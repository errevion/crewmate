// Template file written into target project's .opencode/plugins/crewmate.ts
export const CREWMATE_PLUGIN = `import { type Plugin, tool } from "@opencode-ai/plugin"

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
  $: any,
  directory: string,
  args: string[],
): Promise<any> {
  const cmd = ["crewmate", ...args].join(" ")
  const result = await $\`\${{ raw: cmd }}\`.cwd(directory).quiet().nothrow()
  const text = typeof result.text === "function" ? result.text().trim() : ""
  if (!text) {
    let errorDetails = \`exit code \${result.exitCode}\`
    if (typeof result.stderr === "string" && result.stderr.trim()) {
      errorDetails = result.stderr.trim()
    } else if (result.stderr && typeof result.stderr.toString === "function") {
      const s = result.stderr.toString().trim()
      if (s && s !== "[object Object]") errorDetails = s
    }
    throw new Error(\`crewmate command failed (\${errorDetails})\`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(\`crewmate returned invalid JSON: \${text}\`)
  }
}

interface TrackedSubagentSession {
  agent: string
  taskId?: string
  dispatchedAt: number
}

const CrewmatePlugin: Plugin = async ({ $, directory }: any) => {
  const targetDir = typeof directory === "string" && directory.trim() ? directory : process.cwd()
  const sessionAgentMap = new Map<string, TrackedSubagentSession>()
  const pendingDispatches = new Map<string, { agent: string; taskId?: string; dispatchedAt: number }>()

  return {
    tool: {
      crewmate_create_brief: tool({
        description:
          "Create a new crewmate brief. Call this before updating any fields. Returns the brief ID.",
        args: {},
        async execute(_, context) {
          const json = await runCrewmate($, context.directory, ["brief", "init"])
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
          \`Valid fields: \${VALID_FIELDS_STR}.\`,
          "For simple fields (workType, goal), pass a plain string value.",
          \`For complex fields, pass a JSON string (e.g., scope: '{"included":["x"],"excluded":["y"]}').\`,
          "workType must be one of: software, infrastructure, data, documentation, audit.",
        ].join(" "),
        args: {
          field: z.enum(VALID_FIELDS),
          value: z.string().describe("Field value (string or JSON)"),
          id: z
            .string()
            .optional()
            .describe("Brief ID (defaults to latest)"),
        },
        async execute(args, context) {
          const idArgs = args.id ? ["--id", args.id] : []
          const escaped = $.escape(args.value)
          const json = await runCrewmate(
            $,
            context.directory,
            ["brief", "set", args.field, escaped, ...idArgs],
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
            $,
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
            $,
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
            $,
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
            $,
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

          const escapedTitle = $.escape(taskTitle)
          const escapedDesc = $.escape(taskDescription)
          const cmdParts = ["task", "add", args.briefId, "--title", escapedTitle, "--description", escapedDesc]
          if (args.dependencies && args.dependencies.length > 0) {
            cmdParts.push("--dependencies", ...args.dependencies.map((d: string) => $.escape(d)))
          }
          if (args.field) cmdParts.push("--field", $.escape(args.field))
          
          const json = await runCrewmate($, context.directory, cmdParts)
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
          const json = await runCrewmate($, context.directory, ["task", "list", "--brief", args.briefId])
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
          const json = await runCrewmate($, context.directory, [
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
          const json = await runCrewmate($, context.directory, ["task", "remove", args.taskId])
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
          const escapedFiles = args.files.map((f: string) => $.escape(f))
          const json = await runCrewmate($, context.directory, [
            "lock",
            "acquire",
            args.taskId,
            "--files",
            ...escapedFiles,
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
            cmdParts.push("--files", ...args.files.map((f: string) => $.escape(f)))
          }
          const json = await runCrewmate($, context.directory, cmdParts)
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
          const json = await runCrewmate($, context.directory, cmdParts)
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
          const escapedContent = $.escape(args.content)
          const cmdParts = [
            "artifact",
            "add",
            args.taskId,
            "--type",
            args.type,
            "--content",
            escapedContent,
          ]
          if (args.briefId) {
            cmdParts.push("--brief", args.briefId)
          }
          const json = await runCrewmate($, context.directory, cmdParts)
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

          const json = await runCrewmate($, context.directory, cmdParts)
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
          const escapedMessage = $.escape(args.message)
          const cmdParts = [
            "event",
            "add",
            "--actor",
            args.actor,
            "--type",
            args.type,
            "--message",
            escapedMessage,
          ]
          if (args.taskId) cmdParts.push("--task", args.taskId)
          if (args.briefId) cmdParts.push("--brief", args.briefId)

          const json = await runCrewmate($, context.directory, cmdParts)
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

          const json = await runCrewmate($, context.directory, cmdParts)
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
            cmdParts.push("--message", $.escape(args.message))
          }
          if (args.briefId) {
            cmdParts.push("--brief", args.briefId)
          }

          const json = await runCrewmate($, context.directory, cmdParts)
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

          const json = await runCrewmate($, context.directory, cmdParts)
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
        const toolName = input?.tool
        const callID = input?.callID
        const args = output?.args || input?.args || {}
        if (toolName === "task" && args) {
          const subagent = String(args.subagent_type || args.agent || "").toLowerCase()
          if (["scout", "planner", "executor"].includes(subagent)) {
            const taskId = args.task_id || args.taskId
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

            const cmdParts = [
              "event",
              "add",
              "--actor",
              "frontman",
              "--type",
              "dispatched",
              "--message",
              $.escape(msg),
            ]
            if (taskId) {
              cmdParts.push("--task", $.escape(taskId))
            }
            await runCrewmate($, targetDir, cmdParts).catch(() => {})
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
            await runCrewmate($, targetDir, [
              "event",
              "add",
              "--actor",
              "executor",
              "--type",
              "started",
              "--task",
              $.escape(taskId),
              "--message",
              $.escape(\`Started task \${taskTitle}\`),
            ]).catch(() => {})
          } else if (status === "completed") {
            const taskTitle = parsedOutput?.title || taskId
            await runCrewmate($, targetDir, [
              "event",
              "add",
              "--actor",
              "executor",
              "--type",
              "completed",
              "--task",
              $.escape(taskId),
              "--message",
              $.escape(\`Completed task \${taskTitle}\`),
            ]).catch(() => {})
          }
        }

        if (toolName === "crewmate_acquire_lock" && args?.taskId && Array.isArray(args?.files)) {
          const taskId = args.taskId
          const count = args.files.length
          const taskTitle = parsedOutput?.taskTitle || taskId
          await runCrewmate($, targetDir, [
            "event",
            "add",
            "--actor",
            "executor",
            "--type",
            "locked",
            "--task",
            $.escape(taskId),
            "--message",
            $.escape(\`Locked \${count} file(s) for task \${taskTitle}\`),
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
              $.escape(msg),
            ]
            if (tracked.taskId) {
              cmdParts.push("--task", $.escape(tracked.taskId))
            }
            await runCrewmate($, targetDir, cmdParts).catch(() => {})
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
              $.escape(msg),
            ]
            if (tracked.taskId) {
              cmdParts.push("--task", $.escape(tracked.taskId))
            }
            await runCrewmate($, targetDir, cmdParts).catch(() => {})
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
