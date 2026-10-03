#![allow(dead_code)]

use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "event")]
pub enum RawActivityEvent {
    #[serde(rename = "start")]
    Start {
        id: String,
        agent: String,
        label: String,
        #[serde(default)]
        node: Option<String>,
        #[serde(default)]
        parent: Option<String>,
        at: String,
    },
    #[serde(rename = "end")]
    End {
        id: String,
        #[serde(default)]
        agent: Option<String>,
        #[serde(default = "default_completed")]
        status: String,
        at: String,
    },
}

fn default_completed() -> String {
    "completed".to_string()
}

#[derive(Debug, Clone)]
pub struct ActivityItem {
    pub id: String,
    pub agent: String,
    pub label: String,
    pub node: Option<String>,
    pub parent: Option<String>,
    pub start_at: String,
    pub end_at: Option<String>,
    pub status: String, // "active", "completed", "failed", "interrupted"
    pub is_unclosed: bool,
    pub depth: usize,
}

#[derive(Debug, Clone)]
pub struct FormattedRecentEvent {
    pub timestamp_str: String,
    pub full_timestamp: String,
    pub short_id: String,
    pub full_id: String,
    pub event_type: String, // "START", "END:completed", "END:failed", etc.
    pub agent: String,
    pub label: String,
    pub node: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ActivitySnapshot {
    pub active_tree: Vec<ActivityItem>,
    pub recent_events: Vec<FormattedRecentEvent>,
}

impl ActivitySnapshot {
    pub fn load_from_root(project_root: &Path) -> Self {
        let act_path = project_root.join(".crewmate").join("activity.jsonl");
        if !act_path.exists() {
            return Self::default();
        }

        let content = match fs::read_to_string(&act_path) {
            Ok(c) => c,
            Err(_) => return Self::default(),
        };

        let mut items_map: HashMap<String, ActivityItem> = HashMap::new();
        let mut order: Vec<String> = Vec::new();
        let mut raw_events: Vec<RawActivityEvent> = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            if let Ok(event) = serde_json::from_str::<RawActivityEvent>(line) {
                match &event {
                    RawActivityEvent::Start {
                        id,
                        agent,
                        label,
                        node,
                        parent,
                        at,
                    } => {
                        let item = ActivityItem {
                            id: id.clone(),
                            agent: agent.clone(),
                            label: label.clone(),
                            node: node.clone(),
                            parent: parent.clone(),
                            start_at: at.clone(),
                            end_at: None,
                            status: "active".to_string(),
                            is_unclosed: true,
                            depth: 0,
                        };
                        items_map.insert(id.clone(), item);
                        if !order.contains(id) {
                            order.push(id.clone());
                        }
                    }
                    RawActivityEvent::End { id, status, at, .. } => {
                        if let Some(item) = items_map.get_mut(id) {
                            item.end_at = Some(at.clone());
                            item.status = status.clone();
                            item.is_unclosed = false;
                        }
                    }
                }
                raw_events.push(event);
            }
        }

        // Build active items tree
        // 1. Filter only unclosed activities
        let unclosed_ids: std::collections::HashSet<String> = items_map
            .values()
            .filter(|i| i.is_unclosed)
            .map(|i| i.id.clone())
            .collect();

        // 2. Identify parent-child hierarchy among unclosed activities
        let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
        let mut roots: Vec<String> = Vec::new();

        for id in &order {
            if let Some(item) = items_map.get(id) {
                if item.is_unclosed {
                    if let Some(ref p) = item.parent {
                        if unclosed_ids.contains(p) {
                            children_map.entry(p.clone()).or_default().push(id.clone());
                        } else {
                            roots.push(id.clone());
                        }
                    } else {
                        roots.push(id.clone());
                    }
                }
            }
        }

        // Roots most recent first
        roots.reverse();

        // Flatten tree with depth
        let mut active_tree: Vec<ActivityItem> = Vec::new();

        fn append_tree(
            id: &str,
            depth: usize,
            items_map: &HashMap<String, ActivityItem>,
            children_map: &HashMap<String, Vec<String>>,
            active_tree: &mut Vec<ActivityItem>,
        ) {
            if let Some(item) = items_map.get(id) {
                let mut row = item.clone();
                row.depth = depth;
                active_tree.push(row);

                if let Some(children) = children_map.get(id) {
                    for child_id in children {
                        append_tree(child_id, depth + 1, items_map, children_map, active_tree);
                    }
                }
            }
        }

