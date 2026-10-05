import {
  getTemplatesDir,
  readTemplate,
  readTemplateSync,
  resolveTemplatePath,
} from "./templates.js";

export { getTemplatesDir, readTemplate, readTemplateSync, resolveTemplatePath };

export const DEFAULT_INDEX_YAML = readTemplateSync("contracts/index.yaml");
export const DEFAULT_ARCHITECTURE_YAML = readTemplateSync(
  "contracts/architecture.yaml",
);
export const DEFAULT_STRUCTURE_YAML = readTemplateSync(
  "contracts/structure.yaml",
);
export const DEFAULT_CAPABILITIES_YAML = readTemplateSync(
  "contracts/capabilities.yaml",
);

export const DEFAULT_EXAMPLE_INDEX_YAML = readTemplateSync(
  "contracts/example/index.yaml",
);
export const DEFAULT_EXAMPLE_ARCHITECTURE_YAML = readTemplateSync(
  "contracts/example/architecture.yaml",
);
export const DEFAULT_EXAMPLE_CAPABILITIES_YAML = readTemplateSync(
  "contracts/example/capabilities.yaml",
);
export const DEFAULT_EXAMPLE_CONTRACT_YAML = readTemplateSync(
  "contracts/example/example.contract.yaml",
);

export const DEFAULT_SCHEMA_MD = readTemplateSync("contracts/SCHEMA.md");

export const DEFAULT_GRAPH_YAML = readTemplateSync(
  "workflows/feature-pipeline/graph.yaml",
);
export const DEFAULT_SCOUT_NODE_YAML = readTemplateSync(
  "workflows/feature-pipeline/nodes/scout.node.yaml",
);
export const DEFAULT_CLARIFY_NODE_YAML = readTemplateSync(
  "workflows/feature-pipeline/nodes/clarify.node.yaml",
);
export const DEFAULT_PLAN_NODE_YAML = readTemplateSync(
  "workflows/feature-pipeline/nodes/plan.node.yaml",
);
export const DEFAULT_EXECUTE_NODE_YAML = readTemplateSync(
  "workflows/feature-pipeline/nodes/execute.node.yaml",
);
export const DEFAULT_CONTRACT_NODE_YAML = readTemplateSync(
  "workflows/feature-pipeline/nodes/contract.node.yaml",
);
export const DEFAULT_VERIFY_NODE_YAML = readTemplateSync(
  "workflows/feature-pipeline/nodes/verify.node.yaml",
);

export const SYNC_GRAPH_YAML = readTemplateSync(
  "workflows/contract-sync/graph.yaml",
);
export const SYNC_SCOUT_NODE_YAML = readTemplateSync(
  "workflows/contract-sync/nodes/scout.node.yaml",
);
export const SYNC_CONTRACT_NODE_YAML = readTemplateSync(
  "workflows/contract-sync/nodes/contract.node.yaml",
);

export function generateOpenCodePluginTs(fallbackAdapterUrl?: string): string {
  const fallbackBlock = fallbackAdapterUrl
    ? `  pluginModule = await import(${JSON.stringify(fallbackAdapterUrl)});\n`
    : `  throw err;\n`;

  const template = readTemplateSync("plugins/crewmate.ts.template");
  return template.replace("__FALLBACK_BLOCK__", fallbackBlock);
}

export const DEFAULT_MATTE_AGENT_MD = readTemplateSync("agents/matte.md");
export const DEFAULT_SCOUT_AGENT_MD = readTemplateSync("agents/scout.md");
export const DEFAULT_PLANNER_AGENT_MD = readTemplateSync("agents/planner.md");
export const DEFAULT_BUILDER_AGENT_MD = readTemplateSync("agents/builder.md");
export const DEFAULT_CONTRACTOR_AGENT_MD = readTemplateSync(
  "agents/contractor.md",
);
export const DEFAULT_VERIFIER_AGENT_MD = readTemplateSync("agents/verifier.md");
