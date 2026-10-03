import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type StateEvent, type GateResult } from "../schemas/state.js";
import { type ActivityRecord } from "../schemas/activity.js";
import { type TaskDefinition } from "../schemas/task.js";

export interface WorkflowRunReport {
  runId: string;
  workflow: string;
  status: "completed" | "reset" | "superseded" | "failed" | "active";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  initialNode: string;
  finalNode: string;
  reason?: string;
  summary: {
    transitionsCount: number;
    gateChecks: {
      total: number;
      passed: number;
      failed: number;
    };
    retryCounts: Record<string, number>;
    activities: {
      total: number;
      unclosed: number;
    };
    tasks: {
      total: number;
      done: number;
      failed: number;
      conflicts: number;
    };
  };
  transitions: Array<{
    from: string;
    to: string;
    reason: string;
    timestamp: string;
  }>;
  gateResults: GateResult[];
  activities: Array<{
    id: string;
    agent: string;
    label: string;
    status: string;
    node?: string;
  }>;
  tasks: Array<{
    id: string;
    goal: string;
    contract: string;
    status: string;
    files: string[];
  }>;
  events: StateEvent[];
}

export interface ReportSummaryItem {
  runId: string;
  workflow: string;
  status: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  initialNode: string;
  finalNode: string;
}

