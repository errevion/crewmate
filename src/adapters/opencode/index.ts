import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as syncFs from "node:fs";
import * as yaml from "yaml";
import { z } from "zod";
import { Plugin } from "@opencode/plugin";
import { CrewmateEngine } from "../../core/engine/engine.js";
import { StructureSchema } from "../../core/schemas/contracts.js";
import { matchGlob } from "../../core/utils/glob.js";
import { scanArchitecture } from "../../core/scanner/arch.js";
import { scanDeadCode } from "../../core/scanner/dead-code.js";
import { resolveContractPath } from "../../core/utils/fs.js";

/**
 * Extract candidate command strings from tool execution inputs (supports strings, arrays, objects).
 */
export function extractCommandStrings(input: unknown): string[] {
  if (!input) return [];
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return [input.map(String).join(" ")];

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const results: string[] = [];

    for (const key of ["command", "cmd", "script", "code", "input", "args"]) {
      const val = obj[key];
      if (typeof val === "string") {
        results.push(val);
      } else if (Array.isArray(val)) {
        results.push(val.map(String).join(" "));
      }
    }

    if (results.length > 0) return results;

    // Fallback: check all string properties
    for (const val of Object.values(obj)) {
      if (typeof val === "string") {
        results.push(val);
      }
    }
    return results;
  }

  return [];
}

/**
 * Detect whether a shell command invocation executes the crewmate CLI binary.
 */
