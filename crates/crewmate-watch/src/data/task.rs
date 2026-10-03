#![allow(dead_code)]

use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::activity::ActivitySnapshot;
use super::workflow::WorkflowModel;

#[derive(Debug, Clone, Deserialize)]
pub struct TaskAmendment {
    #[serde(rename = "type")]
    pub amendment_type: String,
    pub file: String,
    #[serde(default)]
    pub at: String,
    #[serde(default, rename = "conflictingTaskId")]
    pub conflicting_task_id: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaskDependencyDef {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawTaskYaml {
    pub id: String,
    pub goal: String,
    #[serde(default)]
    pub contract: String,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<TaskDependencyDef>,
    #[serde(default = "default_pending_status")]
    pub status: String,
    #[serde(default)]
    pub amendments: Vec<TaskAmendment>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
}

fn default_pending_status() -> String {
    "pending".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawTaskEvent {
    pub event: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub at: Option<String>,
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default, rename = "conflictingTaskId")]
    pub conflicting_task_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TaskItem {
    pub id: String,
    pub goal: String,
    pub contract: String,
    pub files: Vec<String>,
    pub depends_on: Vec<String>,
    pub status: String, // "pending", "active", "blocked", "done", "failed"
    pub agent: String,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub elapsed_str: String,
    pub blocking_reason: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct TaskSnapshot {
    pub tasks: Vec<TaskItem>,
    pub running: Vec<TaskItem>,
    pub waiting: Vec<TaskItem>,
    pub done: Vec<TaskItem>,
    pub failed: Vec<TaskItem>,
    pub total_count: usize,
    pub done_count: usize,
    pub running_count: usize,
    pub waiting_count: usize,
    pub events_count: usize,
    pub locked_files: HashMap<String, String>, // normalized_file -> active_task_id
}

pub fn normalize_file_path(p: &str) -> String {
    p.replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

impl TaskSnapshot {
    pub fn load_from_root(
        project_root: &Path,
        activity_snapshot: &ActivitySnapshot,
        workflow_model: Option<&WorkflowModel>,
    ) -> Self {
        let tasks_dir = project_root.join(".crewmate").join("tasks");
        let task_log_path = project_root.join(".crewmate").join("tasks.jsonl");

        // 1. Read events count and latest status change reasons from tasks.jsonl
        let mut events_count = 0;
        let mut event_reasons: HashMap<String, String> = HashMap::new();

        if let Ok(content) = fs::read_to_string(&task_log_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                events_count += 1;
                if let Ok(ev) = serde_json::from_str::<RawTaskEvent>(trimmed) {
                    if let Some(ref r) = ev.reason {
                        if !r.is_empty() {
                            event_reasons.insert(ev.id.clone(), r.clone());
                        }
                    }
                    if ev.event == "scope_conflict" {
                        if let Some(ref f) = ev.file {
                            event_reasons.insert(ev.id.clone(), format!("File '{}' is locked", f));
                        }
                    }
                }
            }
        }

        // 2. Read task definition files from .crewmate/tasks/*.task.yaml
        let mut raw_tasks: Vec<RawTaskYaml> = Vec::new();
        if tasks_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&tasks_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if file_name.ends_with(".task.yaml") || file_name.ends_with(".task.yml") {
                        if let Ok(content) = fs::read_to_string(&path) {
                            if let Ok(task) = serde_yaml::from_str::<RawTaskYaml>(&content) {
                                raw_tasks.push(task);
                            }
                        }
                    }
                }
            }
        }

        // Sort tasks by id ascending
        raw_tasks.sort_by(|a, b| a.id.cmp(&b.id));

        // 3. Build lock table: active tasks hold locks on their declared files
        let mut locked_files: HashMap<String, String> = HashMap::new();
        for task in &raw_tasks {
            if task.status == "active" {
                for file in &task.files {
                    locked_files.insert(normalize_file_path(file), task.id.clone());
                }
            }
        }

        // Also build a map of task status for fast lookup
        let task_status_map: HashMap<String, String> = raw_tasks
            .iter()
            .map(|t| (t.id.clone(), t.status.clone()))
            .collect();

        // 4. Process each task into TaskItem
        let mut processed_tasks: Vec<TaskItem> = Vec::new();

        for task in &raw_tasks {
            // Determine agent
            let agent = if let Some(ref a) = task.agent {
                a.clone()
            } else if let Some(act) = activity_snapshot
                .active_tree
                .iter()
                .find(|a| a.label.contains(&task.id) || a.id == task.id)
            {
                act.agent.clone()
            } else if let Some(act) = activity_snapshot.active_tree.first() {
                act.agent.clone()
            } else if let Some(wf) = workflow_model {
                wf.name.clone()
            } else {
                "agent".to_string()
            };

            // Determine elapsed string
            let elapsed_str = if task.status == "active" {
                if let Some(ref s) = task.started_at {
                    super::activity::format_elapsed(s)
                } else if let Some(ref c) = task.created_at {
                    super::activity::format_elapsed(c)
                } else {
                    "-".to_string()
                }
            } else if task.status == "done" {
                if let (Some(ref s), Some(ref c)) = (&task.started_at, &task.completed_at) {
                    format_time_diff(s, c)
                } else if let Some(ref c) = task.completed_at {
                    super::activity::format_time(c)
                } else {
                    "-".to_string()
                }
            } else {
                "-".to_string()
            };

            // Determine blocking reason for pending or blocked tasks
            let mut blocking_reason: Option<String> = None;
            if task.status == "pending" || task.status == "blocked" {
                // A. Check depends_on tasks: find first dependency not done
                for dep_id in &task.depends_on {
                    let dep_status = task_status_map
                        .get(dep_id)
                        .map(|s| s.as_str())
                        .unwrap_or("missing");
                    if dep_status != "done" {
                        let dep_label = raw_tasks
                            .iter()
                            .find(|t| &t.id == dep_id)
                            .map(|t| {
                                if !t.goal.is_empty() {
                                    if t.goal.len() > 30 {
                                        format!("{}…", &t.goal[..29])
                                    } else {
                                        t.goal.clone()
                                    }
                                } else {
                                    t.id.clone()
                                }
                            })
                            .unwrap_or_else(|| dep_id.clone());
                        blocking_reason = Some(format!("↳ {}", dep_label));
                        break;
                    }
                }

                // B. If not blocked by depends_on, check if any file is locked by an active task
                if blocking_reason.is_none() {
                    for file in &task.files {
                        let norm = normalize_file_path(file);
                        if let Some(locking_task) = locked_files.get(&norm) {
                            if locking_task != &task.id {
                                blocking_reason = Some(format!("↳ waiting on lock: {}", file));
                                break;
                            }
                        }
                    }
                }

                // C. Check scope_conflict amendments
                if blocking_reason.is_none() {
                    for amend in &task.amendments {
                        if amend.amendment_type == "scope_conflict" {
                            blocking_reason = Some(format!("↳ waiting on lock: {}", amend.file));
                            break;
                        }
                    }
                }

                // D. Check event log reason
                if blocking_reason.is_none() {
                    if let Some(r) = event_reasons.get(&task.id) {
                        if r.contains("is locked by active task") || r.contains("is locked") {
                            // Extract file if present: File '...' is locked
                            if let Some(start_idx) = r.find('\'') {
                                if let Some(end_idx) = r[start_idx + 1..].find('\'') {
                                    let filename = &r[start_idx + 1..start_idx + 1 + end_idx];
                                    blocking_reason =
                                        Some(format!("↳ waiting on lock: {}", filename));
                                } else {
                                    blocking_reason = Some("↳ waiting on lock".to_string());
                                }
                            } else {
                                blocking_reason = Some("↳ waiting on lock".to_string());
                            }
                        } else if r.contains("Dependency '") {
                            if let Some(start_idx) = r.find('\'') {
                                if let Some(end_idx) = r[start_idx + 1..].find('\'') {
                                    let dep_id = &r[start_idx + 1..start_idx + 1 + end_idx];
                                    let dep_label = raw_tasks
                                        .iter()
                                        .find(|t| t.id == dep_id)
                                        .map(|t| {
                                            if !t.goal.is_empty() {
                                                if t.goal.len() > 30 {
                                                    format!("{}…", &t.goal[..29])
                                                } else {
                                                    t.goal.clone()
                                                }
                                            } else {
                                                t.id.clone()
                                            }
                                        })
                                        .unwrap_or_else(|| dep_id.to_string());
                                    blocking_reason = Some(format!("↳ {}", dep_label));
                                }
                            }
                        }
                    }
                }
            }

            processed_tasks.push(TaskItem {
                id: task.id.clone(),
                goal: task.goal.clone(),
                contract: task.contract.clone(),
                files: task.files.clone(),
                depends_on: task.depends_on.clone(),
                status: task.status.clone(),
                agent,
                created_at: task.created_at.clone(),
                started_at: task.started_at.clone(),
                completed_at: task.completed_at.clone(),
                elapsed_str,
                blocking_reason,
            });
        }

        let mut running = Vec::new();
        let mut waiting = Vec::new();
        let mut done = Vec::new();
        let mut failed = Vec::new();

        for t in &processed_tasks {
            match t.status.as_str() {
                "active" => running.push(t.clone()),
                "pending" | "blocked" => waiting.push(t.clone()),
                "done" => done.push(t.clone()),
                _ => failed.push(t.clone()),
            }
        }

        let total_count = processed_tasks.len();
        let done_count = done.len();
        let running_count = running.len();
        let waiting_count = waiting.len();

        Self {
            tasks: processed_tasks,
            running,
            waiting,
            done,
            failed,
            total_count,
            done_count,
            running_count,
            waiting_count,
            events_count,
            locked_files,
        }
    }
}

pub fn format_time_diff(start_iso: &str, end_iso: &str) -> String {
    if let (Ok(start), Ok(end)) = (
        DateTime::parse_from_rfc3339(start_iso),
        DateTime::parse_from_rfc3339(end_iso),
    ) {
        let diff = end.signed_duration_since(start.with_timezone(&Utc));
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
