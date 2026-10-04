#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { CrewmateEngine } from "../core/engine/engine.js";
import { scanArchitecture } from "../core/scanner/arch.js";
import { scanDeadCode } from "../core/scanner/dead-code.js";
import { installWatchBinary } from "./install-watch.js";

async function findWatchBinary(
  projectRoot: string,
): Promise<{ cmd: string; args: string[] }> {
  const isWin = process.platform === "win32";
  const exeName = isWin ? "crewmate-watch.exe" : "crewmate-watch";

  // Check explicit environment variable override
  if (
    process.env.CREWMATE_WATCH_BIN &&
    fs.existsSync(process.env.CREWMATE_WATCH_BIN)
  ) {
    return { cmd: process.env.CREWMATE_WATCH_BIN, args: [] };
  }

  // Find package root by walking up from the current script directory until package.json is found
  const __filename = fileURLToPath(import.meta.url);
  let currentDir = path.dirname(__filename);
  let pkgRoot = currentDir;
  for (let i = 0; i < 6; i++) {
    const pkgJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      pkgRoot = currentDir;
      break;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  const candidates = [
    path.join(pkgRoot, "bin", exeName),
    path.join(
      pkgRoot,
      "crates",
      "crewmate-watch",
      "target",
      "release",
      exeName,
    ),
    path.join(pkgRoot, "crates", "crewmate-watch", "target", "debug", exeName),
    path.join(projectRoot, "bin", exeName),
    path.join(
      projectRoot,
      "crates",
      "crewmate-watch",
      "target",
      "release",
      exeName,
    ),
    path.join(
      projectRoot,
      "crates",
      "crewmate-watch",
      "target",
      "debug",
      exeName,
    ),
  ];

  const pathDirs = (process.env.PATH || "").split(path.delimiter);

  const resolveExistingBinary = (): { cmd: string; args: string[] } | null => {
    // Find all existing candidates and select the most recently modified binary
    const existingCandidates = candidates
      .filter((c) => fs.existsSync(c))
      .map((c) => ({ path: c, mtime: fs.statSync(c).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (existingCandidates.length > 0) {
      return { cmd: existingCandidates[0].path, args: [] };
    }

    // Check system PATH
    for (const dir of pathDirs) {
      if (!dir) continue;
      const candidate = path.join(dir, exeName);
      if (fs.existsSync(candidate)) {
        return { cmd: candidate, args: [] };
      }
    }

    return null;
  };

  let binary = resolveExistingBinary();

  // If binary not found initially, attempt lazy download fallback and re-check
  if (!binary) {
    await installWatchBinary({ lazy: true });
    binary = resolveExistingBinary();
  }

  if (binary) {
    return binary;
  }

  // Fallback to cargo run if Cargo.toml is available
  const cargoCandidates = [
    path.join(pkgRoot, "crates", "crewmate-watch", "Cargo.toml"),
    path.join(projectRoot, "crates", "crewmate-watch", "Cargo.toml"),
  ];

  for (const cargoManifest of cargoCandidates) {
    if (fs.existsSync(cargoManifest)) {
      return {
        cmd: "cargo",
        args: ["run", "--release", "--manifest-path", cargoManifest, "--"],
      };
    }
  }

  throw new Error(
    `Could not find '${exeName}' binary.\nChecked candidates:\n${candidates.map((c) => `  - ${c}`).join("\n")}\nPlease run 'cargo build --release --manifest-path crates/crewmate-watch/Cargo.toml' to compile the watch TUI.`,
  );
}

const program = new Command();

program
  .name("crewmate")
  .description(
    "CLI-based workflow engine for contract-driven agent development",
  )
  .version("0.2.0");

// crewmate init
program
  .command("init")
  .description(
    "Scaffold .crewmate/contracts/ and .crewmate/workflows/ directories",
  )
  .option("-f, --force", "Overwrite existing files if present", false)
  .option(
    "-e, --example",
    "Include sample example module contract and capabilities",
    false,
  )
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const res = await engine.init({
        force: options.force,
        example: options.example,
      });
      console.log("Initialized Crewmate workspace successfully.");
      for (const f of res.filesCreated) {
        console.log(`  + ${f}`);
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Error during init: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate status
program
  .command("status")
  .description("Display current node, phase, retry count, and gate status")
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const status = await engine.status();
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log("=== CREWMATE STATUS ===");
        console.log(`Current Node: ${status.currentNode}`);
        console.log(`Status:       ${status.status.toUpperCase()}`);
        console.log(
          `Retry Count:  ${status.retryCount} / ${status.maxRetries}`,
        );
        if (status.escalationTarget) {
          console.log(
            `Escalation:   Escalated to '${status.escalationTarget}'`,
          );
        }
        if (status.subagent) {
          console.log(
            `Subagent:     ${status.subagent.role} (${status.subagent.scope})`,
          );
        }
        if (status.lastGateResults.length > 0) {
          console.log("\nLast Gate Results:");
          for (const g of status.lastGateResults) {
            const symbol = g.status === "passed" ? "✓" : "✗";
            console.log(`  [${symbol}] [${g.phase}] ${g.gate} (${g.status})`);
          }
        }
        if (status.unclosedActivities && status.unclosedActivities.length > 0) {
          console.log(
            `\nUnclosed Activities (${status.unclosedActivities.length}): [INTERRUPTED / UNFINISHED WORK]`,
          );
          for (const a of status.unclosedActivities) {
            const metaFiles = engine.getActivityManager().extractFiles(a);
            const filesTag =
              metaFiles.length > 0 ? ` (files: ${metaFiles.join(", ")})` : "";
            console.log(
              `  - ${a.id}: [${a.agent}] "${a.label}" (started: ${a.startAt})${filesTag}`,
            );
          }
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate watch
program
  .command("watch")
  .description("Launch read-only live TUI observer for workflow engine")
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .option(
    "--fps <number>",
    "UI polling and refresh rate in frames per second",
    "10",
  )
  .action(async (options) => {
    try {
      const { cmd, args } = await findWatchBinary(options.projectRoot);
      const fullArgs = [
        ...args,
        "--root",
        path.resolve(options.projectRoot),
        "--fps",
        String(options.fps),
      ];
      const child = spawn(cmd, fullArgs, {
        stdio: "inherit",
        shell: false,
      });

      child.on("error", (err) => {
        console.error(`Failed to launch watch observer: ${err.message}`);
        process.exit(1);
      });

      child.on("exit", (code) => {
        process.exit(code ?? 0);
      });
    } catch (err: unknown) {
      console.error(
        `Watch Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate context
program
  .command("context")
  .description(
    "Get tiered, scoped context bundle for injection into agent context",
  )
  .option("--node <id>", "Specific node ID (defaults to current node)")
  .option("-m, --module <name>", "Scope to specific module")
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const bundle = await engine.context(options.node, {
        module: options.module,
      });
      if (options.json) {
        console.log(JSON.stringify(bundle, null, 2));
      } else {
        console.log(bundle.formatted);
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate query <module>
program
  .command("query <module>")
  .description("Single-field contract lookup without dumping full contracts")
  .requiredOption(
    "-f, --field <f>",
    "Field to query (e.g. public_api, invariants)",
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (moduleName, options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const value = await engine.query(moduleName, options.field);
      if (options.json) {
        console.log(
          JSON.stringify(
            { module: moduleName, field: options.field, value },
            null,
            2,
          ),
        );
      } else {
        if (typeof value === "object" && value !== null) {
          console.log(JSON.stringify(value, null, 2));
        } else {
          console.log(value);
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate gate check
const gateCmd = program
  .command("gate")
  .description("Gate verification commands");

gateCmd
  .command("check")
  .description("Run hard gates for a node")
  .requiredOption("--node <id>", "Node ID to check gates for")
  .option("--phase <phase>", "Phase to run ('pre' or 'post')")
  .option("--tool <tool>", "Tool being checked")
  .option("--args <json>", "Tool arguments JSON")
  .option("--json", "Output structured JSON", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const res = await engine.gateCheck(options.node, {
        phase: options.phase as "pre" | "post" | undefined,
        tool: options.tool,
        args: options.args,
      });

      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          `Gate Check [Node: ${options.node}]: ${res.passed ? "PASSED" : "FAILED"}`,
        );
        for (const g of res.results) {
          const sym = g.status === "passed" ? "✓" : "✗";
          console.log(`  [${sym}] [${g.phase}] ${g.gate}: ${g.status}`);
          if (g.error) {
            console.log(`      Error: ${g.error}`);
          }
        }
      }

      process.exit(res.passed ? 0 : 1);
    } catch (err: unknown) {
      console.error(
        `Gate Check Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate advance
program
  .command("advance")
  .description(
    "Evaluate post-conditions; transition or route back per graph.yaml",
  )
  .option("--json", "Output structured JSON", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const result = await engine.advance();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.advanced) {
          console.log(
            `✓ Advanced from '${result.from}' -> '${result.to}'. Status: ${result.status}`,
          );
        } else {
          console.log(`✗ Advance blocked on node '${result.from}'.`);
          if (result.message) {
            console.log(`  ${result.message}`);
          }
          if (
            result.unclosedActivities &&
            result.unclosedActivities.length > 0
          ) {
            console.log("\nUnresolved unclosed activities:");
            for (const a of result.unclosedActivities) {
              const files = engine.getActivityManager().extractFiles(a);
              const filesTag =
                files.length > 0 ? ` [files: ${files.join(", ")}]` : "";
              console.log(
                `  - ${a.id}: [${a.agent}] "${a.label}" (started: ${a.startAt})${filesTag}`,
              );
            }
          }
        }
      }

      process.exit(result.advanced ? 0 : 1);
    } catch (err: unknown) {
      console.error(
        `Advance Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate goto <node>
program
  .command("goto <node>")
  .description("Manual override to transition directly to a node")
  .option("-f, --force", "Force transition even if node file is missing", false)
  .option("--json", "Output structured JSON", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (targetNode, options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const res = await engine.goto(targetNode, { force: options.force });
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`Overrode current node: '${res.from}' -> '${res.to}'`);
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Goto Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate scan arch / dead-code
const scanCmd = program
  .command("scan")
  .description("Static analysis scanning commands");

scanCmd
  .command("arch")
  .description("Run dependency-direction check against architecture.yaml")
  .option("--json", "Output structured JSON", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const result = await scanArchitecture(options.projectRoot);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.valid) {
          console.log(
            `✓ Architecture check passed (${result.scannedFiles} files checked, 0 violations).`,
          );
        } else {
          console.log(
            `✗ Architecture check FAILED (${result.violations.length} violations):`,
          );
          for (const v of result.violations) {
            console.log(`  - ${v.file}:${v.line}: ${v.message}`);
          }
        }
      }
      process.exit(result.valid ? 0 : 1);
    } catch (err: unknown) {
      console.error(
        `Architecture Scan Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

scanCmd
  .command("dead-code")
  .description(
    "Cross-reference static analysis against declared public surfaces",
  )
  .option("--json", "Output structured JSON", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const result = await scanDeadCode(options.projectRoot);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log("=== DEAD CODE SCAN PROPOSAL ===");
        if (result.safeDeleteCandidates.length > 0) {
          console.log(
            `\nSafe-Delete Candidates (${result.safeDeleteCandidates.length}): [HIGH CONFIDENCE]`,
          );
          for (const c of result.safeDeleteCandidates) {
            console.log(
              `  - ${c.file} -> symbol '${c.symbol}' (line ${c.line}): ${c.reason}`,
            );
            if (c.provenance) {
              console.log(
                `    Provenance: first introduced in ${c.provenance.originatingActivityId} by [${c.provenance.originatingAgent}] ("${c.provenance.originatingLabel}") at ${c.provenance.originatingAt}; referenced in ${c.provenance.subsequentReferenceCount} later activities.`,
              );
            }
          }
        } else {
          console.log("\nNo safe-delete candidates found.");
        }

        if (result.flaggedForReview.length > 0) {
          console.log(
            `\nFlagged For Human Review (${result.flaggedForReview.length}): [DO NOT AUTO-DELETE]`,
          );
          for (const f of result.flaggedForReview) {
            console.log(
              `  - ${f.file} -> symbol '${f.symbol}' (contract: ${f.contract}): ${f.reason}`,
            );
            if (f.provenance) {
              console.log(
                `    Provenance: first introduced in ${f.provenance.originatingActivityId} by [${f.provenance.originatingAgent}] ("${f.provenance.originatingLabel}") at ${f.provenance.originatingAt}; referenced in ${f.provenance.subsequentReferenceCount} later activities.`,
              );
            }
          }
        }
      }
      // Exit 0 if no safe-delete candidates, 1 if safe-delete candidates found
      process.exit(result.valid ? 0 : 1);
    } catch (err: unknown) {
      console.error(
        `Dead Code Scan Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate activity
const activityCmd = program
  .command("activity")
  .description("Activity tracking commands");

activityCmd
  .command("start")
  .description("Log start of an agent activity; returns activity ID")
  .requiredOption(
    "--agent <name>",
    "Agent name or role performing the activity",
  )
  .requiredOption("--label <text>", "Short description of the activity")
  .option("--node <id>", "Workflow node context")
  .option("--parent <id>", "Parent activity ID (for nesting)")
  .option(
    "--meta <json>",
    'Optional metadata JSON (e.g. {"files":["auth/session.ts"]})',
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      let parsedMeta: Record<string, unknown> | undefined = undefined;
      if (options.meta) {
        try {
          parsedMeta = JSON.parse(options.meta);
        } catch (e) {
          throw new Error(
            `Invalid JSON passed to --meta: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      const id = await engine.getActivityManager().start({
        agent: options.agent,
        label: options.label,
        node: options.node,
        parent: options.parent,
        meta: parsedMeta,
      });

      if (options.json) {
        console.log(
          JSON.stringify(
            { id, event: "start", agent: options.agent, label: options.label },
            null,
            2,
          ),
        );
      } else {
        console.log(id);
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Activity Start Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

activityCmd
  .command("end")
  .description("Log end of an agent activity")
  .requiredOption("--id <id>", "Activity ID to end")
  .option(
    "--status <status>",
    "Outcome status (completed, failed, interrupted)",
    "completed",
  )
  .option("--meta <json>", "Optional outcome metadata JSON")
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      let parsedMeta: Record<string, unknown> | undefined = undefined;
      if (options.meta) {
        try {
          parsedMeta = JSON.parse(options.meta);
        } catch (e) {
          throw new Error(
            `Invalid JSON passed to --meta: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      const record = await engine.getActivityManager().end({
        id: options.id,
        status: options.status as any,
        meta: parsedMeta,
      });

      if (options.json) {
        console.log(JSON.stringify(record, null, 2));
      } else {
        console.log(
          `Activity ${record.id} ended with status '${record.status}'.`,
        );
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Activity End Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

activityCmd
  .command("list")
  .description("List activity history with optional filters")
  .option("--active", "Show only unclosed / active activities", false)
  .option("--node <id>", "Filter by workflow node")
  .option("--agent <name>", "Filter by agent name")
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const activities = await engine.getActivityManager().getActivities({
        activeOnly: options.active,
        node: options.node,
        agent: options.agent,
      });

      if (options.json) {
        console.log(JSON.stringify(activities, null, 2));
      } else {
        if (activities.length === 0) {
          console.log("No activities found.");
        } else {
          console.log(`=== CREWMATE ACTIVITIES (${activities.length}) ===`);
          for (const a of activities) {
            const statusTag = a.isUnclosed
              ? "[UNCLOSED] (active)"
              : `(${a.status})`;
            const nodeTag = a.node ? ` [node: ${a.node}]` : "";
            const parentTag = a.parent ? ` [parent: ${a.parent}]` : "";
            const files = engine.getActivityManager().extractFiles(a);
            const filesTag =
              files.length > 0 ? ` [files: ${files.join(", ")}]` : "";
            console.log(
              `  - ${a.id}: [${a.agent}] "${a.label}" ${statusTag}${nodeTag}${parentTag}${filesTag}`,
            );
          }
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Activity List Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

activityCmd
  .command("tree")
  .description(
    "Display activity tree showing parent/child nesting and unclosed items",
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const roots = await engine.getActivityManager().getActivityTree();

      if (options.json) {
        console.log(JSON.stringify(roots, null, 2));
      } else {
        if (roots.length === 0) {
          console.log("No activities found.");
        } else {
          console.log("=== CREWMATE ACTIVITY TREE ===");
          console.log(engine.getActivityManager().renderTree(roots));
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Activity Tree Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

activityCmd
  .command("reconcile")
  .description(
    "Reconcile and close stale or orphaned unclosed activities (e.g. after crash or disconnect)",
  )
  .option(
    "--reason <text>",
    "Reason for closing stale activities",
    "harness offline",
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const closed = await engine.reconcileStaleActivities(options.reason);

      if (options.json) {
        console.log(
          JSON.stringify(
            { closedCount: closed.length, closedIds: closed },
            null,
            2,
          ),
        );
      } else {
        if (closed.length === 0) {
          console.log("No stale unclosed activities to reconcile.");
        } else {
          console.log(
            `Reconciled ${closed.length} stale activities: ${closed.join(", ")}`,
          );
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Activity Reconcile Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate task
const taskCmd = program
  .command("task")
  .description(
    "Manage contract-scoped parallel tasks, locks, amendments, and completion gates",
  );

taskCmd
  .command("create")
  .description("Create a new contract-scoped task")
  .requiredOption(
    "--contract <path>",
    "Module contract file path or module name",
  )
  .requiredOption(
    "--files <f1,f2,...>",
    "Comma-separated list of files in task scope",
  )
  .requiredOption("--goal <text>", "Goal/description of the task")
  .option(
    "--depends-on <id,...>",
    "Comma-separated list of dependency task IDs",
  )
  .option("--id <id>", "Custom task ID (default: auto-generated task_xxx)")
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const files = options.files
        .split(",")
        .map((f: string) => f.trim())
        .filter((f: string) => f.length > 0);
      const dependsOn = options.dependsOn
        ? options.dependsOn
            .split(",")
            .map((id: string) => id.trim())
            .filter((id: string) => id.length > 0)
        : [];

      const task = await engine.createTask({
        id: options.id,
        contract: options.contract,
        files,
        goal: options.goal,
        depends_on: dependsOn,
      });

      if (options.json) {
        console.log(JSON.stringify(task, null, 2));
      } else {
        console.log(`Task '${task.id}' created successfully.`);
        console.log(`  Goal: ${task.goal}`);
        console.log(`  Contract: ${task.contract}`);
        console.log(`  Files: ${task.files.join(", ")}`);
        if (task.depends_on.length > 0) {
          const depDetails = (task.dependencies || [])
            .map((d) => `${d.taskId} (${d.reason})`)
            .join(", ");
          console.log(
            `  Depends on: ${depDetails || task.depends_on.join(", ")}`,
          );
        }
        console.log(`  Status: ${task.status}`);
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Task Create Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

taskCmd
  .command("list")
  .description("List tasks, optionally filtered by status")
  .option(
    "--status <status>",
    "Filter by status (pending|active|blocked|done|failed)",
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const tasks = await engine.listTasks({ status: options.status });

      if (options.json) {
        console.log(JSON.stringify(tasks, null, 2));
      } else {
        if (tasks.length === 0) {
          console.log("No tasks found.");
        } else {
          console.log("=== CREWMATE TASKS ===");
          for (const t of tasks) {
            const deps =
              t.depends_on.length > 0
                ? ` [depends_on: ${t.depends_on.join(", ")}]`
                : "";
            const files = ` [files: ${t.files.join(", ")}]`;
            console.log(
              `  - ${t.id} [${t.status.toUpperCase()}]: "${t.goal}" (${t.contract})${deps}${files}`,
            );
          }
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Task List Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

taskCmd
  .command("start")
  .description(
    "Attempt atomic lock-grant and start task (sets active or blocked)",
  )
  .requiredOption("--id <task_id>", "Task ID to start")
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const result = await engine.startTask(options.id);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.success) {
          console.log(`Task '${options.id}' is now ACTIVE.`);
          console.log(
            `  Locked files: ${(result.lockedFiles || []).join(", ")}`,
          );
        } else {
          console.log(`Task '${options.id}' could not be started: BLOCKED.`);
          console.log(`  Reason: ${result.reason}`);
        }
      }
      process.exit(result.success ? 0 : 2);
    } catch (err: unknown) {
      console.error(
        `Task Start Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

taskCmd
  .command("amend")
  .description(
    "Amend scope for an active task (goes through atomic lock-grant)",
  )
  .requiredOption("--id <task_id>", "Active task ID to amend")
  .requiredOption("--add-file <path>", "File path to add to task scope")
  .option("--reason <text>", "Reason for scope amendment")
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const result = await engine.amendTaskScope(
        options.id,
        options.addFile,
        options.reason,
      );

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.success) {
          console.log(`Task '${options.id}' scope amended successfully.`);
          console.log(`  File: ${result.file}`);
        } else {
          console.log(`Task '${options.id}' scope amendment FAILED: CONFLICT.`);
          console.log(`  ${result.message}`);
        }
      }
      process.exit(result.success ? 0 : 2);
    } catch (err: unknown) {
      console.error(
        `Task Amend Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

taskCmd
  .command("complete")
  .description(
    "Run task completion gate (scope-diff backstop + contract gates) and finalize",
  )
  .requiredOption("--id <task_id>", "Task ID to complete")
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const result = await engine.completeTask(options.id);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.success) {
          console.log(
            `Task '${options.id}' COMPLETED successfully (status: DONE).`,
          );
          console.log(
            `  Touched files verified: ${(result.touchedFiles || []).join(", ")}`,
          );
        } else {
          console.log(
            `Task '${options.id}' FAILED completion gate (status: FAILED).`,
          );
          console.log(`  Error: ${result.error}`);
        }
      }
      process.exit(result.success ? 0 : 2);
    } catch (err: unknown) {
      console.error(
        `Task Complete Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

taskCmd
  .command("locks")
  .description(
    "Display current active lock table (which task holds which files)",
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const table = await engine.getTaskLocks();

      if (options.json) {
        console.log(JSON.stringify(table, null, 2));
      } else {
        console.log("=== CREWMATE ACTIVE TASK LOCKS ===");
        if (table.locks.length === 0) {
          console.log("No active locks held.");
        } else {
          for (const lock of table.locks) {
            console.log(`  - ${lock.file} -> [${lock.taskId}]`);
          }
          console.log(
            `\nActive tasks holding locks: ${table.activeTasks.join(", ")}`,
          );
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Task Locks Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

taskCmd
  .command("conflicts")
  .description("Display scope conflict history and summary per module")
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const summary = await engine.getTaskConflictSummary();

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log("=== CREWMATE SCOPE CONFLICT SUMMARY ===");
        console.log(`Total conflicts logged: ${summary.totalConflicts}`);
        if (summary.totalConflicts > 0) {
          console.log("\nConflicts by module:");
          for (const [mod, count] of Object.entries(summary.byModule)) {
            console.log(`  - ${mod}: ${count}`);
          }
          console.log("\nRecent conflicts:");
          for (const c of summary.conflicts.slice(-10)) {
            console.log(
              `  - ${c.at}: Task '${c.taskId}' wanted '${c.file}' (locked by '${c.conflictingTaskId}')`,
            );
          }
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Task Conflicts Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// crewmate workflow <subcommand>
const workflowCmd = program
  .command("workflow")
  .description("Multi-workflow orchestration and run reporting commands");

workflowCmd
  .command("list")
  .description(
    "List available workflows in .crewmate/workflows/ and show the active workflow",
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const workflows = await engine.listWorkflows();

      if (options.json) {
        console.log(JSON.stringify(workflows, null, 2));
      } else {
        console.log("=== CREWMATE WORKFLOWS ===");
        if (workflows.length === 0) {
          console.log(
            "No workflows found. Run 'crewmate init' to scaffold the default workflow.",
          );
        } else {
          for (const wf of workflows) {
            const activeMarker = wf.active ? " [ACTIVE]" : "";
            console.log(
              `* ${wf.name}${activeMarker} (initial: ${wf.initialNode}, ${wf.nodeCount} nodes)`,
            );
          }
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Workflow List Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

workflowCmd
  .command("create <name>")
  .description(
    "Create a new workflow with scaffolded graph and node definitions",
  )
  .option(
    "-d, --display-name <name>",
    "Human-readable display name for the workflow",
  )
  .option(
    "-n, --nodes <nodes>",
    "Comma-separated list of node IDs (e.g. triage,patch,verify)",
  )
  .option(
    "-f, --force",
    "Overwrite existing workflow directory if it exists",
    false,
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (name, options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const res = await engine.createWorkflow(name, {
        displayName: options.displayName,
        nodes: options.nodes ? options.nodes.split(",") : undefined,
        force: options.force,
      });

      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          `Workflow '${res.workflow}' created successfully at ${path.relative(options.projectRoot, res.workflowDir).replace(/\\/g, "/")}`,
        );
        console.log("Files created:");
        for (const f of res.filesCreated) {
          console.log(`  • ${f}`);
        }
        console.log();
        if (res.validation.valid) {
          console.log(
            `Validation: PASSED (${res.validation.summary.nodeCount} nodes, 0 errors, ${res.validation.summary.warnings} warnings)`,
          );
        } else {
          console.log(
            `Validation: FAILED (${res.validation.summary.errors} errors, ${res.validation.summary.warnings} warnings)`,
          );
          for (const issue of res.validation.issues) {
            const prefix = issue.type === "error" ? "[✗]" : "[!]";
            console.log(`  ${prefix} ${issue.message}`);
          }
        }
        console.log();
        console.log(`To switch to this workflow:`);
        console.log(`  crewmate workflow run ${res.workflow}`);
      }
      process.exit(res.validation.valid ? 0 : 1);
    } catch (err: unknown) {
      console.error(
        `Workflow Create Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

workflowCmd
  .command("validate [name]")
  .description(
    "Validate workflow graph structure, node definitions, and connectivity",
  )
  .option("-a, --all", "Validate all workflows in .crewmate/workflows/", false)
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (name, options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);

      if (options.all) {
        const workflows = await engine.listWorkflows();
        if (workflows.length === 0) {
          if (options.json) {
            console.log(JSON.stringify([], null, 2));
          } else {
            console.log("No workflows found to validate.");
          }
          process.exit(0);
        }

        const results = [];
        let allValid = true;
        for (const wf of workflows) {
          const res = await engine.validateWorkflow(wf.name);
          results.push(res);
          if (!res.valid) allValid = false;
        }

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          console.log("=== CREWMATE WORKFLOW VALIDATION ===");
          for (const res of results) {
            const statusLabel = res.valid ? "VALID" : "INVALID";
            console.log(
              `\nWorkflow: ${res.workflow} [${statusLabel}] (${res.summary.nodeCount} nodes)`,
            );
            console.log(`Graph: ${res.graphPath}`);
            if (res.issues.length === 0) {
              console.log("  [✓] All checks passed.");
            } else {
              for (const issue of res.issues) {
                const prefix = issue.type === "error" ? "[✗]" : "[!]";
                console.log(`  ${prefix} ${issue.message}`);
              }
            }
          }
        }
        process.exit(allValid ? 0 : 1);
      } else {
        const res = await engine.validateWorkflow(name);
        if (options.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          const statusLabel = res.valid ? "VALID" : "INVALID";
          console.log(
            `=== WORKFLOW VALIDATION: ${res.workflow} [${statusLabel}] ===`,
          );
          if (res.graphPath) {
            console.log(`Graph: ${res.graphPath}`);
          }
          console.log(`Nodes: ${res.summary.nodeCount}`);
          console.log(
            `Issues: ${res.summary.errors} error(s), ${res.summary.warnings} warning(s)\n`,
          );

          if (res.issues.length === 0) {
            console.log(
              "[✓] All checks passed: graph schema, node files, edge connectivity, and terminal path.",
            );
          } else {
            for (const issue of res.issues) {
              const prefix = issue.type === "error" ? "[✗]" : "[!]";
              console.log(`${prefix} ${issue.message}`);
            }
          }
        }
        process.exit(res.valid ? 0 : 1);
      }
    } catch (err: unknown) {
      console.error(
        `Workflow Validate Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

workflowCmd
  .command("run <name>")
  .description("Switch to and start running a named workflow")
  .option(
    "-f, --force",
    "Force switch even if harness is running or tasks are locked",
    false,
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (name, options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const res = await engine.runWorkflow(name, { force: options.force });

      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`Workflow switched to '${res.workflow}'`);
        console.log(`Run ID: ${res.runId}`);
        console.log(`Current node: ${res.initialNode}`);
        if (res.previousRunReport) {
          console.log(
            `Previous run '${res.previousRunReport.runId}' archived (${res.previousRunReport.status})`,
          );
        }
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Workflow Run Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

interface WorkflowResetCliOptions {
  projectRoot: string;
  reason?: string;
  node?: string;
  force: boolean;
  json: boolean;
}

async function handleWorkflowReset(
  options: WorkflowResetCliOptions,
): Promise<void> {
  try {
    const engine = new CrewmateEngine(options.projectRoot);
    const res = await engine.resetWorkflow({
      reason: options.reason,
      node: options.node,
      force: options.force,
    });

    if (options.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`Workflow '${res.workflow}' reset to node '${res.node}'`);
      console.log(`New Run ID: ${res.runId}`);
      if (res.previousRunReport) {
        console.log(
          `Previous run '${res.previousRunReport.runId}' archived (${res.previousRunReport.status})`,
        );
      }
    }
    process.exit(0);
  } catch (err: unknown) {
    console.error(
      `Workflow Reset Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

workflowCmd
  .command("reset")
  .description("Reset the active workflow run to initial or specified node")
  .option("-r, --reason <reason>", "Reason for resetting workflow")
  .option(
    "-n, --node <node>",
    "Target node to reset to (defaults to graph initial)",
  )
  .option(
    "-f, --force",
    "Force reset even if harness is running or tasks are locked",
    false,
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(handleWorkflowReset);

workflowCmd
  .command("report")
  .description("Display the workflow run report (latest or specified run)")
  .option("--run <runId>", "Specific run ID to display")
  .option("--json", "Output in raw JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      const report = await engine.getReport(options.run);

      if (!report) {
        console.log("No workflow report found.");
        process.exit(0);
      }

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const reportMgr = engine.getReportManager();
        console.log(reportMgr.renderMarkdown(report));
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Workflow Report Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// Shortcut: crewmate reset
program
  .command("reset")
  .description("Reset current workflow run (alias for 'workflow reset')")
  .option("-r, --reason <reason>", "Reason for resetting workflow")
  .option(
    "-n, --node <node>",
    "Target node to reset to (defaults to graph initial)",
  )
  .option(
    "-f, --force",
    "Force reset even if harness is running or tasks are locked",
    false,
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(handleWorkflowReset);

// crewmate archive
const archiveCmd = program
  .command("archive [runId]")
  .description(
    "Archive workflow run data (events, completed tasks, activity) to .crewmate/archive/<runId>/",
  )
  .option("--json", "Output in JSON format", false)
  .option("-p, --project-root <dir>", "Project root directory", process.cwd())
  .action(async (runId, options) => {
    try {
      const engine = new CrewmateEngine(options.projectRoot);
      if (runId === "list") {
        const archives = await engine.listArchives();
        if (options.json) {
          console.log(JSON.stringify(archives, null, 2));
        } else {
          if (archives.length === 0) {
            console.log("No archived workflow runs found.");
          } else {
            console.log("Archived Workflow Runs:");
            for (const a of archives) {
              console.log(
                `  • ${a.runId} (${a.workflow}, ${a.status}) — ${a.eventCount} events, ${a.taskCount} tasks, ${a.activityCount} activities`,
              );
            }
          }
        }
        process.exit(0);
      }

      const manifest = await engine.archiveRun(runId);
      if (options.json) {
        console.log(JSON.stringify(manifest, null, 2));
      } else {
        console.log(`Archived run "${manifest.runId}" successfully.`);
        console.log(`  Workflow: ${manifest.workflow} (${manifest.status})`);
        console.log(`  State events: ${manifest.eventCount}`);
        console.log(`  Tasks moved: ${manifest.taskCount}`);
        console.log(`  Activities: ${manifest.activityCount}`);
        console.log(`  Target: .crewmate/archive/${manifest.runId}/`);
      }
      process.exit(0);
    } catch (err: unknown) {
      console.error(
        `Archive Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

program.parse(process.argv);
