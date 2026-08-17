// Template file written into target project's .opencode/plugins/crewmate.ts
export const CREWMATE_PLUGIN = `import { type Plugin, tool } from "@opencode-ai/plugin"

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

async function runCrewmate(
  $: any,
  directory: string,
  args: string[],
): Promise<any> {
  const result = await $\`crewmate \${args}\`.cwd(directory).quiet().nothrow()
  const text = result.text().trim()
  if (!text) {
    throw new Error(\`crewmate returned no output (exit code \${result.exitCode})\`)
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
          "For complex fields, pass a JSON string (e.g., scope: '{\"included\":[\"x\"],\"excluded\":[\"y\"]}').",
          "workType must be one of: software, infrastructure, data, documentation, audit.",
        ].join(" "),
        args: {
          field: tool.schema.enum(VALID_FIELDS),
          value: tool.schema.string().describe("Field value (string or JSON)"),
          id: tool.schema
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
          field: tool.schema.enum(VALID_FIELDS),
          id: tool.schema
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
          id: tool.schema
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
          id: tool.schema
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
          id: tool.schema
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
    },
  }
}

export default CrewmatePlugin
`;
