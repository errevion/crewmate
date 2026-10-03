use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, List, ListItem, Paragraph};
use ratatui::Frame;

use crate::app::App;
use crate::data::activity::{format_elapsed, format_short_id};

pub fn render_activities(f: &mut Frame, app: &App, area: Rect) {
    let items = &app.activity.active_tree;

    let title = match app.heartbeat.status_text.as_str() {
        "RUNNING" => format!(" Activities ({}) ", items.len()),
        "IDLE" => format!(" Activities ({} - IDLE) ", items.len()),
        _ => format!(" Activities ({} - OFFLINE) ", items.len()),
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            title,
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    if items.is_empty() {
        let p = Paragraph::new("No activities (idle)")
            .style(Style::default().fg(Color::DarkGray))
            .block(block)
            .alignment(Alignment::Center);
        f.render_widget(p, area);
        return;
    }

    // Compute subtle pulse for active status dot using tachyonfx
    let elapsed_ms = app.start_time.elapsed().as_millis() as f64;
    // 0.8 Hz frequency sine wave
    let wave = ((elapsed_ms / 350.0).sin() * 0.5 + 0.5) as f32;
    // Interpolate lightness between 0.35 and 0.70 in HSL green (120 deg)
    let dot_color = tachyonfx::color_from_hsl(120.0, 0.95, 0.35 + 0.35 * wave);

    let inner_width = area.width.saturating_sub(2) as usize;

    let list_items: Vec<ListItem> = items
        .iter()
        .map(|item| {
            let elapsed = format_elapsed(&item.start_at);
            let short_id = format_short_id(&item.id);

            let indent_prefix = if item.depth == 0 {
                String::new()
            } else {
                let spaces = "   ".repeat(item.depth - 1);
                format!("{}└─ ", spaces)
            };

            let mut spans = Vec::new();

            if !indent_prefix.is_empty() {
                spans.push(Span::styled(indent_prefix.clone(), Style::default().fg(Color::DarkGray)));
            }

            // Status indicator and elapsed badge based on liveness
            let (elapsed_badge_len, is_dimmed) = match app.heartbeat.status_text.as_str() {
                "RUNNING" => {
                    spans.push(Span::styled("● ", Style::default().fg(dot_color).add_modifier(Modifier::BOLD)));
                    spans.push(Span::styled(
                        format!("[{}] ", elapsed),
                        Style::default().fg(Color::Cyan),
                    ));
                    (elapsed.len() + 3, false)
                }
                "IDLE" => {
                    spans.push(Span::styled("○ ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)));
                    spans.push(Span::styled(
                        format!("[{}] [idle] ", elapsed),
                        Style::default().fg(Color::Cyan),
                    ));
                    (elapsed.len() + 10, false)
                }
                _ => {
                    spans.push(Span::styled("○ ", Style::default().fg(Color::DarkGray)));
                    spans.push(Span::styled(
                        format!("[{}] [offline] ", elapsed),
                        Style::default().fg(Color::DarkGray),
                    ));
                    (elapsed.len() + 13, true)
                }
            };

            // Calculate available width for label
            let agent_len = item.agent.len() + 3; // " (agent)"
            let short_id_len = short_id.len() + 2; // " #id"
            let fixed_w = indent_prefix.len() + 2 + elapsed_badge_len + agent_len + short_id_len;
            let label_avail = inner_width.saturating_sub(fixed_w);

            let label_display = if item.label.chars().count() <= label_avail {
                item.label.clone()
            } else if label_avail > 3 {
                let take_chars = label_avail.saturating_sub(3);
                let truncated: String = item.label.chars().take(take_chars).collect();
                format!("{}...", truncated)
            } else {
                "...".to_string()
            };

            let label_style = if is_dimmed {
                Style::default().fg(Color::DarkGray)
            } else {
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD)
            };

            // Activity label
            spans.push(Span::styled(label_display, label_style));

            // Agent name
            spans.push(Span::styled(
                format!(" ({})", item.agent),
                Style::default().fg(Color::Cyan),
            ));

            // Short ID
            spans.push(Span::styled(
                format!(" #{}", short_id),
                Style::default().fg(Color::DarkGray),
            ));

            ListItem::new(Line::from(spans))
        })
        .collect();

    let list = List::new(list_items).block(block);
    f.render_widget(list, area);
}
