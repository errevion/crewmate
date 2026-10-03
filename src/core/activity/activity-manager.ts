import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import {
  type ActivityEvent,
  type ActivityProvenance,
  type ActivityRecord,
  type ActivityStatus,
  type ActivityTreeNode,
  ActivityEventSchema,
  ActivityStartEventSchema,
  ActivityEndEventSchema,
} from "../schemas/activity.js";

export class ActivityManager {
  private projectRoot: string;
  private activityFilePath: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.activityFilePath = path.join(projectRoot, ".crewmate", "activity.jsonl");
  }

  public getFilePath(): string {
    return this.activityFilePath;
  }

  public async exists(): Promise<boolean> {
    try {
      await fs.access(this.activityFilePath);
      return true;
    } catch {
      return false;
    }
  }

  public async readEvents(): Promise<ActivityEvent[]> {
    try {
      const content = await fs.readFile(this.activityFilePath, "utf-8");
      const lines = content.split("\n").filter((line: string) => line.trim().length > 0);
      const events: ActivityEvent[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        try {
          const parsed = JSON.parse(line);
          const validated = ActivityEventSchema.parse(parsed);
          events.push(validated);
        } catch (err) {
          throw new Error(
            `Malformed activity event at line ${i + 1} in ${this.activityFilePath}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      return events;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  public async appendEvent(event: ActivityEvent): Promise<void> {
    const validated = ActivityEventSchema.parse(event);
    const line = JSON.stringify(validated) + "\n";
    const dir = path.dirname(this.activityFilePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(this.activityFilePath, line, "utf-8");
  }

  public async start(options: {
    agent: string;
    label: string;
    node?: string;
    parent?: string;
    meta?: Record<string, unknown>;
    id?: string;
    at?: string;
  }): Promise<string> {
    const id = options.id || `act_${randomBytes(4).toString("hex")}`;
    const at = options.at || new Date().toISOString();

    const event = ActivityStartEventSchema.parse({
      event: "start",
      id,
      agent: options.agent,
      label: options.label,
      node: options.node,
      parent: options.parent,
      meta: options.meta,
      at,
    });

    await this.appendEvent(event);
    return id;
  }

  public async end(options: {
    id: string;
    status?: ActivityStatus;
    meta?: Record<string, unknown>;
    agent?: string;
    at?: string;
  }): Promise<ActivityRecord> {
    const activities = await this.getActivities();
    const existing = activities.find((a) => a.id === options.id);

    if (!existing) {
      throw new Error(`Cannot end activity '${options.id}': Activity not found in ${this.activityFilePath}`);
    }

    if (!existing.isUnclosed) {
      throw new Error(`Activity '${options.id}' has already been ended with status '${existing.status}'`);
    }

    const at = options.at || new Date().toISOString();
    const status: ActivityStatus = options.status || "completed";
    const agent = options.agent || existing.agent;

    const event = ActivityEndEventSchema.parse({
      event: "end",
      id: options.id,
      agent,
      status,
      meta: options.meta,
      at,
    });

    await this.appendEvent(event);

    return {
      ...existing,
      status,
      endAt: at,
      endMeta: options.meta,
      isUnclosed: false,
    };
  }

  public async getActivities(filter?: {
    activeOnly?: boolean;
    node?: string;
    agent?: string;
  }): Promise<ActivityRecord[]> {
    const events = await this.readEvents();
    const activityMap = new Map<string, ActivityRecord>();
    const order: string[] = [];

    for (const event of events) {
      if (event.event === "start") {
        const record: ActivityRecord = {
          id: event.id,
          agent: event.agent,
          label: event.label,
          node: event.node,
          parent: event.parent,
          startAt: event.at,
          status: "active",
          startMeta: event.meta,
          isUnclosed: true,
        };
        activityMap.set(event.id, record);
        order.push(event.id);
      } else if (event.event === "end") {
        const record = activityMap.get(event.id);
        if (record) {
          record.status = event.status;
          record.endAt = event.at;
          record.endMeta = event.meta;
          record.isUnclosed = false;
        } else {
          // End event with no start event recorded
          const fallbackRecord: ActivityRecord = {
            id: event.id,
            agent: event.agent || "unknown",
            label: "unlabeled activity",
            startAt: event.at,
            endAt: event.at,
            status: event.status,
            endMeta: event.meta,
            isUnclosed: false,
          };
          activityMap.set(event.id, fallbackRecord);
          order.push(event.id);
        }
      }
    }

    let result = order.map((id) => activityMap.get(id)!);

    if (filter?.activeOnly) {
      result = result.filter((a) => a.isUnclosed);
    }
    if (filter?.node) {
      result = result.filter((a) => a.node === filter.node);
    }
    if (filter?.agent) {
      result = result.filter((a) => a.agent === filter.agent);
    }

    return result;
  }

  public async getUnclosedActivities(): Promise<ActivityRecord[]> {
    return this.getActivities({ activeOnly: true });
  }

  public async getActivityTree(): Promise<ActivityTreeNode[]> {
    const activities = await this.getActivities();
    const nodeMap = new Map<string, ActivityTreeNode>();

    for (const act of activities) {
      nodeMap.set(act.id, {
        activity: act,
        children: [],
      });
    }

    const roots: ActivityTreeNode[] = [];

    for (const act of activities) {
      const node = nodeMap.get(act.id)!;
      if (act.parent && nodeMap.has(act.parent)) {
        nodeMap.get(act.parent)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  public renderTree(roots: ActivityTreeNode[], prefix = ""): string {
    const lines: string[] = [];

    for (let i = 0; i < roots.length; i++) {
      const node = roots[i];
      const isLast = i === roots.length - 1;
      const connector = prefix ? (isLast ? "└── " : "├── ") : "";
      const act = node.activity;

      const statusTag = act.isUnclosed
        ? "[UNCLOSED] (active)"
        : `(${act.status})`;

      const nodeTag = act.node ? ` [node: ${act.node}]` : "";
      const metaFiles = this.extractFiles(act);
      const filesTag = metaFiles.length > 0 ? ` [files: ${metaFiles.join(", ")}]` : "";

      lines.push(
        `${prefix}${connector}${act.id}: [${act.agent}] "${act.label}" ${statusTag}${nodeTag}${filesTag}`
      );

      if (node.children.length > 0) {
        const nextPrefix = prefix ? prefix + (isLast ? "    " : "│   ") : "  ";
        lines.push(this.renderTree(node.children, nextPrefix));
      }
    }

    return lines.join("\n");
  }

  public extractFiles(act: ActivityRecord): string[] {
    const files = new Set<string>();

    const checkObj = (obj?: Record<string, unknown>) => {
      if (!obj) return;
      if (Array.isArray(obj.files)) {
        for (const f of obj.files) {
          if (typeof f === "string") files.add(this.normalizePath(f));
        }
      }
      if (Array.isArray(obj.files_changed)) {
        for (const f of obj.files_changed) {
          if (typeof f === "string") files.add(this.normalizePath(f));
        }
      }
      if (typeof obj.file === "string") {
        files.add(this.normalizePath(obj.file));
      }
    };

    checkObj(act.startMeta);
    checkObj(act.endMeta);

    return Array.from(files);
  }

  public normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  }

  public async findProvenance(targetFile: string): Promise<ActivityProvenance | undefined> {
    const normalizedTarget = this.normalizePath(targetFile);
    const activities = await this.getActivities();

    let originating: ActivityRecord | undefined = undefined;
    const subsequent: ActivityRecord[] = [];

    for (const act of activities) {
      const actFiles = this.extractFiles(act);
      const touches = actFiles.some(
        (f) => f === normalizedTarget || normalizedTarget.endsWith("/" + f) || f.endsWith("/" + normalizedTarget)
      );

      if (touches) {
        if (!originating) {
          originating = act;
        } else {
          subsequent.push(act);
        }
      }
    }

    if (!originating) {
      return undefined;
    }

    return {
      originatingActivityId: originating.id,
      originatingAgent: originating.agent,
      originatingLabel: originating.label,
      originatingAt: originating.startAt,
      subsequentReferenceCount: subsequent.length,
      subsequentActivityIds: subsequent.map((a) => a.id),
    };
  }

  public async getHarnessLiveness(): Promise<{
    alive: boolean;
    status: "running" | "idle" | "offline";
    harness?: string;
    protocol?: string;
    session?: {
      id?: string;
      title?: string;
    };
    pid?: number;
    lastHeartbeat?: string;
    lastActivity?: string;
    reason?: string;
  }> {
    const heartbeatPath = path.join(this.projectRoot, ".crewmate", "heartbeat.json");
    try {
      const content = await fs.readFile(heartbeatPath, "utf-8");
      const data = JSON.parse(content);
      if (data.status === "offline") {
        return {
          alive: false,
          status: "offline",
          harness: data.harness,
          protocol: data.protocol,
          session: data.session,
          pid: data.pid,
          lastHeartbeat: data.lastHeartbeat,
          lastActivity: data.lastActivity,
          reason: "Harness marked offline",
        };
      }
      if (data.lastHeartbeat) {
        const elapsedMs = Date.now() - new Date(data.lastHeartbeat).getTime();
        // Heartbeat interval is ~4s. If more than 15s have elapsed, harness is offline
        if (elapsedMs > 15000) {
          return {
            alive: false,
            status: "offline",
            harness: data.harness,
            protocol: data.protocol,
            session: data.session,
            pid: data.pid,
            lastHeartbeat: data.lastHeartbeat,
            lastActivity: data.lastActivity,
            reason: `Heartbeat stale (${Math.round(elapsedMs / 1000)}s ago)`,
          };
        }
      }
      // Check PID if on same machine
      if (typeof data.pid === "number") {
        try {
          process.kill(data.pid, 0);
        } catch (err: any) {
          if (err && err.code === "ESRCH") {
            return {
              alive: false,
              status: "offline",
              harness: data.harness,
              protocol: data.protocol,
              session: data.session,
              pid: data.pid,
              lastHeartbeat: data.lastHeartbeat,
              lastActivity: data.lastActivity,
              reason: `Process PID ${data.pid} no longer running`,
            };
          }
        }
      }
      // Process is running and heartbeat is fresh: determine running vs idle
      if (data.status === "running" || data.status === "online" || data.status === "alive") {
        return {
          alive: true,
          status: "running",
          harness: data.harness,
          protocol: data.protocol,
          session: data.session,
          pid: data.pid,
          lastHeartbeat: data.lastHeartbeat,
          lastActivity: data.lastActivity,
        };
      }
      if (data.status === "idle") {
        return {
          alive: true,
          status: "idle",
          harness: data.harness,
          protocol: data.protocol,
          session: data.session,
          pid: data.pid,
          lastHeartbeat: data.lastHeartbeat,
          lastActivity: data.lastActivity,
        };
      }
      return {
        alive: false,
        status: "offline",
        harness: data.harness,
        protocol: data.protocol,
        session: data.session,
        pid: data.pid,
        lastHeartbeat: data.lastHeartbeat,
        lastActivity: data.lastActivity,
        reason: `Unknown status '${data.status}'`,
      };
    } catch {
      return {
        alive: false,
        status: "offline",
        reason: "No heartbeat file found",
      };
    }
  }

  public async reconcileStaleActivities(reason: string = "harness offline"): Promise<string[]> {
    const unclosed = await this.getUnclosedActivities();
    const closedIds: string[] = [];
    const at = new Date().toISOString();

    for (const act of unclosed) {
      const event = ActivityEndEventSchema.parse({
        event: "end",
        id: act.id,
        agent: act.agent,
        status: "interrupted",
        meta: { ...(act.startMeta || {}), reason, autoReconciled: true },
        at,
      });
      await this.appendEvent(event);
      closedIds.push(act.id);
    }

    return closedIds;
  }
}
