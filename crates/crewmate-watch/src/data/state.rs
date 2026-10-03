#![allow(dead_code)]

use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "event")]
pub enum StateEvent {
    #[serde(rename = "INIT")]
    Init {
        #[serde(default)]
        id: Option<String>,
        timestamp: String,
        #[serde(rename = "initialNode")]
        initial_node: String,
        #[serde(default)]
        workflow: Option<String>,
    },
    #[serde(rename = "NODE_TRANSITION")]
    NodeTransition {
        #[serde(default)]
        id: Option<String>,
        timestamp: String,
        from: String,
        to: String,
        #[serde(default)]
        reason: String,
    },
    #[serde(rename = "GATE_CHECK")]
    GateCheck {
        #[serde(default)]
        id: Option<String>,
        timestamp: String,
        node: String,
        phase: String,
        gate: String,
        status: String,
    },
    #[serde(rename = "RETRY_INCREMENT")]
    RetryIncrement {
        #[serde(default)]
        id: Option<String>,
        timestamp: String,
        node: String,
        #[serde(rename = "retryCount")]
        retry_count: usize,
        #[serde(rename = "maxRetries")]
        max_retries: usize,
    },
    #[serde(rename = "ESCALATE")]
    Escalate {
        #[serde(default)]
        id: Option<String>,
        timestamp: String,
        node: String,
        target: String,
        reason: String,
    },
    #[serde(rename = "OVERRIDE")]
    Override {
        #[serde(default)]
        id: Option<String>,
        timestamp: String,
        from: String,
        to: String,
        #[serde(default)]
        reason: Option<String>,
    },
    #[serde(rename = "COMPLETE")]
    Complete {
        #[serde(default)]
        id: Option<String>,
        timestamp: String,
        node: String,
    },
    #[serde(rename = "RUN_START")]
    RunStart {
        #[serde(default)]
        id: Option<String>,
        timestamp: String,
        #[serde(rename = "initialNode")]
        initial_node: String,
        workflow: String,
        #[serde(rename = "runId")]
        run_id: String,
    },
    #[serde(rename = "RESET")]
    Reset {
        #[serde(default)]
        id: Option<String>,
        timestamp: String,
        node: String,
        #[serde(default)]
        reason: Option<String>,
        #[serde(default, rename = "runId")]
        run_id: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

impl StateEvent {
    pub fn id(&self) -> Option<&str> {
        match self {
            StateEvent::Init { id, .. }
            | StateEvent::NodeTransition { id, .. }
            | StateEvent::GateCheck { id, .. }
            | StateEvent::RetryIncrement { id, .. }
            | StateEvent::Escalate { id, .. }
            | StateEvent::Override { id, .. }
            | StateEvent::Complete { id, .. }
            | StateEvent::RunStart { id, .. }
            | StateEvent::Reset { id, .. } => id.as_deref(),
            StateEvent::Unknown => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct EngineStateSnapshot {
    pub current_node: Option<String>,
    pub status: String, // "active", "completed", "escalated", "not initialized"
    pub active_workflow: Option<String>,
    pub current_run_id: Option<String>,
    pub retry_counts: HashMap<String, usize>,
    pub max_retries: HashMap<String, usize>,
    pub escalation_target: Option<String>,
    pub last_timestamp: Option<String>,
}

impl Default for EngineStateSnapshot {
    fn default() -> Self {
        Self {
            current_node: None,
            status: "not initialized".to_string(),
            active_workflow: None,
            current_run_id: None,
            retry_counts: HashMap::new(),
            max_retries: HashMap::new(),
            escalation_target: None,
            last_timestamp: None,
        }
    }
}

impl EngineStateSnapshot {
    pub fn load_from_root(project_root: &Path) -> Self {
        let state_path = project_root.join(".crewmate").join("state.jsonl");
        if !state_path.exists() {
            return Self::default();
        }

        let content = match fs::read_to_string(&state_path) {
            Ok(c) => c,
            Err(_) => return Self::default(),
        };

        let mut snapshot = Self::default();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            if let Ok(event) = serde_json::from_str::<StateEvent>(line) {
                match event {
                    StateEvent::Init {
                        timestamp,
                        initial_node,
                        workflow,
                        ..
                    } => {
                        snapshot.current_node = Some(initial_node);
                        snapshot.status = "active".to_string();
                        if let Some(wf) = workflow {
                            snapshot.active_workflow = Some(wf);
                        } else if snapshot.active_workflow.is_none() {
                            snapshot.active_workflow = Some("feature-pipeline".to_string());
                        }
                        snapshot.last_timestamp = Some(timestamp);
                    }
                    StateEvent::NodeTransition { timestamp, to, .. } => {
                        snapshot.current_node = Some(to);
                        snapshot.status = "active".to_string();
                        snapshot.last_timestamp = Some(timestamp);
                    }
                    StateEvent::GateCheck { timestamp, .. } => {
                        snapshot.last_timestamp = Some(timestamp);
                    }
                    StateEvent::RetryIncrement {
                        timestamp,
                        node,
                        retry_count,
                        max_retries,
                        ..
                    } => {
                        snapshot.retry_counts.insert(node.clone(), retry_count);
                        snapshot.max_retries.insert(node, max_retries);
                        snapshot.last_timestamp = Some(timestamp);
                    }
                    StateEvent::Escalate {
                        timestamp, target, ..
                    } => {
                        snapshot.status = "escalated".to_string();
                        snapshot.escalation_target = Some(target);
                        snapshot.last_timestamp = Some(timestamp);
                    }
                    StateEvent::Override { timestamp, to, .. } => {
                        snapshot.current_node = Some(to);
                        snapshot.status = "active".to_string();
                        snapshot.last_timestamp = Some(timestamp);
                    }
                    StateEvent::Complete {
                        timestamp, node, ..
                    } => {
                        snapshot.current_node = Some(node);
                        snapshot.status = "completed".to_string();
                        snapshot.last_timestamp = Some(timestamp);
                    }
                    StateEvent::RunStart {
                        timestamp,
                        initial_node,
                        workflow,
                        run_id,
                        ..
                    } => {
                        snapshot.current_node = Some(initial_node);
                        snapshot.status = "active".to_string();
                        snapshot.active_workflow = Some(workflow);
                        snapshot.current_run_id = Some(run_id);
                        snapshot.retry_counts.clear();
                        snapshot.escalation_target = None;
                        snapshot.last_timestamp = Some(timestamp);
                    }
                    StateEvent::Reset {
                        timestamp,
                        node,
                        run_id,
                        ..
                    } => {
                        snapshot.current_node = Some(node);
                        snapshot.status = "active".to_string();
                        if let Some(r_id) = run_id {
                            snapshot.current_run_id = Some(r_id);
                        }
                        snapshot.retry_counts.clear();
                        snapshot.escalation_target = None;
                        snapshot.last_timestamp = Some(timestamp);
                    }
                    StateEvent::Unknown => {}
                }
            }
        }

        snapshot
    }

    pub fn current_retry_count(&self) -> usize {
        if let Some(ref node) = self.current_node {
            *self.retry_counts.get(node).unwrap_or(&0)
        } else {
            0
        }
    }

    pub fn current_max_retries(&self) -> usize {
        if let Some(ref node) = self.current_node {
            *self.max_retries.get(node).unwrap_or(&2)
        } else {
            2
        }
    }
}
