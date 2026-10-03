import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type StateEvent, StateEventSchema } from "../schemas/state.js";
import { type ActivityRecord } from "../schemas/activity.js";
import { type TaskDefinition, TaskDefinitionSchema } from "../schemas/task.js";
import { type WorkflowRunReport } from "../report/report-manager.js";

export interface ArchiveManifest {
  runId: string;
  workflow: string;
  status: string;
  archivedAt: string;
  eventCount: number;
  taskCount: number;
  activityCount: number;
  filesArchived: string[];
}

export class ArchiveManager {
  private projectRoot: string;
  private archiveDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.archiveDir = path.join(projectRoot, ".crewmate", "archive");
  }

  public getArchiveDir(): string {
    return this.archiveDir;
  }

  /**
   * Archive a workflow run: packages its state events, completed tasks, activity provenance,
   * and run report into .crewmate/archive/<runId>/.
   */
  public async archiveRun(options: {
    runId: string;
    workflow?: string;
    status?: string;
    report?: WorkflowRunReport;
    pruneActiveState?: boolean;
  }): Promise<ArchiveManifest> {
    const { runId } = options;
    const runArchiveDir = path.join(this.archiveDir, runId);
    await fs.mkdir(runArchiveDir, { recursive: true });

    const filesArchived: string[] = [];

    // 1. Process State Events
    const stateFile = path.join(this.projectRoot, ".crewmate", "state.jsonl");
    let runEvents: StateEvent[] = [];
    let remainingEvents: StateEvent[] = [];

    try {
      const content = await fs.readFile(stateFile, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);

      // Identify which events belong to this runId
      let currentRunId = "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const ev = StateEventSchema.parse(parsed);

          if (ev.event === "INIT") {
            currentRunId = `run_${ev.timestamp.replace(/[-:T.Z]/g, "").slice(0, 14)}_init`;
          } else if (ev.event === "RUN_START") {
            currentRunId = ev.runId;
          } else if (ev.event === "RESET" && ev.runId) {
            currentRunId = ev.runId;
          }

          if (currentRunId === runId) {
            runEvents.push(ev);
          } else {
            remainingEvents.push(ev);
          }
        } catch {
          // ignore malformed lines
        }
      }

      if (runEvents.length === 0 && lines.length > 0) {
        for (const line of lines) {
          try {
            runEvents.push(StateEventSchema.parse(JSON.parse(line)));
          } catch {
            // ignore
          }
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    if (runEvents.length > 0) {
      const archiveStateLines =
        runEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await fs.writeFile(
        path.join(runArchiveDir, "state.jsonl"),
        archiveStateLines,
        "utf-8",
      );
      filesArchived.push("state.jsonl");

      // Prune active state.jsonl if requested
      if (options.pruneActiveState) {
        if (remainingEvents.length > 0) {
          const remainingLines =
            remainingEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
          await fs.writeFile(stateFile, remainingLines, "utf-8");
        } else {
          // When all events belonged to this run, leave empty state file
          await fs.writeFile(stateFile, "", "utf-8");
        }
      }
    }

    // 2. Archive Completed/Failed Tasks
    const tasksDir = path.join(this.projectRoot, ".crewmate", "tasks");
    const archiveTasksDir = path.join(runArchiveDir, "tasks");
    let taskCount = 0;

    try {
      const taskFiles = await fs.readdir(tasksDir);
      for (const f of taskFiles) {
        if (f.endsWith(".task.yaml") || f.endsWith(".task.yml")) {
          const taskPath = path.join(tasksDir, f);
          try {
            const raw = await fs.readFile(taskPath, "utf-8");
            const parsed = (await import("yaml")).parse(raw);
            const taskDef = TaskDefinitionSchema.parse(parsed);

            // Move completed or failed tasks to archive
            if (taskDef.status === "done" || taskDef.status === "failed") {
              await fs.mkdir(archiveTasksDir, { recursive: true });
              await fs.rename(taskPath, path.join(archiveTasksDir, f));
              filesArchived.push(`tasks/${f}`);
              taskCount++;
            }
          } catch {
            // ignore non-task files
          }
        }
      }
    } catch {
      // tasks directory may not exist
    }

    // Also archive relevant tasks.jsonl lines
    const tasksLogFile = path.join(
      this.projectRoot,
      ".crewmate",
      "tasks.jsonl",
    );
    try {
      const taskLogContent = await fs.readFile(tasksLogFile, "utf-8");
      if (taskLogContent.trim().length > 0) {
        await fs.writeFile(
          path.join(runArchiveDir, "tasks.jsonl"),
          taskLogContent,
          "utf-8",
        );
        filesArchived.push("tasks.jsonl");
      }
    } catch {
      // optional
    }

    // 3. Archive Activities
    const activityLogFile = path.join(
      this.projectRoot,
      ".crewmate",
      "activity.jsonl",
    );
    let activityCount = 0;
    try {
      const actContent = await fs.readFile(activityLogFile, "utf-8");
      const actLines = actContent
        .split("\n")
        .filter((l) => l.trim().length > 0);
      if (actLines.length > 0) {
        await fs.writeFile(
          path.join(runArchiveDir, "activity.jsonl"),
          actContent,
          "utf-8",
        );
        filesArchived.push("activity.jsonl");
        activityCount = actLines.length;
      }
    } catch {
      // optional
    }

    // 4. Archive Run Report
    let finalWorkflow = options.workflow || "default";
    let finalStatus = options.status || "completed";

    if (options.report) {
      finalWorkflow = options.report.workflow;
      finalStatus = options.report.status;
      await fs.writeFile(
        path.join(runArchiveDir, "report.json"),
        JSON.stringify(options.report, null, 2),
        "utf-8",
      );
      filesArchived.push("report.json");
    } else {
      // Try to read existing report from .crewmate/reports/<runId>.json
      const reportFile = path.join(
        this.projectRoot,
        ".crewmate",
        "reports",
        `${runId}.json`,
      );
      try {
        const repContent = await fs.readFile(reportFile, "utf-8");
        const parsedReport = JSON.parse(repContent);
        finalWorkflow = parsedReport.workflow || finalWorkflow;
        finalStatus = parsedReport.status || finalStatus;
        await fs.writeFile(
          path.join(runArchiveDir, "report.json"),
          repContent,
          "utf-8",
        );
        filesArchived.push("report.json");
      } catch {
        // no report file found
      }
    }

    // 5. Write Archive Manifest
    const manifest: ArchiveManifest = {
      runId,
      workflow: finalWorkflow,
      status: finalStatus,
      archivedAt: new Date().toISOString(),
      eventCount: runEvents.length,
      taskCount,
      activityCount,
      filesArchived,
    };

    await fs.writeFile(
      path.join(runArchiveDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    return manifest;
  }

  /**
   * List all archived runs ordered newest first
   */
  public async listArchives(): Promise<ArchiveManifest[]> {
    try {
      const entries = await fs.readdir(this.archiveDir);
      const manifests: ArchiveManifest[] = [];

      for (const entry of entries) {
        const manifestFile = path.join(this.archiveDir, entry, "manifest.json");
        try {
          const content = await fs.readFile(manifestFile, "utf-8");
          const manifest = JSON.parse(content) as ArchiveManifest;
          manifests.push(manifest);
        } catch {
          // ignore directories without manifest
        }
      }

      manifests.sort(
        (a, b) =>
          new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime(),
      );
      return manifests;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /**
   * Get details of a specific archived run
   */
  public async getArchive(runId: string): Promise<{
    manifest: ArchiveManifest;
    stateEvents: StateEvent[];
    report?: WorkflowRunReport;
  } | null> {
    const runArchiveDir = path.join(this.archiveDir, runId);
    const manifestFile = path.join(runArchiveDir, "manifest.json");

    try {
      const manifestContent = await fs.readFile(manifestFile, "utf-8");
      const manifest = JSON.parse(manifestContent) as ArchiveManifest;

      let stateEvents: StateEvent[] = [];
      try {
        const stateContent = await fs.readFile(
          path.join(runArchiveDir, "state.jsonl"),
          "utf-8",
        );
        stateEvents = stateContent
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .map((l) => StateEventSchema.parse(JSON.parse(l)));
      } catch {
        // optional
      }

      let report: WorkflowRunReport | undefined;
      try {
        const reportContent = await fs.readFile(
          path.join(runArchiveDir, "report.json"),
          "utf-8",
        );
        report = JSON.parse(reportContent) as WorkflowRunReport;
      } catch {
        // optional
      }

      return { manifest, stateEvents, report };
    } catch {
      return null;
    }
  }
}