export function isCrewmateCliCommand(cmdStr: string): boolean {
  if (!cmdStr || typeof cmdStr !== "string") {
    return false;
  }

  // Quick check: must mention crewmate or local cli script
  if (
    !/\bcrewmate\b/i.test(cmdStr) &&
    !/(?:[/\\]cli[/\\]|cli\.js|cli\.ts)/i.test(cmdStr)
  ) {
    return false;
  }

  // Split on command delimiters: ;, &&, ||, |, newline
  const subCommands = cmdStr.split(/[\r\n;&|]+/);
  for (const rawSub of subCommands) {
    const sub = rawSub.trim();
    if (!sub) continue;

    // Quick sub-command check
    if (
      !/\bcrewmate\b/i.test(sub) &&
      !/(?:[/\\]cli[/\\]|cli\.js|cli\.ts)/i.test(sub)
    ) {
      continue;
    }

    // Tokenize into words
    const words = sub.split(/\s+/).filter(Boolean);
    let cmdIdx = 0;

    // Skip environment variable assignments at the beginning (e.g. "FOO=1 BAR=2 crewmate ...")
    while (
      cmdIdx < words.length &&
      words[cmdIdx].includes("=") &&
      !words[cmdIdx].startsWith("-")
    ) {
      cmdIdx++;
    }
    if (cmdIdx >= words.length) continue;

    const baseCmd = words[cmdIdx]
      .replace(/^["']|["']$/g, "")
      .replace(/\\/g, "/");
    const cmdName = baseCmd.split("/").pop()?.toLowerCase() || "";

    // 1. Direct binary invocation: crewmate, crewmate.exe, ./node_modules/.bin/crewmate
    if (cmdName === "crewmate" || cmdName === "crewmate.exe") {
      return true;
    }

    // 2. Package manager execution: npx, pnpm, yarn, bun, bunx
    const runnerCommands = new Set(["npx", "pnpm", "yarn", "bun", "bunx"]);
    if (runnerCommands.has(cmdName)) {
      for (let j = cmdIdx + 1; j < words.length; j++) {
        const word = words[j].replace(/^["']|["']$/g, "").toLowerCase();
        // Skip common runner flags or subcommands: -y, --yes, exec, run, -p, --package
        if (word.startsWith("-") || word === "exec" || word === "run") {
          continue;
        }
        if (word === "crewmate" || word === "crewmate.exe") {
          return true;
        }
        // If first non-flag argument is something else (e.g. "npx prettier ..."), stop
        break;
      }
    }

    // 3. Node invocation: node dist/src/cli/index.js, node .../crewmate
    if (cmdName === "node" || cmdName === "node.exe") {
      for (let j = cmdIdx + 1; j < words.length; j++) {
        const arg = words[j]
          .replace(/^["']|["']$/g, "")
          .replace(/\\/g, "/")
          .toLowerCase();
        if (arg.startsWith("-")) {
          continue;
        }
        if (
          arg.includes("crewmate") ||
          arg.includes("/cli/") ||
          arg.endsWith("/cli.js") ||
          arg.endsWith("/cli.ts")
        ) {
          return true;
        }
        break;
      }
    }
  }

  return false;
}

export const CREWMATE_TOOL_ACCESS: Record<string, string[] | "all"> = {
  // Orchestrator-only (Matte)
  crewmate_advance: ["orchestrator"],
  crewmate_goto: ["orchestrator"],
  crewmate_gate_check: ["orchestrator"],
  crewmate_activity_start: ["orchestrator"],
  crewmate_activity_end: ["orchestrator"],
  crewmate_activity_list: ["orchestrator"],
  crewmate_activity_reconcile: ["orchestrator"],
  crewmate_workflow_run: ["orchestrator"],
  crewmate_workflow_reset: ["orchestrator"],
  crewmate_archive: ["orchestrator"],

  // Task mutation (planner can create, builder can create/start/amend/complete)
  crewmate_task_create: ["orchestrator", "planner", "builder"],
  crewmate_task_start: ["orchestrator", "builder"],
  crewmate_task_amend: ["orchestrator", "builder"],
  crewmate_task_complete: ["orchestrator", "builder"],

  // Scanners (verifier, contractor, and orchestrator)
  crewmate_scan_arch: ["orchestrator", "verifier", "contractor"],
  crewmate_scan_dead_code: ["orchestrator", "verifier", "contractor"],

  // Read-only introspection (all roles)
  crewmate_status: "all",
  crewmate_context: "all",
  crewmate_query: "all",
  crewmate_task_list: "all",
  crewmate_task_locks: "all",
  crewmate_workflow_list: "all",
  crewmate_report_get: "all",
  crewmate_archive_list: "all",
};

/**
 * Known built-in Crewmate agent names and roles.
 */
export const DEFAULT_CREWMATE_AGENTS = new Set([
  "matte",
  "orchestrator",
  "scout",
  "planner",
  "builder",
  "contractor",
  "verifier",
]);

/**
 * Checks if a given agent name belongs to the Crewmate workflow ecosystem.
 * Dynamically includes agents declared in the active workflow's node definitions.
 */
export async function isCrewmateAgent(
  engine: CrewmateEngine,
  agentName: string | undefined | null,
): Promise<boolean> {
  if (!agentName) {
    // When agentName is omitted (e.g. test mocks without agent metadata),
    // default to true so existing unit tests that don't pass an agent field continue to work.
    return true;
  }

  const normalized = agentName.toLowerCase().trim();

  // 1. Built-in Crewmate agents & roles
  if (DEFAULT_CREWMATE_AGENTS.has(normalized)) {
    return true;
  }

  // 2. Dynamically check active workflow's node definitions
  try {
    const isInit = await engine.getStateManager().exists();
    if (!isInit) {
      return false;
    }

    const graph = await engine.getGraph();
    for (const node of graph.nodes) {
      try {
        const nodeDef = await engine.getNodeDef(node.id);
        if (
          nodeDef.subagent?.agent &&
          nodeDef.subagent.agent.toLowerCase().trim() === normalized
        ) {
          return true;
        }
        if (
          nodeDef.subagent?.role &&
          nodeDef.subagent.role.toLowerCase().trim() === normalized
        ) {
          return true;
        }
      } catch {
        // Ignore missing node files during dynamic check
      }
    }
  } catch {
    // Fallback if workflow graph cannot be read
  }

  return false;
}

export const crewmateOpenCodePlugin = Plugin.define({
  id: "crewmate",
  setup: async (ctx) => {
    const projectRoot = ctx.location?.directory || process.cwd();
    const engine = new CrewmateEngine(projectRoot);

    // 1. Heartbeat Sentry & Dynamic Session Tracking
    // Tracks active session and harness state: "running" (executing prompt/tools), "idle" (open/waiting), "offline" (closed/disconnected).
    const heartbeatPath = path.join(projectRoot, ".crewmate", "heartbeat.json");
    const startedAtIso = new Date().toISOString();
    const RUNNING_TIMEOUT_MS = 15_000; // 15s without active execution transitions back to idle
    let lastActivityTs = Date.now();
    let currentHeartbeatStatus: "running" | "idle" | "offline" = "idle";
    let activeSession: { id?: string; title?: string } | undefined;

    const setActiveSession = async (sessionId?: string, title?: string) => {
      if (!sessionId) return;
      if (!activeSession || activeSession.id !== sessionId) {
        activeSession = { id: sessionId, title };
        if (
          !title &&
          ctx.session &&
          typeof (ctx.session as any).get === "function"
        ) {
          try {
            const info = await (ctx.session as any).get({
              sessionID: sessionId,
            });
            if (info && (info as any).title) {
              activeSession.title = (info as any).title;
            }
          } catch {
            // Silently ignore if session lookup fails
          }
        }
      } else if (title) {
        activeSession.title = title;
      }
    };

    const touchActivity = async (sessionId?: string) => {
      lastActivityTs = Date.now();
      if (sessionId) {
        await setActiveSession(sessionId).catch(() => {});
      }
      if (currentHeartbeatStatus !== "running") {
        currentHeartbeatStatus = "running";
        await writeHeartbeat("running").catch(() => {});
      }
    };

    const setIdle = async (sessionId?: string) => {
      if (sessionId) {
        await setActiveSession(sessionId).catch(() => {});
      }
      if (currentHeartbeatStatus === "running") {
        currentHeartbeatStatus = "idle";
        await writeHeartbeat("idle").catch(() => {});
      }
    };

    const writeHeartbeat = async (status: "running" | "idle" | "offline") => {
      try {
        currentHeartbeatStatus = status;
        await fs.mkdir(path.dirname(heartbeatPath), { recursive: true });
        const payload = {
          harness: "OpenCode",
          protocol: "plugin",
          pid: process.pid,
          startedAt: startedAtIso,
          lastHeartbeat: new Date().toISOString(),
          lastActivity: new Date(lastActivityTs).toISOString(),
          status,
          session: activeSession,
        };
        await fs.writeFile(
          heartbeatPath,
          JSON.stringify(payload, null, 2),
          "utf-8",
        );
      } catch {
        // Silently ignore during shutdown
      }
    };

    await writeHeartbeat("idle");
    const heartbeatTimer = setInterval(() => {
      const elapsedSinceActivity = Date.now() - lastActivityTs;
      if (
        currentHeartbeatStatus === "running" &&
        elapsedSinceActivity >= RUNNING_TIMEOUT_MS
      ) {
        currentHeartbeatStatus = "idle";
      }
      writeHeartbeat(currentHeartbeatStatus).catch(() => {});
    }, 4000);
    heartbeatTimer.unref();

    const onProcessExit = () => {
      try {
        syncFs.writeFileSync(
          heartbeatPath,
          JSON.stringify(
            {
              harness: "OpenCode",
              protocol: "plugin",
              pid: process.pid,
              startedAt: startedAtIso,
              lastHeartbeat: new Date().toISOString(),
              lastActivity: new Date(lastActivityTs).toISOString(),
              status: "offline",
              session: activeSession,
            },
            null,
            2,
          ),
        );
      } catch {
        // Silently ignore
      }
    };
    process.on("exit", onProcessExit);

    // 2. Native Tool Registration via Plugin SDK
    // Exposes crewmate harness tools natively to agents
    if (ctx.tool && typeof ctx.tool.transform === "function") {
      await ctx.tool.transform((editor) => {
        // crewmate_status
        editor.add({
          name: "crewmate_status",
          description:
            "Get the current Crewmate workflow status, current active node, retry counts, escalation state, active activities, and harness liveness.",
          input: z.object({}),
          execute: async () => {
            const isInit = await engine.getStateManager().exists();
            if (!isInit) {
              return {
                content: JSON.stringify(
                  {
                    initialized: false,
                    message:
                      "Crewmate project not initialized. Run init first.",
                  },
                  null,
                  2,
                ),
              };
            }
            const status = await engine.status();
            const unclosed = await engine
              .getActivityManager()
              .getUnclosedActivities();
            const liveness = await engine
              .getActivityManager()
              .getHarnessLiveness();
            return {
              content: JSON.stringify(
                {
                  ...status,
                  activeActivities: unclosed.map((a) => ({
                    id: a.id,
                    label: a.label,
                    agent: a.agent,
                    at: a.startAt,
                  })),
                  harness: liveness,
                },
                null,
                2,
              ),
            };
          },
        });

        // crewmate_advance
        editor.add({
          name: "crewmate_advance",
          description:
            "Advance the Crewmate workflow to the next node. Automatically runs gate checks before advancing.",
          input: z.object({}),
          execute: async () => {
            const result = await engine.advance();
            return { content: JSON.stringify(result, null, 2) };
          },
        });

        // crewmate_goto
        editor.add({
          name: "crewmate_goto",
          description:
            "Transition the workflow to a specific target node (e.g. 'execute' when verification fails, or 'plan'). Manual override for orchestrator.",
          input: z.object({
            node: z.string().describe("Target node ID to transition to"),
            force: z
              .boolean()
              .optional()
              .describe(
                "Force transition even if node file does not exist (e.g. 'done')",
              ),
          }),
          execute: async (input) => {
            const result = await engine.goto(input.node, {
              force: input.force,
            });
            return { content: JSON.stringify(result, null, 2) };
          },
        });

        // crewmate_gate_check
        editor.add({
          name: "crewmate_gate_check",
          description:
            "Run pre-gate or post-gate checks for a node in the workflow.",
          input: z.object({
            node: z
              .string()
              .optional()
              .describe("Node ID to check (defaults to current active node)"),
            phase: z
              .enum(["pre", "post", "both"])
              .optional()
              .describe("Gate phase to check (pre, post, or both)"),
          }),
          execute: async (input) => {
            const status = await engine.status();
            const node = input?.node || status.currentNode;
            if (!node) {
              return {
                content: JSON.stringify(
                  { error: "No active node found to check gates." },
                  null,
                  2,
                ),
              };
            }
            const phase = input?.phase || "both";
            if (phase === "both") {
              const pre = await engine.gateCheck(node, { phase: "pre" });
              const post = await engine.gateCheck(node, { phase: "post" });
              return { content: JSON.stringify({ node, pre, post }, null, 2) };
            }
            const res = await engine.gateCheck(node, { phase });
            return { content: JSON.stringify({ node, [phase]: res }, null, 2) };
          },
        });

        // crewmate_activity_start
        editor.add({
          name: "crewmate_activity_start",
          description:
            "Start a tracked activity in Crewmate. Returns the unique activity ID. Always end the activity with crewmate_activity_end when complete.",
          input: z.object({
            label: z
              .string()
              .describe("Descriptive label of the activity being performed"),
            agent: z
              .string()
              .optional()
              .describe("Name of the agent performing the activity"),
            node: z
              .string()
              .optional()
              .describe("Workflow node this activity belongs to"),
            parent: z
              .string()
              .optional()
              .describe("Parent activity ID if this is a subtask"),
            meta: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Optional metadata (e.g. files touched, intent)"),
          }),
          execute: async (input, toolCtx) => {
            const status = await engine.status().catch(() => null);
            const agentName =
              input.agent ||
              (toolCtx ? (toolCtx as any).agent : "agent") ||
              "agent";
            const nodeName = input.node || status?.currentNode;
            const id = await engine.getActivityManager().start({
              agent: String(agentName),
              label: input.label,
              node: nodeName,
              parent: input.parent,
              meta: input.meta,
            });
            return {
              content: JSON.stringify(
                {
                  id,
                  label: input.label,
                  agent: agentName,
                  node: nodeName,
                  status: "active",
                },
                null,
                2,
              ),
            };
          },
        });

        // crewmate_activity_end
        editor.add({
          name: "crewmate_activity_end",
          description: "End a tracked activity in Crewmate by its ID.",
          input: z.object({
            id: z
              .string()
              .describe("The activity ID returned by crewmate_activity_start"),
            status: z
              .enum(["completed", "failed", "interrupted"])
              .optional()
              .describe("Final status of the activity (defaults to completed)"),
            meta: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Optional completion metadata"),
          }),
          execute: async (input) => {
            const record = await engine.getActivityManager().end({
              id: input.id,
              status: input.status || "completed",
              meta: input.meta,
            });
            return {
              content: JSON.stringify(
                {
                  id: record.id,
                  label: record.label,
                  status: record.status,
                  endAt: record.endAt,
                },
                null,
                2,
              ),
            };
          },
        });

        // crewmate_activity_list
        editor.add({
          name: "crewmate_activity_list",
          description:
            "List tracked activities in Crewmate. Can filter to only unclosed (in-progress) activities.",
          input: z.object({
            unclosedOnly: z
              .boolean()
              .optional()
              .describe(
                "If true, returns only currently active/unclosed activities",
              ),
          }),
          execute: async (input) => {
            if (input.unclosedOnly) {
              const unclosed = await engine
                .getActivityManager()
                .getUnclosedActivities();
              return { content: JSON.stringify(unclosed, null, 2) };
            }
            const all = await engine.getActivityManager().getActivities();
            return { content: JSON.stringify(all, null, 2) };
          },
        });

        // crewmate_activity_reconcile
        editor.add({
          name: "crewmate_activity_reconcile",
          description:
            "Reconcile and close any abandoned or stale unclosed activities (e.g. from crashed or interrupted sessions).",
          input: z.object({
            reason: z
              .string()
              .optional()
              .describe("Reason for closing the stale activities"),
          }),
          execute: async (input) => {
            const reconciled = await engine.reconcileStaleActivities(
              input.reason || "manually reconciled",
            );
            return {
              content: JSON.stringify(
                { closedCount: reconciled.length, closedIds: reconciled },
                null,
                2,
              ),
            };
          },
        });

        // crewmate_context
        editor.add({
          name: "crewmate_context",
          description:
            "Get the tiered contract context bundle (Tier 0 manifest, Tier 1 contracts, Tier 2 architecture) for the active or specified workflow node.",
          input: z.object({
            node: z
              .string()
              .optional()
              .describe(
                "Node ID to get context for (defaults to current node)",
              ),
          }),
          execute: async (input) => {
            const bundle = await engine.context(input?.node);
            return { content: bundle.formatted };
          },
        });

        // crewmate_query
        editor.add({
          name: "crewmate_query",
          description:
            "Query a specific field from a module contract (e.g. public_api, invariants, dependencies).",
          input: z.object({
            module: z.string().describe("Module name (e.g. auth, users)"),
            field: z.string().describe("Contract field name to query"),
          }),
          execute: async (input) => {
            const val = await engine.query(input.module, input.field);
            return { content: JSON.stringify(val, null, 2) };
          },
        });

        // crewmate_scan_arch
        editor.add({
          name: "crewmate_scan_arch",
          description:
            "Run AST-based static analysis scanner to check architecture boundary violations against architecture.yaml rules.",
          input: z.object({}),
          execute: async () => {
            const scanResult = await scanArchitecture(projectRoot);
            return { content: JSON.stringify(scanResult, null, 2) };
          },
        });

        // crewmate_scan_dead_code
        editor.add({
          name: "crewmate_scan_dead_code",
          description:
            "Run AST-based static analysis scanner to detect dead code or unreferenced exports in module contracts.",
          input: z.object({}),
          execute: async () => {
            const scanResult = await scanDeadCode(projectRoot);
            return { content: JSON.stringify(scanResult, null, 2) };
          },
        });

        // crewmate_task_create
        editor.add({
          name: "crewmate_task_create",
          description:
            "Create a new contract-scoped task with atomic scope and dependency checking.",
          input: z.object({
            contract: z
              .string()
              .describe("Module contract file path or module name"),
            files: z.array(z.string()).describe("List of files in task scope"),
            goal: z.string().describe("Goal/description of the task"),
            depends_on: z
              .array(z.string())
              .optional()
              .describe("Optional list of dependency task IDs"),
            id: z.string().optional().describe("Optional custom task ID"),
          }),
          execute: async (input) => {
            const task = await engine.createTask({
              contract: input.contract,
              files: input.files,
              goal: input.goal,
              depends_on: input.depends_on,
              id: input.id,
            });
            return { content: JSON.stringify(task, null, 2) };
          },
        });

        // crewmate_task_start
        editor.add({
          name: "crewmate_task_start",
          description:
            "Attempt atomic lock-grant and start a task (sets status to active or blocked).",
          input: z.object({
            id: z.string().describe("Task ID to start"),
          }),
          execute: async (input) => {
            const res = await engine.startTask(input.id);
            return { content: JSON.stringify(res, null, 2) };
          },
        });

        // crewmate_task_amend
        editor.add({
          name: "crewmate_task_amend",
          description:
            "Amend scope for an active task by requesting an additional file (goes through atomic lock-grant).",
          input: z.object({
            id: z.string().describe("Active task ID"),
            file: z.string().describe("File path to add to scope"),
            reason: z
              .string()
              .optional()
              .describe("Optional reason for amendment"),
          }),
          execute: async (input) => {
            const res = await engine.amendTaskScope(
              input.id,
              input.file,
              input.reason,
            );
            return { content: JSON.stringify(res, null, 2) };
          },
        });

        // crewmate_task_complete
        editor.add({
          name: "crewmate_task_complete",
          description:
            "Run task completion gate (scope-diff backstop + contract/architecture gates) and finalize task.",
          input: z.object({
            id: z.string().describe("Active task ID to complete"),
          }),
          execute: async (input) => {
            const res = await engine.completeTask(input.id);
            return { content: JSON.stringify(res, null, 2) };
          },
        });

        // crewmate_task_list
        editor.add({
          name: "crewmate_task_list",
          description: "List tasks in Crewmate, optionally filtered by status.",
          input: z.object({
            status: z
              .enum(["pending", "active", "blocked", "done", "failed"])
              .optional(),
          }),
          execute: async (input) => {
            const tasks = await engine.listTasks({ status: input.status });
            return { content: JSON.stringify(tasks, null, 2) };
          },
        });

        // crewmate_task_locks
        editor.add({
          name: "crewmate_task_locks",
          description:
            "Display current active lock table (which task holds which files).",
          input: z.object({}),
          execute: async () => {
            const locks = await engine.getTaskLocks();
            return { content: JSON.stringify(locks, null, 2) };
          },
        });

        // crewmate_workflow_list
        editor.add({
          name: "crewmate_workflow_list",
          description:
            "List available workflows in .crewmate/workflows/ and show which workflow is currently active.",
          input: z.object({}),
          execute: async () => {
            const workflows = await engine.listWorkflows();
            return { content: JSON.stringify(workflows, null, 2) };
          },
        });

        // crewmate_workflow_run
        editor.add({
          name: "crewmate_workflow_run",
          description:
            "Switch to and start running a named workflow from .crewmate/workflows/<name>/. Automatically archives the previous run report.",
          input: z.object({
            workflow: z.string().describe("The name of the workflow to run"),
            force: z
              .boolean()
              .optional()
              .describe("Force run/switch even if tasks are locked"),
          }),
          execute: async (input) => {
            const res = await engine.runWorkflow(input.workflow, {
              force: input.force,
            });
            return { content: JSON.stringify(res, null, 2) };
          },
        });

        // crewmate_workflow_reset
        editor.add({
          name: "crewmate_workflow_reset",
          description:
            "Reset the current workflow run to initial or target node, generating an audit report for the prior run.",
          input: z.object({
            reason: z
              .string()
              .optional()
              .describe("Reason for resetting workflow"),
            node: z
              .string()
              .optional()
              .describe("Target node to reset to (defaults to graph initial)"),
            force: z
              .boolean()
              .optional()
              .describe("Force reset even if tasks are locked"),
          }),
          execute: async (input) => {
            const res = await engine.resetWorkflow({
              reason: input.reason,
              node: input.node,
              force: input.force,
            });
            return { content: JSON.stringify(res, null, 2) };
          },
        });

        // crewmate_report_get
        editor.add({
          name: "crewmate_report_get",
          description:
            "Retrieve a workflow run report by runId, or get the latest run report if no runId is specified.",
          input: z.object({
            runId: z
              .string()
              .optional()
              .describe("Run ID to retrieve (omitted for latest)"),
          }),
          execute: async (input) => {
            const report = await engine.getReport(input.runId);
            if (!report) {
              return { content: "No report found." };
            }
            return { content: JSON.stringify(report, null, 2) };
          },
        });

        // crewmate_archive
        editor.add({
          name: "crewmate_archive",
          description:
            "Archive a workflow run's events, tasks, activities, and report to .crewmate/archive/<runId>/, pruning them from active files.",
          input: z.object({
            runId: z
              .string()
              .optional()
              .describe("Optional runId to archive (defaults to current run)"),
          }),
          execute: async (input) => {
            const manifest = await engine.archiveRun(input.runId);
            return { content: JSON.stringify(manifest, null, 2) };
          },
        });

        // crewmate_archive_list
        editor.add({
          name: "crewmate_archive_list",
          description: "List all archived workflow runs.",
          input: z.object({}),
          execute: async () => {
            const archives = await engine.listArchives();
            return { content: JSON.stringify(archives, null, 2) };
          },
        });
      });
    }

    // 3. Context Injection Hook
    // Injects tiered, scoped context on every model request.
    // Survives context compactions by dynamically pulling fresh state from disk.
    ctx.session.hook("context", async (sessionCtx) => {
      await touchActivity(sessionCtx.sessionID);
      try {
        const isInit = await engine.getStateManager().exists();
        if (!isInit) {
          return;
        }

        // If caller agent is specified and is NOT a Crewmate agent (e.g. "build", "general"),
        // completely bypass context injection so regular chats remain completely clean.
        const callerAgent =
          (sessionCtx as any).agent ||
          (sessionCtx as any).caller ||
          (sessionCtx as any).meta?.agent ||
          (sessionCtx as any).session?.agent;
        if (callerAgent && !(await isCrewmateAgent(engine, callerAgent))) {
          return;
        }

        const state = await engine.getStateManager().getState();
        if (!state.currentNode || state.status === "completed") {
          return;
        }

        const bundle = await engine.context();
        if (!bundle || !bundle.formatted) {
          return;
        }

        // Inject tiered context into system messages
        sessionCtx.system.push({
          type: "text",
          text: bundle.formatted,
        });

        // Inject subagent instructions if specified
        if (bundle.subagent) {
          const roleDirective = [
            `\n[CREWMATE SUBAGENT ROLE DIRECTIVE]`,
            `Active Role: ${bundle.subagent.role}`,
            bundle.subagent.agent ? `Subagent: ${bundle.subagent.agent}` : null,
            `Scope: ${bundle.subagent.scope}`,
            bundle.subagent.allowed_tools
              ? `Allowed Tools: ${bundle.subagent.allowed_tools.join(", ")}`
              : `Allowed Tools: All`,
            `You must adhere strictly to the role instructions and scope limits defined above.`,
          ]
            .filter(Boolean)
            .join("\n");

          sessionCtx.system.push({
            type: "text",
            text: roleDirective,
          });
        }
      } catch (err) {
        // Silently handle context hook errors so agent doesn't crash if repo lacks contracts
        console.warn(
          `[Crewmate Plugin] Context hook warning: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    // 4. Tool Execution Guardrail Hook
    // Intercepts tool calls BEFORE execution to enforce hard boundaries.
    ctx.tool.hook("execute.before", async (info) => {
      await touchActivity((info as any).sessionID);

      const isInit = await engine.getStateManager().exists();
      if (!isInit) {
        return;
      }

      const state = await engine.getStateManager().getState();
      if (!state.currentNode || state.status === "completed") {
        return;
      }

      // Determine caller agent:
      const explicitAgent =
        (info as any).agent ||
        (info as any).caller ||
        (info as any).meta?.agent ||
        (info as any).session?.agent;

      // If caller agent is specified and is NOT a Crewmate agent (e.g. "build", "general"),
      // completely bypass ALL guardrails so unmanaged agents are never blocked!
      if (explicitAgent && !(await isCrewmateAgent(engine, explicitAgent))) {
        return;
      }

      const status = await engine.status();
      const nodeDef = await engine.getNodeDef(status.currentNode);

      // Determine effective calling role:
      // 1. Explicit caller agent on hook payload (e.g. info.agent, info.meta?.agent)
      // 2. "matte" or "orchestrator" maps to "orchestrator"
      // 3. Otherwise, if current node has a subagent role, that is the active subagent role
      // 4. Default to "orchestrator" if no subagent defined on node
      let effectiveRole: string;
      if (explicitAgent === "matte" || explicitAgent === "orchestrator") {
        effectiveRole = "orchestrator";
      } else if (explicitAgent) {
        effectiveRole = explicitAgent;
      } else if (nodeDef.subagent?.role) {
        effectiveRole = nodeDef.subagent.role;
      } else {
        effectiveRole = "orchestrator";
      }

      // Crewmate Native Tool Access Control
      const isCrewmateTool =
        info.tool.startsWith("crewmate_") || info.tool.startsWith("crewmate:");
      if (isCrewmateTool) {
        const normTool = info.tool.replace(/^crewmate:/, "crewmate_");
        const allowed = CREWMATE_TOOL_ACCESS[normTool];

        if (allowed === "all") {
          return;
        }

        if (Array.isArray(allowed) && allowed.includes(effectiveRole)) {
          return;
        }

        throw new Error(
          `[Crewmate Guardrail Blocked] Tool '${info.tool}' is restricted: Subagent role '${effectiveRole}' is not permitted to execute this command.`,
        );
      }

      // Crewmate CLI Command Interception for Shell / Terminal Executions
      // Prevents subagents from bypassing role/scope gates by shelling out to the crewmate CLI
      if (effectiveRole !== "orchestrator") {
        const cmdStrings = extractCommandStrings(info.input);
        for (const cmdStr of cmdStrings) {
          if (isCrewmateCliCommand(cmdStr)) {
            throw new Error(
              `[Crewmate Guardrail Blocked] Shell execution of crewmate CLI commands is restricted: Subagent role '${effectiveRole}' is not permitted to execute CLI commands directly. Use the provided native Crewmate plugin tools instead.`,
            );
          }
        }
      }

      // Workspace Directory Boundary Enforcement for Subagents
      // Prevents subagents from wandering into outside directories (e.g. harness, system, or other repos)
      if (effectiveRole !== "orchestrator") {
        const fileAccessTools = [
          "read",
          "edit",
          "write",
          "patch",
          "delete",
          "create_file",
          "grep",
          "glob",
        ];
        if (fileAccessTools.includes(info.tool)) {
          const inputObj = info.input as Record<string, unknown> | undefined;
          const targetPath = (inputObj?.path ||
            inputObj?.filePath ||
            inputObj?.file) as string | undefined;
          if (targetPath && typeof targetPath === "string") {
            const isForeignWinAbs =
              process.platform !== "win32" &&
              /^[a-zA-Z]:[/\\]/.test(targetPath);
            const resolvedTarget = path.resolve(projectRoot, targetPath);
            const resolvedProjectRoot = path.resolve(projectRoot);
            const rel = path.relative(resolvedProjectRoot, resolvedTarget);
            const isInside =
              !isForeignWinAbs &&
              !rel.startsWith("..") &&
              !path.isAbsolute(rel);
            if (!isInside) {
              throw new Error(
                `[Crewmate Guardrail Blocked] Access to path outside the project workspace is forbidden: '${targetPath}'. Subagents must operate strictly within the workspace directory.`,
              );
            }
          }
        }
      }

      // Check subagent restrictions
      if (nodeDef.subagent) {
        // A. Read-only scope enforcement
        if (nodeDef.subagent.scope === "read-only") {
          const modifyingTools = [
            "write",
            "edit",
            "patch",
            "delete",
            "create_file",
          ];
          if (modifyingTools.includes(info.tool)) {
            throw new Error(
              `[Crewmate Guardrail Blocked] Tool '${info.tool}' is forbidden: Current node '${status.currentNode}' has scope 'read-only'. File modifications are not permitted during this phase.`,
            );
          }
        }

        // A2. Contracts-write scope enforcement (only permits modifications in .crewmate/contracts/)
        if (nodeDef.subagent.scope === "contracts-write") {
          const modifyingTools = [
            "write",
            "edit",
            "patch",
            "delete",
            "create_file",
          ];
          if (modifyingTools.includes(info.tool)) {
            const inputObj = info.input as Record<string, unknown> | undefined;
            const targetPath = (inputObj?.path ||
              inputObj?.filePath ||
              inputObj?.file) as string | undefined;
            const normPath = targetPath ? targetPath.replace(/\\/g, "/") : "";
            const isContractFile =
              normPath.includes(".crewmate/contracts/") ||
              normPath.startsWith("contracts/") ||
              normPath.includes("/contracts/");

            if (!targetPath || !isContractFile) {
              throw new Error(
                `[Crewmate Guardrail Blocked] Tool '${info.tool}' blocked on '${targetPath || "unknown"}': Current node '${status.currentNode}' has scope 'contracts-write'. Only contract definitions in .crewmate/contracts/ may be modified during this phase.`,
              );
            }
          }
        }

        // B. Allowed tools whitelist enforcement
        if (
          nodeDef.subagent.allowed_tools &&
          nodeDef.subagent.allowed_tools.length > 0
        ) {
          if (!nodeDef.subagent.allowed_tools.includes(info.tool)) {
            throw new Error(
              `[Crewmate Guardrail Blocked] Tool '${info.tool}' is not permitted: Node '${
                status.currentNode
              }' allows only [${nodeDef.subagent.allowed_tools.join(", ")}].`,
            );
          }
        }
      }

      // C. Forbidden file path enforcement (from .crewmate/contracts/structure.yaml)
      if (["write", "edit", "patch"].includes(info.tool)) {
        const inputObj = info.input as Record<string, unknown> | undefined;
        const targetPath = (inputObj?.path ||
          inputObj?.filePath ||
          inputObj?.file) as string | undefined;

        if (targetPath) {
          try {
            const structurePath = await resolveContractPath(
              projectRoot,
              "structure.yaml",
            );
            const structureContent = await fs.readFile(structurePath, "utf-8");
            const structure = StructureSchema.parse(
              yaml.parse(structureContent),
            );

            for (const pattern of structure.forbidden_patterns) {
              if (matchGlob(pattern, targetPath)) {
                throw new Error(
                  `[Crewmate Guardrail Blocked] Target path '${targetPath}' violates structure contract forbidden pattern: '${pattern}'.`,
                );
              }
            }
          } catch (err) {
            if (
              err instanceof Error &&
              err.message.startsWith("[Crewmate Guardrail Blocked]")
            ) {
              throw err;
            }
            // Ignore missing contracts/structure.yaml
          }
        }
      }

      // D. Task write-lock and scope enforcement (Write-only, reads are always unrestricted)
      if (["write", "edit", "patch"].includes(info.tool)) {
        const inputObj = info.input as Record<string, unknown> | undefined;
        const targetPath = (inputObj?.path ||
          inputObj?.filePath ||
          inputObj?.file) as string | undefined;

        if (targetPath) {
          const taskManager = engine.getTaskManager();
          const activeTasks = await taskManager.listTasks({ status: "active" });

          if (activeTasks.length > 0) {
            // Find candidate task: explicit taskId if passed, or matching task, or single active task
            const explicitTaskId = (inputObj?.taskId ||
              (info as any).meta?.taskId) as string | undefined;
            const targetTask = explicitTaskId
              ? activeTasks.find((t) => t.id === explicitTaskId)
              : activeTasks.find((t) =>
                  taskManager.isPathInList(targetPath, t.files),
                ) || (activeTasks.length === 1 ? activeTasks[0] : undefined);

            if (targetTask) {
              const inScope = taskManager.isPathInList(
                targetPath,
                targetTask.files,
              );
              if (!inScope) {
                // Attempt atomic scope amendment on write attempt
                const amendResult = await taskManager.amendScope(
                  targetTask.id,
                  targetPath,
                  "write tool auto-amendment",
                );
                if (amendResult.conflict) {
                  throw new Error(
                    `[Crewmate Guardrail Blocked] Scope conflict: Target file '${targetPath}' is currently locked by active task '${amendResult.conflictingTaskId}'. File modifications are blocked and escalated to lead agent.`,
                  );
                }
              }
            } else {
              // Multiple active tasks and targetPath does not belong to any:
              // Check if targetPath is locked by any active task
              const lockTable = await taskManager.getLocks();
              const lockEntry = lockTable.locks.find((l) =>
                taskManager.pathsEqual(l.file, targetPath),
              );
              if (lockEntry) {
                throw new Error(
                  `[Crewmate Guardrail Blocked] Target file '${targetPath}' is currently locked by active task '${lockEntry.taskId}'.`,
                );
              }
            }
          }
        }
      }
    });

    // 5. Background Session Event Subscription
    // Monitor session state, handle liveness, dynamic session tracking, and notify on escalation
    const abortController = new AbortController();
    (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: abortController.signal,
        })) {
          const evType = (event as any).type;

          if (evType === "workspace.status") {
            const wsData = (event as any).data;
            if (wsData?.status === "disconnected") {
              await writeHeartbeat("offline");
            } else if (wsData?.status === "connected") {
              await writeHeartbeat("idle");
            }
          } else if (evType === "location.shutdown") {
            await writeHeartbeat("offline");
            await engine.reconcileStaleActivities("server shutdown");
          } else if (evType === "session.viewed") {
            const sid = (event as any).data?.sessionID;
            if (sid) {
              await setActiveSession(sid);
              if ((currentHeartbeatStatus as string) === "offline") {
                await writeHeartbeat("idle");
              }
            }
          } else if (
            evType === "session.renamed" ||
            evType === "session.title"
          ) {
            const sid =
              (event as any).data?.sessionID || (event as any).data?.id;
            const title = (event as any).data?.title;
            if (sid) {
              await setActiveSession(sid, title);
            }
          } else if (evType === "session.deleted") {
            const sid =
              (event as any).data?.sessionID || (event as any).data?.id;
            if (activeSession?.id === sid) {
              activeSession = undefined;
              await writeHeartbeat("offline");
            }
            await engine.reconcileStaleActivities("session deleted");
          } else if (evType === "session.execution.interrupted") {
            const sid = (event as any).data?.sessionID;
            await setIdle(sid);
            await engine.reconcileStaleActivities("session interrupted");
          } else if (evType === "session.execution.failed") {
            const sid = (event as any).data?.sessionID;
            await setIdle(sid);
            await engine.reconcileStaleActivities("session failed");
          } else if (evType === "session.execution.succeeded") {
            const sid = (event as any).data?.sessionID;
            await setIdle(sid);
          } else if (evType === "session.status") {
            const data = (event as Record<string, unknown>).data as
              | Record<string, unknown>
              | undefined;
            const eventStatus = data?.status as
              | Record<string, unknown>
              | undefined;
            const sid = (data as any)?.sessionID as string | undefined;

            if (
              eventStatus?.type === "running" ||
              eventStatus?.type === "streaming"
            ) {
              await touchActivity(sid);
            } else if (eventStatus?.type === "idle") {
              await setIdle(sid);
              const isInit = await engine.getStateManager().exists();
              if (isInit) {
                const state = await engine.getStateManager().getState();
                if (state.status === "escalated") {
                  console.warn(
                    `\n[Crewmate Alert] Workflow on node '${state.currentNode}' is ESCALATED to '${state.escalationTarget}'. Manual review required.`,
                  );
                }
              }
            }
          } else if (
            evType === "session.message.created" ||
            evType === "session.message.updated" ||
            evType === "session.execution.started" ||
            evType === "session.step.started" ||
            evType === "session.tool.called"
          ) {
            const sid = (event as any).data?.sessionID;
            await touchActivity(sid);
          }
        }
      } catch {
        // Stream aborted or ended
      }
    })();

    // Cleanup hook
    return async () => {
      clearInterval(heartbeatTimer);
      process.removeListener("exit", onProcessExit);
      abortController.abort();
      await writeHeartbeat("offline");
    };
  },
});

export const crewmatePlugin = crewmateOpenCodePlugin;
export default crewmateOpenCodePlugin;
