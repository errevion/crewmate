pub mod activities;
pub mod contracts;
pub mod events;
pub mod footer;
pub mod graph;
pub mod header;
pub mod help;
pub mod tasks;

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::app::{App, AppPage};
use self::activities::render_activities;
use self::contracts::render_contracts_page;
use self::events::{render_event_detail_modal, render_recent_events};
use self::footer::render_footer;
use self::graph::{render_canvas_graph, render_compressed_graph};
use self::header::render_header;
use self::help::render_help_overlay;
use self::tasks::{render_task_detail_modal, render_tasks_page};

pub fn render(f: &mut Frame, app: &App) {
    let size = f.area();

    // Ultra-compact mode for very tiny terminal dimensions
    if size.width < 45 || size.height < 10 {
        if app.current_page == AppPage::Tasks {
            render_tasks_ultra_compact(f, app, size);
            if app.show_task_detail {
                render_task_detail_modal(f, app, size);
            }
        } else if app.current_page == AppPage::Contracts {
            render_contracts_ultra_compact(f, app, size);
        } else {
            render_ultra_compact(f, app, size);
            if app.show_event_detail {
                render_event_detail_modal(f, app, size);
            }
        }
        if app.show_help {
            render_help_overlay(f, size);
        }
        return;
    }

    if app.current_page == AppPage::Tasks {
        render_tasks_page(f, app, size);
        if app.show_task_detail {
            render_task_detail_modal(f, app, size);
        }
        if app.show_help {
            render_help_overlay(f, size);
        }
        return;
    }

    if app.current_page == AppPage::Contracts {
        render_contracts_page(f, app, size);
        if app.show_help {
            render_help_overlay(f, size);
        }
        return;
    }

    // Graceful degradation layout decisions:
    let is_narrow = size.width < 90;
    let is_very_narrow = size.width < 60;
    let is_short = size.height < 22;

    // Outer vertical layout:
    // 1. Header (fixed height 3)
    // 2. Graph (canvas height ~12, or compressed height 3)
    // 3. Lower panels (activities & events)
    // 4. Footer (fixed height 1)

    let graph_compressed = is_very_narrow || is_short;
    let graph_height = if graph_compressed { 3 } else { 12 };

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),               // Header
            Constraint::Length(graph_height),    // Graph (canvas or compressed)
            Constraint::Min(4),                  // Lower panels
            Constraint::Length(1),               // Footer
        ])
        .split(size);

    // 1. Render Header
    render_header(f, app, chunks[0], None);

    // 2. Render Graph (Canvas vs Compressed)
    if graph_compressed {
        render_compressed_graph(f, app, chunks[1]);
    } else {
        render_canvas_graph(f, app, chunks[1]);
    }

    // 3. Render Lower Panels
    // Narrow drops events panel first, leaving activities panel 100% width
    if is_narrow {
        render_activities(f, app, chunks[2]);
    } else {
        let bottom_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(chunks[2]);

        render_activities(f, app, bottom_chunks[0]);
        render_recent_events(f, app, bottom_chunks[1]);
    }

    // 4. Render Footer
    render_footer(f, app, chunks[3]);

    // If event detail modal is active, render on top
    if app.show_event_detail {
        render_event_detail_modal(f, app, size);
    }

    // If help modal is active, render on top
    if app.show_help {
        render_help_overlay(f, size);
    }
}

fn render_tasks_ultra_compact(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(1),
        ])
        .split(area);

    let wf_name = app.workflow_display_name();
    let header_line = Line::from(vec![
        Span::styled(format!("{} ", wf_name), Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::styled(format!("│ Tasks: {}/{}", app.task_snapshot.done_count, app.task_snapshot.total_count), Style::default().fg(Color::Yellow)),
    ]);
    f.render_widget(Paragraph::new(header_line), chunks[0]);

    let counts_line = Line::from(vec![
        Span::styled(
            format!(
                "{} done · {} run · {} wait",
                app.task_snapshot.done_count,
                app.task_snapshot.running_count,
                app.task_snapshot.waiting_count
            ),
            Style::default().fg(Color::Green),
        ),
    ]);
    f.render_widget(Paragraph::new(counts_line), chunks[1]);

    let summary = if let Some(first) = app.task_snapshot.running.first() {
        format!("Run: {}", first.goal)
    } else if let Some(first) = app.task_snapshot.waiting.first() {
        format!("Wait: {}", first.goal)
    } else {
        "No active tasks".to_string()
    };
    f.render_widget(Paragraph::new(summary), chunks[2]);
    render_footer(f, app, chunks[3]);
}

fn render_ultra_compact(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(2),
            Constraint::Length(1),
        ])
        .split(area);

    let wf_name = app.workflow_display_name();
    let curr = app.state.current_node.as_deref().unwrap_or("-");
    let header_line = Line::from(vec![
        Span::styled(format!("{} ", wf_name), Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::styled(format!("│ Node: {}", curr), Style::default().fg(Color::Yellow)),
    ]);
    f.render_widget(Paragraph::new(header_line), chunks[0]);

    render_compressed_graph(f, app, chunks[1]);
    render_activities(f, app, chunks[2]);
    render_footer(f, app, chunks[3]);
}

fn render_contracts_ultra_compact(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(2),
            Constraint::Length(1),
        ])
        .split(area);

    let summary = Line::from(vec![
        Span::styled("Contracts: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::styled(format!("{} modules", app.contracts.index.modules.len()), Style::default().fg(Color::White)),
    ]);
    f.render_widget(Paragraph::new(summary), chunks[0]);

    let desc = if let Some(m) = app.selected_module() {
        format!("{}: {}", m.name, m.responsibility)
    } else {
        "No contracts loaded".to_string()
    };
    f.render_widget(Paragraph::new(desc), chunks[1]);
    render_footer(f, app, chunks[2]);
}
