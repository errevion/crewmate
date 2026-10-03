#![allow(dead_code)]

use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub next: Option<String>,
    #[serde(default)]
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GraphDef {
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub name: Option<String>,
    pub initial: String,
    pub nodes: Vec<GraphNode>,
}

fn default_version() -> String {
    "1.0.0".to_string()
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct NodeDef {
    pub id: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub on_fail: Option<String>,
    #[serde(default = "default_max_retries")]
    pub on_fail_max_retries: usize,
    #[serde(default = "default_escalate")]
    pub escalate_after_max_retries: String,
}

fn default_max_retries() -> usize {
    2
}

fn default_escalate() -> String {
    "human".to_string()
}

#[derive(Debug, Clone)]
pub struct WorkflowModel {
    pub name: String,
    pub initial_node: String,
    pub nodes_in_order: Vec<String>,
    pub node_edges: Vec<(String, String)>,
    pub node_defs: HashMap<String, NodeDef>,
}

impl WorkflowModel {
    pub fn load_from_root(project_root: &Path, active_workflow: Option<&str>) -> Result<Self, String> {
        let wf_name = active_workflow.unwrap_or("feature-pipeline");

        let graph_candidates = [
            format!(".crewmate/workflows/{}/graph.yaml", wf_name),
            format!(".crewmate/workflows/{}/graph.yml", wf_name),
            ".crewmate/workflows/feature-pipeline/graph.yaml".to_string(),
            ".crewmate/workflows/feature-pipeline/graph.yml".to_string(),
            ".crewmate/workflows/default/graph.yaml".to_string(),
            ".crewmate/workflows/default/graph.yml".to_string(),
            ".crewmate/workflow/graph.yaml".to_string(),
            ".crewmate/workflow/graph.yml".to_string(),
            "workflow/graph.yaml".to_string(),
            "graph.yaml".to_string(),
            "workflow/graph.yml".to_string(),
            "graph.yml".to_string(),
        ];
        let graph_candidate_refs: Vec<&str> = graph_candidates.iter().map(|s| s.as_str()).collect();

        let graph_path = find_file(project_root, &graph_candidate_refs)
            .ok_or_else(|| "Could not find graph.yaml in .crewmate/workflows/ or workflow/".to_string())?;

        let graph_content = fs::read_to_string(&graph_path)
            .map_err(|e| format!("Failed to read {}: {}", graph_path.display(), e))?;

        let graph_def: GraphDef = serde_yaml::from_str(&graph_content)
            .map_err(|e| format!("Failed to parse {}: {}", graph_path.display(), e))?;

        let mut next_map: HashMap<String, String> = HashMap::new();
        let mut all_node_ids = Vec::new();

        for n in &graph_def.nodes {
            all_node_ids.push(n.id.clone());
            if let Some(ref next) = n.next {
                next_map.insert(n.id.clone(), next.clone());
            }
        }

        // Compute topological left-to-right order starting from graph_def.initial
        let mut nodes_in_order = Vec::new();
        let mut curr = Some(graph_def.initial.clone());
        let mut visited = std::collections::HashSet::new();

        while let Some(node_id) = curr {
            if node_id == "done" || visited.contains(&node_id) {
                break;
            }
            visited.insert(node_id.clone());
            nodes_in_order.push(node_id.clone());
            curr = next_map.get(&node_id).cloned();
        }

        // Add any remaining declared nodes that weren't reached via linear traverse
        for node_id in &all_node_ids {
            if !visited.contains(node_id) && node_id != "done" {
                nodes_in_order.push(node_id.clone());
                visited.insert(node_id.clone());
            }
        }

        // Compute edges
        let mut node_edges = Vec::new();
        for node_id in &nodes_in_order {
            if let Some(next) = next_map.get(node_id) {
                node_edges.push((node_id.clone(), next.clone()));
            }
        }

        // Load node definitions if available from separate .node.yaml files
        let mut node_defs = HashMap::new();
        for node_id in &nodes_in_order {
            let def_candidates = [
                format!(".crewmate/workflows/{}/nodes/{}.node.yaml", wf_name, node_id),
                format!(".crewmate/workflows/{}/nodes/{}.node.yml", wf_name, node_id),
                format!(".crewmate/workflows/default/nodes/{}.node.yaml", node_id),
                format!(".crewmate/workflows/default/nodes/{}.node.yml", node_id),
                format!(".crewmate/workflow/nodes/{}.node.yaml", node_id),
                format!(".crewmate/workflow/nodes/{}.node.yml", node_id),
                format!("workflow/nodes/{}.node.yaml", node_id),
                format!("workflow/nodes/{}.node.yml", node_id),
                format!("nodes/{}.node.yaml", node_id),
                format!("nodes/{}.node.yml", node_id),
            ];
            let cand_refs: Vec<&str> = def_candidates.iter().map(|s| s.as_str()).collect();
            if let Some(def_path) = find_file(project_root, &cand_refs) {
                if let Ok(content) = fs::read_to_string(&def_path) {
                    if let Ok(def) = serde_yaml::from_str::<NodeDef>(&content) {
                        node_defs.insert(node_id.clone(), def);
                    }
                }
            }
        }

        // Also merge instructions defined inline on GraphNode
        for n in &graph_def.nodes {
            if let Some(ref instr) = n.instructions {
                let entry = node_defs.entry(n.id.clone()).or_insert_with(|| NodeDef {
                    id: n.id.clone(),
                    ..Default::default()
                });
                if entry.instructions.is_empty() {
                    entry.instructions = instr.clone();
                }
            }
        }

        let name = graph_def.name.clone().unwrap_or_else(|| {
            project_root
                .file_name()
                .and_then(|n| n.to_str())
                .filter(|s| !s.is_empty() && *s != ".")
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Workflow".to_string())
        });

        Ok(WorkflowModel {
            name,
            initial_node: graph_def.initial,
            nodes_in_order,
            node_edges,
            node_defs,
        })
    }
}

fn find_file(root: &Path, relative_paths: &[&str]) -> Option<PathBuf> {
    for rel in relative_paths {
        let candidate = root.join(rel);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
