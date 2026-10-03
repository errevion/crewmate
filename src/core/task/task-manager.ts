import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import yaml from "yaml";
import {
  type TaskDefinition,
  type TaskDependency,
  type TaskEvent,
  type TaskStatus,
  TaskDefinitionSchema,
  TaskEventSchema,
  TaskCreateEventSchema,
  TaskStatusChangeEventSchema,
  TaskLockGrantEventSchema,
  TaskLockReleaseEventSchema,
  TaskScopeAmendmentEventSchema,
  TaskScopeConflictEventSchema,
} from "../schemas/task.js";
import { ModuleContractSchema, type ModuleContract } from "../schemas/contracts.js";
import { scanArchitecture } from "../scanner/arch.js";

const execAsync = promisify(exec);

export interface TaskCreateOptions {
  id?: string;
  goal: string;
  contract: string;
  files: string[];
  depends_on?: string[];
}

export interface TaskStartResult {
  success: boolean;
  status: TaskStatus;
  lockedFiles?: string[];
  reason?: string;
}

export interface TaskAmendResult {
  success: boolean;
  file: string;
  conflict?: boolean;
  conflictingTaskId?: string;
  message: string;
}

export interface TaskCompleteResult {
  success: boolean;
  status: TaskStatus;
  touchedFiles?: string[];
  error?: string;
  outOfScopeFiles?: string[];
}

export interface LockEntry {
  file: string;
  taskId: string;
}

export interface LocksTableResult {
  locks: LockEntry[];
  activeTasks: string[];
}

export interface ConflictSummary {
  totalConflicts: number;
  byModule: Record<string, number>;
  byTask: Record<string, number>;
  conflicts: Array<{
    taskId: string;
    file: string;
    conflictingTaskId: string;
    at: string;
    contract?: string;
  }>;
}