        for root_id in roots {
            append_tree(&root_id, 0, &items_map, &children_map, &mut active_tree);
        }

        // Format recent events list (tail, newest at top)
        let mut formatted_events: Vec<FormattedRecentEvent> = Vec::new();

        for ev in raw_events.iter() {
            match ev {
                RawActivityEvent::Start {
                    id,
                    agent,
                    label,
                    node,
                    at,
                    ..
                } => {
                    formatted_events.push(FormattedRecentEvent {
                        timestamp_str: format_time(at),
                        full_timestamp: at.clone(),
                        short_id: format_short_id(id),
                        full_id: id.clone(),
                        event_type: "START".to_string(),
                        agent: agent.clone(),
                        label: label.clone(),
                        node: node.clone(),
                    });
                }
                RawActivityEvent::End {
                    id,
                    agent,
                    status,
                    at,
                } => {
                    let agent_name = agent.clone().unwrap_or_else(|| {
                        items_map
                            .get(id)
                            .map(|i| i.agent.clone())
                            .unwrap_or_else(|| "-".to_string())
                    });
                    let label_text = items_map
                        .get(id)
                        .map(|i| i.label.clone())
                        .unwrap_or_default();
                    let node_name = items_map.get(id).and_then(|i| i.node.clone());

                    formatted_events.push(FormattedRecentEvent {
                        timestamp_str: format_time(at),
                        full_timestamp: at.clone(),
                        short_id: format_short_id(id),
                        full_id: id.clone(),
                        event_type: format!("END:{}", status),
                        agent: agent_name,
                        label: label_text,
                        node: node_name,
                    });
                }
            }
        }

