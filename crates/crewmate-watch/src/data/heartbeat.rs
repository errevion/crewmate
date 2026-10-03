use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct RawSessionInfo {
    pub id: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct RawHeartbeat {
    pub harness: Option<String>,
    pub protocol: Option<String>,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    #[serde(rename = "lastHeartbeat")]
    pub last_heartbeat: Option<String>,
    #[serde(rename = "lastActivity")]
    pub last_activity: Option<String>,
    pub status: Option<String>,
    pub session: Option<RawSessionInfo>,
}

#[derive(Debug, Clone)]
pub struct HeartbeatStatus {
    pub is_alive: bool,
    pub pid: Option<u32>,
    pub status_text: String, // "RUNNING", "IDLE", "OFFLINE"
    pub harness_name: Option<String>,
    pub protocol: Option<String>,
    pub session_id: Option<String>,
    pub session_title: Option<String>,
    pub last_heartbeat_ago_secs: Option<i64>,
}

impl Default for HeartbeatStatus {
    fn default() -> Self {
        Self {
            is_alive: false,
            pid: None,
            status_text: "OFFLINE".to_string(),
            harness_name: None,
            protocol: None,
            session_id: None,
            session_title: None,
            last_heartbeat_ago_secs: None,
        }
    }
}

impl HeartbeatStatus {
    pub fn load_from_root(project_root: &Path) -> Self {
        let path = project_root.join(".crewmate").join("heartbeat.json");
        if !path.exists() {
            return Self::default();
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => return Self::default(),
        };

        let raw: RawHeartbeat = match serde_json::from_str(&content) {
            Ok(r) => r,
            Err(_) => return Self::default(),
        };

        let (session_id, session_title) = match raw.session {
            Some(s) => (s.id, s.title),
            None => (None, None),
        };

        let harness_name = raw.harness.clone().or_else(|| raw.protocol.clone());
        let protocol = raw.protocol.clone();

        if raw.status.as_deref() == Some("offline") {
            return Self {
                is_alive: false,
                pid: raw.pid,
                status_text: "OFFLINE".to_string(),
                harness_name,
                protocol,
                session_id,
                session_title,
                last_heartbeat_ago_secs: None,
            };
        }

        if let Some(ref hb_str) = raw.last_heartbeat {
            if let Ok(hb_time) = DateTime::parse_from_rfc3339(hb_str) {
                let now = Utc::now();
                let elapsed = now.signed_duration_since(hb_time.with_timezone(&Utc));
                let secs = elapsed.num_seconds();

                // Heartbeat is sent every ~4s. If > 15s have elapsed, harness is offline
                if secs > 15 {
                    return Self {
                        is_alive: false,
                        pid: raw.pid,
                        status_text: "OFFLINE".to_string(),
                        harness_name,
                        protocol,
                        session_id,
                        session_title,
                        last_heartbeat_ago_secs: Some(secs),
                    };
                }

                // Heartbeat is fresh: check status
                let (is_alive, status_text) = match raw.status.as_deref() {
                    Some("running") | Some("online") | Some("alive") => {
                        (true, "RUNNING".to_string())
                    }
                    Some("idle") => (true, "IDLE".to_string()),
                    _ => (false, "OFFLINE".to_string()),
                };

                return Self {
                    is_alive,
                    pid: raw.pid,
                    status_text,
                    harness_name,
                    protocol,
                    session_id,
                    session_title,
                    last_heartbeat_ago_secs: Some(secs.max(0)),
                };
            }
        }

        Self::default()
    }
}
