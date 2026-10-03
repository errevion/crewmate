import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as yaml from "yaml";

import {
  type Architecture,
  ArchitectureSchema,
  type Capabilities,
  CapabilitiesSchema,
  type IndexManifest,
  IndexManifestSchema,
  type ModuleContract,
  ModuleContractSchema,
  type Structure,
  StructureSchema,
} from "../schemas/contracts.js";
import {
  type Graph,
  GraphSchema,
  type HardGuardrail,
  type NodeDef,
  NodeDefSchema,
} from "../schemas/workflow.js";
import {
  type EngineState,
  type GateResult,
  type StateEvent,
} from "../schemas/state.js";
import { type ActivityRecord } from "../schemas/activity.js";
import { StateManager } from "../state/state-manager.js";
import { ActivityManager } from "../activity/activity-manager.js";
import {
  TaskManager,
  type TaskCreateOptions,
  type TaskStartResult,
  type TaskAmendResult,
  type TaskCompleteResult,
  type LocksTableResult,
  type ConflictSummary,
} from "../task/task-manager.js";
import { type TaskDefinition, type TaskStatus } from "../schemas/task.js";
import {
  ReportManager,
  type WorkflowRunReport,
  type ReportSummaryItem,
} from "../report/report-manager.js";
import {
  ArchiveManager,
  type ArchiveManifest,
} from "../archive/archive-manager.js";
import {
  DEFAULT_ARCHITECTURE_YAML,
  DEFAULT_CAPABILITIES_YAML,
  DEFAULT_EXAMPLE_CONTRACT_YAML,
  DEFAULT_EXAMPLE_INDEX_YAML,
  DEFAULT_EXAMPLE_ARCHITECTURE_YAML,
  DEFAULT_EXAMPLE_CAPABILITIES_YAML,
  DEFAULT_SCOUT_NODE_YAML,
  DEFAULT_CLARIFY_NODE_YAML,
  DEFAULT_PLAN_NODE_YAML,
  DEFAULT_EXECUTE_NODE_YAML,
  DEFAULT_CONTRACT_NODE_YAML,
  DEFAULT_VERIFY_NODE_YAML,
  DEFAULT_GRAPH_YAML,
  DEFAULT_INDEX_YAML,
  DEFAULT_STRUCTURE_YAML,
  DEFAULT_SCHEMA_MD,
  DEFAULT_MATTE_AGENT_MD,
  DEFAULT_SCOUT_AGENT_MD,
  DEFAULT_PLANNER_AGENT_MD,
  DEFAULT_BUILDER_AGENT_MD,
  DEFAULT_CONTRACTOR_AGENT_MD,
  DEFAULT_VERIFIER_AGENT_MD,
  SYNC_GRAPH_YAML,
  SYNC_SCOUT_NODE_YAML,
  SYNC_CONTRACT_NODE_YAML,
  generateOpenCodePluginTs,
} from "./scaffold.js";
import { resolveContractPath as resolveContractPathFs } from "../utils/fs.js";

const execAsync = promisify(exec);

export interface InitResult {
  initialized: boolean;
  filesCreated: string[];
}

export interface StatusResult {
  currentNode: string;
  status: "active" | "completed" | "escalated";
  retryCount: number;
  maxRetries: number;
  lastGateResults: GateResult[];
  escalationTarget?: string;
  instructions: string;
  subagent?: NodeDef["subagent"];
  unclosedActivities: ActivityRecord[];
}

export interface ContextBundle {
  nodeId: string;
  instructions: string;
  subagent?: NodeDef["subagent"];
  tier0: {
    index: IndexManifest;
    capabilities: Capabilities;
  };
  tier1: {
    contracts: Record<string, ModuleContract>;
  };
  tier2: {
    architecture: Architecture;
    structure: Structure;
  };
  formatted: string;
}

export interface GateCheckOptions {
  phase?: "pre" | "post";
  tool?: string;
  args?: string;
}

export interface GateCheckResult {
  passed: boolean;
  results: GateResult[];
}

export interface AdvanceResult {
  advanced: boolean;
  from: string;
  to?: string;
  status: "active" | "completed" | "escalated";
  retryCount?: number;
  maxRetries?: number;
  escalated?: boolean;
  escalationTarget?: string;
  gateResults?: GateResult[];
  unclosedActivities?: ActivityRecord[];
  report?: WorkflowRunReport;
  message?: string;
}

export interface WorkflowInfo {
  name: string;
  active: boolean;
  initialNode: string;
  nodeCount: number;
}

export interface WorkflowRunResult {
  runId: string;
  workflow: string;
  initialNode: string;
  state: EngineState;
  previousRunReport?: WorkflowRunReport | null;
}

export interface WorkflowResetResult {
  runId: string;
  workflow: string;
  node: string;
  reason?: string;
  state: EngineState;
  previousRunReport?: WorkflowRunReport | null;
}

export interface WorkflowValidationIssue {
  type: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
}

export interface WorkflowValidationResult {
  workflow: string;
  valid: boolean;
  graphPath: string;
  issues: WorkflowValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    nodeCount: number;
  };
}

export interface WorkflowCreateOptions {
  displayName?: string;
  nodes?: string[];
  force?: boolean;
}

export interface WorkflowCreateResult {
  created: boolean;
  workflow: string;
  workflowDir: string;
  filesCreated: string[];
  validation: WorkflowValidationResult;
}