export class ReportManager {
  private projectRoot: string;
  private reportsDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.reportsDir = path.join(projectRoot, ".crewmate", "reports");
  }

  public getReportsDir(): string {
    return this.reportsDir;
  }

  /**
   * Assemble and persist a run report in both JSON and Markdown
   */
  public async generateReport(options: {
    runId: string;
    workflow: string;
    status: "completed" | "reset" | "superseded" | "failed" | "active";
    reason?: string;
    events: StateEvent[];
    activities?: ActivityRecord[];
    tasks?: TaskDefinition[];
  }): Promise<WorkflowRunReport> {
    await fs.mkdir(this.reportsDir, { recursive: true });

    const runEvents = options.events;
    const startedAt =
      runEvents.length > 0 ? runEvents[0].timestamp : new Date().toISOString();
    const endedAt = new Date().toISOString();
    const durationMs = Math.max(
      0,
      new Date(endedAt).getTime() - new Date(startedAt).getTime(),
    );

    // Compute initial and final nodes
    let initialNode = "unknown";
    let finalNode = "unknown";
    const transitions: WorkflowRunReport["transitions"] = [];
    const gateResultsMap = new Map<string, GateResult>();
    const retryCounts: Record<string, number> = {};

    for (const ev of runEvents) {
      if (ev.event === "INIT") {
        initialNode = ev.initialNode;
        finalNode = ev.initialNode;
      } else if (ev.event === "RUN_START") {
        initialNode = ev.initialNode;
        finalNode = ev.initialNode;
      } else if (ev.event === "NODE_TRANSITION") {
        transitions.push({
          from: ev.from,
          to: ev.to,
          reason: ev.reason,
          timestamp: ev.timestamp,
        });
        finalNode = ev.to;
      } else if (ev.event === "OVERRIDE") {
        transitions.push({
          from: ev.from,
          to: ev.to,
          reason: ev.reason || "override",
          timestamp: ev.timestamp,
        });
        finalNode = ev.to;
      } else if (ev.event === "COMPLETE") {
        finalNode = ev.node;
      } else if (ev.event === "GATE_CHECK") {
        const key = `${ev.node}:${ev.phase}:${ev.gate}`;
        gateResultsMap.set(key, {
          gate: ev.gate,
          phase: ev.phase,
          type: "hard",
          status: ev.status,
          exitCode: ev.exitCode,
          output: ev.output,
          evidence: ev.evidence,
          error: ev.error,
        });
      } else if (ev.event === "RETRY_INCREMENT") {
        retryCounts[ev.node] = ev.retryCount;
      }
    }

    const gateResults = Array.from(gateResultsMap.values());
    const gatePassed = gateResults.filter((g) => g.status === "passed").length;
    const gateFailed = gateResults.filter((g) => g.status === "failed").length;

    const allActivities = options.activities || [];
    const unclosedActivities = allActivities.filter((a) => a.isUnclosed);

    const allTasks = options.tasks || [];
    const tasksDone = allTasks.filter((t) => t.status === "done").length;
    const tasksFailed = allTasks.filter((t) => t.status === "failed").length;
    let conflictCount = 0;
    for (const t of allTasks) {
      conflictCount +=
        t.amendments?.filter((a) => a.type === "scope_conflict").length || 0;
    }

    const report: WorkflowRunReport = {
      runId: options.runId,
      workflow: options.workflow,
      status: options.status,
      startedAt,
      endedAt,
      durationMs,
      initialNode,
      finalNode,
      reason: options.reason,
      summary: {
        transitionsCount: transitions.length,
        gateChecks: {
          total: gateResults.length,
          passed: gatePassed,
          failed: gateFailed,
        },
        retryCounts,
        activities: {
          total: allActivities.length,
          unclosed: unclosedActivities.length,
        },
        tasks: {
          total: allTasks.length,
          done: tasksDone,
          failed: tasksFailed,
          conflicts: conflictCount,
        },
      },
      transitions,
      gateResults,
      activities: allActivities.map((a) => ({
        id: a.id,
        agent: a.agent,
        label: a.label,
        status: a.status,
        node: a.node,
      })),
      tasks: allTasks.map((t) => ({
        id: t.id,
        goal: t.goal,
        contract: t.contract,
        status: t.status,
        files: t.files,
      })),
      events: runEvents,
    };

    // 1. Write JSON
    const jsonPath = path.join(this.reportsDir, `${options.runId}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");

    // 2. Write Markdown
    const mdPath = path.join(this.reportsDir, `${options.runId}.md`);
    const mdContent = this.renderMarkdown(report);
    await fs.writeFile(mdPath, mdContent, "utf-8");

    // 3. Write latest pointer
    const latestPath = path.join(this.reportsDir, "latest.json");
    await fs.writeFile(latestPath, JSON.stringify(report, null, 2), "utf-8");

    return report;
  }

  public renderMarkdown(report: WorkflowRunReport): string {
    const lines: string[] = [];
    lines.push(`# Crewmate Workflow Run Report: ${report.runId}`);
    lines.push("");
    lines.push(`- **Workflow:** ${report.workflow}`);
    lines.push(`- **Status:** \`${report.status.toUpperCase()}\``);
    if (report.reason) {
      lines.push(`- **Reason:** ${report.reason}`);
    }
    lines.push(`- **Started At:** ${report.startedAt}`);
    lines.push(
      `- **Ended At:** ${report.endedAt} (${(report.durationMs / 1000).toFixed(2)}s)`,
    );
    lines.push(
      `- **Initial Node:** \`${report.initialNode}\` → **Final Node:** \`${report.finalNode}\``,
    );
    lines.push("");

    lines.push("## Summary");
    lines.push(`- **Transitions:** ${report.summary.transitionsCount}`);
    lines.push(
      `- **Gate Checks:** ${report.summary.gateChecks.passed}/${report.summary.gateChecks.total} passed (${report.summary.gateChecks.failed} failed)`,
    );
    lines.push(
      `- **Activities Tracked:** ${report.summary.activities.total} (${report.summary.activities.unclosed} unclosed)`,
    );
    lines.push(
      `- **Tasks Executed:** ${report.summary.tasks.total} (${report.summary.tasks.done} done, ${report.summary.tasks.failed} failed, ${report.summary.tasks.conflicts} conflicts)`,
    );

    if (Object.keys(report.summary.retryCounts).length > 0) {
      lines.push("");
      lines.push("### Retries per Node");
      for (const [node, count] of Object.entries(report.summary.retryCounts)) {
        lines.push(`- \`${node}\`: ${count}`);
      }
    }

    if (report.transitions.length > 0) {
      lines.push("");
      lines.push("## Node Transitions Timeline");
      for (const t of report.transitions) {
        lines.push(
          `- **${t.from}** → **${t.to}** (${t.reason}) at \`${t.timestamp}\``,
        );
      }
    }

    if (report.gateResults.length > 0) {
      lines.push("");
      lines.push("## Gate Checks");
      for (const g of report.gateResults) {
        const badge = g.status === "passed" ? "PASSED" : "FAILED";
        lines.push(
          `- \`[${badge}]\` **${g.phase.toUpperCase()}**: \`${g.gate}\``,
        );
        if (g.error) {
          lines.push(`  - Error: ${g.error}`);
        }
        if (g.output) {
          lines.push(`  - Output: ${g.output}`);
        }
      }
    }

    if (report.tasks.length > 0) {
      lines.push("");
      lines.push("## Tasks");
      for (const t of report.tasks) {
        lines.push(
          `- **${t.id}** [\`${t.status}\`]: "${t.goal}" (${t.contract})`,
        );
        lines.push(`  - Files: ${t.files.join(", ")}`);
      }
    }

    if (report.activities.length > 0) {
      lines.push("");
      lines.push("## Activities");
      for (const a of report.activities) {
        lines.push(
          `- **${a.id}** [\`${a.status}\`]: [${a.agent}] "${a.label}"`,
        );
      }
    }

    return lines.join("\n");
  }

  /**
   * Load report by runId or return latest
   */
  public async getReport(runId?: string): Promise<WorkflowRunReport | null> {
    const filename = runId ? `${runId}.json` : "latest.json";
    const reportPath = path.join(this.reportsDir, filename);
    try {
      const content = await fs.readFile(reportPath, "utf-8");
      return JSON.parse(content) as WorkflowRunReport;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /**
   * List available reports
   */
  public async listReports(): Promise<ReportSummaryItem[]> {
    try {
      const entries = await fs.readdir(this.reportsDir);
      const reports: ReportSummaryItem[] = [];

      for (const entry of entries) {
        if (entry.endsWith(".json") && entry !== "latest.json") {
          try {
            const content = await fs.readFile(
              path.join(this.reportsDir, entry),
              "utf-8",
            );
            const data = JSON.parse(content) as WorkflowRunReport;
            reports.push({
              runId: data.runId,
              workflow: data.workflow,
              status: data.status,
              startedAt: data.startedAt,
              endedAt: data.endedAt,
              durationMs: data.durationMs,
              initialNode: data.initialNode,
              finalNode: data.finalNode,
            });
          } catch {
            // ignore corrupted report
          }
        }
      }

      // Sort by endedAt descending
      return reports.sort((a, b) => b.endedAt.localeCompare(a.endedAt));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }
}