export class TaskManager {
  private projectRoot: string;
  private tasksDir: string;
  private taskLogPath: string;
  private lockFilePath: string;
  private memoryLockPromise: Promise<void> = Promise.resolve();

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.tasksDir = path.join(projectRoot, ".crewmate", "tasks");
    this.taskLogPath = path.join(projectRoot, ".crewmate", "tasks.jsonl");
    this.lockFilePath = path.join(projectRoot, ".crewmate", "tasks.lock");
  }

  public normalizePath(filePath: string): string {
    return path.normalize(filePath).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  }

  public pathsEqual(a: string, b: string): boolean {
    const normA = this.normalizePath(a);
    const normB = this.normalizePath(b);
    if (process.platform === "win32") {
      return normA.toLowerCase() === normB.toLowerCase();
    }
    return normA === normB;
  }

  public isPathInList(target: string, list: string[]): boolean {
    return list.some((item) => this.pathsEqual(target, item));
  }

  /**
   * Atomic mutual exclusion wrapper using in-process chain and cross-process file lock
   */
  public async withAtomicLock<T>(fn: () => Promise<T>): Promise<T> {
    // Chain with memory lock first to serialize within same process
    let releaseMemoryLock: () => void = () => {};
    const memoryLockWait = new Promise<void>((resolve) => {
      releaseMemoryLock = resolve;
    });

    const previousLock = this.memoryLockPromise;
    this.memoryLockPromise = this.memoryLockPromise.then(() => memoryLockWait);

    await previousLock;

    // Cross-process file lock
    await fs.mkdir(path.dirname(this.lockFilePath), { recursive: true });
    let fileHandle: fs.FileHandle | null = null;
    const maxRetries = 100;
    const retryDelayMs = 30;

    for (let i = 0; i < maxRetries; i++) {
      try {
        fileHandle = await fs.open(this.lockFilePath, "wx");
        break;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          // Check if lock file is stale (> 10s)
          try {
            const stat = await fs.stat(this.lockFilePath);
            if (Date.now() - stat.mtimeMs > 10000) {
              await fs.unlink(this.lockFilePath).catch(() => {});
            }
          } catch {
            // Stat might fail if unlinked between checks
          }
          await new Promise((r) => setTimeout(r, retryDelayMs));
        } else {
          throw err;
        }
      }
    }

    if (!fileHandle) {
      releaseMemoryLock();
      throw new Error(`Timeout acquiring task lock on ${this.lockFilePath}`);
    }

    try {
      return await fn();
    } finally {
      try {
        await fileHandle.close();
      } catch {
        // ignore
      }
      try {
        await fs.unlink(this.lockFilePath);
      } catch {
        // ignore
      }
      releaseMemoryLock();
    }
  }

  /**
   * Append event to .crewmate/tasks.jsonl
   */
  public async appendEvent(event: TaskEvent): Promise<void> {
    const validated = TaskEventSchema.parse(event);
    const line = JSON.stringify(validated) + "\n";
    await fs.mkdir(path.dirname(this.taskLogPath), { recursive: true });
    await fs.appendFile(this.taskLogPath, line, "utf-8");
  }

  /**
   * Read all events from .crewmate/tasks.jsonl
   */
  public async readEvents(): Promise<TaskEvent[]> {
    try {
      const content = await fs.readFile(this.taskLogPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      const events: TaskEvent[] = [];
      for (const line of lines) {
        const parsed = JSON.parse(line);
        events.push(TaskEventSchema.parse(parsed));
      }
      return events;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /**
   * Resolve and load contract definition
   */
  public async resolveContract(contractRef: string): Promise<{ resolvedPath: string; contract: ModuleContract }> {
    const candidates = [
      path.join(this.projectRoot, ".crewmate", "contracts", contractRef),
      path.join(this.projectRoot, ".crewmate", "contracts", "modules", contractRef),
      path.join(this.projectRoot, ".crewmate", "contracts", "modules", `${contractRef}.contract.yaml`),
      path.join(this.projectRoot, "contracts", contractRef),
      path.join(this.projectRoot, "contracts", "modules", contractRef),
      path.join(this.projectRoot, "contracts", "modules", `${contractRef}.contract.yaml`),
      path.join(this.projectRoot, contractRef),
    ];

    for (const candidate of candidates) {
      try {
        const content = await fs.readFile(candidate, "utf-8");
        const parsed = yaml.parse(content);
        const contract = ModuleContractSchema.parse(parsed);
        return { resolvedPath: candidate, contract };
      } catch {
        continue;
      }
    }

    throw new Error(`Contract '${contractRef}' not found. Each task must reference a valid module contract.`);
  }

  /**
   * Load a task definition from disk
   */
  public async getTask(taskId: string): Promise<TaskDefinition | null> {
    const taskPath = path.join(this.tasksDir, `${taskId}.task.yaml`);
    try {
      const content = await fs.readFile(taskPath, "utf-8");
      const parsed = yaml.parse(content);
      return TaskDefinitionSchema.parse(parsed);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save task definition to disk
   */
  public async saveTask(task: TaskDefinition): Promise<void> {
    await fs.mkdir(this.tasksDir, { recursive: true });
    const taskPath = path.join(this.tasksDir, `${task.id}.task.yaml`);
    const yamlStr = yaml.stringify(task);
    await fs.writeFile(taskPath, yamlStr, "utf-8");
  }

  /**
   * List all tasks on disk
   */
  public async listTasks(filter?: { status?: TaskStatus }): Promise<TaskDefinition[]> {
    try {
      const entries = await fs.readdir(this.tasksDir);
      const tasks: TaskDefinition[] = [];
      for (const entry of entries) {
        if (entry.endsWith(".task.yaml")) {
          const content = await fs.readFile(path.join(this.tasksDir, entry), "utf-8");
          const task = TaskDefinitionSchema.parse(yaml.parse(content));
          if (!filter?.status || task.status === filter.status) {
            tasks.push(task);
          }
        }
      }
      // Sort tasks by id
      return tasks.sort((a, b) => a.id.localeCompare(b.id));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /**
   * Create and register a task with 3-source dependency determination
   */
  public async createTask(options: TaskCreateOptions): Promise<TaskDefinition> {
    return this.withAtomicLock(async () => {
      // 1. Verify contract exists
      const { contract } = await this.resolveContract(options.contract);

      // 2. Normalize declared files
      const normalizedFiles = options.files.map((f) => this.normalizePath(f));
      if (normalizedFiles.length === 0) {
        throw new Error("Task must declare at least one file in its scope.");
      }

      // 3. Generate or validate ID
      const allTasks = await this.listTasks();
      let taskId = options.id;
      if (!taskId) {
        const nextNum = allTasks.length + 1;
        taskId = `task_${String(nextNum).padStart(3, "0")}`;
      }

      if (allTasks.some((t) => t.id === taskId)) {
        throw new Error(`Task with id '${taskId}' already exists.`);
      }

      const explicitDependsOn = new Set(options.depends_on || []);
      const dependencies: TaskDependency[] = [];
      const finalDependsOn = new Set(explicitDependsOn);

      // Check against existing non-done, non-failed tasks
      const activeOrPendingTasks = allTasks.filter((t) => t.status !== "done" && t.status !== "failed");

      // 4. Source 1: Declared file overlap rule
      // If task B's files intersects task A's, they cannot be scheduled in parallel.
      // Refuse to register two overlapping-file tasks as parallel siblings without an edge!
      for (const existingTask of activeOrPendingTasks) {
        const overlappingFiles: string[] = [];
        for (const file of normalizedFiles) {
          if (this.isPathInList(file, existingTask.files)) {
            overlappingFiles.push(file);
          }
        }

        if (overlappingFiles.length > 0) {
          const hasEdge = explicitDependsOn.has(existingTask.id);
          if (!hasEdge) {
            throw new Error(
              `Cannot register task '${taskId}': Overlapping file(s) [${overlappingFiles.join(
                ", "
              )}] with existing task '${existingTask.id}'. Overlapping tasks cannot be parallel siblings; specify --depends-on ${existingTask.id} or merge tasks.`
            );
          } else {
            dependencies.push({ taskId: existingTask.id, reason: "file-overlap" });
          }
        }
      }

      // 5. Source 2: Contract-visible consumer relationship
      // If B's module is a declared consumer of a module A is changing,
      // B depends on A ONLY if A's change touches the declared public surface of its contract.
      for (const existingTask of activeOrPendingTasks) {
        try {
          const { contract: existingContract } = await this.resolveContract(existingTask.contract);
          const isConsumer =
            existingContract.declared_consumers &&
            existingContract.declared_consumers.includes(contract.module);

          if (isConsumer) {
            // Check if existingTask declared files touch existingContract.public_api
            const touchesPublicSurface = existingContract.public_api.some((api) => {
              const apiFile = this.normalizePath(api.file);
              return existingTask.files.some((f) => this.pathsEqual(f, apiFile));
            });

            if (touchesPublicSurface) {
              finalDependsOn.add(existingTask.id);
              if (!dependencies.some((d) => d.taskId === existingTask.id)) {
                dependencies.push({ taskId: existingTask.id, reason: "contract-consumer" });
              }
            }
          }
        } catch {
          // If existing contract cannot be loaded, skip consumer inference
        }
      }

      // 6. Source 3: Explicit lead-declared edges
      for (const depId of explicitDependsOn) {
        if (!dependencies.some((d) => d.taskId === depId)) {
          dependencies.push({ taskId: depId, reason: "manual" });
        }
      }

      const now = new Date().toISOString();
      const taskDef: TaskDefinition = {
        id: taskId,
        goal: options.goal,
        contract: options.contract,
        files: normalizedFiles,
        depends_on: Array.from(finalDependsOn),
        dependencies,
        status: "pending",
        amendments: [],
        created_at: now,
      };

      await this.saveTask(taskDef);

      await this.appendEvent(
        TaskCreateEventSchema.parse({
          event: "create",
          id: taskId,
          goal: taskDef.goal,
          contract: taskDef.contract,
          files: taskDef.files,
          depends_on: taskDef.depends_on,
          dependencies: taskDef.dependencies,
          at: now,
        })
      );

      return taskDef;
    });
  }

  /**
   * Schedule / Start a task (Atomic Lock-Grant)
   */
  public async startTask(taskId: string): Promise<TaskStartResult> {
    return this.withAtomicLock(async () => {
      const task = await this.getTask(taskId);
      if (!task) {
        throw new Error(`Task '${taskId}' not found.`);
      }

      if (task.status === "active") {
        return { success: true, status: "active", lockedFiles: task.files };
      }

      if (task.status === "done" || task.status === "failed") {
        throw new Error(`Cannot start task '${taskId}': Task has already finished with status '${task.status}'.`);
      }

      const now = new Date().toISOString();

      // 1. Check eligibility: all depends_on tasks must be done
      for (const depId of task.depends_on) {
        const dep = await this.getTask(depId);
        if (!dep || dep.status !== "done") {
          const currentDepStatus = dep ? dep.status : "missing";
          if (task.status !== "blocked") {
            const prev = task.status;
            task.status = "blocked";
            await this.saveTask(task);
            await this.appendEvent(
              TaskStatusChangeEventSchema.parse({
                event: "status_change",
                id: taskId,
                from: prev,
                to: "blocked",
                reason: `Dependency '${depId}' is not done (status: ${currentDepStatus})`,
                at: now,
              })
            );
          }
          return {
            success: false,
            status: "blocked",
            reason: `Dependency task '${depId}' is not done (current status: ${currentDepStatus}).`,
          };
        }
      }

      // 2. Check current locked files across all currently ACTIVE tasks
      const allTasks = await this.listTasks();
      const otherActiveTasks = allTasks.filter((t) => t.id !== taskId && t.status === "active");

      for (const file of task.files) {
        for (const activeTask of otherActiveTasks) {
          if (this.isPathInList(file, activeTask.files)) {
            // Conflict! Set to blocked
            if (task.status !== "blocked") {
              const prev = task.status;
              task.status = "blocked";
              await this.saveTask(task);
              await this.appendEvent(
                TaskStatusChangeEventSchema.parse({
                  event: "status_change",
                  id: taskId,
                  from: prev,
                  to: "blocked",
                  reason: `File '${file}' is locked by active task '${activeTask.id}'`,
                  at: now,
                })
              );
            }
            return {
              success: false,
              status: "blocked",
              reason: `File '${file}' is locked by active task '${activeTask.id}'.`,
            };
          }
        }
      }

      // 3. Grant lock for all files and set to active
      // Capture base git commit for completion gate check
      let baseCommit: string | undefined = undefined;
      try {
        const { stdout } = await execAsync("git rev-parse HEAD", { cwd: this.projectRoot });
        baseCommit = stdout.trim();
      } catch {
        // Not a git repo or no commits
      }

      const prevStatus = task.status;
      task.status = "active";
      task.started_at = now;
      task.base_commit = baseCommit;
      await this.saveTask(task);

      await this.appendEvent(
        TaskLockGrantEventSchema.parse({
          event: "lock_grant",
          id: taskId,
          files: task.files,
          at: now,
        })
      );

      await this.appendEvent(
        TaskStatusChangeEventSchema.parse({
          event: "status_change",
          id: taskId,
          from: prevStatus,
          to: "active",
          at: now,
        })
      );

      return {
        success: true,
        status: "active",
        lockedFiles: task.files,
      };
    });
  }

  /**
   * Amend scope for an active task
   */
  public async amendScope(taskId: string, filePath: string, reason?: string): Promise<TaskAmendResult> {
    return this.withAtomicLock(async () => {
      const task = await this.getTask(taskId);
      if (!task) {
        throw new Error(`Task '${taskId}' not found.`);
      }

      if (task.status !== "active") {
        throw new Error(
          `Cannot amend scope for task '${taskId}': Task is not active (current status: ${task.status}).`
        );
      }

      const normalized = this.normalizePath(filePath);
      if (this.isPathInList(normalized, task.files)) {
        return {
          success: true,
          file: normalized,
          message: `File '${normalized}' is already in task scope.`,
        };
      }

      const now = new Date().toISOString();

      // Check if file is currently locked by another active task
      const allTasks = await this.listTasks();
      const otherActiveTasks = allTasks.filter((t) => t.id !== taskId && t.status === "active");

      const conflictingTask = otherActiveTasks.find((t) => this.isPathInList(normalized, t.files));

      if (conflictingTask) {
        // HARD BLOCK, NO AUTO-RESOLUTION
        task.amendments.push({
          type: "scope_conflict",
          file: normalized,
          conflictingTaskId: conflictingTask.id,
          reason,
          at: now,
        });
        await this.saveTask(task);

        await this.appendEvent(
          TaskScopeConflictEventSchema.parse({
            event: "scope_conflict",
            id: taskId,
            file: normalized,
            conflictingTaskId: conflictingTask.id,
            reason,
            at: now,
          })
        );

        return {
          success: false,
          conflict: true,
          file: normalized,
          conflictingTaskId: conflictingTask.id,
          message: `Scope conflict: File '${normalized}' is currently locked by active task '${conflictingTask.id}'. Escalated to lead agent.`,
        };
      }

      // File is unclaimed: grant lock and append scope_amendment
      task.files.push(normalized);
      task.amendments.push({
        type: "scope_amendment",
        file: normalized,
        reason,
        at: now,
      });
      await this.saveTask(task);

      await this.appendEvent(
        TaskScopeAmendmentEventSchema.parse({
          event: "scope_amendment",
          id: taskId,
          file: normalized,
          reason,
          at: now,
        })
      );

      await this.appendEvent(
        TaskLockGrantEventSchema.parse({
          event: "lock_grant",
          id: taskId,
          files: [normalized],
          at: now,
        })
      );

      return {
        success: true,
        file: normalized,
        message: `Scope amended: File '${normalized}' added to task '${taskId}' scope and locked.`,
      };
    });
  }

  /**
   * Complete a task: runs scope-diff gate + scanners, releases locks, marks done or failed
   */
  public async completeTask(taskId: string): Promise<TaskCompleteResult> {
    return this.withAtomicLock(async () => {
      const task = await this.getTask(taskId);
      if (!task) {
        throw new Error(`Task '${taskId}' not found.`);
      }

      if (task.status !== "active") {
        throw new Error(
          `Cannot complete task '${taskId}': Task is not active (current status: ${task.status}).`
        );
      }

      const now = new Date().toISOString();

      // 1. Task completion gate: Scope-diff check against actual git diff
      const touchedFiles = await this.getActuallyTouchedFiles(task.base_commit);

      // Filter out internal metadata/transient paths:
      const relevantTouched = touchedFiles.filter((f) => {
        const norm = this.normalizePath(f);
        return (
          !norm.startsWith(".crewmate/") &&
          !norm.startsWith(".git/") &&
          !norm.startsWith(".opencode/") &&
          !norm.startsWith("dist/") &&
          !norm.startsWith("node_modules/")
        );
      });

      const outOfScopeFiles = relevantTouched.filter((f) => !this.isPathInList(f, task.files));

      if (outOfScopeFiles.length > 0) {
        // Hard failure: touched files outside scope
        task.status = "failed";
        task.completed_at = now;
        await this.saveTask(task);

        await this.appendEvent(
          TaskLockReleaseEventSchema.parse({
            event: "lock_release",
            id: taskId,
            files: task.files,
            at: now,
          })
        );

        await this.appendEvent(
          TaskStatusChangeEventSchema.parse({
            event: "status_change",
            id: taskId,
            from: "active",
            to: "failed",
            reason: `Scope violation: modified files [${outOfScopeFiles.join(", ")}] outside declared scope`,
            at: now,
          })
        );

        return {
          success: false,
          status: "failed",
          touchedFiles: relevantTouched,
          outOfScopeFiles,
          error: `Task '${taskId}' failed scope completion gate: touched file(s) [${outOfScopeFiles.join(
            ", "
          )}] outside declared+amended scope.`,
        };
      }

      // 2. Run existing contract and architecture gates
      try {
        const archResult = await scanArchitecture(this.projectRoot);
        if (!archResult.valid && archResult.violations.length > 0) {
          task.status = "failed";
          task.completed_at = now;
          await this.saveTask(task);

          await this.appendEvent(
            TaskLockReleaseEventSchema.parse({
              event: "lock_release",
              id: taskId,
              files: task.files,
              at: now,
            })
          );

          await this.appendEvent(
            TaskStatusChangeEventSchema.parse({
              event: "status_change",
              id: taskId,
              from: "active",
              to: "failed",
              reason: `Architecture violation: ${archResult.violations[0]?.message}`,
              at: now,
            })
          );

          return {
            success: false,
            status: "failed",
            touchedFiles: relevantTouched,
            error: `Task '${taskId}' failed architecture gate: ${archResult.violations
              .map((v) => v.message)
              .join("; ")}`,
          };
        }
      } catch (err) {
        // If architecture files don't exist or scanner errors on non-code projects, ignore
        if (err instanceof Error && err.message.includes("violates architecture rules")) {
          task.status = "failed";
          task.completed_at = now;
          await this.saveTask(task);

          await this.appendEvent(
            TaskLockReleaseEventSchema.parse({
              event: "lock_release",
              id: taskId,
              files: task.files,
              at: now,
            })
          );

          await this.appendEvent(
            TaskStatusChangeEventSchema.parse({
              event: "status_change",
              id: taskId,
              from: "active",
              to: "failed",
              reason: err.message,
              at: now,
            })
          );

          return {
            success: false,
            status: "failed",
            touchedFiles: relevantTouched,
            error: err.message,
          };
        }
      }

      // 3. Mark task done and release locks
      task.status = "done";
      task.completed_at = now;
      await this.saveTask(task);

      await this.appendEvent(
        TaskLockReleaseEventSchema.parse({
          event: "lock_release",
          id: taskId,
          files: task.files,
          at: now,
        })
      );

      await this.appendEvent(
        TaskStatusChangeEventSchema.parse({
          event: "status_change",
          id: taskId,
          from: "active",
          to: "done",
          at: now,
        })
      );

      return {
        success: true,
        status: "done",
        touchedFiles: relevantTouched,
      };
    });
  }

  /**
   * Get current lock table
   */
  public async getLocks(): Promise<LocksTableResult> {
    const allTasks = await this.listTasks();
    const activeTasks = allTasks.filter((t) => t.status === "active");

    const locks: LockEntry[] = [];
    for (const task of activeTasks) {
      for (const file of task.files) {
        locks.push({ file, taskId: task.id });
      }
    }

    return {
      locks,
      activeTasks: activeTasks.map((t) => t.id),
    };
  }

  /**
   * Get conflict summary per module and task
   */
  public async getConflictSummary(): Promise<ConflictSummary> {
    const events = await this.readEvents();
    const conflictEvents = events.filter(
      (e): e is TaskEvent & { event: "scope_conflict"; file: string; conflictingTaskId: string } =>
        e.event === "scope_conflict"
    );

    const byModule: Record<string, number> = {};
    const byTask: Record<string, number> = {};
    const conflicts: ConflictSummary["conflicts"] = [];

    const allTasks = await this.listTasks();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));

    for (const ev of conflictEvents) {
      byTask[ev.id] = (byTask[ev.id] || 0) + 1;
      const task = taskMap.get(ev.id);
      const mod = task?.contract || "unknown";
      byModule[mod] = (byModule[mod] || 0) + 1;

      conflicts.push({
        taskId: ev.id,
        file: ev.file,
        conflictingTaskId: ev.conflictingTaskId,
        at: ev.at,
        contract: task?.contract,
      });
    }

    return {
      totalConflicts: conflictEvents.length,
      byModule,
      byTask,
      conflicts,
    };
  }

  /**
   * Find all files actually touched since base commit or in working directory
   */
  public async getActuallyTouchedFiles(baseCommit?: string): Promise<string[]> {
    const touched = new Set<string>();

    // 1. Files in working tree (staged, modified, untracked)
    try {
      const { stdout } = await execAsync("git status --porcelain -uall", { cwd: this.projectRoot });
      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        // format is "XY filename" or "XY orig -> dest"
        let filePathPart = line.slice(3).trim();
        if (filePathPart.includes(" -> ")) {
          const parts = filePathPart.split(" -> ");
          filePathPart = parts[1].trim();
        }
        filePathPart = filePathPart.replace(/^"|"$/g, "");
        touched.add(this.normalizePath(filePathPart));
      }
    } catch {
      // not a git repo
    }

    // 2. Committed changes since base commit if provided
    if (baseCommit) {
      try {
        const { stdout } = await execAsync(`git diff --name-only ${baseCommit}`, { cwd: this.projectRoot });
        const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const trimmed = line.trim().replace(/^"|"$/g, "");
          touched.add(this.normalizePath(trimmed));
        }
      } catch {
        // commit might not be reachable or no git
      }
    }

    return Array.from(touched);
  }
}
