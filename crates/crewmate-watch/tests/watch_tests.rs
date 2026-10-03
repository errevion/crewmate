use std::fs;
use std::path::PathBuf;
use std::thread::sleep;
use std::time::Duration;

use crewmate_watch::app::{App, TransitionAnimation};
use crewmate_watch::data::activity::{
    format_elapsed, format_local_datetime, format_short_id, format_time, ActivitySnapshot,
};
use crewmate_watch::data::state::EngineStateSnapshot;
use crewmate_watch::data::workflow::WorkflowModel;

fn create_temp_dir(test_name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("crewmate_watch_{}_{}", test_name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn test_workflow_loading() {
    let dir = create_temp_dir("workflow");

    let graph_yaml = r#"
version: "1.0.0"
name: "Feature Pipeline"
initial: plan
nodes:
  - id: plan
    next: execute
  - id: execute
    next: verify
  - id: verify
    next: done
"#;

    fs::write(dir.join("graph.yaml"), graph_yaml).unwrap();

    let nodes_dir = dir.join("nodes");
    fs::create_dir_all(&nodes_dir).unwrap();
    fs::write(
        nodes_dir.join("execute.node.yaml"),
        "id: execute\ninstructions: do work\non_fail_max_retries: 3\n",
    )
    .unwrap();

    let model = WorkflowModel::load_from_root(&dir, None).expect("Should load workflow model");
    assert_eq!(model.name, "Feature Pipeline");
    assert_eq!(model.initial_node, "plan");
    assert_eq!(model.nodes_in_order, vec!["plan", "execute", "verify"]);
    assert_eq!(
        model.node_edges,
        vec![
            ("plan".to_string(), "execute".to_string()),
            ("execute".to_string(), "verify".to_string()),
            ("verify".to_string(), "done".to_string()),
        ]
    );

    let exec_def = model.node_defs.get("execute").expect("execute def loaded");
    assert_eq!(exec_def.id, "execute");
    assert_eq!(exec_def.on_fail_max_retries, 3);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_workflow_loading_from_crewmate_dir() {
    let dir = create_temp_dir("crewmate_workflow");
    let crewmate_wf = dir.join(".crewmate").join("workflow");
    fs::create_dir_all(&crewmate_wf).unwrap();

    let graph_yaml = r#"
version: "1.0.0"
name: "Crewmate Feature Pipeline"
initial: plan
nodes:
  - id: plan
    next: execute
  - id: execute
    next: done
"#;

    fs::write(crewmate_wf.join("graph.yaml"), graph_yaml).unwrap();

    let nodes_dir = crewmate_wf.join("nodes");
    fs::create_dir_all(&nodes_dir).unwrap();
    fs::write(
        nodes_dir.join("plan.node.yaml"),
        "id: plan\ninstructions: plan work\non_fail_max_retries: 2\n",
    )
    .unwrap();

    let model = WorkflowModel::load_from_root(&dir, None).expect("Should load workflow model from .crewmate/workflow");
    assert_eq!(model.name, "Crewmate Feature Pipeline");
    assert_eq!(model.initial_node, "plan");
    assert_eq!(model.nodes_in_order, vec!["plan", "execute"]);
    assert!(model.node_defs.contains_key("plan"));
    assert_eq!(model.node_defs["plan"].instructions, "plan work");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_workflow_loading_from_unified_workflows_dir() {
    let dir = create_temp_dir("unified_workflows");
    let bugfix_wf = dir.join(".crewmate").join("workflows").join("bugfix");
    fs::create_dir_all(&bugfix_wf).unwrap();

    let graph_yaml = r#"
version: "1.0.0"
name: "Bugfix Pipeline"
initial: triage
nodes:
  - id: triage
    next: fix
  - id: fix
    next: done
"#;

    fs::write(bugfix_wf.join("graph.yaml"), graph_yaml).unwrap();

    let nodes_dir = bugfix_wf.join("nodes");
    fs::create_dir_all(&nodes_dir).unwrap();
    fs::write(
        nodes_dir.join("triage.node.yaml"),
        "id: triage\ninstructions: triage issue\non_fail_max_retries: 1\n",
    )
    .unwrap();

    // With active_workflow = Some("bugfix")
    let model = WorkflowModel::load_from_root(&dir, Some("bugfix")).expect("Should load workflow model from .crewmate/workflows/bugfix");
    assert_eq!(model.name, "Bugfix Pipeline");
    assert_eq!(model.initial_node, "triage");
    assert_eq!(model.nodes_in_order, vec!["triage", "fix"]);
    assert!(model.node_defs.contains_key("triage"));
    assert_eq!(model.node_defs["triage"].instructions, "triage issue");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_state_loading() {
    let dir = create_temp_dir("state");
    let crewmate_dir = dir.join(".crewmate");
    fs::create_dir_all(&crewmate_dir).unwrap();

    let state_jsonl = r#"{"timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"plan"}
{"timestamp":"2026-09-26T12:01:00Z","event":"NODE_TRANSITION","from":"plan","to":"execute","reason":"advance"}
{"timestamp":"2026-09-26T12:02:00Z","event":"RETRY_INCREMENT","node":"execute","retryCount":1,"maxRetries":3}
{"timestamp":"2026-09-26T12:03:00Z","event":"ESCALATE","node":"execute","target":"human","reason":"max retries reached"}
"#;

    fs::write(crewmate_dir.join("state.jsonl"), state_jsonl).unwrap();

    let snapshot = EngineStateSnapshot::load_from_root(&dir);
    assert_eq!(snapshot.current_node.as_deref(), Some("execute"));
    assert_eq!(snapshot.status, "escalated");
    assert_eq!(snapshot.current_retry_count(), 1);
    assert_eq!(snapshot.current_max_retries(), 3);
    assert_eq!(snapshot.escalation_target.as_deref(), Some("human"));
    assert_eq!(snapshot.last_timestamp.as_deref(), Some("2026-09-26T12:03:00Z"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_activity_snapshot_tree() {
    let dir = create_temp_dir("activity");
    let crewmate_dir = dir.join(".crewmate");
    fs::create_dir_all(&crewmate_dir).unwrap();

    let activity_jsonl = r#"{"timestamp":"2026-09-26T12:00:00Z","event":"start","id":"act_root_1","agent":"lead","label":"Root Task","at":"2026-09-26T12:00:00Z"}
{"timestamp":"2026-09-26T12:01:00Z","event":"start","id":"act_child_1","agent":"coder","label":"Child Task","parent":"act_root_1","at":"2026-09-26T12:01:00Z"}
{"timestamp":"2026-09-26T12:02:00Z","event":"start","id":"act_done_1","agent":"tester","label":"Done Task","at":"2026-09-26T12:02:00Z"}
{"timestamp":"2026-09-26T12:03:00Z","event":"end","id":"act_done_1","status":"completed","at":"2026-09-26T12:03:00Z"}
"#;

    fs::write(crewmate_dir.join("activity.jsonl"), activity_jsonl).unwrap();

    let snapshot = ActivitySnapshot::load_from_root(&dir);

    // Active tree should contain act_root_1 (depth 0) and act_child_1 (depth 1)
    assert_eq!(snapshot.active_tree.len(), 2);
    assert_eq!(snapshot.active_tree[0].id, "act_root_1");
    assert_eq!(snapshot.active_tree[0].depth, 0);
    assert_eq!(snapshot.active_tree[1].id, "act_child_1");
    assert_eq!(snapshot.active_tree[1].depth, 1);

    // Recent events should have 4 events in reverse order
    assert_eq!(snapshot.recent_events.len(), 4);
    assert_eq!(snapshot.recent_events[0].event_type, "END:completed");
    assert_eq!(snapshot.recent_events[1].event_type, "START");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_transition_animation() {
    let anim = TransitionAnimation::new("plan".to_string(), "execute".to_string(), 100);
    assert_eq!(anim.from_node, "plan");
    assert_eq!(anim.to_node, "execute");
    let p = anim.progress();
    assert!(p >= 0.0 && p <= 1.0);

    sleep(Duration::from_millis(120));
    assert!(anim.is_finished());
    assert_eq!(anim.progress(), 1.0);
}

#[test]
fn test_format_helpers() {
    assert_eq!(format_short_id("act_1234567890abcdef"), "act_12345…");
    assert_eq!(format_short_id("short"), "short");

    let iso = "2026-09-26T14:30:15Z";
    let time_formatted = format_time(iso);
    let expected_time = chrono::DateTime::parse_from_rfc3339(iso)
        .unwrap()
        .with_timezone(&chrono::Local)
        .format("%H:%M:%S")
        .to_string();
    assert_eq!(time_formatted, expected_time);

    let local_dt = format_local_datetime(iso);
    let expected_dt = chrono::DateTime::parse_from_rfc3339(iso)
        .unwrap()
        .with_timezone(&chrono::Local)
        .format("%Y-%m-%d %H:%M:%S (%:z)")
        .to_string();
    assert_eq!(local_dt, expected_dt);

    let elapsed = format_elapsed("2026-09-26T14:00:00Z");
    assert!(!elapsed.is_empty());
}

#[test]
fn test_app_polling() {
    let dir = create_temp_dir("app");
    let crewmate_dir = dir.join(".crewmate");
    fs::create_dir_all(&crewmate_dir).unwrap();

    let mut app = App::new(dir.clone(), 10);
    assert_eq!(app.state.status, "not initialized");

    // Write state
    fs::write(
        crewmate_dir.join("state.jsonl"),
        r#"{"timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"plan"}"#,
    )
    .unwrap();

    app.poll_files();
    assert_eq!(app.state.current_node.as_deref(), Some("plan"));
    assert_eq!(app.state.status, "active");

    // Advance to execute, verify transition animation triggers
    fs::write(
        crewmate_dir.join("state.jsonl"),
        r#"{"timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"plan"}
{"timestamp":"2026-09-26T12:01:00Z","event":"NODE_TRANSITION","from":"plan","to":"execute","reason":"advance"}
"#,
    )
    .unwrap();

    app.poll_files();
    assert_eq!(app.state.current_node.as_deref(), Some("execute"));
    assert!(app.transition_animation.is_some());
    let anim = app.transition_animation.as_ref().unwrap();
    assert_eq!(anim.from_node, "plan");
    assert_eq!(anim.to_node, "execute");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_graph_panel_block_rendering() {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use ratatui::layout::Rect;
    use ratatui::style::Color;
    use crewmate_watch::ui::graph::render_canvas_graph;

    let dir = create_temp_dir("graph_render");
    let crewmate_dir = dir.join(".crewmate");
    fs::create_dir_all(&crewmate_dir).unwrap();

    let graph_yaml = r#"
version: "1.0.0"
name: "Test Pipeline"
initial: plan
nodes:
  - id: plan
    next: execute
  - id: execute
    next: verify
  - id: verify
    next: done
"#;
    fs::write(dir.join("graph.yaml"), graph_yaml).unwrap();

    let state_jsonl = r#"{"timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"plan"}
{"timestamp":"2026-09-26T12:01:00Z","event":"NODE_TRANSITION","from":"plan","to":"execute","reason":"advance"}
"#;
    fs::write(crewmate_dir.join("state.jsonl"), state_jsonl).unwrap();

    let mut app = App::new(dir.clone(), 10);
    // Poll to trigger transition animation from plan to execute
    app.previous_node = Some("plan".to_string());
    app.poll_files();

    assert!(app.transition_animation.is_some());

    let backend = TestBackend::new(80, 5);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal.draw(|f| {
        render_canvas_graph(f, &app, Rect::new(0, 0, 80, 5));
    }).unwrap();

    let buf = terminal.backend().buffer().clone();

    // Check line by line
    let mut full_rendered = String::new();
    for y in 0..5 {
        let mut line = String::new();
        for x in 0..80 {
            line.push_str(buf[(x, y)].symbol());
        }
        full_rendered.push_str(&line);
        full_rendered.push('\n');
    }

    // 1. Must contain "plan ✓" (done node)
    assert!(full_rendered.contains("plan ✓"), "Rendered buffer must contain 'plan ✓':\n{}", full_rendered);

    // 2. Must contain "execute" (current node)
    assert!(full_rendered.contains("execute"), "Rendered buffer must contain 'execute':\n{}", full_rendered);

    // 3. Must contain "verify" (pending node)
    assert!(full_rendered.contains("verify"), "Rendered buffer must contain 'verify':\n{}", full_rendered);

    // 4. Must contain connector arrows "▶" and lines "─"
    assert!(full_rendered.contains('▶'), "Rendered buffer must contain arrow ▶:\n{}", full_rendered);
    assert!(full_rendered.contains('─'), "Rendered buffer must contain connector line ─:\n{}", full_rendered);

    // 5. Must contain animated transition dot ● on the active transition edge
    assert!(full_rendered.contains('●'), "Rendered buffer must contain animated transition dot ●:\n{}", full_rendered);

    // 6. Must contain Thick borders (┏, ┓, ┗, ┛) for current node
    assert!(full_rendered.contains('┏') && full_rendered.contains('┓'), "Current node must have Thick border corners:\n{}", full_rendered);

    // 7. Must contain Plain borders (┌, ┐, └, ┘) for pending/done nodes
    assert!(full_rendered.contains('┌') && full_rendered.contains('┐'), "Pending/done node must have Plain border corners:\n{}", full_rendered);

    // 8. Verify colors in buffer:
    // Find where 'plan' is and check it's Cyan (completed)
    // Find where 'execute' is and check it's Green (active)
    let mut found_cyan = false;
    let mut found_green = false;
    for y in 0..5 {
        for x in 0..80 {
            let cell = &buf[(x, y)];
            if cell.symbol() == "p" && cell.fg == Color::Cyan {
                found_cyan = true;
            }
            if cell.symbol() == "e" && cell.fg == Color::Green {
                found_green = true;
            }
        }
    }
    assert!(found_cyan, "Plan node text should be cyan (completed)");
    assert!(found_green, "Execute node text should be green (active)");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_focused_view_and_horizontal_scroll() {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use ratatui::layout::Rect;
    use crewmate_watch::ui::graph::render_canvas_graph;

    let dir = create_temp_dir("focused_scroll");
    let crewmate_dir = dir.join(".crewmate");
    fs::create_dir_all(&crewmate_dir).unwrap();

    let graph_yaml = r#"
version: "1.0.0"
name: "Long Pipeline"
initial: step-0
nodes:
  - id: step-0
    next: step-1
  - id: step-1
    next: step-2
  - id: step-2
    next: step-3
  - id: step-3
    next: generate-database-migrations
  - id: generate-database-migrations
    next: step-5
  - id: step-5
    next: step-6
  - id: step-6
    next: step-7
  - id: step-7
    next: step-8
  - id: step-8
    next: done
"#;
    fs::write(dir.join("graph.yaml"), graph_yaml).unwrap();

    let state_jsonl = r#"{"timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"step-0"}
{"timestamp":"2026-09-26T12:01:00Z","event":"NODE_TRANSITION","from":"step-0","to":"generate-database-migrations","reason":"advance"}
"#;
    fs::write(crewmate_dir.join("state.jsonl"), state_jsonl).unwrap();

    let mut app = App::new(dir.clone(), 10);
    app.poll_files();

    assert_eq!(app.active_node_index(), 4);
    assert_eq!(app.current_focus_index(), 4);

    let backend = TestBackend::new(80, 5);
    let mut terminal = Terminal::new(backend).unwrap();

    // 1. Initial focused view centered on active node (index 4: generate-database-migrations)
    terminal.draw(|f| {
        render_canvas_graph(f, &app, Rect::new(0, 0, 80, 5));
    }).unwrap();

    let buf = terminal.backend().buffer().clone();
    let mut rendered_1 = String::new();
    for y in 0..5 {
        for x in 0..80 {
            rendered_1.push_str(buf[(x, y)].symbol());
        }
        rendered_1.push('\n');
    }

    // Must show left indicator since step-0..step-2 are hidden
    assert!(rendered_1.contains("past"), "Must show past hidden indicator:\n{}", rendered_1);
    // Must show right indicator since later steps are hidden
    assert!(rendered_1.contains("more"), "Must show more hidden indicator:\n{}", rendered_1);
    // Must show truncated name with ellipsis for long node name
    assert!(rendered_1.contains("..."), "Must truncate long node name with ellipsis:\n{}", rendered_1);

    // 2. Pan left using scroll_graph_left()
    app.scroll_graph_left();
    assert_eq!(app.current_focus_index(), 3);
    assert!(app.graph_focus_index.is_some());

    terminal.draw(|f| {
        render_canvas_graph(f, &app, Rect::new(0, 0, 80, 5));
    }).unwrap();

    let buf2 = terminal.backend().buffer().clone();
    let mut rendered_2 = String::new();
    for y in 0..5 {
        for x in 0..80 {
            rendered_2.push_str(buf2[(x, y)].symbol());
        }
        rendered_2.push('\n');
    }

    // Header title shows manual viewing state
    assert!(rendered_2.contains("Viewing step 4/9"), "Header should indicate viewing step 4/9:\n{}", rendered_2);

    // 3. Re-center with reset_graph_focus()
    app.reset_graph_focus();
    assert_eq!(app.graph_focus_index, None);
    assert_eq!(app.current_focus_index(), 4);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_event_selection_and_detail_modal() {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use ratatui::layout::Rect;
    use crewmate_watch::ui::events::{render_event_detail_modal, render_recent_events};

    let dir = create_temp_dir("events_modal");
    let crewmate_dir = dir.join(".crewmate");
    fs::create_dir_all(&crewmate_dir).unwrap();

    let activity_jsonl = r#"{"timestamp":"2026-09-26T12:00:00Z","event":"start","id":"act_test_long_id_12345","agent":"senior_architect","label":"Very long descriptive activity label that exceeds standard panel width and must be truncated","at":"2026-09-26T12:00:00Z"}
{"timestamp":"2026-09-26T12:01:00Z","event":"end","id":"act_test_long_id_12345","status":"completed","at":"2026-09-26T12:01:00Z"}
"#;
    fs::write(crewmate_dir.join("activity.jsonl"), activity_jsonl).unwrap();

    let mut app = App::new(dir.clone(), 10);
    app.poll_files();

    assert_eq!(app.activity.recent_events.len(), 2);
    assert_eq!(app.selected_event_index, 0);

    let backend = TestBackend::new(80, 10);
    let mut terminal = Terminal::new(backend).unwrap();

    // 1. Render recent events list
    terminal.draw(|f| {
        render_recent_events(f, &app, Rect::new(0, 0, 80, 10));
    }).unwrap();

    let buf = terminal.backend().buffer().clone();
    let mut rendered = String::new();
    for y in 0..10 {
        let mut line = String::new();
        for x in 0..80 {
            line.push_str(buf[(x, y)].symbol());
        }
        rendered.push_str(&line);
        rendered.push('\n');
    }

    // Must show selection pointer ▶ for selected event
    assert!(rendered.contains('▶'), "Event list must show selection pointer ▶:\n{}", rendered);
    // Must show ellipsis truncation ... for long label
    assert!(rendered.contains("..."), "Event list must truncate long label with ...:\n{}", rendered);

    // 2. Test event scrolling navigation
    app.scroll_events_down();
    assert_eq!(app.selected_event_index, 1);
    app.scroll_events_down(); // bounded at len - 1
    assert_eq!(app.selected_event_index, 1);
    app.scroll_events_up();
    assert_eq!(app.selected_event_index, 0);

    // 3. Test open and render event detail modal
    app.open_event_detail();
    assert!(app.show_event_detail);

    let modal_backend = TestBackend::new(80, 20);
    let mut modal_terminal = Terminal::new(modal_backend).unwrap();

    modal_terminal.draw(|f| {
        render_event_detail_modal(f, &app, Rect::new(0, 0, 80, 20));
    }).unwrap();

    let modal_buf = modal_terminal.backend().buffer().clone();
    let mut modal_rendered = String::new();
    for y in 0..20 {
        let mut line = String::new();
        for x in 0..80 {
            line.push_str(modal_buf[(x, y)].symbol());
        }
        modal_rendered.push_str(&line);
        modal_rendered.push('\n');
    }

    // Modal must contain untruncated activity label and title
    assert!(modal_rendered.contains("Event Details"), "Modal should contain 'Event Details':\n{}", modal_rendered);
    assert!(modal_rendered.contains("Very long descriptive activity label"), "Modal should display full unshortened activity label:\n{}", modal_rendered);
    assert!(modal_rendered.contains("act_test_long_id_12345"), "Modal should display full activity ID:\n{}", modal_rendered);
    assert!(modal_rendered.contains("senior_architect"), "Modal should display agent name:\n{}", modal_rendered);

    // 4. Test close event detail modal
    app.close_event_detail();
    assert!(!app.show_event_detail);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_heartbeat_liveness_display() {
    use ratatui::backend::TestBackend;
    use ratatui::layout::Rect;
    use ratatui::Terminal;
    use serde_json::json;
    use chrono::Utc;

    let dir = create_temp_dir("heartbeat_liveness");
    let crewmate_dir = dir.join(".crewmate");
    let _ = fs::create_dir_all(&crewmate_dir);

    // Write an activity
    let act_file = crewmate_dir.join("activity.jsonl");
    let act_json = json!({
        "event": "start",
        "id": "act_live_test",
        "agent": "worker",
        "label": "Working on parser",
        "at": Utc::now().to_rfc3339()
    });
    fs::write(&act_file, format!("{}\n", act_json)).unwrap();

    // 1. When no heartbeat file exists, default is OFFLINE
    let mut app = App::new(dir.clone(), 60);
    assert!(!app.heartbeat.is_alive);

    let backend = TestBackend::new(80, 24);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal.draw(|f| {
        crewmate_watch::ui::header::render_header(f, &app, Rect::new(0, 0, 80, 3), None);
        crewmate_watch::ui::activities::render_activities(f, &app, Rect::new(0, 3, 80, 10));
    }).unwrap();

    let buf = terminal.backend().buffer().clone();
    let mut rendered = String::new();
    for y in 0..13 {
        let mut line = String::new();
        for x in 0..80 {
            line.push_str(buf[(x, y)].symbol());
        }
        rendered.push_str(&line);
        rendered.push('\n');
    }

    assert!(rendered.contains("Harness:"), "Header must include Harness indicator");
    assert!(rendered.contains("OFFLINE"), "Header must show OFFLINE when no heartbeat");
    assert!(rendered.contains("Activities (1 - OFFLINE)"), "Activities title must show (1 - OFFLINE)");
    assert!(rendered.contains("[offline]"), "Activity item must show [offline] badge");

    // 2. Now write a live heartbeat file
    let heartbeat_file = crewmate_dir.join("heartbeat.json");
    let hb_json = json!({
        "harness": "OpenCode",
        "protocol": "plugin",
        "pid": 99999,
        "startedAt": Utc::now().to_rfc3339(),
        "lastHeartbeat": Utc::now().to_rfc3339(),
        "status": "running",
        "session": {
            "id": "ses_4a1b2c3d4e5f",
            "title": "Design API"
        }
    });
    fs::write(&heartbeat_file, serde_json::to_string_pretty(&hb_json).unwrap()).unwrap();

    // Poll to reload heartbeat
    app.poll_files();
    assert!(app.heartbeat.is_alive, "Heartbeat should be alive");
    assert_eq!(app.heartbeat.status_text, "RUNNING");
    assert_eq!(app.heartbeat.harness_name.as_deref(), Some("OpenCode"));
    assert_eq!(app.heartbeat.session_id.as_deref(), Some("ses_4a1b2c3d4e5f"));
    assert_eq!(app.heartbeat.session_title.as_deref(), Some("Design API"));

    let live_backend = TestBackend::new(100, 24);
    let mut live_terminal = Terminal::new(live_backend).unwrap();

    live_terminal.draw(|f| {
        crewmate_watch::ui::header::render_header(f, &app, Rect::new(0, 0, 100, 3), None);
        crewmate_watch::ui::activities::render_activities(f, &app, Rect::new(0, 3, 100, 10));
    }).unwrap();

    let live_buf = live_terminal.backend().buffer().clone();
    let mut live_rendered = String::new();
    for y in 0..13 {
        let mut line = String::new();
        for x in 0..100 {
            line.push_str(live_buf[(x, y)].symbol());
        }
        live_rendered.push_str(&line);
        live_rendered.push('\n');
    }

    assert!(live_rendered.contains("RUNNING"), "Header must show RUNNING when heartbeat is fresh");
    assert!(live_rendered.contains("OpenCode ses_4a1b"), "Header must show harness name and session ID");
    assert!(!live_rendered.contains("Status:"), "Header must not show Status: ACTIVE");
    assert!(live_rendered.contains("Activities (1)"), "Activities title must show Activities (1) without OFFLINE");
    assert!(!live_rendered.contains("[offline]"), "Activity item must not have [offline] badge");

    // 3. Now write an idle heartbeat file with MCP protocol fallback
    let idle_json = json!({
        "harness": "MCP",
        "pid": 99999,
        "startedAt": Utc::now().to_rfc3339(),
        "lastHeartbeat": Utc::now().to_rfc3339(),
        "status": "idle"
    });
    fs::write(&heartbeat_file, serde_json::to_string_pretty(&idle_json).unwrap()).unwrap();

    app.poll_files();
    assert!(app.heartbeat.is_alive, "Heartbeat should be alive in idle");
    assert_eq!(app.heartbeat.status_text, "IDLE");
    assert_eq!(app.heartbeat.harness_name.as_deref(), Some("MCP"));

    let idle_backend = TestBackend::new(80, 24);
    let mut idle_terminal = Terminal::new(idle_backend).unwrap();

    idle_terminal.draw(|f| {
        crewmate_watch::ui::header::render_header(f, &app, Rect::new(0, 0, 80, 3), None);
        crewmate_watch::ui::activities::render_activities(f, &app, Rect::new(0, 3, 80, 10));
    }).unwrap();

    let idle_buf = idle_terminal.backend().buffer().clone();
    let mut idle_rendered = String::new();
    for y in 0..13 {
        let mut line = String::new();
        for x in 0..80 {
            line.push_str(idle_buf[(x, y)].symbol());
        }
        idle_rendered.push_str(&line);
        idle_rendered.push('\n');
    }

    assert!(idle_rendered.contains("IDLE"), "Header must show IDLE when status is idle");
    assert!(idle_rendered.contains("(MCP)"), "Header must show (MCP) fallback when no session id");
    assert!(idle_rendered.contains("Activities (1 - IDLE)"), "Activities title must show (1 - IDLE)");
    assert!(idle_rendered.contains("[idle]"), "Activity item must have [idle] badge");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_page_switching_and_persistence() {
    use crewmate_watch::app::AppPage;

    let dir = create_temp_dir("page_switching");
    let mut app = App::new(dir.clone(), 10);

    // Initial page is Workflow
    assert_eq!(app.current_page, AppPage::Workflow);

    // Tab switch toggles to Tasks
    app.switch_page();
    assert_eq!(app.current_page, AppPage::Tasks);

    // Polling files across ticks preserves active page (does not reset)
    app.poll_files();
    assert_eq!(app.current_page, AppPage::Tasks);

    // Tab switch toggles to Contracts
    app.switch_page();
    assert_eq!(app.current_page, AppPage::Contracts);

    app.poll_files();
    assert_eq!(app.current_page, AppPage::Contracts);

    // Tab switch toggles back to Workflow
    app.switch_page();
    assert_eq!(app.current_page, AppPage::Workflow);

    app.poll_files();
    assert_eq!(app.current_page, AppPage::Workflow);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_task_snapshot_loading_and_blocking_reasons() {
    let dir = create_temp_dir("task_snapshot");
    let crewmate_dir = dir.join(".crewmate");
    let tasks_dir = crewmate_dir.join("tasks");
    fs::create_dir_all(&tasks_dir).unwrap();

    // 1. Task 1: active task, locking "src/auth/token.ts"
    let task1_yaml = r#"
id: task_001
goal: Update auth token validation
contract: auth
files:
  - src/auth/token.ts
status: active
agent: security_worker
started_at: "2026-09-26T12:00:00Z"
"#;
    fs::write(tasks_dir.join("task_001.task.yaml"), task1_yaml).unwrap();

    // 2. Task 2: pending task, depends_on task_001 (dependency-blocked)
    let task2_yaml = r#"
id: task_002
goal: Add discount logic to billing
contract: billing
files:
  - src/billing/discount.ts
depends_on:
  - task_001
status: pending
agent: billing_worker
"#;
    fs::write(tasks_dir.join("task_002.task.yaml"), task2_yaml).unwrap();

    // 3. Task 3: blocked task, overlapping file src/auth/token.ts (lock-blocked)
    let task3_yaml = r#"
id: task_003
goal: Audit auth token
contract: auth
files:
  - src/auth/token.ts
status: blocked
agent: auditor
"#;
    fs::write(tasks_dir.join("task_003.task.yaml"), task3_yaml).unwrap();

    // 4. Task 4: done task
    let task4_yaml = r#"
id: task_004
goal: Setup config schema
contract: core
files:
  - src/core/config.ts
status: done
started_at: "2026-09-26T11:50:00Z"
completed_at: "2026-09-26T11:55:00Z"
"#;
    fs::write(tasks_dir.join("task_004.task.yaml"), task4_yaml).unwrap();

    // 5. Write tasks.jsonl
    let tasks_jsonl = r#"{"event":"create","id":"task_001","at":"2026-09-26T11:59:00Z"}
{"event":"create","id":"task_002","at":"2026-09-26T12:00:00Z"}
{"event":"create","id":"task_003","at":"2026-09-26T12:01:00Z"}
{"event":"create","id":"task_004","at":"2026-09-26T11:49:00Z"}
"#;
    fs::write(crewmate_dir.join("tasks.jsonl"), tasks_jsonl).unwrap();

    let mut app = App::new(dir.clone(), 10);
    app.poll_files();

    assert_eq!(app.task_snapshot.total_count, 4);
    assert_eq!(app.task_snapshot.running_count, 1);
    assert_eq!(app.task_snapshot.waiting_count, 2);
    assert_eq!(app.task_snapshot.done_count, 1);
    assert_eq!(app.task_snapshot.events_count, 4);

    // Verify lock table holds src/auth/token.ts for task_001
    assert_eq!(
        app.task_snapshot.locked_files.get("src/auth/token.ts").map(|s| s.as_str()),
        Some("task_001")
    );

    // Verify Task 2 dependency-blocked reason
    let t2 = app.task_snapshot.waiting.iter().find(|t| t.id == "task_002").unwrap();
    assert!(
        t2.blocking_reason.as_ref().unwrap().contains("Update auth token")
            || t2.blocking_reason.as_ref().unwrap().contains("task_001"),
        "Task 2 should be blocked by task_001"
    );

    // Verify Task 3 lock-blocked reason distinguishes lock from dependency
    let t3 = app.task_snapshot.waiting.iter().find(|t| t.id == "task_003").unwrap();
    assert!(
        t3.blocking_reason.as_ref().unwrap().contains("waiting on lock: src/auth/token.ts"),
        "Task 3 must show waiting on lock distinctly"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_tasks_page_rendering_and_expand_collapse() {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use crewmate_watch::app::AppPage;

    let dir = create_temp_dir("tasks_render");
    let crewmate_dir = dir.join(".crewmate");
    let tasks_dir = crewmate_dir.join("tasks");
    fs::create_dir_all(&tasks_dir).unwrap();

    // Write workflow graph
    let graph_yaml = r#"
version: "1.0.0"
name: "Feature Auth"
initial: plan
nodes:
  - id: plan
    next: execute
  - id: execute
    instructions: "Implement contract-scoped parallel tasks"
    next: verify
  - id: verify
    next: done
"#;
    fs::write(dir.join("graph.yaml"), graph_yaml).unwrap();

    // Write state.jsonl
    let state_jsonl = r#"{"timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"plan"}
{"timestamp":"2026-09-26T12:01:00Z","event":"NODE_TRANSITION","from":"plan","to":"execute","reason":"advance"}
"#;
    fs::write(crewmate_dir.join("state.jsonl"), state_jsonl).unwrap();

    // Active task
    fs::write(
        tasks_dir.join("task_001.task.yaml"),
        r#"
id: task_001
goal: Update auth token validation
contract: auth
files:
  - src/auth/token.ts
status: active
agent: security_worker
started_at: "2026-09-26T12:00:00Z"
"#,
    ).unwrap();

    // Waiting task
    fs::write(
        tasks_dir.join("task_002.task.yaml"),
        r#"
id: task_002
goal: Add discount logic
contract: billing
files:
  - src/billing/discount.ts
depends_on:
  - task_001
status: pending
agent: billing_worker
"#,
    ).unwrap();

    // Done task
    fs::write(
        tasks_dir.join("task_003.task.yaml"),
        r#"
id: task_003
goal: Setup config schema
contract: core
files:
  - src/core/config.ts
status: done
started_at: "2026-09-26T11:50:00Z"
completed_at: "2026-09-26T11:55:00Z"
"#,
    ).unwrap();

    let mut app = App::new(dir.clone(), 10);
    app.poll_files();
    app.current_page = AppPage::Tasks;

    let backend = TestBackend::new(100, 24);
    let mut terminal = Terminal::new(backend).unwrap();

    // 1. Render collapsed tasks page
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf = terminal.backend().buffer().clone();
    let mut rendered = String::new();
    for y in 0..24 {
        let mut line = String::new();
        for x in 0..100 {
            line.push_str(buf[(x, y)].symbol());
        }
        rendered.push_str(&line);
        rendered.push('\n');
    }

    // Must match reference header layout:
    assert!(rendered.contains("Feature Auth"), "Header should contain workflow title:\n{}", rendered);
    assert!(!rendered.contains("events"), "Header should not display event count:\n{}", rendered);
    assert!(rendered.contains("│"), "Header should use vertical bar separators:\n{}", rendered);

    // Must contain progress bar text counts:
    assert!(rendered.contains("1/3 done"), "Progress counts must display 1/3 done:\n{}", rendered);
    assert!(rendered.contains("1 running"), "Progress counts must display 1 running:\n{}", rendered);
    assert!(rendered.contains("1 waiting"), "Progress counts must display 1 waiting:\n{}", rendered);

    // Stage indicator row removed:
    assert!(!rendered.contains("stage 2/3"), "Stage row must not be displayed:\n{}", rendered);

    // Must contain running task section:
    assert!(rendered.contains("Running · 1"), "Must have Running section:\n{}", rendered);
    assert!(!rendered.contains("Tasks · running"), "Must not have 'Tasks · running':\n{}", rendered);
    assert!(rendered.contains("Update auth token validation"), "Must list running task goal:\n{}", rendered);
    assert!(rendered.contains("security_wor"), "Must list agent:\n{}", rendered);

    // Must contain waiting task section:
    assert!(rendered.contains("Waiting · 1"), "Must have Waiting section:\n{}", rendered);
    assert!(rendered.contains("Add discount logic"), "Must list waiting task goal:\n{}", rendered);
    assert!(rendered.contains('↳'), "Must show dependency arrow ↳:\n{}", rendered);

    // Must contain permanently expanded Done section:
    assert!(rendered.contains("Done · 1"), "Must show Done section:\n{}", rendered);
    assert!(rendered.contains("Setup config schema"), "Done tasks must always be expanded:\n{}", rendered);
    assert!(!rendered.contains("enter to expand"), "No enter to expand hint:\n{}", rendered);

    // Must contain footer with [Tab] Switch page:
    assert!(rendered.contains("[Tab] Switch page"), "Footer must include [Tab] Switch page:\n{}", rendered);
    assert!(!rendered.contains("Polling:"), "Footer must not contain Polling:\n{}", rendered);
    assert!(!rendered.contains("[READ-ONLY OBSERVER]"), "Footer must not contain observer tag:\n{}", rendered);

    // 2. Open Task detail modal with show_task_detail = true
    app.show_task_detail = true;

    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf2 = terminal.backend().buffer().clone();
    let mut rendered2 = String::new();
    for y in 0..24 {
        let mut line = String::new();
        for x in 0..100 {
            line.push_str(buf2[(x, y)].symbol());
        }
        rendered2.push_str(&line);
        rendered2.push('\n');
    }

    assert!(rendered2.contains("Task Details"), "Modal must show 'Task Details' title:\n{}", rendered2);
    assert!(rendered2.contains("Task ID:"), "Modal must show Task ID field:\n{}", rendered2);
    assert!(rendered2.contains("Status:"), "Modal must show Status field:\n{}", rendered2);
    assert!(rendered2.contains("Goal:"), "Modal must show Goal field:\n{}", rendered2);

    app.show_task_detail = false;

    // 3. Test row navigation across running, waiting, and done
    assert_eq!(app.selected_task_index, 0);
    app.select_next_task();
    assert_eq!(app.selected_task_index, 1);
    app.select_next_task();
    assert_eq!(app.selected_task_index, 2);
    assert_eq!(app.selected_task().unwrap().id, "task_003");
    app.select_previous_task();
    assert_eq!(app.selected_task_index, 1);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_footer_hints_on_both_pages() {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use crewmate_watch::app::AppPage;

    let dir = create_temp_dir("footer_hints");
    let mut app = App::new(dir.clone(), 10);

    let backend = TestBackend::new(140, 24);
    let mut terminal = Terminal::new(backend).unwrap();

    // 1. Page 1 (Workflow) footer
    app.current_page = AppPage::Workflow;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf1 = terminal.backend().buffer().clone();
    let mut rendered1 = String::new();
    for x in 0..140 {
        rendered1.push_str(buf1[(x, 23)].symbol());
    }
    // Global segment identical on every page
    assert!(rendered1.contains("[Tab] Switch page"), "Page 1 footer must include '[Tab] Switch page': {}", rendered1);
    assert!(rendered1.contains("[q] Quit"), "Page 1 footer must include '[q] Quit': {}", rendered1);
    assert!(rendered1.contains("[h] Help"), "Page 1 footer must include '[h] Help': {}", rendered1);
    assert!(!rendered1.contains("Polling:"), "Page 1 footer must not include Polling: {}", rendered1);
    assert!(!rendered1.contains("[READ-ONLY OBSERVER]"), "Page 1 footer must not include '[READ-ONLY OBSERVER]': {}", rendered1);
    // Page 1 specific hotkeys
    assert!(rendered1.contains("Pan"), "Page 1 footer must include 'Pan': {}", rendered1);
    assert!(rendered1.contains("Select"), "Page 1 footer must include 'Select': {}", rendered1);
    assert!(rendered1.contains("Inspect"), "Page 1 footer must include 'Inspect': {}", rendered1);
    // Page 1 must not show Page 2 hotkeys
    assert!(!rendered1.contains("Expand/collapse"), "Page 1 footer must not show Page 2 hotkeys: {}", rendered1);

    // 2. Page 2 (Tasks) footer
    app.current_page = AppPage::Tasks;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf2 = terminal.backend().buffer().clone();
    let mut rendered2 = String::new();
    for x in 0..140 {
        rendered2.push_str(buf2[(x, 23)].symbol());
    }
    // Global segment identical on every page
    assert!(rendered2.contains("[Tab] Switch page"), "Page 2 footer must include '[Tab] Switch page': {}", rendered2);
    assert!(rendered2.contains("[q] Quit"), "Page 2 footer must include '[q] Quit': {}", rendered2);
    assert!(rendered2.contains("[h] Help"), "Page 2 footer must include '[h] Help': {}", rendered2);
    assert!(!rendered2.contains("Polling:"), "Page 2 footer must not include Polling: {}", rendered2);
    assert!(!rendered2.contains("[READ-ONLY OBSERVER]"), "Page 2 footer must not include '[READ-ONLY OBSERVER]': {}", rendered2);
    // Page 2 specific hotkeys
    assert!(rendered2.contains("Select"), "Page 2 footer must include 'Select': {}", rendered2);
    assert!(rendered2.contains("Inspect"), "Page 2 footer must include 'Inspect': {}", rendered2);
    assert!(!rendered2.contains("Expand/collapse"), "Page 2 footer must not show old hotkey: {}", rendered2);

    // 3. Page 3 (Contracts) footer
    app.current_page = AppPage::Contracts;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf3 = terminal.backend().buffer().clone();
    let mut rendered3 = String::new();
    for x in 0..140 {
        rendered3.push_str(buf3[(x, 23)].symbol());
    }
    assert!(rendered3.contains("[Tab] Switch page"), "Page 3 footer must include '[Tab] Switch page': {}", rendered3);
    assert!(rendered3.contains("[m/a/p]"), "Page 3 footer must include '[m/a/p]': {}", rendered3);
    assert!(rendered3.contains("Sub-view"), "Page 3 footer must include 'Sub-view': {}", rendered3);
    assert!(rendered3.contains("Select"), "Page 3 footer must include 'Select': {}", rendered3);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_single_source_of_truth_across_pages() {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use serde_json::json;
    use chrono::Utc;
    use crewmate_watch::app::AppPage;

    let dir = create_temp_dir("single_source_truth");
    let crewmate_dir = dir.join(".crewmate");
    let tasks_dir = crewmate_dir.join("tasks");
    fs::create_dir_all(&tasks_dir).unwrap();

    // 1. Initial workflow with 3 stages: plan, execute, verify
    let graph_yaml = r#"
version: "1.0.0"
name: "Orchestration Pipeline"
initial: plan
nodes:
  - id: plan
    instructions: "Formulate architecture design"
    next: execute
  - id: execute
    instructions: "Implement parallel tasks"
    next: verify
  - id: verify
    instructions: "Run complete verification suite"
    next: done
"#;
    fs::write(dir.join("graph.yaml"), graph_yaml).unwrap();

    // Initial state: plan node, 0 retries
    let state_jsonl = r#"{"timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"plan"}
"#;
    fs::write(crewmate_dir.join("state.jsonl"), state_jsonl).unwrap();

    let mut app = App::new(dir.clone(), 10);
    app.poll_files();

    let backend = TestBackend::new(120, 24);
    let mut terminal = Terminal::new(backend).unwrap();

    // Render Page 1
    app.current_page = AppPage::Workflow;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();
    let buf1 = terminal.backend().buffer().clone();
    let mut p1_initial = String::new();
    for y in 0..24 {
        for x in 0..120 {
            p1_initial.push_str(buf1[(x, y)].symbol());
        }
        p1_initial.push('\n');
    }

    // Render Page 2
    app.current_page = AppPage::Tasks;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();
    let buf2 = terminal.backend().buffer().clone();
    let mut p2_initial = String::new();
    for y in 0..24 {
        for x in 0..120 {
            p2_initial.push_str(buf2[(x, y)].symbol());
        }
        p2_initial.push('\n');
    }

    // Both pages must show identical node position, retries, and offline status
    assert!(p1_initial.contains("Node: plan (1/3)"), "Page 1 must show Node: plan (1/3): {}", p1_initial);
    assert!(p2_initial.contains("Node: plan (1/3)"), "Page 2 must show Node: plan (1/3): {}", p2_initial);
    assert!(p1_initial.contains("Retries: 0/2"), "Page 1 must show Retries: 0/2: {}", p1_initial);
    assert!(p2_initial.contains("Retries: 0/2"), "Page 2 must show Retries: 0/2: {}", p2_initial);
    assert!(p1_initial.contains("Harness: OFFLINE"), "Page 1 must show Harness: OFFLINE: {}", p1_initial);
    assert!(p2_initial.contains("Harness: OFFLINE"), "Page 2 must show Harness: OFFLINE: {}", p2_initial);
    // Page 2 stage indicator must not be displayed
    assert!(!p2_initial.contains("stage 1/3 · plan"), "Page 2 must not show stage indicator line: {}", p2_initial);

    // 2. Now transition state: node transitions to execute, retry increments to 2 of 3, heartbeat is live
    let updated_state = r#"{"timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"plan"}
{"timestamp":"2026-09-26T12:01:00Z","event":"NODE_TRANSITION","from":"plan","to":"execute","reason":"advance"}
{"timestamp":"2026-09-26T12:02:00Z","event":"RETRY_INCREMENT","node":"execute","retryCount":2,"maxRetries":3}
"#;
    fs::write(crewmate_dir.join("state.jsonl"), updated_state).unwrap();

    let hb_json = json!({
        "harness": "OpenCode",
        "protocol": "plugin",
        "pid": 54321,
        "startedAt": Utc::now().to_rfc3339(),
        "lastHeartbeat": Utc::now().to_rfc3339(),
        "status": "running",
        "session": {
            "id": "ses_sync_test_99",
            "title": "Unified Chrome Test"
        }
    });
    fs::write(crewmate_dir.join("heartbeat.json"), serde_json::to_string_pretty(&hb_json).unwrap()).unwrap();

    // Poll to refresh
    app.poll_files();

    // Render Page 1 after transition
    app.current_page = AppPage::Workflow;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();
    let buf1_updated = terminal.backend().buffer().clone();
    let mut p1_updated = String::new();
    for y in 0..24 {
        for x in 0..120 {
            p1_updated.push_str(buf1_updated[(x, y)].symbol());
        }
        p1_updated.push('\n');
    }

    // Render Page 2 after transition
    app.current_page = AppPage::Tasks;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();
    let buf2_updated = terminal.backend().buffer().clone();
    let mut p2_updated = String::new();
    for y in 0..24 {
        for x in 0..120 {
            p2_updated.push_str(buf2_updated[(x, y)].symbol());
        }
        p2_updated.push('\n');
    }

    // Verify Page 1 and Page 2 updated identically and simultaneously:
    assert!(p1_updated.contains("Node: execute (2/3)"), "Page 1 updated node position: {}", p1_updated);
    assert!(p2_updated.contains("Node: execute (2/3)"), "Page 2 updated node position: {}", p2_updated);

    assert!(p1_updated.contains("Retries: 2/3"), "Page 1 updated retries: {}", p1_updated);
    assert!(p2_updated.contains("Retries: 2/3"), "Page 2 updated retries: {}", p2_updated);

    assert!(p1_updated.contains("RUNNING (OpenCode ses_sync)"), "Page 1 updated harness state: {}", p1_updated);
    assert!(p2_updated.contains("RUNNING (OpenCode ses_sync)"), "Page 2 updated harness state: {}", p2_updated);

    // Verify Page 2 does not have stage indicator or mini-graph dot connectors
    assert!(!p2_updated.contains("stage 2/3 · execute"), "Page 2 must not show stage indicator: {}", p2_updated);
    assert!(!p2_updated.contains("──●"), "Page 2 must not have mini-graph dot connectors: {}", p2_updated);

    // Verify active node instruction/goal is displayed in Page 1's Workflow Graph
    assert!(p1_updated.contains("Implement parallel tasks"), "Page 1 workflow graph must show active node instruction/goal: {}", p1_updated);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_contracts_loading_and_page_rendering() {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use crewmate_watch::app::AppPage;
    use crewmate_watch::data::contracts::ContractsSubView;

    let dir = create_temp_dir("contracts_test");
    let contracts_dir = dir.join(".crewmate").join("contracts");
    let modules_dir = contracts_dir.join("modules");
    fs::create_dir_all(&modules_dir).unwrap();

    let index_yaml = r#"version: "1.0.0"
modules:
  - name: auth
    responsibility: Authentication and session management
    path: src/auth
    version: "1.0.0"
    public_surface:
      - login
      - logout
  - name: notifications
    responsibility: Future notification delivery system
    path: src/notifications
    version: "0.1.0"
    public_surface:
      - sendAlert
"#;
    fs::write(contracts_dir.join("index.yaml"), index_yaml).unwrap();

    let arch_yaml = r#"version: "1.0.0"
modules:
  auth:
    responsibility: Authentication domain
    allowed_dependencies:
      - db
      - config
  notifications:
    responsibility: Notifications domain
    allowed_dependencies:
      - config
"#;
    fs::write(contracts_dir.join("architecture.yaml"), arch_yaml).unwrap();

    let caps_yaml = r#"capabilities:
  - name: user-login
    module: auth
    description: Authenticate user with credentials
    entrypoint: src/auth/index.ts
"#;
    fs::write(contracts_dir.join("capabilities.yaml"), caps_yaml).unwrap();

    let auth_contract_yaml = r#"module: auth
status: final
version: "1.0.0"
public_api:
  - export: login
    file: src/auth/index.ts
    signature: "(creds: Credentials) => Promise<Session>"
    description: Authenticate credentials
  - export: logout
    file: src/auth/index.ts
    signature: "() => Promise<void>"
invariants:
  - Sessions must expire after 24 hours
declared_consumers:
  - api-gateway
"#;
    fs::write(modules_dir.join("auth.contract.yaml"), auth_contract_yaml).unwrap();

    let notif_contract_yaml = r#"module: notifications
status: draft
version: "0.1.0"
public_api:
  - export: sendAlert
    file: src/notifications/alert.ts
    signature: "(msg: string) => Promise<void>"
    description: Send urgent alert
invariants:
  - Must not duplicate notifications
declared_consumers: []
"#;
    fs::write(modules_dir.join("notifications.contract.yaml"), notif_contract_yaml).unwrap();

    let mut app = App::new(dir.clone(), 10);
    assert!(app.contracts.loaded);
    assert_eq!(app.contracts.index.modules.len(), 2);
    assert_eq!(app.contracts.index.modules[0].name, "auth");
    assert_eq!(app.contracts.index.modules[0].public_surface.len(), 2);
    assert_eq!(app.contracts.architecture.modules.len(), 2);
    assert_eq!(
        app.contracts.architecture.modules["auth"].allowed_dependencies,
        vec!["db".to_string(), "config".to_string()]
    );
    assert_eq!(app.contracts.capabilities.capabilities.len(), 1);
    assert_eq!(app.contracts.capabilities.capabilities[0].name, "user-login");
    assert!(app.contracts.module_contracts.contains_key("auth"));
    assert_eq!(app.contracts.module_contracts["auth"].status, "final");
    assert_eq!(app.contracts.module_contracts["auth"].invariants.len(), 1);
    assert!(app.contracts.module_contracts.contains_key("notifications"));
    assert_eq!(app.contracts.module_contracts["notifications"].status, "draft");

    let backend = TestBackend::new(120, 30);
    let mut terminal = Terminal::new(backend).unwrap();

    // 1. Render Modules subview (selected module is auth)
    app.current_page = AppPage::Contracts;
    app.contracts_subview = ContractsSubView::Modules;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf_mods = terminal.backend().buffer().clone();
    let mut rendered_mods = String::new();
    for y in 0..30 {
        for x in 0..120 {
            rendered_mods.push_str(buf_mods[(x, y)].symbol());
        }
        rendered_mods.push('\n');
    }

    assert!(rendered_mods.contains("Contracts Registry"), "Must have Contracts Registry title: {}", rendered_mods);
    assert!(rendered_mods.contains("Modules (2)"), "Must show Modules (2): {}", rendered_mods);
    assert!(rendered_mods.contains("[DRAFT]"), "Must show [DRAFT] badge in module list: {}", rendered_mods);
    assert!(rendered_mods.contains("Module Contract: auth (v1.0.0, FINAL)"), "Must show Module Contract: auth: {}", rendered_mods);
    assert!(rendered_mods.contains("Status: FINAL (authoritative)"), "Must show status: {}", rendered_mods);
    assert!(rendered_mods.contains("Public API (2 exports)"), "Must show Public API: {}", rendered_mods);
    assert!(rendered_mods.contains("Sessions must expire after 24 hours"), "Must show invariant: {}", rendered_mods);
    assert!(rendered_mods.contains("db, config"), "Must show allowed dependencies: {}", rendered_mods);

    // Select notifications (draft module)
    app.selected_module_index = 1;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf_draft = terminal.backend().buffer().clone();
    let mut rendered_draft = String::new();
    for y in 0..30 {
        for x in 0..120 {
            rendered_draft.push_str(buf_draft[(x, y)].symbol());
        }
        rendered_draft.push('\n');
    }

    assert!(rendered_draft.contains("Module Contract: notifications (v0.1.0, DRAFT)"), "Must show draft title: {}", rendered_draft);
    assert!(rendered_draft.contains("Status: DRAFT (future contract)"), "Must show draft status: {}", rendered_draft);
    assert!(rendered_draft.contains("sendAlert"), "Must show sendAlert export: {}", rendered_draft);
    assert!(rendered_draft.contains("Must not duplicate notifications"), "Must show draft invariant: {}", rendered_draft);

    // 2. Render Architecture subview
    app.contracts_subview = ContractsSubView::Architecture;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf_arch = terminal.backend().buffer().clone();
    let mut rendered_arch = String::new();
    for y in 0..30 {
        for x in 0..120 {
            rendered_arch.push_str(buf_arch[(x, y)].symbol());
        }
        rendered_arch.push('\n');
    }

    assert!(rendered_arch.contains("Architecture & Dependency Graph"), "Must show Architecture title: {}", rendered_arch);
    assert!(rendered_arch.contains("allowed dependencies: db, config"), "Must show allowed dependencies in arch view: {}", rendered_arch);

    // 3. Render Capabilities subview
    app.contracts_subview = ContractsSubView::Capabilities;
    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf_caps = terminal.backend().buffer().clone();
    let mut rendered_caps = String::new();
    for y in 0..30 {
        for x in 0..120 {
            rendered_caps.push_str(buf_caps[(x, y)].symbol());
        }
        rendered_caps.push('\n');
    }

    assert!(rendered_caps.contains("Capabilities Registry"), "Must show Capabilities title: {}", rendered_caps);
    assert!(rendered_caps.contains("user-login"), "Must show capability name: {}", rendered_caps);
    assert!(rendered_caps.contains("src/auth/index.ts"), "Must show entrypoint: {}", rendered_caps);

    // Test subview cycling
    app.cycle_contracts_subview(); // Capabilities -> Modules
    assert_eq!(app.contracts_subview, ContractsSubView::Modules);
    app.cycle_contracts_subview(); // Modules -> Architecture
    assert_eq!(app.contracts_subview, ContractsSubView::Architecture);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_state_event_id_parsing_and_display() {
    let dir = create_temp_dir("state_event_id");
    let crewmate_dir = dir.join(".crewmate");
    fs::create_dir_all(&crewmate_dir).unwrap();
    fs::write(crewmate_dir.join("activity.jsonl"), "").unwrap();

    // 1. Write state.jsonl with a modern event (with id) and legacy event (without id)
    let state_jsonl = r#"{"id":"evt_1a2b3c4d","timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"plan"}
{"timestamp":"2026-09-26T12:01:00Z","event":"NODE_TRANSITION","from":"plan","to":"execute","reason":"advance"}
"#;
    fs::write(crewmate_dir.join("state.jsonl"), state_jsonl).unwrap();

    let mut app = App::new(dir.clone(), 10);
    app.poll_files();

    assert_eq!(app.activity.recent_events.len(), 2);

    // Newer event (NODE_TRANSITION at 12:01:00Z) is first because recent_events is sorted desc by timestamp
    let trans_ev = &app.activity.recent_events[0];
    assert_eq!(trans_ev.event_type, "TRANSITION");
    assert_eq!(trans_ev.short_id, "-");
    assert_eq!(trans_ev.full_id, "-");

    // Older event (INIT with id at 12:00:00Z) has parsed id
    let init_ev = &app.activity.recent_events[1];
    assert_eq!(init_ev.event_type, "INIT");
    assert_eq!(init_ev.full_id, "evt_1a2b3c4d");
    assert!(init_ev.short_id.starts_with("evt_1a2b3"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_header_no_elapsed_timer() {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    let dir = create_temp_dir("header_no_timer");
    let crewmate_dir = dir.join(".crewmate");
    fs::create_dir_all(&crewmate_dir).unwrap();

    let state_jsonl = r#"{"timestamp":"2026-09-26T12:00:00Z","event":"INIT","initialNode":"plan"}
{"timestamp":"2026-09-26T12:01:00Z","event":"NODE_TRANSITION","from":"plan","to":"execute","reason":"advance"}
"#;
    fs::write(crewmate_dir.join("state.jsonl"), state_jsonl).unwrap();

    let mut app = App::new(dir.clone(), 10);
    app.poll_files();

    let backend = TestBackend::new(120, 24);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf = terminal.backend().buffer().clone();
    let mut header_rendered = String::new();
    for x in 0..120 {
        header_rendered.push_str(buf[(x, 1)].symbol());
    }

    // Header contains workflow title & node & harness, but no trailing elapsed timer
    assert!(header_rendered.contains("feature-pipeline"), "Header should have workflow name: {}", header_rendered);
    assert!(header_rendered.contains("execute"), "Header should have current node: {}", header_rendered);
    assert!(header_rendered.contains("Harness: OFFLINE"), "Header should have harness: {}", header_rendered);
    assert!(!header_rendered.contains("s │") && !header_rendered.contains("m │"), "Header should not have elapsed timer: {}", header_rendered);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_contracts_subview_cycle_back_and_forward() {
    use crewmate_watch::data::contracts::ContractsSubView;

    let dir = create_temp_dir("contracts_cycle");
    let mut app = App::new(dir.clone(), 10);

    assert_eq!(app.contracts_subview, ContractsSubView::Modules);

    // Forward cycle
    app.cycle_contracts_subview();
    assert_eq!(app.contracts_subview, ContractsSubView::Architecture);
    app.cycle_contracts_subview();
    assert_eq!(app.contracts_subview, ContractsSubView::Capabilities);
    app.cycle_contracts_subview();
    assert_eq!(app.contracts_subview, ContractsSubView::Modules);

    // Backward cycle
    app.cycle_contracts_subview_back();
    assert_eq!(app.contracts_subview, ContractsSubView::Capabilities);
    app.cycle_contracts_subview_back();
    assert_eq!(app.contracts_subview, ContractsSubView::Architecture);
    app.cycle_contracts_subview_back();
    assert_eq!(app.contracts_subview, ContractsSubView::Modules);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_contracts_fullscreen_detail_open_and_close() {
    use crewmate_watch::app::AppPage;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    let dir = create_temp_dir("contracts_fullscreen");
    let contracts_dir = dir.join(".crewmate").join("contracts");
    let modules_dir = contracts_dir.join("modules");
    fs::create_dir_all(&modules_dir).unwrap();

    let index_yaml = r#"
version: 1.0.0
modules:
  - name: auth
    responsibility: Authentication and session management
    path: src/auth
    version: 1.2.0
    public_surface:
      - src/auth/index.ts
"#;
    fs::write(contracts_dir.join("index.yaml"), index_yaml).unwrap();

    let auth_contract = r#"
module: auth
status: final
version: 1.2.0
public_api:
  - export: authenticateUser
    signature: "(creds: Credentials) => Promise<Session>"
    file: src/auth/login.ts
    description: Authenticate user credentials and return active session
invariants:
  - Sessions must expire after 24 hours
declared_consumers:
  - api-gateway
"#;
    fs::write(modules_dir.join("auth.contract.yaml"), auth_contract).unwrap();

    let mut app = App::new(dir.clone(), 10);
    app.poll_files();
    app.current_page = AppPage::Contracts;

    assert!(!app.show_contract_detail);

    // Open detail
    app.open_contract_detail();
    assert!(app.show_contract_detail);
    assert_eq!(app.contract_detail_scroll, 0);

    // Scroll
    app.scroll_contract_detail_down();
    assert_eq!(app.contract_detail_scroll, 1);
    app.scroll_contract_detail_up();
    assert_eq!(app.contract_detail_scroll, 0);

    // Render fullscreen
    let backend = TestBackend::new(120, 30);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal.draw(|f| {
        crewmate_watch::ui::render(f, &app);
    }).unwrap();

    let buf = terminal.backend().buffer().clone();
    let mut rendered = String::new();
    for y in 0..30 {
        for x in 0..120 {
            rendered.push_str(buf[(x, y)].symbol());
        }
        rendered.push('\n');
    }

    assert!(rendered.contains("[FULL SCREEN] Module Contract: auth"), "Must contain fullscreen header: {}", rendered);
    assert!(rendered.contains("authenticateUser"), "Must contain export: {}", rendered);
    assert!(rendered.contains("Sessions must expire after 24 hours"), "Must contain invariant: {}", rendered);
    assert!(rendered.contains("Close Fullscreen"), "Footer must show close hint: {}", rendered);

    // Close detail
    app.close_contract_detail();
    assert!(!app.show_contract_detail);

    let _ = fs::remove_dir_all(&dir);
}
