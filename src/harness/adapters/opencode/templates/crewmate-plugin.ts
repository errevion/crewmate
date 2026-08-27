// Template file written into target project's .opencode/plugins/crewmate.ts
export const CREWMATE_PLUGIN = `import { type Plugin, tool } from "@opencode-ai/plugin"
import spawn from "cross-spawn"

const z = tool.schema

const VALID_FIELDS = [
  "workType",
  "goal",
  "scope",
  "functionalRequirements",
  "technicalStack",
  "constraints",
  "existingCodebase",
  "referenceMaterials",
  "acceptanceCriteria",
  "qualityStandards",
  "dependencies",
  "risks",
  "deliverables",
] as const

const VALID_FIELDS_STR = VALID_FIELDS.join(", ")

const FIELD_SCHEMAS = {
  workType: z.enum(["software", "infrastructure", "data", "documentation", "audit"]),
  goal: z.string().min(1),
  scope: z.object({
    included: z.array(z.string()),
    excluded: z.array(z.string()),
  }),
  functionalRequirements: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  technicalStack: z.object({
    frontend: z.array(z.string()),
    backend: z.array(z.string()),
    database: z.array(z.string()),
    tools: z.array(z.string()),
  }),
  constraints: z.object({
    exclusions: z.array(z.string()),
    requirements: z.array(z.string()),
  }),
  existingCodebase: z.array(z.string()),
  referenceMaterials: z.array(z.string()),
  qualityStandards: z.object({
    performance: z.record(z.string(), z.unknown()),
    security: z.record(z.string(), z.unknown()),
    accessibility: z.record(z.string(), z.unknown()),
  }),
  dependencies: z.array(z.string()),
  risks: z.array(z.string()),
      deliverables: z.array(
    z.object({
      type: z.enum(["code", "doc", "report"]),
      format: z.enum(["file", "repo", "presentation"]),
    }),
  ),
} as const

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

  // Send initial session heartbeat
  const pid = process.pid
  runCrewmate(targetDir, ["session", "heartbeat", "--pid", String(pid), "--status", "active"]).catch(() => {})

  const heartbeatInterval = setInterval(() => {
    const currentStatus = sessionIdle ? "idle" : "active"
    runCrewmate(targetDir, ["session", "heartbeat", "--pid", String(pid), "--status", currentStatus]).catch(() => {})
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
        description: [
          "Update a field on the current crewmate brief.",
          "Simple: workType ('software'|'infrastructure'|'data'|'documentation'|'audit'), goal (string).",
          "Complex (JSON string): scope {included:[],excluded:[]}, technicalStack {frontend:[],backend:[],database:[],tools:[]}, constraints {exclusions:[],requirements:[]}, deliverables [{type,format}], all other complex fields string[].",
        ].join(" "),
        args: {
          field: z.enum(VALID_FIELDS),
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
        description: \`Get a field value from the current crewmate brief. Valid fields: \${VALID_FIELDS_STR}.\`,
        args: {
          field: z.enum(VALID_FIELDS),
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
          "Check the completeness status of the current crewmate brief. Shows which required fields (workType, goal, scope, functionalRequirements, acceptanceCriteria) are set vs missing, and whether the brief can be completed.",
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
          "Mark the crewmate brief as complete. This will fail if required fields (workType, goal, scope, functionalRequirements, acceptanceCriteria) are not all set. Call crewmate_check_status first to verify readiness.",
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

      crewmate_add_task: tool({
        description: [
          "Add a new task to a brief.",
          "REQUIRED: briefId, description.",
          "Optional: title (short summary; if omitted, derived from description), dependencies (array of task IDs), field (brief field name).",
        ].join(" "),
        args: {
          briefId: z.string().min(1).describe("REQUIRED: The brief ID to link this task to"),
          description: z.string().min(1).describe("REQUIRED: Task description"),
          title: z
            .string()
            .optional()
            .describe("Optional: Task title (if omitted, auto-generated from description)"),
          dependencies: z
            .array(z.string())
            .optional()
            .describe("Optional: Array of task IDs that this task depends on"),
          field: z.string().optional().describe("Optional: Brief field this task addresses"),
        },
        async execute(args, context) {
          const taskTitle = args.title && args.title.trim().length > 0
            ? args.title.trim()
            : args.description.trim().split(/\\r?\\n/)[0].slice(0, 80)
          const taskDescription = args.description.trim()

          const cmdParts = ["task", "add", args.briefId, "--title", taskTitle, "--description", taskDescription]
          if (args.dependencies && args.dependencies.length > 0) {
            cmdParts.push("--dependencies", ...args.dependencies)
          }
          if (args.field) cmdParts.push("--field", args.field)
          
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
          "Update a task's status.",
          "REQUIRED: taskId, status (pending | in_progress | completed).",
        ].join(" "),
        args: {
          taskId: z.string().min(1).describe("REQUIRED: The task ID to update"),
          status: z.enum(["pending", "in_progress", "completed"]).describe("REQUIRED: New status"),
        },
        async execute(args, context) {
          const json = await runCrewmate(context.directory, [
            "task",
            "update",
            args.taskId,
            "--status",
            args.status,
          ])
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Updated task \${args.taskId} to \${args.status}\`,
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

      crewmate_add_artifact: tool({
        description: [
          "Add an execution artifact / incremental knowledge fact for a task.",
          "REQUIRED: taskId, type (fact | decision | api_contract | constraint | note | log), content.",
          "Optional: briefId.",
        ].join(" "),
        args: {
          taskId: z.string().min(1).describe("REQUIRED: The task ID creating this artifact"),
          type: z
            .enum(["fact", "decision", "api_contract", "constraint", "note", "log"])
            .describe("REQUIRED: Artifact category"),
          content: z.string().min(1).describe("REQUIRED: Artifact text, contract, decision, or note"),
          briefId: z.string().optional().describe("Optional: Brief ID"),
        },
        async execute(args, context) {
          const cmdParts = [
            "artifact",
            "add",
            args.taskId,
            "--type",
            args.type,
            "--content",
            args.content,
          ]
          if (args.briefId) {
            cmdParts.push("--brief", args.briefId)
          }
          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: \`Added \${args.type} artifact for task \${args.taskId}\`,
            output: JSON.stringify(json),
          }
        },
      }),

      crewmate_list_artifacts: tool({
        description:
          "List incremental knowledge artifacts (facts, decisions, api_contracts, constraints). Optional: briefId, taskId, type.",
        args: {
          briefId: z.string().optional().describe("Optional: Brief ID filter"),
          taskId: z.string().optional().describe("Optional: Task ID filter"),
          type: z
            .enum(["fact", "decision", "api_contract", "constraint", "note", "log"])
            .optional()
            .describe("Optional: Artifact category filter"),
        },
        async execute(args, context) {
          const cmdParts = ["artifact", "list"]
          if (args.briefId) cmdParts.push("--brief", args.briefId)
          if (args.taskId) cmdParts.push("--task", args.taskId)
          if (args.type) cmdParts.push("--type", args.type)

          const json = await runCrewmate(context.directory, cmdParts)
          if (!json.ok) throw new Error(json.error)
          return {
            title: "Execution artifacts",
            output: JSON.stringify(json, null, 2),
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
    },

    "tool.execute.before": async (input: any, output: any) => {
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
        const toolName = input?.tool
        const callID = input?.callID
        const args = output?.args || input?.args || {}
        if (toolName === "task" && args) {
          const subagent = String(args.subagent_type || args.agent || "").toLowerCase()
          if (["scout", "planner", "executor"].includes(subagent)) {
            let taskId = args.task_id || args.taskId
            if (!taskId && subagent === "executor" && typeof args.prompt === "string") {
              const match = args.prompt.match(/(?:taskId|task_id|task\\s+id|task)\\s*[:=]?\\s*([0-9a-f]{8})\\b/i) || args.prompt.match(/\\b([0-9a-f]{8})\\b/i)
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
      } catch {
        // Guardrail should not break tool execution
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
          const taskTitle = parsedOutput?.taskTitle || taskId
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
      } catch {
        // Guardrail should not break tool execution
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
            // Find most recently dispatched pending task as fallback correlation
            let bestCallId: string | null = null
            let latestTime = 0
            for (const [callId, pending] of pendingDispatches.entries()) {
              if (pending.dispatchedAt > latestTime && Date.now() - pending.dispatchedAt < 10000) {
                latestTime = pending.dispatchedAt
                bestCallId = callId
              }
            }
            if (bestCallId) {
              const pending = pendingDispatches.get(bestCallId)!
              sessionAgentMap.set(sessionInfo.id, {
                agent: pending.agent,
                taskId: pending.taskId,
                dispatchedAt: pending.dispatchedAt,
              })
              pendingDispatches.delete(bestCallId)
            }
          }
        }

        if (event.type === "session.idle") {
          const sessionID = event.properties?.sessionID
          if (sessionID && sessionAgentMap.has(sessionID)) {
            const tracked = sessionAgentMap.get(sessionID)!
            sessionAgentMap.delete(sessionID)

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
      } catch {
        // Guardrail should not break event processing
      }
    },
  }
}

export default CrewmatePlugin
`;
