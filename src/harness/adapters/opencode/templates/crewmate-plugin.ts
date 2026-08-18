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

const CrewmatePlugin: Plugin = async ({ $ }) => {
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
    },
  }
}

export default CrewmatePlugin
`;
