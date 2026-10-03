use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};
use ratatui::Frame;

use crate::app::App;

pub fn render_header(f: &mut Frame, app: &App, area: Rect, subtitle: Option<&str>) {
    // Single source of truth: Node position info: e.g. "execute (2/3)"
    let (node_name, idx, total) = app.current_node_position();
    let pos_display = if idx > 0 && total > 0 {
        format!("({}/{})", idx, total)
    } else if total > 0 {
        format!("(-/{})", total)
    } else {
        "(-/-)".to_string()
    };

    // Single source of truth: Retries
    let retry_count = app.state.current_retry_count();
    let max_retries = app.state.current_max_retries();
    let retry_str = format!("{}/{}", retry_count, max_retries);

    let retry_style = if retry_count > 0 {
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::White)
    };

    // Single source of truth: Workflow display name
    let workflow_name = app.workflow_display_name();

    // 1. <workflow name>
    let mut line_spans = vec![Span::styled(
        format!(" {} ", workflow_name),
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )];

    if let Some(ref run_id) = app.state.current_run_id {
        line_spans.push(Span::styled(
            format!("({}) ", run_id),
            Style::default().fg(Color::DarkGray),
        ));
    }

    // 2. | Node: <node> (<i>/<n>)
    // 3. | Retries: <r>/<max>
    line_spans.extend(vec![
        Span::styled("│ Node: ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            node_name,
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" "),
        Span::styled(pos_display, Style::default().fg(Color::DarkGray)),
        Span::styled(" │ Retries: ", Style::default().fg(Color::DarkGray)),
        Span::styled(retry_str, retry_style),
    ]);

    if let Some(ref target) = app.state.escalation_target {
        line_spans.push(Span::styled(
            " │ Escalated: ",
            Style::default().fg(Color::DarkGray),
        ));
        line_spans.push(Span::styled(
            target,
            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        ));
    }

    // 4. | Harness: <state> (<runtime> <session_id>)
    let (harness_color, harness_text) = match app.heartbeat.status_text.as_str() {
        "RUNNING" => (Color::Green, "RUNNING"),
        "IDLE" => (Color::Cyan, "IDLE"),
        _ => (Color::Red, "OFFLINE"),
    };
    line_spans.push(Span::styled(
        " │ Harness: ",
        Style::default().fg(Color::DarkGray),
    ));
    line_spans.push(Span::styled(
        harness_text,
        Style::default()
            .fg(harness_color)
            .add_modifier(Modifier::BOLD),
    ));

    if app.heartbeat.is_alive {
        let harness_label = app.heartbeat.harness_name.as_deref().unwrap_or("OpenCode");
        let short_sid =
            app.heartbeat.session_id.as_deref().map(
                |sid| {
                    if sid.len() > 8 {
                        &sid[..8]
                    } else {
                        sid
                    }
                },
            );

        let label = match short_sid {
            Some(sid) => format!(" ({} {})", harness_label, sid),
            None => format!(" ({})", harness_label),
        };
        line_spans.push(Span::styled(label, Style::default().fg(Color::DarkGray)));
    } else if let Some(ref h) = app.heartbeat.harness_name {
        line_spans.push(Span::styled(
            format!(" ({})", h),
            Style::default().fg(Color::DarkGray),
        ));
    }

    let mut block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray));

    if app.state.status == "escalated" {
        block = block.title(Span::styled(
            " [ESCALATED] ",
            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        ));
    }

    let mut lines = vec![Line::from(line_spans)];

    // If an optional subtitle is present and space allows, render as a second row below the main header line
    if let Some(sub) = subtitle {
        if !sub.trim().is_empty() && area.height >= 4 {
            let inner_width = area.width.saturating_sub(4) as usize;
            let truncated = if sub.len() > inner_width && inner_width > 3 {
                format!("{}…", &sub[..inner_width - 3])
            } else {
                sub.to_string()
            };
            lines.push(Line::from(vec![
                Span::raw(" "),
                Span::styled(truncated, Style::default().fg(Color::White)),
            ]));
        }
    }

    let paragraph = Paragraph::new(lines)
        .block(block)
        .alignment(Alignment::Left);

    f.render_widget(paragraph, area);
}