        // Also ingest events from tasks.jsonl into Recent Events
        let task_log_path = project_root.join(".crewmate").join("tasks.jsonl");
        if let Ok(task_content) = fs::read_to_string(&task_log_path) {
            for line in task_content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    let ev_type = val.get("event").and_then(|v| v.as_str()).unwrap_or("event");
                    let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("-");
                    let at = val.get("at").and_then(|v| v.as_str()).unwrap_or("");
                    let label = if let Some(r) = val.get("reason").and_then(|v| v.as_str()) {
                        r.to_string()
                    } else if let Some(f) = val.get("file").and_then(|v| v.as_str()) {
                        format!("file: {}", f)
                    } else if let Some(g) = val.get("goal").and_then(|v| v.as_str()) {
                        g.to_string()
                    } else {
                        format!("Task {}", ev_type)
                    };
                    let agent = val.get("agent").and_then(|v| v.as_str()).unwrap_or("task");
                    let formatted_type = match ev_type {
                        "create" => "TASK:create".to_string(),
                        "start" => "TASK:start".to_string(),
                        "complete" => "TASK:done".to_string(),
                        "block" => "TASK:block".to_string(),
                        "scope_conflict" => "TASK:conflict".to_string(),
                        "scope_amend" => "TASK:amend".to_string(),
                        other => format!("TASK:{}", other),
                    };

                    formatted_events.push(FormattedRecentEvent {
                        timestamp_str: format_time(at),
                        full_timestamp: at.to_string(),
                        short_id: format_short_id(id),
                        full_id: id.to_string(),
                        event_type: formatted_type,
                        agent: agent.to_string(),
                        label,
                        node: None,
                    });
                }
            }
        }

        // Also ingest events from state.jsonl into Recent Events
        let state_log_path = project_root.join(".crewmate").join("state.jsonl");
        if let Ok(state_content) = fs::read_to_string(&state_log_path) {
            for line in state_content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    let ev_type = val.get("event").and_then(|v| v.as_str()).unwrap_or("");
                    let ts = val.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
                    if ts.is_empty() || ev_type.is_empty() {
                        continue;
                    }

                    let (formatted_type, label, node) = match ev_type {
                        "INIT" => (
                            "INIT".to_string(),
                            format!(
                                "Initial node: {}",
                                val.get("initialNode")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("-")
                            ),
                            val.get("initialNode")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        ),
                        "RUN_START" => (
                            "RUN_START".to_string(),
                            format!(
                                "Workflow: {}",
                                val.get("workflow").and_then(|v| v.as_str()).unwrap_or("-")
                            ),
                            val.get("initialNode")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        ),
                        "NODE_TRANSITION" => {
                            let from = val.get("from").and_then(|v| v.as_str()).unwrap_or("-");
                            let to = val.get("to").and_then(|v| v.as_str()).unwrap_or("-");
                            (
                                "TRANSITION".to_string(),
                                format!("{} -> {}", from, to),
                                Some(to.to_string()),
                            )
                        }
                        "GATE_CHECK" => {
                            let gate = val.get("gate").and_then(|v| v.as_str()).unwrap_or("gate");
                            let status = val.get("status").and_then(|v| v.as_str()).unwrap_or("-");
                            let phase = val.get("phase").and_then(|v| v.as_str()).unwrap_or("-");
                            let node = val
                                .get("node")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            (
                                "GATE".to_string(),
                                format!("{}: {} ({})", gate, status, phase),
                                node,
                            )
                        }
                        "RETRY_INCREMENT" => {
                            let r = val.get("retryCount").and_then(|v| v.as_u64()).unwrap_or(0);
                            let max = val.get("maxRetries").and_then(|v| v.as_u64()).unwrap_or(0);
                            let node = val
                                .get("node")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            ("RETRY".to_string(), format!("Retry {}/{}", r, max), node)
                        }
                        "ESCALATE" => {
                            let target = val
                                .get("target")
                                .and_then(|v| v.as_str())
                                .unwrap_or("human");
                            let reason = val.get("reason").and_then(|v| v.as_str()).unwrap_or("");
                            let node = val
                                .get("node")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            (
                                "ESCALATE".to_string(),
                                format!("to {}: {}", target, reason),
                                node,
                            )
                        }
                        "COMPLETE" => {
                            let node = val
                                .get("node")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            (
                                "COMPLETE".to_string(),
                                "Workflow completed".to_string(),
                                node,
                            )
                        }
                        "RESET" => {
                            let node = val
                                .get("node")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            ("RESET".to_string(), "Workflow reset".to_string(), node)
                        }
                        other => (other.to_string(), "".to_string(), None),
                    };

                    let event_id = val.get("id").and_then(|v| v.as_str());
                    let (short_id, full_id) = match event_id {
                        Some(id) if !id.is_empty() => (format_short_id(id), id.to_string()),
                        _ => ("-".to_string(), "-".to_string()),
                    };

                    formatted_events.push(FormattedRecentEvent {
                        timestamp_str: format_time(ts),
                        full_timestamp: ts.to_string(),
                        short_id,
                        full_id,
                        event_type: formatted_type,
                        agent: "engine".to_string(),
                        label,
                        node,
                    });
                }
            }
        }

        // Sort descending by timestamp (newest events first)
        formatted_events.sort_by(|a, b| b.full_timestamp.cmp(&a.full_timestamp));

        ActivitySnapshot {
            active_tree,
            recent_events: formatted_events,
        }
    }
}

pub fn format_short_id(id: &str) -> String {
    if id.len() > 10 {
        format!("{}…", &id[..9])
    } else {
        id.to_string()
    }
}

pub fn format_time(iso: &str) -> String {
    if let Ok(dt) = DateTime::parse_from_rfc3339(iso) {
        dt.with_timezone(&chrono::Local)
            .format("%H:%M:%S")
            .to_string()
    } else if iso.len() >= 19 && iso.contains('T') {
        let time_part = iso.split('T').nth(1).unwrap_or("");
        time_part.chars().take(8).collect()
    } else {
        iso.chars().take(8).collect()
    }
}

pub fn format_local_datetime(iso: &str) -> String {
    if let Ok(dt) = DateTime::parse_from_rfc3339(iso) {
        dt.with_timezone(&chrono::Local)
            .format("%Y-%m-%d %H:%M:%S (%:z)")
            .to_string()
    } else {
        iso.to_string()
    }
}

pub fn format_elapsed(start_iso: &str) -> String {
    if let Ok(start) = DateTime::parse_from_rfc3339(start_iso) {
        let now = Utc::now();
        let diff = now.signed_duration_since(start.with_timezone(&Utc));
        let secs = diff.num_seconds().max(0);
        if secs < 60 {
            format!("{}s", secs)
        } else if secs < 3600 {
            let m = secs / 60;
            let s = secs % 60;
            format!("{}m {}s", m, s)
        } else {
            let h = secs / 3600;
            let m = (secs % 3600) / 60;
            format!("{}h {}m", h, m)
        }
    } else {
        "-".to_string()
    }
}
