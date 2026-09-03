// Template file written into target project's .opencode/plugins/crewmate.ts
export const CREWMATE_PLUGIN = `import { type Plugin, tool } from "@opencode-ai/plugin"
import spawn from "cross-spawn"
import { resolve as pathResolve, relative as pathRelative } from "node:path"

const z = tool.schema

async function runCrewmate(
  directory: string,
  args: string[],
): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn("crewmate", args, {
      cwd: directory,
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    child.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("close", (code) => {
      const text = stdout.trim()
      let parsed: any = null
      if (text) {
        try {
          parsed = JSON.parse(text)
        } catch {
          // not JSON
        }
      }

      if (code !== 0 || !text) {
        let errorDetails = stderr.trim()
        if (!errorDetails && parsed && parsed.error) {
          errorDetails = parsed.error
        }
        if (!errorDetails && text) {
          errorDetails = text
        }
        if (!errorDetails) {
          errorDetails = \`exit code \${code}\`
        }
        return reject(new Error(\`crewmate command failed (\${errorDetails})\`))
      }

      if (parsed !== null) {
        if (parsed.ok === false && parsed.error) {
          return reject(new Error(parsed.error))
        }
        return resolve(parsed)
      }

      reject(new Error(\`crewmate returned invalid JSON: \${text}\`))
    })

    child.on("error", (err) => {
      reject(new Error(\`crewmate process error: \${err.message}\`))
    })
  })
}

interface TrackedSubagentSession {
  agent: string
  taskId?: string
  dispatchedAt: number
}

const CrewmatePlugin: Plugin = async ({ directory }: any) => {
  const targetDir = typeof directory === "string" && directory.trim() ? directory : process.cwd()
  let parentSessionId: string | null = null
  let sessionIdle = false
  const sessionAgentMap = new Map<string, TrackedSubagentSession>()
  const pendingDispatches = new Map<string, { agent: string; taskId?: string; dispatchedAt: number }>()
  const completedTaskSet = new Set<string>()
  const activeLockedTasks = new Set<string>()

  // Send initial session heartbeat
  const pid = process.pid
  runCrewmate(targetDir, ["session", "heartbeat", "--pid", String(pid), "--status", "active"]).catch(() => {})

  const heartbeatInterval = setInterval(async () => {
    const currentStatus = sessionIdle ? "idle" : "active"
    runCrewmate(targetDir, ["session", "heartbeat", "--pid", String(pid), "--status", currentStatus]).catch(() => {})

    // Renew lock leases for all tasks with active locks
    for (const taskId of activeLockedTasks) {
      const locksResult = await runCrewmate(targetDir, ["lock", "list", "--task", taskId]).catch(() => null)
      if (locksResult?.ok && Array.isArray(locksResult.locks) && locksResult.locks.length > 0) {
        const files = locksResult.locks.map((l: any) => l.filePath)
        await runCrewmate(targetDir, ["lock", "acquire", taskId, "--files", ...files]).catch(() => {})
      } else {
        activeLockedTasks.delete(taskId)
      }
    }
  }, 4000)

  return {
    dispose: async () => {
      clearInterval(heartbeatInterval)
      await runCrewmate(targetDir, ["session", "stop"]).catch(() => {})
    },

    tool: {
      crewmate_create_brief: tool({
        description:
          "Create a new crewmate brief. Call this before updating any fields. Returns the brief ID.",
        args: {},
        async execute(_, context) {
          const json = await runCrewmate(context.directory, ["brief", "init"])
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Brief created: \${json.id}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_update_field: tool({
        description: "Update a field on the current crewmate brief. Any field name is accepted. Value can be a plain string or JSON string.",
        args: {
          field: z.string().min(1).describe("Field name"),
          value: z.string().describe("Field value (plain string or JSON string)"),
          id: z
            .string()
            .optional()
            .describe("Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const idArgs = args.id ? ["--id", args.id] : []
          const b64Value = Buffer.from(args.value, "utf-8").toString("base64")
          const json = await runCrewmate(
            context.directory,
            ["brief", "set", args.field, b64Value, "--base64", ...idArgs],
          )
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Set \${args.field}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_get_field: tool({
        description: "Get a field value from the current crewmate brief.",
        args: {
          field: z.string().min(1).describe("Field name"),
          id: z
            .string()
            .optional()
            .describe("Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const idArgs = args.id ? ["--id", args.id] : []
          const json = await runCrewmate(
            context.directory,
            ["brief", "get", args.field, ...idArgs],
          )
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Get \${args.field}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_show_brief: tool({
        description:
          "Show the full crewmate brief as JSON, including all fields and their current values.",
        args: {
          id: z
            .string()
            .optional()
            .describe("Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const idArgs = args.id ? ["--id", args.id] : []
          const json = await runCrewmate(
            context.directory,
            ["brief", "show", ...idArgs],
          )
          if (!json.ok) throw new Error(json.error)
          return {
            title: "Brief details",
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_check_status: tool({
        description:
          "Check the completeness status of the current crewmate brief. Shows which required fields are set vs missing, and whether the brief can be completed.",
        args: {
          id: z
            .string()
            .optional()
            .describe("Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const idArgs = args.id ? ["--id", args.id] : []
          const json = await runCrewmate(
            context.directory,
            ["brief", "status", ...idArgs],
          )
          if (!json.ok) throw new Error(json.error)
          return {
            title: json.complete ? "Brief complete" : "Brief incomplete",
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_finish_brief: tool({
        description:
          "Mark the crewmate brief as complete. This will fail if required fields are not all set. Call crewmate_check_status first to verify readiness.",
        args: {
          id: z
            .string()
            .optional()
            .describe("Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const idArgs = args.id ? ["--id", args.id] : []
          const json = await runCrewmate(
            context.directory,
            ["brief", "complete", ...idArgs],
          )
          if (!json.ok) {
            return {
              title: "Cannot complete brief",
              output: JSON.stringify(json),
            }
          }
          return {
            title: \`Brief \${json.id} completed\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_reopen_brief: tool({
        description: "Reopen a completed brief back to draft status so fields can be modified.",
        args: {
          id: z.string().optional().describe("Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const idArgs = args.id ? ["--id", args.id] : []
          const json = await runCrewmate(context.directory, ["brief", "reopen", ...idArgs])
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Brief \${json.id} reopened to draft\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_delete_brief: tool({
        description: "Delete a brief and cascade-delete all associated tasks, locks, artifacts, events, and workflow runs.",
        args: {
          id: z.string().optional().describe("Brief ID (defaults to latest)"),
          force: z.boolean().optional().describe("Force deletion even if workflow runs or locks are active"),
        },
        async execute(args, context) {
          const cmdParts = ["brief", "delete"]
          if (args.id) cmdParts.push(args.id)
          if (args.force) cmdParts.push("--force")
          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Brief \${json.deletedId} deleted\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_unset_field: tool({
        description: "Remove a field from the current brief.",
        args: {
          field: z.string().describe("Field name to remove"),
          id: z.string().optional().describe("Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const idArgs = args.id ? ["--id", args.id] : []
          const json = await runCrewmate(context.directory, ["brief", "unset", args.field, ...idArgs])
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Removed field: \${args.field}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_add_task: tool({
        description: [
          "Add a new task to a brief.",
          "REQUIRED: briefId, title (concise task summary), description (detailed task implementation instructions).",
          "Optional: dependencies (array of task IDs), field (brief field name), artifactRequirements (array of artifact types: fact, decision, api_contract, constraint, note, log).",
        ].join(" "),
        args: {
          briefId: z.string().min(1).describe("REQUIRED: The brief ID to link this task to"),
          title: z.string().min(1).describe("REQUIRED: Concise task title / summary"),
          description: z.string().min(1).describe("REQUIRED: Detailed task description and requirements"),
          dependencies: z
            .array(z.string())
            .optional()
            .describe("Optional: Array of task IDs that this task depends on"),
          field: z.string().optional().describe("Optional: Brief field this task addresses"),
          artifactRequirements: z
            .array(z.enum(["fact", "decision", "api_contract", "constraint", "note", "log"]))
            .optional()
            .describe("Optional: Required artifact types that must be recorded before completing this task"),
        },
        async execute(args, context) {
          const taskTitle = args.title ? args.title.trim() : args.description.trim().split(/\\r?\\n/)[0]
          const taskDescription = args.description.trim()

          const cmdParts = ["task", "add", args.briefId, "--title", taskTitle, "--description", taskDescription]
          if (args.dependencies && args.dependencies.length > 0) {
            cmdParts.push("--dependencies", ...args.dependencies)
          }
          if (args.field) cmdParts.push("--field", args.field)
          if (args.artifactRequirements && args.artifactRequirements.length > 0) {
            cmdParts.push("--artifact-requirements", ...args.artifactRequirements)
          }
          
          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Added task: \${json.title}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_list_tasks: tool({
        description: "List all tasks for a brief. REQUIRED: briefId.",
        args: {
          briefId: z.string().min(1).describe("REQUIRED: The brief ID to list tasks for"),
        },
        async execute(args, context) {
          const json = await runCrewmate(context.directory, ["task", "list", "--brief", args.briefId])
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Tasks for brief \${args.briefId}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_update_task: tool({
        description: [
          "Update a task's status or details.",
          "REQUIRED: taskId.",
          "Optional: status (pending | in_progress | completed), title, description, field, dependencies (array of task IDs), artifactRequirements.",
        ].join(" "),
        args: {
          taskId: z.string().min(1).describe("REQUIRED: The task ID to update"),
          status: z.enum(["pending", "in_progress", "completed"]).optional().describe("Optional: New status"),
          title: z.string().optional().describe("Optional: New task title"),
          description: z.string().optional().describe("Optional: New task description"),
          field: z.string().optional().describe("Optional: Brief field this task addresses"),
          dependencies: z.array(z.string()).optional().describe("Optional: Updated dependency task IDs"),
          artifactRequirements: z
            .array(z.enum(["fact", "decision", "api_contract", "constraint", "note", "log"]))
            .optional()
            .describe("Optional: Required artifact types before completion"),
        },
        async execute(args, context) {
          const cmdParts = ["task", "update", args.taskId]
          if (args.status) cmdParts.push("--status", args.status)
          if (args.title) cmdParts.push("--title", args.title)
          if (args.description) cmdParts.push("--description", args.description)
          if (args.field) cmdParts.push("--field", args.field)
          if (args.dependencies && args.dependencies.length > 0) {
            cmdParts.push("--dependencies", ...args.dependencies)
          }
          if (args.artifactRequirements && args.artifactRequirements.length > 0) {
            cmdParts.push("--artifact-requirements", ...args.artifactRequirements)
          }

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Updated task \${args.taskId}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_clear_tasks: tool({
        description: "Clear all tasks associated with a brief.",
        args: {
          briefId: z.string().optional().describe("Optional: Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const cmdParts = ["task", "clear"]
          if (args.briefId) cmdParts.push("--brief", args.briefId)
          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Cleared tasks for brief \${json.briefId}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_remove_task: tool({
        description: "Remove a task from a brief. REQUIRED: taskId.",
        args: {
          taskId: z.string().min(1).describe("REQUIRED: The task ID to remove"),
        },
        async execute(args, context) {
          const json = await runCrewmate(context.directory, ["task", "remove", args.taskId])
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Removed task \${args.taskId}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_acquire_lock: tool({
        description:
          "Acquire write locks on files for a task to prevent collisions during parallel execution. REQUIRED: taskId, files.",
        args: {
          taskId: z.string().min(1).describe("REQUIRED: The task ID acquiring locks"),
          files: z.array(z.string()).min(1).describe("REQUIRED: Array of relative file paths to lock"),
        },
        async execute(args, context) {
          const json = await runCrewmate(context.directory, [
            "lock",
            "acquire",
            args.taskId,
            "--files",
            ...args.files,
          ])
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Locked \${args.files.length} file(s) for task \${args.taskId}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_release_lock: tool({
        description:
          "Release file locks held by a task after execution completes or on failure. REQUIRED: taskId. Optional: files.",
        args: {
          taskId: z.string().min(1).describe("REQUIRED: The task ID releasing locks"),
          files: z.array(z.string()).optional().describe("Optional: Specific file paths to release"),
        },
        async execute(args, context) {
          const cmdParts = ["lock", "release", args.taskId]
          if (args.files && args.files.length > 0) {
            cmdParts.push("--files", ...args.files)
          }
          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Released locks for task \${args.taskId}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_list_locks: tool({
        description: "List currently held file locks. Optional: taskId.",
        args: {
          taskId: z.string().optional().describe("Optional: Filter locks by task ID"),
        },
        async execute(args, context) {
          const cmdParts = ["lock", "list"]
          if (args.taskId) {
            cmdParts.push("--task", args.taskId)
          }
          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: "Active file locks",
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_clear_locks: tool({
        description: "Force release all file locks, or all locks held by a specific task (for crash recovery or deadlocks).",
        args: {
          taskId: z.string().optional().describe("Optional: Release only locks held by this task ID"),
        },
        async execute(args, context) {
          const cmdParts = ["lock", "clear"]
          if (args.taskId) cmdParts.push("--task", args.taskId)
          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Cleared \${json.released} lock(s)\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_add_artifact: tool({
        description: [
          "Add an execution artifact / incremental knowledge fact for a task or brief.",
          "Optional: taskId (omit for brief-level facts/constraints discovered during briefing).",
          "REQUIRED: type (fact | decision | api_contract | constraint | note | log), content (plain string or structured JSON).",
          "Optional: briefId, tags.",
        ].join(" "),
        args: {
          type: z
            .enum(["fact", "decision", "api_contract", "constraint", "note", "log"])
            .describe("REQUIRED: Artifact category"),
          content: z.string().min(1).describe("REQUIRED: Artifact text, contract, decision, or JSON payload"),
          taskId: z.string().optional().describe("Optional: The task ID creating this artifact (omit for brief-level findings)"),
          briefId: z.string().optional().describe("Optional: Brief ID"),
          tags: z.array(z.string()).optional().describe("Optional: Categorization tags"),
        },
        async execute(args, context) {
          const cmdParts = [
            "artifact",
            "add",
          ]
          if (args.taskId) {
            cmdParts.push(args.taskId)
          }
          const b64Content = Buffer.from(args.content, "utf-8").toString("base64")
          cmdParts.push(
            "--type",
            args.type,
            "--content",
            b64Content,
            "--base64",
          )
          if (args.briefId) {
            cmdParts.push("--brief", args.briefId)
          }
          if (args.tags && args.tags.length > 0) {
            cmdParts.push("--tags", ...args.tags)
          }
          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Added \${args.type} artifact\${args.taskId ? \` for task \${args.taskId}\` : ""}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_list_artifacts: tool({
        description:
          "List incremental knowledge artifacts (facts, decisions, api_contracts, constraints). Optional: briefId, taskId, forTask, type, status.",
        args: {
          briefId: z.string().optional().describe("Optional: Brief ID filter"),
          taskId: z.string().optional().describe("Optional: Task ID filter"),
          forTask: z.string().optional().describe("Optional: Smart DAG filter — returns relevant ancestor artifacts and brief-level constraints for a task"),
          type: z
            .enum(["fact", "decision", "api_contract", "constraint", "note", "log"])
            .optional()
            .describe("Optional: Artifact category filter"),
          status: z
            .enum(["active", "superseded", "invalidated", "all"])
            .optional()
            .describe("Optional: Artifact status filter (default: active)"),
        },
        async execute(args, context) {
          const cmdParts = ["artifact", "list"]
          if (args.briefId) cmdParts.push("--brief", args.briefId)
          if (args.taskId) cmdParts.push("--task", args.taskId)
          if (args.forTask) cmdParts.push("--for-task", args.forTask)
          if (args.type) cmdParts.push("--type", args.type)
          if (args.status) cmdParts.push("--status", args.status)

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: "Execution artifacts",
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_supersede_artifact: tool({
        description: "Mark an older artifact as superseded by a newer one.",
        args: {
          oldId: z.string().describe("The ID of the obsolete artifact being replaced"),
          newId: z.string().describe("The ID of the new artifact replacing it"),
        },
        async execute(args, context) {
          const json = await runCrewmate(context.directory, ["artifact", "supersede", args.oldId, args.newId])
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Artifact \${args.oldId} superseded by \${args.newId}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_invalidate_artifact: tool({
        description: "Mark an artifact as invalidated / obsolete.",
        args: {
          id: z.string().describe("The artifact ID to invalidate"),
        },
        async execute(args, context) {
          const json = await runCrewmate(context.directory, ["artifact", "invalidate", args.id])
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Artifact \${args.id} invalidated\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_add_event: tool({
        description: [
          "Record a workflow lifecycle event for the live watch dashboard.",
          "REQUIRED: actor (frontman | scout | planner | executor), type (dispatched | started | locked | artifact | completed | error), message.",
          "Optional: taskId, briefId (defaults to task brief or latest).",
        ].join(" "),
        args: {
          actor: z
            .enum(["frontman", "scout", "planner", "executor"])
            .describe("REQUIRED: Agent that emitted the event"),
          type: z
            .enum(["dispatched", "started", "locked", "artifact", "completed", "error"])
            .describe("REQUIRED: Event type"),
          message: z.string().min(1).describe("REQUIRED: Human-readable event description"),
          taskId: z.string().optional().describe("Optional: Task this event relates to"),
          briefId: z.string().optional().describe("Optional: Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const cmdParts = [
            "event",
            "add",
            "--actor",
            args.actor,
            "--type",
            args.type,
            "--message",
            args.message,
          ]
          if (args.taskId) cmdParts.push("--task", args.taskId)
          if (args.briefId) cmdParts.push("--brief", args.briefId)

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Added \${args.type} event from \${args.actor}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_list_events: tool({
        description:
          "List workflow lifecycle events (dispatch, start, lock, artifact, completion, error). Optional: briefId, taskId, actor, type, limit.",
        args: {
          briefId: z.string().optional().describe("Optional: Brief ID filter"),
          taskId: z.string().optional().describe("Optional: Task ID filter"),
          actor: z
            .enum(["frontman", "scout", "planner", "executor"])
            .optional()
            .describe("Optional: Actor filter"),
          type: z
            .enum(["dispatched", "started", "locked", "artifact", "completed", "error"])
            .optional()
            .describe("Optional: Event type filter"),
          limit: z
            .string()
            .optional()
            .describe("Optional: Max number of events to return"),
        },
        async execute(args, context) {
          const cmdParts = ["event", "list"]
          if (args.briefId) cmdParts.push("--brief", args.briefId)
          if (args.taskId) cmdParts.push("--task", args.taskId)
          if (args.actor) cmdParts.push("--actor", args.actor)
          if (args.type) cmdParts.push("--type", args.type)
          if (args.limit) cmdParts.push("--limit", args.limit)

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: "Workflow events",
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_set_activity: tool({
        description: [
          "Set Frontman's active state for the live watch dashboard.",
          "REQUIRED: activityType (questioning | awaiting_response | analyzing | planning | orchestrating | reviewing | idle).",
          "Optional: message (context or question description), briefId (defaults to latest).",
        ].join(" "),
        args: {
          activityType: z
            .enum([
              "questioning",
              "awaiting_response",
              "analyzing",
              "planning",
              "orchestrating",
              "reviewing",
              "idle",
            ])
            .describe("REQUIRED: Frontman activity type"),
          message: z.string().optional().describe("Optional: Context or description of what Frontman is doing"),
          briefId: z.string().optional().describe("Optional: Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const cmdParts = ["activity", "set", args.activityType]
          if (args.message) {
            cmdParts.push("--message", args.message)
          }
          if (args.briefId) {
            cmdParts.push("--brief", args.briefId)
          }

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Set Frontman activity to \${args.activityType}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_get_activity: tool({
        description: "Get Frontman's current active state. Optional: briefId.",
        args: {
          briefId: z.string().optional().describe("Optional: Brief ID filter"),
        },
        async execute(args, context) {
          const cmdParts = ["activity", "get"]
          if (args.briefId) cmdParts.push("--brief", args.briefId)

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: "Frontman activity",
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_workflow_start: tool({
        description:
          "Start a graph-based workflow run. Binds to a brief and loads the default or custom workflow.",
        args: {
          briefId: z.string().optional().describe("Optional: Brief ID (defaults to active)"),
          file: z.string().optional().describe("Optional: Path to custom workflow JSON file"),
          context: z.string().optional().describe("Optional: Initial context JSON string"),
        },
        async execute(args, context) {
          const cmdParts = ["workflow", "start", "--agent-summary"]
          if (args.briefId) cmdParts.push("--brief", args.briefId)
          if (args.file) cmdParts.push("--file", args.file)
          if (args.context) cmdParts.push("--context", args.context)

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Workflow run started: \${json.data?.id || "ok"}\`,
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_workflow_status: tool({
        description:
          "Get the active workflow run status, current stage, stages list, and context.",
        args: {
          runId: z.string().optional().describe("Optional: Workflow run ID (defaults to active)"),
          briefId: z.string().optional().describe("Optional: Brief ID filter"),
        },
        async execute(args, context) {
          const cmdParts = ["workflow", "status", "--agent-summary"]
          if (args.runId) cmdParts.push("--run", args.runId)
          if (args.briefId) cmdParts.push("--brief", args.briefId)

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: "Workflow run status",
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_workflow_advance: tool({
        description:
          "Advance the workflow run to the next stage after completing the current stage's work.",
        args: {
          runId: z.string().optional().describe("Optional: Workflow run ID (defaults to active)"),
          outputs: z.string().optional().describe("Optional: JSON string of outputs/context to pass downstream"),
        },
        async execute(args, context) {
          const cmdParts = ["workflow", "advance", "--agent-summary"]
          if (args.runId) cmdParts.push("--run", args.runId)
          if (args.outputs) cmdParts.push("--outputs", args.outputs)

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Advanced workflow stage\`,
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_workflow_skip: tool({
        description:
          "Skip a stage in the active workflow run and proceed to the next.",
        args: {
          stageId: z.string().min(1).describe("REQUIRED: Stage ID to skip"),
          runId: z.string().optional().describe("Optional: Workflow run ID (defaults to active)"),
        },
        async execute(args, context) {
          const cmdParts = ["workflow", "skip", args.stageId, "--agent-summary"]
          if (args.runId) cmdParts.push("--run", args.runId)

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Skipped stage \${args.stageId}\`,
            output: JSON.stringify(json, null, 2),
          }
        },
      }),

      crewmate_workflow_cancel: tool({
        description: "Cancel an active or paused workflow run.",
        args: {
          runId: z.string().optional().describe("Optional: Workflow run ID (defaults to active)"),
        },
        async execute(args, context) {
          const cmdParts = ["workflow", "cancel"]
          if (args.runId) cmdParts.push("--run", args.runId)
          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Workflow run cancelled: \${json.data?.id || args.runId}\`,
            output: JSON.stringify(json, null, 2),
          }
        },
      }),
    },

    "tool.execute.before": async (input: any, output: any) => {
      const toolName = input?.tool
      const callID = input?.callID
      const args = output?.args || input?.args || {}

      // Enforce active workflow node gates (tool permissions)
      // Orchestration tools (subagent dispatching, user questions, workflow lifecycle) bypass node-level gates
      const ORCHESTRATION_BYPASS = ["task", "question"]
      if (
        toolName &&
        !toolName.startsWith("crewmate_workflow_") &&
        !ORCHESTRATION_BYPASS.includes(toolName)
      ) {
        try {
          const wfStatus = await runCrewmate(targetDir, ["workflow", "status", "--agent-summary"]).catch(() => null)
          if (wfStatus?.ok && wfStatus.data?.status === "running") {
            const activeNodes = wfStatus.data.activeNodes || []
            for (const node of activeNodes) {
              if (Array.isArray(node.deniedTools) && node.deniedTools.includes(toolName)) {
                throw new Error(\`Gate restriction: tool '\${toolName}' is forbidden during the '\${node.name || node.id}' step.\`)
              }
              if (Array.isArray(node.allowedTools) && !node.allowedTools.includes(toolName)) {
                throw new Error(\`Gate restriction: tool '\${toolName}' is not permitted during the '\${node.name || node.id}' step. Allowed tools: \${node.allowedTools.join(", ")}\`)
              }
            }
          }
        } catch (gateErr: any) {
          if (gateErr?.message && gateErr.message.startsWith("Gate restriction:")) {
            throw gateErr
          }
        }
      }

      // Enforce lock ownership before file-modifying tools - throws on conflict to block execution
      if ((toolName === "edit" || toolName === "write") && args) {
        const filePath = args.filePath || args.file_path || args.path || ""
        if (typeof filePath === "string" && filePath.trim()) {
          let locksResult: any = null
          try {
            locksResult = await runCrewmate(targetDir, ["lock", "list"])
          } catch (err) {
            console.error("[crewmate] lock check error:", err)
          }

          if (locksResult?.ok && Array.isArray(locksResult.locks)) {
            const resolved = pathResolve(filePath.trim())
            const root = targetDir
            let rel = pathRelative(root, resolved).replace(/\\\\/g, "/")
            if (process.platform === "win32" || process.platform === "darwin") {
              rel = rel.toLowerCase()
            }
            const lockForFile = locksResult.locks.find((l: any) => {
              const lp = (process.platform === "win32" || process.platform === "darwin")
                ? l.filePath.toLowerCase()
                : l.filePath
              return lp === rel
            })
            if (lockForFile) {
              const currentSessionId = input?.sessionID || input?.sessionId
              const trackedForSession = currentSessionId ? sessionAgentMap.get(currentSessionId) : null
              const isOwner = trackedForSession?.taskId
                ? trackedForSession.taskId === lockForFile.taskId
                : false

              // If the current session is not the owner of this lock (or session is unknown/untracked but locked)
              if (!isOwner) {
                await runCrewmate(targetDir, [
                  "event", "add",
                  "--actor", "executor",
                  "--type", "error",
                  "--task", lockForFile.taskId,
                  "--message", \`Lock violation: \${toolName} on \${rel} locked by task \${lockForFile.taskId}\`,
                ]).catch(() => {})
                throw new Error(\`File is locked by task \${lockForFile.taskId}: \${rel}. Acquire the lock first or wait for the task to complete.\`)
              }
            }
          }
        }
      }

      // Non-blocking hooks: heartbeat, prompt injection, and dispatch event tracking
      try {
        if (sessionIdle) {
          sessionIdle = false
          await runCrewmate(targetDir, [
            "session",
            "heartbeat",
            "--pid",
            String(pid),
            "--status",
            "active",
          ]).catch(() => {})
        }

        if (toolName === "task" && args) {
          const subagent = String(args.subagent_type || args.agent || "").toLowerCase()
          if (["scout", "planner", "executor"].includes(subagent)) {
            let taskId = args.task_id || args.taskId
            if (!taskId && subagent === "executor" && typeof args.prompt === "string") {
              const match = args.prompt.match(/(?:taskId|task_id|task\s*id|task\s*[:=#])\s*([0-9a-f]{8})\b/i)
              if (match) taskId = match[1]
            }
            let msg = \`Dispatched \${subagent}\`
            if (subagent === "scout") {
              msg = "Dispatched scout to explore the codebase"
            } else if (subagent === "planner") {
              msg = "Dispatched planner to decompose the brief into tasks"
            } else if (subagent === "executor") {
              const taskDesc = args.description || args.title || "task"
              const firstLine = String(taskDesc).trim().split(/\\r?\\n/)[0].slice(0, 60)
              msg = \`Dispatched executor for \${firstLine}\`
            }

            if (subagent === "executor" && taskId) {
              // Fetch relevant upstream artifacts and inject into executor prompt
              const upstream = await runCrewmate(targetDir, [
                "artifact",
                "list",
                "--for-task",
                taskId,
                "--status",
                "active",
              ]).catch(() => null)

              if (upstream?.ok && Array.isArray(upstream.artifacts) && upstream.artifacts.length > 0) {
                const lines = upstream.artifacts.map((a: any) => {
                  let payloadSummary = a.content
                  try {
                    const parsed = JSON.parse(a.content)
                    if (parsed.statement) payloadSummary = parsed.statement
                    else if (parsed.choice) payloadSummary = \`\${parsed.choice} (\${parsed.rationale || ""})\`
                    else if (parsed.signature) payloadSummary = \`\${parsed.filePath ? \`[\${parsed.filePath}] \` : ""}\${parsed.signature}\`
                    else if (parsed.rule) payloadSummary = \`[\${parsed.severity || "must"}] \${parsed.rule}\`
                    else if (parsed.summary) payloadSummary = parsed.summary
                  } catch {
                    // plain text
                  }
                  return \`- [\${a.type.toUpperCase()}] \${payloadSummary}\`
                })

                const injection = \`\\n\\n<prior_knowledge_artifacts>\\nArchitectural contracts and constraints from previous tasks/briefing (must adhere to):\\n\${lines.join("\\n")}\\n</prior_knowledge_artifacts>\`
                if (output?.args && typeof output.args.prompt === "string") {
                  output.args.prompt += injection
                } else if (input?.args && typeof input.args.prompt === "string") {
                  input.args.prompt += injection
                }
              }
            }

            if (callID) {
              pendingDispatches.set(callID, {
                agent: subagent,
                taskId,
                dispatchedAt: Date.now(),
              })
            }

            // Check if a dispatch event for this agent or task was recorded in the last 4 seconds
            const recent = await runCrewmate(targetDir, [
              "event",
              "list",
              "--actor",
              "frontman",
              "--type",
              "dispatched",
              "--limit",
              "5",
            ]).catch(() => null)

            const isDuplicate =
              recent?.ok &&
              Array.isArray(recent.events) &&
              recent.events.some((e: any) => {
                const age = Date.now() - new Date(e.createdAt).getTime()
                if (age > 4000) return false
                if (taskId && e.taskId === taskId) return true
                if (!taskId && !e.taskId && e.message === msg) return true
                return false
              })

            if (!isDuplicate) {
              const cmdParts = [
                "event",
                "add",
                "--actor",
                "frontman",
                "--type",
                "dispatched",
                "--message",
                msg,
              ]
              if (taskId) {
                cmdParts.push("--task", taskId)
              }
              await runCrewmate(targetDir, cmdParts).catch(() => {})
            }
          }
        }
      } catch (err) {
        console.error("[crewmate] dispatch tracking error:", err)
      }
    },

    "tool.execute.after": async (input: any, output: any) => {
      try {
        const toolName = input?.tool
        const args = input?.args || {}
        const rawOutput = output?.output

        let parsedOutput: any = null
        if (rawOutput) {
          try {
            parsedOutput = JSON.parse(rawOutput)
          } catch {
            parsedOutput = null
          }
        }

        if (toolName === "crewmate_update_task" && args?.taskId && args?.status) {
          const taskId = args.taskId
          const status = args.status
          if (status === "in_progress") {
            const taskTitle = parsedOutput?.title || taskId
            await runCrewmate(targetDir, [
              "event",
              "add",
              "--actor",
              "executor",
              "--type",
              "started",
              "--task",
              taskId,
              "--message",
              \`Started task \${taskTitle}\`,
            ]).catch(() => {})
          } else if (status === "completed") {
            completedTaskSet.add(taskId)
            const taskTitle = parsedOutput?.title || taskId
            await runCrewmate(targetDir, [
              "event",
              "add",
              "--actor",
              "executor",
              "--type",
              "completed",
              "--task",
              taskId,
              "--message",
              \`Completed task \${taskTitle}\`,
            ]).catch(() => {})
          }
        }

        if (toolName === "crewmate_acquire_lock" && args?.taskId && Array.isArray(args?.files)) {
          const taskId = args.taskId
          const count = args.files.length
          // Only track locks if acquisition actually succeeded
          if (parsedOutput && parsedOutput.ok !== false) {
            const taskTitle = parsedOutput?.taskTitle || taskId
            activeLockedTasks.add(taskId)
            await runCrewmate(targetDir, [
              "event",
              "add",
              "--actor",
              "executor",
              "--type",
              "locked",
              "--task",
              taskId,
              "--message",
              \`Locked \${count} file(s) for task \${taskTitle}\`,
            ]).catch(() => {})
          }
        }

        if (toolName === "crewmate_release_lock" && args?.taskId) {
          if (!args.files || args.files.length === 0) {
            activeLockedTasks.delete(args.taskId)
          }
        }
      } catch (err) {
        console.error("[crewmate] post-tool event error:", err)
      }
    },

    event: async ({ event }: { event: any }) => {
      try {
        if (event.type === "message.part.updated") {
          const part = event.properties?.part
          if (part?.type === "subtask" && part?.callID && part?.sessionID) {
            const pending = pendingDispatches.get(part.callID)
            if (pending) {
              sessionAgentMap.set(part.sessionID, {
                agent: pending.agent,
                taskId: pending.taskId,
                dispatchedAt: pending.dispatchedAt,
              })
              pendingDispatches.delete(part.callID)
            }
          }
        }

        if (event.type === "session.created") {
          const sessionInfo = event.properties?.info
          if (sessionInfo?.id && !sessionInfo?.parentID) {
            parentSessionId = sessionInfo.id
          }
          if (sessionInfo?.parentID && sessionInfo?.id && !sessionAgentMap.has(sessionInfo.id)) {
            // Find pending dispatches within timeout window - only correlate if unambiguous
            const recentMatches: Array<{ callId: string; pending: any }> = []
            for (const [callId, pending] of pendingDispatches.entries()) {
              if (Date.now() - pending.dispatchedAt < 10000) {
                recentMatches.push({ callId, pending })
              }
            }
            if (recentMatches.length === 1) {
              const { callId, pending } = recentMatches[0]
              sessionAgentMap.set(sessionInfo.id, {
                agent: pending.agent,
                taskId: pending.taskId,
                dispatchedAt: pending.dispatchedAt,
              })
              pendingDispatches.delete(callId)
            }
          }
        }

        if (event.type === "session.idle") {
          const sessionID = event.properties?.sessionID
          if (sessionID && sessionAgentMap.has(sessionID)) {
            const tracked = sessionAgentMap.get(sessionID)!
            sessionAgentMap.delete(sessionID)

            // If executor already emitted completed event via crewmate_update_task, skip duplicate session.idle event
            const alreadyCompleted = tracked.taskId && completedTaskSet.has(tracked.taskId)
            if (alreadyCompleted && tracked.taskId) {
              completedTaskSet.delete(tracked.taskId)
            } else {
              let msg = \`Completed \${tracked.agent}\`
              if (tracked.agent === "scout") {
                msg = "Finished codebase exploration"
              } else if (tracked.agent === "planner") {
                msg = "Finished task breakdown"
              } else if (tracked.agent === "executor") {
                msg = tracked.taskId ? \`Completed executor for task \${tracked.taskId}\` : "Completed task implementation"
              }

              const cmdParts = [
                "event",
                "add",
                "--actor",
                tracked.agent,
                "--type",
                "completed",
                "--message",
                msg,
              ]
              if (tracked.taskId) {
                cmdParts.push("--task", tracked.taskId)
              }
              await runCrewmate(targetDir, cmdParts).catch(() => {})
            }
          } else if (sessionID && (sessionID === parentSessionId || !parentSessionId)) {
            // Parent session went idle (user interrupted or waiting for user prompt)
            sessionIdle = true

            // Flush any remaining active subagents that never completed (interrupted)
            for (const [, tracked] of sessionAgentMap.entries()) {
              const msg = \`Interrupted \${tracked.agent}\${tracked.taskId ? \` for task \${tracked.taskId}\` : ""}\`
              const cmdParts = [
                "event",
                "add",
                "--actor",
                tracked.agent,
                "--type",
                "error",
                "--message",
                msg,
              ]
              if (tracked.taskId) {
                cmdParts.push("--task", tracked.taskId)
              }
              await runCrewmate(targetDir, cmdParts).catch(() => {})

              // Revert interrupted task back to pending and release locks
              if (tracked.taskId) {
                activeLockedTasks.delete(tracked.taskId)
                await runCrewmate(targetDir, [
                  "task",
                  "update",
                  tracked.taskId,
                  "--status",
                  "pending",
                ]).catch(() => {})
                await runCrewmate(targetDir, [
                  "lock",
                  "release",
                  tracked.taskId,
                ]).catch(() => {})
              }
            }
            sessionAgentMap.clear()
            pendingDispatches.clear()
            activeLockedTasks.clear()

            await runCrewmate(targetDir, [
              "session",
              "heartbeat",
              "--pid",
              String(pid),
              "--status",
              "idle",
            ]).catch(() => {})
          }
        }

        if (event.type === "session.error") {
          const sessionID = event.properties?.sessionID
          if (sessionID && sessionAgentMap.has(sessionID)) {
            const tracked = sessionAgentMap.get(sessionID)!
            sessionAgentMap.delete(sessionID)

            const errorData = event.properties?.error
            const errMsg = errorData?.data?.message || errorData?.name || "Subagent execution error"
            const msg = \`Error in \${tracked.agent}: \${errMsg}\`.slice(0, 120)

            const cmdParts = [
              "event",
              "add",
              "--actor",
              tracked.agent,
              "--type",
              "error",
              "--message",
              msg,
            ]
            if (tracked.taskId) {
              cmdParts.push("--task", tracked.taskId)
            }
            await runCrewmate(targetDir, cmdParts).catch(() => {})

            // Revert failed task back to pending and release locks
            if (tracked.taskId) {
              activeLockedTasks.delete(tracked.taskId)
              await runCrewmate(targetDir, [
                "task",
                "update",
                tracked.taskId,
                "--status",
                "pending",
              ]).catch(() => {})
              await runCrewmate(targetDir, [
                "lock",
                "release",
                tracked.taskId,
              ]).catch(() => {})
            }
          }
        }
      } catch (err) {
        console.error("[crewmate] event handler error:", err)
      }
    },
  }
}

export default CrewmatePlugin
`;