export class CrewmateEngine {
  private projectRoot: string;
  private stateManager: StateManager;
  private activityManager: ActivityManager;
  private taskManager: TaskManager;
  private reportManager: ReportManager;
  private archiveManager: ArchiveManager;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
    this.stateManager = new StateManager(this.projectRoot);
    this.activityManager = new ActivityManager(this.projectRoot);
    this.taskManager = new TaskManager(this.projectRoot);
    this.reportManager = new ReportManager(this.projectRoot);
    this.archiveManager = new ArchiveManager(this.projectRoot);
  }

  public getProjectRoot(): string {
    return this.projectRoot;
  }

  public getStateManager(): StateManager {
    return this.stateManager;
  }

  public getActivityManager(): ActivityManager {
    return this.activityManager;
  }

  public getTaskManager(): TaskManager {
    return this.taskManager;
  }

  public getReportManager(): ReportManager {
    return this.reportManager;
  }

  public getArchiveManager(): ArchiveManager {
    return this.archiveManager;
  }

  public async createTask(options: TaskCreateOptions): Promise<TaskDefinition> {
    return this.taskManager.createTask(options);
  }

  public async startTask(taskId: string): Promise<TaskStartResult> {
    return this.taskManager.startTask(taskId);
  }

  public async amendTaskScope(
    taskId: string,
    filePath: string,
    reason?: string,
  ): Promise<TaskAmendResult> {
    return this.taskManager.amendScope(taskId, filePath, reason);
  }

  public async completeTask(taskId: string): Promise<TaskCompleteResult> {
    return this.taskManager.completeTask(taskId);
  }

  public async getTaskLocks(): Promise<LocksTableResult> {
    return this.taskManager.getLocks();
  }

  public async listTasks(filter?: {
    status?: TaskStatus;
  }): Promise<TaskDefinition[]> {
    return this.taskManager.listTasks(filter);
  }

  public async getTaskConflictSummary(): Promise<ConflictSummary> {
    return this.taskManager.getConflictSummary();
  }

  /**
   * Get files being verified in current workspace
   */
  public async getVerifiedFiles(
    unclosedActivities?: ActivityRecord[],
  ): Promise<string[]> {
    const verified = new Set<string>();

    // 1. Try git status / diff
    try {
      const { stdout: statusOut } = await execAsync("git status --porcelain", {
        cwd: this.projectRoot,
      });
      const lines = statusOut
        .split("\n")
        .filter((l: string) => l.trim().length > 0);
      for (const line of lines) {
        const raw = line.slice(3).trim();
        const clean = raw.includes(" -> ") ? raw.split(" -> ")[1].trim() : raw;
        verified.add(
          this.activityManager.normalizePath(clean.replace(/^"|"$/g, "")),
        );
      }

      try {
        const { stdout: diffOut } = await execAsync(
          "git diff --name-only HEAD",
          { cwd: this.projectRoot },
        );
        const diffLines = diffOut
          .split("\n")
          .filter((l: string) => l.trim().length > 0);
        for (const dl of diffLines) {
          verified.add(
            this.activityManager.normalizePath(dl.trim().replace(/^"|"$/g, "")),
          );
        }
      } catch {
        // HEAD might not exist
      }
    } catch {
      // not a git repo
    }

    // 2. If unclosed activities are passed and git found nothing (or not a git repo),
    // check whether files declared in unclosed activities exist on disk in projectRoot
    if (unclosedActivities) {
      for (const act of unclosedActivities) {
        const actFiles = this.activityManager.extractFiles(act);
        for (const file of actFiles) {
          const abs = path.resolve(this.projectRoot, file);
          try {
            await fs.access(abs);
            // file exists on disk!
            verified.add(this.activityManager.normalizePath(file));
          } catch {
            // does not exist
          }
        }
      }
    }

    return Array.from(verified);
  }

  /**
   * Helper to resolve path relative to project root
   */
  private p(...segments: string[]): string {
    return path.join(this.projectRoot, ...segments);
  }

  /**
   * Helper to resolve a contract path (.crewmate/contracts/... with fallback to contracts/...)
   */
  public async resolveContractPath(...segments: string[]): Promise<string> {
    return resolveContractPathFs(this.projectRoot, ...segments);
  }

  /**
   * Helper to resolve a workflow path (.crewmate/workflows/<activeWorkflow>/... with fallback to default and legacy paths)
   */
  public async resolveWorkflowPath(...segments: string[]): Promise<string> {
    let activeWf = "feature-pipeline";
    try {
      const state = await this.stateManager.getState();
      if (state.activeWorkflow) {
        activeWf = state.activeWorkflow;
      }
    } catch {
      // Default to "feature-pipeline" if state is not initialized yet
    }

    const candidateDirs = [
      this.p(".crewmate", "workflows", activeWf),
      this.p(".crewmate", "workflows", "feature-pipeline"),
      this.p(".crewmate", "workflows", "default"),
      this.p(".crewmate", "workflow"),
      this.p("workflow"),
    ];

    for (const dir of candidateDirs) {
      const candidate = path.join(dir, ...segments);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // If segments end in .yaml, also check .yml
        const last = segments[segments.length - 1];
        if (last && last.endsWith(".yaml")) {
          const ymlSegments = [
            ...segments.slice(0, -1),
            last.replace(/\.yaml$/, ".yml"),
          ];
          const ymlCandidate = path.join(dir, ...ymlSegments);
          try {
            await fs.access(ymlCandidate);
            return ymlCandidate;
          } catch {
            // continue
          }
        }
      }
    }

    return path.join(candidateDirs[0], ...segments);
  }

  /**
   * Safely read and parse a YAML file
   */
  private async readYaml<T>(
    filePath: string,
    schema: { parse: (val: unknown) => T },
  ): Promise<T> {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = yaml.parse(content);
    return schema.parse(parsed);
  }

  /**
   * Initialize standard project structure
   */
  public async init(
    options: { force?: boolean; example?: boolean } = {},
  ): Promise<InitResult> {
    const indexContent = options.example
      ? DEFAULT_EXAMPLE_INDEX_YAML
      : DEFAULT_INDEX_YAML;
    const archContent = options.example
      ? DEFAULT_EXAMPLE_ARCHITECTURE_YAML
      : DEFAULT_ARCHITECTURE_YAML;
    const capsContent = options.example
      ? DEFAULT_EXAMPLE_CAPABILITIES_YAML
      : DEFAULT_CAPABILITIES_YAML;

    const filesToCreate = [
      {
        path: this.p(".crewmate", "contracts", "index.yaml"),
        content: indexContent,
      },
      {
        path: this.p(".crewmate", "contracts", "architecture.yaml"),
        content: archContent,
      },
      {
        path: this.p(".crewmate", "contracts", "structure.yaml"),
        content: DEFAULT_STRUCTURE_YAML,
      },
      {
        path: this.p(".crewmate", "contracts", "capabilities.yaml"),
        content: capsContent,
      },
      {
        path: this.p(".crewmate", "contracts", "SCHEMA.md"),
        content: DEFAULT_SCHEMA_MD,
      },
      ...(options.example
        ? [
            {
              path: this.p(
                ".crewmate",
                "contracts",
                "modules",
                "example.contract.yaml",
              ),
              content: DEFAULT_EXAMPLE_CONTRACT_YAML,
            },
          ]
        : []),
      // Primary workflow: feature-pipeline
      {
        path: this.p(
          ".crewmate",
          "workflows",
          "feature-pipeline",
          "graph.yaml",
        ),
        content: DEFAULT_GRAPH_YAML,
      },
      {
        path: this.p(
          ".crewmate",
          "workflows",
          "feature-pipeline",
          "nodes",
          "scout.node.yaml",
        ),
        content: DEFAULT_SCOUT_NODE_YAML,
      },
      {
        path: this.p(
          ".crewmate",
          "workflows",
          "feature-pipeline",
          "nodes",
          "clarify.node.yaml",
        ),
        content: DEFAULT_CLARIFY_NODE_YAML,
      },
      {
        path: this.p(
          ".crewmate",
          "workflows",
          "feature-pipeline",
          "nodes",
          "plan.node.yaml",
        ),
        content: DEFAULT_PLAN_NODE_YAML,
      },
      {
        path: this.p(
          ".crewmate",
          "workflows",
          "feature-pipeline",
          "nodes",
          "execute.node.yaml",
        ),
        content: DEFAULT_EXECUTE_NODE_YAML,
      },
      {
        path: this.p(
          ".crewmate",
          "workflows",
          "feature-pipeline",
          "nodes",
          "contract.node.yaml",
        ),
        content: DEFAULT_CONTRACT_NODE_YAML,
      },
      {
        path: this.p(
          ".crewmate",
          "workflows",
          "feature-pipeline",
          "nodes",
          "verify.node.yaml",
        ),
        content: DEFAULT_VERIFY_NODE_YAML,
      },
      // Secondary workflow: contract-sync
      {
        path: this.p(".crewmate", "workflows", "contract-sync", "graph.yaml"),
        content: SYNC_GRAPH_YAML,
      },
      {
        path: this.p(
          ".crewmate",
          "workflows",
          "contract-sync",
          "nodes",
          "scout.node.yaml",
        ),
        content: SYNC_SCOUT_NODE_YAML,
      },
      {
        path: this.p(
          ".crewmate",
          "workflows",
          "contract-sync",
          "nodes",
          "contract.node.yaml",
        ),
        content: SYNC_CONTRACT_NODE_YAML,
      },
    ];

    if (!options.force) {
      for (const file of filesToCreate) {
        try {
          await fs.access(file.path);
          throw new Error(
            `File already exists: ${path.relative(this.projectRoot, file.path)}. Use --force to overwrite.`,
          );
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            throw err;
          }
        }
      }
    }

    const created: string[] = [];
    for (const file of filesToCreate) {
      await fs.mkdir(path.dirname(file.path), { recursive: true });
      await fs.writeFile(file.path, file.content, "utf-8");
      created.push(
        path.relative(this.projectRoot, file.path).replace(/\\/g, "/"),
      );
    }

    // Always ensure the contracts/modules directory exists even if no contracts are created initially
    await fs.mkdir(this.p(".crewmate", "contracts", "modules"), {
      recursive: true,
    });

    // Install OpenCode project-wide plugin (.opencode/plugins/crewmate.ts)
    // Clean up any legacy crewmate.js so OpenCode does not attempt duplicate/conflicting loading
    const legacyJsPath = this.p(".opencode", "plugins", "crewmate.js");
    try {
      await fs.rm(legacyJsPath, { force: true });
    } catch {
      // Ignore if not present
    }

    const pluginTsPath = this.p(".opencode", "plugins", "crewmate.ts");
    let pluginExists = false;
    try {
      await fs.access(pluginTsPath);
      pluginExists = true;
    } catch {
      pluginExists = false;
    }

    if (!pluginExists || options.force) {
      // Resolve absolute file URL to this installation's adapter as fallback for projects without crewmate in node_modules
      let fallbackAdapterUrl: string | undefined;
      try {
        fallbackAdapterUrl = new URL(
          "../../adapters/opencode/index.js",
          import.meta.url,
        ).href;
      } catch {
        fallbackAdapterUrl = undefined;
      }

      const pluginContent = generateOpenCodePluginTs(fallbackAdapterUrl);
      await fs.mkdir(path.dirname(pluginTsPath), { recursive: true });
      await fs.writeFile(pluginTsPath, pluginContent, "utf-8");
      created.push(
        path.relative(this.projectRoot, pluginTsPath).replace(/\\/g, "/"),
      );
    }

    // Install OpenCode specialized orchestrator and subagents in .opencode/agents/
    const agentsToScaffold: Array<{ filename: string; content: string }> = [
      { filename: "matte.md", content: DEFAULT_MATTE_AGENT_MD },
      { filename: "scout.md", content: DEFAULT_SCOUT_AGENT_MD },
      { filename: "planner.md", content: DEFAULT_PLANNER_AGENT_MD },
      { filename: "builder.md", content: DEFAULT_BUILDER_AGENT_MD },
      { filename: "contractor.md", content: DEFAULT_CONTRACTOR_AGENT_MD },
      { filename: "verifier.md", content: DEFAULT_VERIFIER_AGENT_MD },
    ];

    for (const agent of agentsToScaffold) {
      const agentPath = this.p(".opencode", "agents", agent.filename);
      let agentExists = false;
      try {
        await fs.access(agentPath);
        agentExists = true;
      } catch {
        agentExists = false;
      }

      if (!agentExists || options.force) {
        await fs.mkdir(path.dirname(agentPath), { recursive: true });
        await fs.writeFile(agentPath, agent.content, "utf-8");
        created.push(
          path.relative(this.projectRoot, agentPath).replace(/\\/g, "/"),
        );
      }
    }

    // Clean up any duplicate local file paths in opencode.json's plugins array
    const opencodeJsonPath = this.p("opencode.json");
    try {
      const content = await fs.readFile(opencodeJsonPath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.plugins)) {
        const cleaned = parsed.plugins.filter(
          (p: string) => !p.includes(".opencode/plugins/crewmate"),
        );
        if (cleaned.length !== parsed.plugins.length) {
          parsed.plugins = cleaned;
          await fs.writeFile(
            opencodeJsonPath,
            JSON.stringify(parsed, null, 2),
            "utf-8",
          );
        }
      }
    } catch {
      // Ignore if missing or unparseable
    }

    // Initialize state
    const graphFile = await this.resolveWorkflowPath("graph.yaml");
    const graph = await this.readYaml(graphFile, GraphSchema);
    await this.stateManager.appendEvent({
      timestamp: new Date().toISOString(),
      event: "INIT",
      initialNode: graph.initial,
      workflow: "feature-pipeline",
    });
    created.push(".crewmate/state.jsonl");

    return { initialized: true, filesCreated: created };
  }

  /**
   * Get current engine status
   */
  public async status(): Promise<StatusResult> {
    const state = await this.stateManager.getState();
    if (!state.currentNode) {
      throw new Error(
        "Crewmate is not initialized. Run 'crewmate init' first.",
      );
    }

    let instructions = "";
    let subagent: NodeDef["subagent"] = undefined;
    let maxRetries = 2;

    try {
      const nodeDef = await this.getNodeDef(state.currentNode);
      instructions = nodeDef.instructions;
      subagent = nodeDef.subagent;
      maxRetries = nodeDef.on_fail_max_retries;
    } catch {
      // If node definition cannot be loaded (e.g. node "done"), defaults apply
    }

    const currentRetries = state.retryCounts[state.currentNode] || 0;
    const gateResults = state.lastGateResults[state.currentNode] || [];
    const unclosedActivities =
      await this.activityManager.getUnclosedActivities();

    return {
      currentNode: state.currentNode,
      status: state.status,
      retryCount: currentRetries,
      maxRetries,
      lastGateResults: gateResults,
      escalationTarget: state.escalationTarget,
      instructions,
      subagent,
      unclosedActivities,
    };
  }

  /**
   * Load node definition
   */
  public async getNodeDef(nodeId: string): Promise<NodeDef> {
    const nodeFile = await this.resolveWorkflowPath(
      "nodes",
      `${nodeId}.node.yaml`,
    );
    return this.readYaml(nodeFile, NodeDefSchema);
  }

  /**
   * Load workflow graph
   */
  public async getGraph(): Promise<Graph> {
    const graphFile = await this.resolveWorkflowPath("graph.yaml");
    return this.readYaml(graphFile, GraphSchema);
  }

  /**
   * Assemble tiered context for a node
   */
  public async context(
    nodeId?: string,
    options: { module?: string } = {},
  ): Promise<ContextBundle> {
    const state = await this.stateManager.getState();
    const targetNode = nodeId || state.currentNode;
    if (!targetNode) {
      throw new Error(
        "Cannot determine node for context: workflow has no current node.",
      );
    }

    const nodeDef = await this.getNodeDef(targetNode);

    // Tier 0: Manifest and Capabilities
    const index = await this.readYaml(
      await this.resolveContractPath("index.yaml"),
      IndexManifestSchema,
    );
    const capabilities = await this.readYaml(
      await this.resolveContractPath("capabilities.yaml"),
      CapabilitiesSchema,
    );

    // Tier 1: Target Module Contract(s)
    const contracts: Record<string, ModuleContract> = {};
    const modulesDir = await this.resolveContractPath("modules");
    try {
      const moduleFiles = await fs.readdir(modulesDir);
      for (const file of moduleFiles) {
        if (file.endsWith(".contract.yaml")) {
          const modName = file.replace(/\.contract\.yaml$/, "");
          if (!options.module || options.module === modName) {
            const contract = await this.readYaml(
              path.join(modulesDir, file),
              ModuleContractSchema,
            );
            contracts[contract.module] = contract;
          }
        }
      }
    } catch {
      // modules dir empty or missing
    }

    // Tier 2: Architecture & Structure
    const architecture = await this.readYaml(
      await this.resolveContractPath("architecture.yaml"),
      ArchitectureSchema,
    );
    const structure = await this.readYaml(
      await this.resolveContractPath("structure.yaml"),
      StructureSchema,
    );

    // Human/Agent readable formatted bundle
    const formatted = this.formatContextBundle({
      nodeId: targetNode,
      instructions: nodeDef.instructions,
      subagent: nodeDef.subagent,
      tier0: { index, capabilities },
      tier1: { contracts },
      tier2: { architecture, structure },
    });

    return {
      nodeId: targetNode,
      instructions: nodeDef.instructions,
      subagent: nodeDef.subagent,
      tier0: { index, capabilities },
      tier1: { contracts },
      tier2: { architecture, structure },
      formatted,
    };
  }

  private formatContextBundle(bundle: {
    nodeId: string;
    instructions: string;
    subagent?: NodeDef["subagent"];
    tier0: { index: IndexManifest; capabilities: Capabilities };
    tier1: { contracts: Record<string, ModuleContract> };
    tier2: { architecture: Architecture; structure: Structure };
  }): string {
    const lines: string[] = [];
    lines.push(
      `=== CREWMATE CONTEXT [NODE: ${bundle.nodeId.toUpperCase()}] ===`,
    );

    if (bundle.subagent) {
      const agentPart = bundle.subagent.agent
        ? ` | Subagent: ${bundle.subagent.agent}`
        : "";
      lines.push(
        `Role: ${bundle.subagent.role}${agentPart} | Scope: ${bundle.subagent.scope}`,
      );
      if (
        bundle.subagent.allowed_tools &&
        bundle.subagent.allowed_tools.length > 0
      ) {
        lines.push(
          `Allowed Tools: ${bundle.subagent.allowed_tools.join(", ")}`,
        );
      }
    }

    if (bundle.instructions.trim()) {
      lines.push(`\n--- Instructions ---\n${bundle.instructions.trim()}`);
    }

    // Tier 0
    lines.push("\n--- Tier 0: Modules & Capabilities ---");
    lines.push("Known Modules:");
    for (const m of bundle.tier0.index.modules) {
      lines.push(`  - ${m.name} (${m.path}): ${m.responsibility}`);
    }
    lines.push("Existing Capabilities:");
    for (const c of bundle.tier0.capabilities.capabilities) {
      lines.push(`  - [${c.module}] ${c.name}: ${c.description}`);
    }

    // Tier 1
    if (Object.keys(bundle.tier1.contracts).length > 0) {
      lines.push("\n--- Tier 1: Scoped Module Contracts ---");
      for (const [mod, contract] of Object.entries(bundle.tier1.contracts)) {
        lines.push(`Module: ${mod} (v${contract.version})`);
        if (contract.public_api.length > 0) {
          lines.push("  Public API:");
          for (const api of contract.public_api) {
            lines.push(
              `    - ${api.export} (${api.file})${api.signature ? `: ${api.signature}` : ""}`,
            );
          }
        }
        if (contract.invariants.length > 0) {
          lines.push("  Invariants:");
          for (const inv of contract.invariants) {
            lines.push(`    - ${inv}`);
          }
        }
        if (contract.declared_consumers.length > 0) {
          lines.push(`  Consumers: ${contract.declared_consumers.join(", ")}`);
        }
      }
    }

    // Tier 2
    lines.push("\n--- Tier 2: Architecture & Structure Rules ---");
    lines.push("Allowed Dependencies:");
    for (const [mod, rule] of Object.entries(
      bundle.tier2.architecture.modules,
    )) {
      lines.push(`  ${mod} -> [${rule.allowed_dependencies.join(", ")}]`);
    }
    if (bundle.tier2.structure.forbidden_patterns.length > 0) {
      lines.push(
        `Forbidden Patterns: ${bundle.tier2.structure.forbidden_patterns.join(", ")}`,
      );
    }

    return lines.join("\n");
  }

  /**
   * Single-field contract lookup
   */
  public async query(moduleName: string, field: string): Promise<unknown> {
    const contractPath = await this.resolveContractPath(
      "modules",
      `${moduleName}.contract.yaml`,
    );
    try {
      const contract = await this.readYaml(contractPath, ModuleContractSchema);
      const val = (contract as Record<string, unknown>)[field];
      if (val === undefined) {
        throw new Error(
          `Field '${field}' not found in contract for module '${moduleName}'. Available fields: ${Object.keys(
            contract,
          ).join(", ")}`,
        );
      }
      return val;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Module contract not found for '${moduleName}' at ${contractPath}`,
        );
      }
      throw err;
    }
  }

  /**
   * Run hard gates for a node
   */
  public async gateCheck(
    nodeId: string,
    options: GateCheckOptions = {},
  ): Promise<GateCheckResult> {
    const nodeDef = await this.getNodeDef(nodeId);
    const phases: ("pre" | "post")[] = options.phase
      ? [options.phase]
      : ["pre", "post"];
    const results: GateResult[] = [];
    let overallPassed = true;

    for (const phase of phases) {
      const guardrails = nodeDef.guardrails[phase] || [];
      const hardGuardrails = guardrails.filter(
        (g): g is HardGuardrail => g.type === "hard",
      );

      for (const guard of hardGuardrails) {
        const checkResult = await this.executeGateRun(nodeId, phase, guard.run);
        results.push(checkResult);

        // Record check in state log
        await this.stateManager.appendEvent({
          timestamp: new Date().toISOString(),
          event: "GATE_CHECK",
          node: nodeId,
          phase,
          gate: guard.run,
          status: checkResult.status,
          exitCode: checkResult.exitCode,
          output: checkResult.output,
          evidence: checkResult.evidence,
          error: checkResult.error,
        });

        if (checkResult.status === "failed") {
          overallPassed = false;
        }
      }
    }

    return { passed: overallPassed, results };
  }

  /**
   * Execute a single gate command
   */
  public async executeGateRun(
    nodeId: string,
    phase: "pre" | "post",
    command: string,
  ): Promise<GateResult> {
    const trimmedCmd = command.trim();

    // Fast-path internal dispatch for crewmate scan commands
    if (trimmedCmd.startsWith("crewmate scan arch")) {
      const { scanArchitecture } = await import("../scanner/arch.js");
      const result = await scanArchitecture(this.projectRoot);
      return {
        gate: command,
        type: "hard",
        phase,
        status: result.valid ? "passed" : "failed",
        exitCode: result.valid ? 0 : 1,
        output: JSON.stringify(result, null, 2),
        evidence: {
          violations: result.violations,
          scannedFiles: result.scannedFiles,
        },
        error: result.valid
          ? undefined
          : `Found ${result.violations.length} architecture violations.`,
      };
    }

    if (trimmedCmd.startsWith("crewmate scan dead-code")) {
      const { scanDeadCode } = await import("../scanner/dead-code.js");
      const result = await scanDeadCode(this.projectRoot);
      return {
        gate: command,
        type: "hard",
        phase,
        status: result.valid ? "passed" : "failed",
        exitCode: result.valid ? 0 : 1,
        output: JSON.stringify(result, null, 2),
        evidence: {
          safeDeleteCandidates: result.safeDeleteCandidates,
          flaggedForReview: result.flaggedForReview,
          summary: result.summary,
        },
        error: result.valid
          ? undefined
          : `Found ${result.safeDeleteCandidates.length} dead code safe-delete candidates.`,
      };
    }

    try {
      // Execute command in project root
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.projectRoot,
        env: { ...process.env, CREWMATE_PROJECT_ROOT: this.projectRoot },
      });

      let evidence: Record<string, unknown> | undefined = undefined;
      // Try to parse structured JSON from stdout if available
      try {
        const trimmed = stdout.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          evidence = JSON.parse(trimmed);
        }
      } catch {
        // stdout is plain text
      }

      return {
        gate: command,
        type: "hard",
        phase,
        status: "passed",
        exitCode: 0,
        output: stdout.trim(),
        evidence,
        error: stderr.trim() || undefined,
      };
    } catch (err: unknown) {
      const errorObj = err as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const exitCode = typeof errorObj.code === "number" ? errorObj.code : 1;
      const stdout = errorObj.stdout ? errorObj.stdout.trim() : "";
      const stderr = errorObj.stderr
        ? errorObj.stderr.trim()
        : errorObj.message || String(err);

      let evidence: Record<string, unknown> | undefined = undefined;
      try {
        if (stdout.startsWith("{") && stdout.endsWith("}")) {
          evidence = JSON.parse(stdout);
        }
      } catch {
        // ignore
      }

      return {
        gate: command,
        type: "hard",
        phase,
        status: "failed",
        exitCode,
        output: stdout,
        evidence,
        error: stderr,
      };
    }
  }

  /**
   * Authoritative phase-transition re-verification
   */
  public async advance(): Promise<AdvanceResult> {
    const state = await this.stateManager.getState();
    const currentNode = state.currentNode;

    if (!currentNode) {
      throw new Error("Engine not initialized. Run 'crewmate init' first.");
    }

    if (state.status === "completed") {
      return {
        advanced: false,
        from: currentNode,
        status: "completed",
        message: "Workflow is already completed.",
      };
    }

    if (state.status === "escalated") {
      return {
        advanced: false,
        from: currentNode,
        status: "escalated",
        escalationTarget: state.escalationTarget,
        message: `Workflow is escalated to ${state.escalationTarget}. Manual intervention required.`,
      };
    }

    // 0. Check for unclosed activities (orphans) touching verified files
    const unclosedActivities =
      await this.activityManager.getUnclosedActivities();
    if (unclosedActivities.length > 0) {
      const verifiedFiles = await this.getVerifiedFiles(unclosedActivities);
      const blockingActivities: ActivityRecord[] = [];

      for (const act of unclosedActivities) {
        const actFiles = this.activityManager.extractFiles(act);
        const overlaps = actFiles.some((f) =>
          verifiedFiles.some(
            (vf) => vf === f || vf.endsWith("/" + f) || f.endsWith("/" + vf),
          ),
        );
        if (overlaps) {
          blockingActivities.push(act);
        }
      }

      if (blockingActivities.length > 0) {
        const actSummaries = blockingActivities
          .map((a) => `${a.id} ("${a.label}")`)
          .join(", ");
        return {
          advanced: false,
          from: currentNode,
          status: state.status,
          message: `Advance blocked: Unclosed activities touching verified files: ${actSummaries}. Resolve or end these activities before advancing.`,
          unclosedActivities: blockingActivities,
        };
      }
    }

    const graph = await this.getGraph();
    const nodeDef = await this.getNodeDef(currentNode);

    // 1. Re-verify ALL post hard gates of current node
    const postCheck = await this.gateCheck(currentNode, { phase: "post" });

    // 2. If post gates pass:
    if (postCheck.passed) {
      const graphEntry = graph.nodes.find((n) => n.id === currentNode);
      const nextNode = graphEntry?.next;

      if (!nextNode || nextNode === "done") {
        await this.stateManager.appendEvent({
          timestamp: new Date().toISOString(),
          event: "COMPLETE",
          node: currentNode,
        });
        const report = await this.generateCurrentRunReport(
          "completed",
          "Workflow completed successfully",
        );
        return {
          advanced: true,
          from: currentNode,
          to: "done",
          status: "completed",
          gateResults: postCheck.results,
          report: report || undefined,
        };
      }

      // Check pre gates of next node
      const nextNodeDef = await this.getNodeDef(nextNode);
      const preCheck = await this.gateCheck(nextNode, { phase: "pre" });

      if (preCheck.passed) {
        await this.stateManager.appendEvent({
          timestamp: new Date().toISOString(),
          event: "NODE_TRANSITION",
          from: currentNode,
          to: nextNode,
          reason: "advance: gates passed",
        });

        return {
          advanced: true,
          from: currentNode,
          to: nextNode,
          status: "active",
          gateResults: [...postCheck.results, ...preCheck.results],
        };
      } else {
        // Pre-gates of next node failed! Handle per next node on_fail
        return this.handleGateFailure(nextNode, nextNodeDef, preCheck.results);
      }
    }

    // 3. Post gates failed! Handle retry & fail-routing
    return this.handleGateFailure(currentNode, nodeDef, postCheck.results);
  }

  private async handleGateFailure(
    nodeId: string,
    nodeDef: NodeDef,
    failedResults: GateResult[],
  ): Promise<AdvanceResult> {
    const state = await this.stateManager.getState();
    const currentRetries = state.retryCounts[nodeId] || 0;
    const maxRetries = nodeDef.on_fail_max_retries;

    if (currentRetries < maxRetries) {
      const newRetries = currentRetries + 1;
      await this.stateManager.appendEvent({
        timestamp: new Date().toISOString(),
        event: "RETRY_INCREMENT",
        node: nodeId,
        retryCount: newRetries,
        maxRetries,
      });

      // Parse on_fail: e.g. "route(execute)"
      let targetNode = nodeId;
      if (nodeDef.on_fail) {
        const match = nodeDef.on_fail.match(/^route\((.+)\)$/);
        if (match) {
          targetNode = match[1].trim();
        }
      }

      await this.stateManager.appendEvent({
        timestamp: new Date().toISOString(),
        event: "NODE_TRANSITION",
        from: nodeId,
        to: targetNode,
        reason: `on_fail: gate failed (${nodeDef.on_fail || "retry"})`,
      });

      return {
        advanced: false,
        from: nodeId,
        to: targetNode,
        status: "active",
        retryCount: newRetries,
        maxRetries,
        gateResults: failedResults,
        message: `Gates failed. Routed to ${targetNode} (retry ${newRetries}/${maxRetries}).`,
      };
    } else {
      // Exceeded retries -> escalate
      const target = nodeDef.escalate_after_max_retries || "human";
      await this.stateManager.appendEvent({
        timestamp: new Date().toISOString(),
        event: "ESCALATE",
        node: nodeId,
        target,
        reason: `Exceeded max retries (${maxRetries}) on node ${nodeId}`,
      });

      return {
        advanced: false,
        from: nodeId,
        status: "escalated",
        escalated: true,
        escalationTarget: target,
        retryCount: currentRetries,
        maxRetries,
        gateResults: failedResults,
        message: `Gates failed. Max retries (${maxRetries}) reached. Escalated to ${target}.`,
      };
    }
  }

  /**
   * Manual override
   */
  public async goto(
    targetNode: string,
    options: { force?: boolean } = {},
  ): Promise<{ from: string; to: string }> {
    const state = await this.stateManager.getState();
    const fromNode = state.currentNode || "none";

    if (!options.force && targetNode !== "done") {
      // Check node file exists
      await this.getNodeDef(targetNode);
    }

    if (targetNode === "done") {
      await this.stateManager.appendEvent({
        timestamp: new Date().toISOString(),
        event: "COMPLETE",
        node: fromNode,
      });
      return { from: fromNode, to: targetNode };
    }

    await this.stateManager.appendEvent({
      timestamp: new Date().toISOString(),
      event: "OVERRIDE",
      from: fromNode,
      to: targetNode,
      reason: "manual goto",
    });

    return { from: fromNode, to: targetNode };
  }

  public async getHarnessLiveness() {
    return this.activityManager.getHarnessLiveness();
  }

  public async reconcileStaleActivities(reason: string = "harness offline") {
    return this.activityManager.reconcileStaleActivities(reason);
  }

  /**
   * List available workflows under .crewmate/workflows/
   */
  public async listWorkflows(): Promise<WorkflowInfo[]> {
    const workflowsDir = this.p(".crewmate", "workflows");
    const legacyWorkflowDir = this.p(".crewmate", "workflow");

    // If .crewmate/workflows doesn't exist, check if legacy .crewmate/workflow exists to migrate/seed default
    try {
      await fs.access(workflowsDir);
    } catch {
      try {
        const legacyGraph = path.join(legacyWorkflowDir, "graph.yaml");
        await fs.access(legacyGraph);
        await fs.mkdir(path.join(workflowsDir, "feature-pipeline"), {
          recursive: true,
        });
        await fs.cp(
          legacyWorkflowDir,
          path.join(workflowsDir, "feature-pipeline"),
          { recursive: true },
        );
      } catch {
        return [];
      }
    }

    const state = await this.stateManager.getState();
    const activeName = state.activeWorkflow || "feature-pipeline";

    let entries: string[] = [];
    try {
      entries = await fs.readdir(workflowsDir);
    } catch {
      return [];
    }

    const results: WorkflowInfo[] = [];

    for (const name of entries) {
      const dirPath = path.join(workflowsDir, name);
      try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      let resolvedGraph: string | null = null;
      for (const candidate of ["graph.yaml", "graph.yml"]) {
        const p = path.join(dirPath, candidate);
        try {
          await fs.access(p);
          resolvedGraph = p;
          break;
        } catch {
          // continue
        }
      }

      if (resolvedGraph) {
        try {
          const graph = await this.readYaml(resolvedGraph, GraphSchema);
          results.push({
            name,
            active: name === activeName,
            initialNode: graph.initial,
            nodeCount: graph.nodes.length,
          });
        } catch {
          // ignore invalid yaml
        }
      }
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Validate a workflow's graph structure, node definitions, and edge connectivity
   */
  public async validateWorkflow(
    workflowName?: string,
  ): Promise<WorkflowValidationResult> {
    let targetName = workflowName;
    if (!targetName) {
      try {
        const state = await this.stateManager.getState();
        targetName = state.activeWorkflow || "feature-pipeline";
      } catch {
        targetName = "feature-pipeline";
      }
    }

    const workflowsDir = this.p(".crewmate", "workflows");
    let targetWfDir = path.join(workflowsDir, targetName);

    // Check if directory exists; fallback check for legacy paths if targetName is default or feature-pipeline
    let dirExists = false;
    try {
      const stat = await fs.stat(targetWfDir);
      dirExists = stat.isDirectory();
    } catch {
      dirExists = false;
    }

    if (!dirExists) {
      // Check legacy candidates if looking for default/feature-pipeline
      if (targetName === "feature-pipeline" || targetName === "default") {
        for (const candidate of [
          this.p(".crewmate", "workflows", "feature-pipeline"),
          this.p(".crewmate", "workflows", "default"),
          this.p(".crewmate", "workflow"),
          this.p("workflow"),
        ]) {
          try {
            const stat = await fs.stat(candidate);
            if (stat.isDirectory()) {
              targetWfDir = candidate;
              dirExists = true;
              break;
            }
          } catch {
            // continue
          }
        }
      }
    }

    if (!dirExists) {
      return {
        workflow: targetName,
        valid: false,
        graphPath: "",
        issues: [
          {
            type: "error",
            code: "WORKFLOW_NOT_FOUND",
            message: `Workflow directory not found at .crewmate/workflows/${targetName}`,
          },
        ],
        summary: {
          errors: 1,
          warnings: 0,
          nodeCount: 0,
        },
      };
    }

    const issues: WorkflowValidationIssue[] = [];

    // 1. Locate graph.yaml or graph.yml
    let resolvedGraphPath: string | null = null;
    for (const candidate of ["graph.yaml", "graph.yml"]) {
      const p = path.join(targetWfDir, candidate);
      try {
        await fs.access(p);
        resolvedGraphPath = p;
        break;
      } catch {
        // continue
      }
    }

    if (!resolvedGraphPath) {
      return {
        workflow: targetName,
        valid: false,
        graphPath: "",
        issues: [
          {
            type: "error",
            code: "MISSING_GRAPH",
            message: `Missing graph.yaml in ${path.relative(this.projectRoot, targetWfDir).replace(/\\/g, "/")}`,
          },
        ],
        summary: {
          errors: 1,
          warnings: 0,
          nodeCount: 0,
        },
      };
    }

    // 2. Parse graph.yaml
    let graph: Graph | null = null;
    try {
      const content = await fs.readFile(resolvedGraphPath, "utf-8");
      const raw = yaml.parse(content);
      graph = GraphSchema.parse(raw);
    } catch (err: unknown) {
      issues.push({
        type: "error",
        code: "INVALID_GRAPH_SCHEMA",
        message: `Graph definition does not conform to schema: ${err instanceof Error ? err.message : String(err)}`,
      });
      return {
        workflow: targetName,
        valid: false,
        graphPath: path
          .relative(this.projectRoot, resolvedGraphPath)
          .replace(/\\/g, "/"),
        issues,
        summary: {
          errors: issues.filter((i) => i.type === "error").length,
          warnings: issues.filter((i) => i.type === "warning").length,
          nodeCount: 0,
        },
      };
    }

    const nodeIds = new Set<string>();
    const duplicateIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id)) {
        duplicateIds.add(node.id);
      }
      nodeIds.add(node.id);
    }

    for (const dup of duplicateIds) {
      issues.push({
        type: "error",
        code: "DUPLICATE_NODE_ID",
        message: `Duplicate node ID "${dup}" declared in graph nodes list`,
        nodeId: dup,
      });
    }

    // 3. Verify initial node exists in graph nodes list
    if (!nodeIds.has(graph.initial)) {
      issues.push({
        type: "error",
        code: "INVALID_INITIAL_NODE",
        message: `Initial node "${graph.initial}" is not declared in graph nodes list`,
        nodeId: graph.initial,
      });
    }

    // 4. Verify all next targets reference valid node IDs or "done"
    for (const node of graph.nodes) {
      if (node.next) {
        if (node.next !== "done" && !nodeIds.has(node.next)) {
          issues.push({
            type: "error",
            code: "INVALID_NEXT_TARGET",
            message: `Node "${node.id}" has next target "${node.next}" which does not exist in graph nodes list (must be a valid node ID or "done")`,
            nodeId: node.id,
          });
        }
      }
    }

    // 5. Verify node YAML files and schema
    const nodesDir = path.join(targetWfDir, "nodes");
    for (const node of graph.nodes) {
      let resolvedNodeFile: string | null = null;
      for (const candidate of [`${node.id}.node.yaml`, `${node.id}.node.yml`]) {
        const p = path.join(nodesDir, candidate);
        try {
          await fs.access(p);
          resolvedNodeFile = p;
          break;
        } catch {
          // continue
        }
      }

      if (!resolvedNodeFile) {
        issues.push({
          type: "error",
          code: "MISSING_NODE_FILE",
          message: `Missing node definition file for node "${node.id}" (expected nodes/${node.id}.node.yaml)`,
          nodeId: node.id,
        });
        continue;
      }

      try {
        const content = await fs.readFile(resolvedNodeFile, "utf-8");
        const raw = yaml.parse(content);
        const nodeDef = NodeDefSchema.parse(raw);

        if (nodeDef.id !== node.id) {
          issues.push({
            type: "warning",
            code: "NODE_ID_MISMATCH",
            message: `Node file "${path.basename(resolvedNodeFile)}" specifies id "${nodeDef.id}" which does not match graph node id "${node.id}"`,
            nodeId: node.id,
          });
        }

        if (nodeDef.on_fail) {
          const match = nodeDef.on_fail.match(/route\(([^)]+)\)/);
          if (match) {
            const routeTarget = match[1].trim();
            if (routeTarget !== "done" && !nodeIds.has(routeTarget)) {
              issues.push({
                type: "warning",
                code: "INVALID_ON_FAIL_ROUTE",
                message: `Node "${node.id}" has on_fail route target "${routeTarget}" which is not defined in graph nodes`,
                nodeId: node.id,
              });
            }
          }
        }

        if (nodeDef.subagent?.agent) {
          const agentPath = path.join(
            this.projectRoot,
            ".opencode",
            "agents",
            `${nodeDef.subagent.agent}.md`,
          );
          try {
            await fs.access(agentPath);
          } catch {
            // Check if .opencode/agents/ directory exists before warning
            try {
              await fs.access(
                path.join(this.projectRoot, ".opencode", "agents"),
              );
              issues.push({
                type: "warning",
                code: "MISSING_AGENT_FILE",
                message: `Node "${node.id}" specifies subagent "${nodeDef.subagent.agent}", but .opencode/agents/${nodeDef.subagent.agent}.md does not exist`,
                nodeId: node.id,
              });
            } catch {
              // ignore if .opencode/agents directory does not exist
            }
          }
        }
      } catch (err: unknown) {
        issues.push({
          type: "error",
          code: "INVALID_NODE_SCHEMA",
          message: `Invalid schema in node file "${path.basename(resolvedNodeFile)}": ${err instanceof Error ? err.message : String(err)}`,
          nodeId: node.id,
        });
      }
    }

    // 6. Reachability and Terminal Path Analysis
    if (nodeIds.has(graph.initial)) {
      const reachable = new Set<string>();
      const queue = [graph.initial];
      let reachesDone = false;

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (reachable.has(current)) continue;
        reachable.add(current);

        const nodeObj = graph.nodes.find((n) => n.id === current);
        if (nodeObj && nodeObj.next) {
          if (nodeObj.next === "done") {
            reachesDone = true;
          } else if (
            !reachable.has(nodeObj.next) &&
            nodeIds.has(nodeObj.next)
          ) {
            queue.push(nodeObj.next);
          }
        }
      }

      for (const id of nodeIds) {
        if (!reachable.has(id)) {
          issues.push({
            type: "warning",
            code: "UNREACHABLE_NODE",
            message: `Node "${id}" is unreachable from initial node "${graph.initial}"`,
            nodeId: id,
          });
        }
      }

      if (!reachesDone) {
        issues.push({
          type: "warning",
          code: "TERMINAL_UNREACHABLE",
          message: `Workflow has no forward path from initial node "${graph.initial}" to terminal node "done"`,
        });
      }
    }

    const errors = issues.filter((i) => i.type === "error").length;
    const warnings = issues.filter((i) => i.type === "warning").length;

    return {
      workflow: targetName,
      valid: errors === 0,
      graphPath: path
        .relative(this.projectRoot, resolvedGraphPath)
        .replace(/\\/g, "/"),
      issues,
      summary: {
        errors,
        warnings,
        nodeCount: graph.nodes.length,
      },
    };
  }

  /**
   * Scaffold a new workflow under .crewmate/workflows/<name>/
   */
  public async createWorkflow(
    workflowName: string,
    options: WorkflowCreateOptions = {},
  ): Promise<WorkflowCreateResult> {
    if (!workflowName || !workflowName.trim()) {
      throw new Error("Workflow name cannot be empty.");
    }
    const cleanWfName = workflowName.trim();
    if (
      !/^[a-zA-Z0-9_\-\.]+$/.test(cleanWfName) ||
      cleanWfName === "." ||
      cleanWfName === ".."
    ) {
      throw new Error(
        `Invalid workflow name "${cleanWfName}". Use alphanumeric characters, dashes, and underscores.`,
      );
    }

    const targetDir = this.p(".crewmate", "workflows", cleanWfName);
    let dirExists = false;
    try {
      await fs.access(targetDir);
      dirExists = true;
    } catch {
      dirExists = false;
    }

    if (dirExists && !options.force) {
      throw new Error(
        `Workflow "${cleanWfName}" already exists at .crewmate/workflows/${cleanWfName}. Use --force to overwrite.`,
      );
    }

    let nodeList = (options.nodes || [])
      .flatMap((n) => n.split(","))
      .map((n) => n.trim())
      .filter(Boolean);

    if (nodeList.length === 0) {
      nodeList = ["start"];
    }

    const displayName =
      options.displayName ||
      cleanWfName
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

    const graphNodes = nodeList.map((nodeId, idx) => ({
      id: nodeId,
      next: idx < nodeList.length - 1 ? nodeList[idx + 1] : "done",
    }));

    const graphContent = yaml.stringify({
      version: "1.0.0",
      name: displayName,
      initial: nodeList[0],
      nodes: graphNodes,
    });

    const filesCreated: string[] = [];
    await fs.mkdir(path.join(targetDir, "nodes"), { recursive: true });

    const graphFilePath = path.join(targetDir, "graph.yaml");
    await fs.writeFile(graphFilePath, graphContent, "utf-8");
    filesCreated.push(
      path.relative(this.projectRoot, graphFilePath).replace(/\\/g, "/"),
    );

    for (const nodeId of nodeList) {
      let role = "builder";
      let scope = "implementation";
      let agent = "builder";
      const lower = nodeId.toLowerCase();
      if (
        lower.includes("scout") ||
        lower.includes("triage") ||
        lower.includes("inspect") ||
        lower.includes("audit") ||
        lower.includes("explore")
      ) {
        role = "scout";
        scope = "read-only";
        agent = "scout";
      } else if (
        lower.includes("plan") ||
        lower.includes("design") ||
        lower.includes("architect")
      ) {
        role = "planner";
        scope = "contracts-write";
        agent = "planner";
      } else if (
        lower.includes("contract") ||
        lower.includes("reconcile") ||
        lower.includes("sync")
      ) {
        role = "contractor";
        scope = "contracts-write";
        agent = "contractor";
      } else if (
        lower.includes("verify") ||
        lower.includes("test") ||
        lower.includes("check") ||
        lower.includes("lint")
      ) {
        role = "verifier";
        scope = "read-only";
        agent = "verifier";
      }

      const nodeContent = yaml.stringify({
        id: nodeId,
        instructions: `Execute ${nodeId} phase according to workflow objectives.\n`,
        inputs: [],
        subagent: {
          role,
          agent,
          scope,
        },
        guardrails: {
          pre: [],
          post: [],
        },
        on_fail: `route(${nodeId})`,
        on_fail_max_retries: 2,
        escalate_after_max_retries: "human",
      });

      const nodeFilePath = path.join(targetDir, "nodes", `${nodeId}.node.yaml`);
      await fs.writeFile(nodeFilePath, nodeContent, "utf-8");
      filesCreated.push(
        path.relative(this.projectRoot, nodeFilePath).replace(/\\/g, "/"),
      );
    }

    const validation = await this.validateWorkflow(cleanWfName);

    return {
      created: true,
      workflow: cleanWfName,
      workflowDir: targetDir,
      filesCreated,
      validation,
    };
  }

  /**
   * Run or switch to a named workflow (e.g. crewmate workflow run <name>)
   */
  public async runWorkflow(
    workflowName: string,
    options: { force?: boolean } = {},
  ): Promise<WorkflowRunResult> {
    const workflowsDir = this.p(".crewmate", "workflows");
    const targetWfDir = path.join(workflowsDir, workflowName);

    // 1. Verify workflow exists
    let resolvedGraphPath: string | null = null;
    for (const candidate of ["graph.yaml", "graph.yml"]) {
      const p = path.join(targetWfDir, candidate);
      try {
        await fs.access(p);
        resolvedGraphPath = p;
        break;
      } catch {
        // continue
      }
    }

    if (!resolvedGraphPath) {
      throw new Error(
        `Workflow "${workflowName}" not found in .crewmate/workflows/${workflowName}/ (missing graph.yaml)`,
      );
    }

    const targetGraph = await this.readYaml(resolvedGraphPath, GraphSchema);

    // 2. Idle safety check: harness liveness
    const liveness = await this.getHarnessLiveness();
    if (liveness.status === "running" && !options.force) {
      throw new Error(
        `Cannot switch or run workflow while harness is actively RUNNING (session: ${liveness.session?.id || "active"}). Wait for idle or pass --force.`,
      );
    }

    // 3. Idle safety check: task locks
    const locks = await this.getTaskLocks();
    if (locks.locks.length > 0 && !options.force) {
      throw new Error(
        `Cannot switch or run workflow while tasks are actively locked (${locks.locks.length} active locks). Complete active tasks or pass --force.`,
      );
    }

    // 4. If forced, reconcile stale activities
    if (options.force) {
      await this.reconcileStaleActivities("workflow run switch");
    }

    // 5. Finalize previous run report if state exists
    const currentState = await this.stateManager.getState();
    let previousRunReport: WorkflowRunReport | null = null;
    if (currentState.history && currentState.history.length > 0) {
      const prevStatus =
        currentState.status === "completed" ? "completed" : "superseded";
      previousRunReport = await this.generateCurrentRunReport(
        prevStatus,
        `Superseded by workflow run "${workflowName}"`,
      );

      // Auto-archive previous run
      if (previousRunReport) {
        try {
          await this.archiveManager.archiveRun({
            runId: previousRunReport.runId,
            workflow: previousRunReport.workflow,
            status: previousRunReport.status,
            report: previousRunReport,
            pruneActiveState: false,
          });
        } catch (err) {
          console.warn(
            `[Crewmate Engine] Failed to auto-archive run ${previousRunReport.runId}: ${err}`,
          );
        }
      }
    }

    // 6. Generate run ID & log RUN_START event
    const timestamp = new Date().toISOString();
    const cleanTime = timestamp.replace(/[-:T.Z]/g, "").slice(0, 14);
    const runId = `run_${cleanTime}_${workflowName}`;

    await this.stateManager.appendEvent({
      timestamp,
      event: "RUN_START",
      runId,
      workflow: workflowName,
      initialNode: targetGraph.initial,
    });

    const newState = await this.stateManager.getState();
    return {
      runId,
      workflow: workflowName,
      initialNode: targetGraph.initial,
      state: newState,
      previousRunReport,
    };
  }

  /**
   * Reset the current workflow run
   */
  public async resetWorkflow(
    options: { reason?: string; node?: string; force?: boolean } = {},
  ): Promise<WorkflowResetResult> {
    // 1. Idle safety check: harness liveness
    const liveness = await this.getHarnessLiveness();
    if (liveness.status === "running" && !options.force) {
      throw new Error(
        `Cannot reset workflow while harness is actively RUNNING (session: ${liveness.session?.id || "active"}). Wait for idle or pass --force.`,
      );
    }

    // 2. Idle safety check: task locks
    const locks = await this.getTaskLocks();
    if (locks.locks.length > 0 && !options.force) {
      throw new Error(
        `Cannot reset workflow while tasks are actively locked (${locks.locks.length} active locks). Complete active tasks or pass --force.`,
      );
    }

    // 3. If forced, reconcile stale activities
    if (options.force) {
      await this.reconcileStaleActivities("workflow reset");
    }

    // 4. Finalize previous run report if state exists
    const currentState = await this.stateManager.getState();
    let previousRunReport: WorkflowRunReport | null = null;
    if (currentState.history && currentState.history.length > 0) {
      previousRunReport = await this.generateCurrentRunReport(
        "reset",
        options.reason || "Workflow reset",
      );
    }

    // 5. Determine target node
    const graph = await this.getGraph();
    let targetNode = graph.initial;
    if (options.node) {
      if (options.node !== "done") {
        await this.getNodeDef(options.node);
      }
      targetNode = options.node;
    }

    // 6. Generate run ID & log RESET event
    const timestamp = new Date().toISOString();
    const cleanTime = timestamp.replace(/[-:T.Z]/g, "").slice(0, 14);
    const currentWf = currentState.activeWorkflow || "feature-pipeline";
    const runId = `run_${cleanTime}_${currentWf}`;

    await this.stateManager.appendEvent({
      timestamp,
      event: "RESET",
      runId,
      node: targetNode,
      reason: options.reason || "workflow reset",
    });

    const newState = await this.stateManager.getState();
    return {
      runId,
      workflow: currentWf,
      node: targetNode,
      reason: options.reason,
      state: newState,
      previousRunReport,
    };
  }

  /**
   * Generate report for current run
   */
  public async generateCurrentRunReport(
    status: "completed" | "reset" | "superseded" | "failed" | "active",
    reason?: string,
  ): Promise<WorkflowRunReport | null> {
    const state = await this.stateManager.getState();
    if (!state.history || state.history.length === 0) {
      return null;
    }

    // Find the boundary of the current run: search backward for the most recent RUN_START or INIT event
    let runStartIndex = 0;
    for (let i = state.history.length - 1; i >= 0; i--) {
      const ev = state.history[i];
      if (
        ev.event === "RUN_START" ||
        ev.event === "INIT" ||
        ev.event === "RESET"
      ) {
        runStartIndex = i;
        break;
      }
    }

    const runEvents = state.history.slice(runStartIndex);
    const startedAt = runEvents[0].timestamp;
    const workflow = state.activeWorkflow || "feature-pipeline";
    const runId =
      state.currentRunId ||
      `run_${startedAt.replace(/[-:T.Z]/g, "").slice(0, 14)}_${workflow}`;

    let activities: ActivityRecord[] = [];
    try {
      const allActivities = await this.activityManager.getActivities();
      activities = allActivities.filter(
        (a: ActivityRecord) => a.startAt >= startedAt,
      );
    } catch {
      // ignore
    }

    let tasks: TaskDefinition[] = [];
    try {
      const allTasks = await this.taskManager.listTasks();
      tasks = allTasks.filter(
        (t: TaskDefinition) => !t.created_at || t.created_at >= startedAt,
      );
    } catch {
      // ignore
    }

    return this.reportManager.generateReport({
      runId,
      workflow,
      status,
      reason,
      events: runEvents,
      activities,
      tasks,
    });
  }

  public async getReport(runId?: string): Promise<WorkflowRunReport | null> {
    return this.reportManager.getReport(runId);
  }

  public async listReports(): Promise<ReportSummaryItem[]> {
    return this.reportManager.listReports();
  }

  /**
   * Archive a workflow run (default: current run)
   */
  public async archiveRun(runId?: string): Promise<ArchiveManifest> {
    const currentState = await this.stateManager.getState();
    const targetRunId = runId || currentState.currentRunId;

    if (!targetRunId) {
      throw new Error("No active or specified runId to archive.");
    }

    // Try to get report if exists
    let report: WorkflowRunReport | undefined;
    try {
      report = (await this.reportManager.getReport(targetRunId)) || undefined;
    } catch {
      // optional
    }

    if (!report && currentState.currentRunId === targetRunId) {
      const mappedStatus =
        currentState.status === "escalated" ? "failed" : currentState.status;
      const generated = await this.generateCurrentRunReport(
        mappedStatus,
        "Manual archive",
      );
      if (generated) {
        report = generated;
      }
    }

    const finalStatus =
      currentState.status === "escalated" ? "failed" : currentState.status;

    return await this.archiveManager.archiveRun({
      runId: targetRunId,
      workflow: currentState.activeWorkflow || "feature-pipeline",
      status: finalStatus,
      report,
      pruneActiveState: false,
    });
  }

  /**
   * List all archived runs
   */
  public async listArchives(): Promise<ArchiveManifest[]> {
    return await this.archiveManager.listArchives();
  }
}
