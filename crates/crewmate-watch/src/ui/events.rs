use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, List, ListItem, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::App;
use crate::data::activity::{format_local_datetime, FormattedRecentEvent};

pub fn render_recent_events(f: &mut Frame, app: &App, area: Rect) {
    let events = &app.activity.recent_events;
    let title = format!(" Recent Events ({}) ", events.len());

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            title,
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ));

    if events.is_empty() {
        let p = Paragraph::new("No recent events")
            .style(Style::default().fg(Color::DarkGray))
            .block(block)
            .alignment(Alignment::Center);
        f.render_widget(p, area);
        return;
    }

    let inner_height = area.height.saturating_sub(2) as usize;
    let total_events = events.len();
    let selected_idx = app.selected_event_index.min(total_events.saturating_sub(1));

    // Auto-scroll viewport so selected_idx is always in view
    let start_idx = if selected_idx < inner_height {
        0
    } else {
        selected_idx.saturating_sub(inner_height.saturating_sub(1))
    };
    let end_idx = (start_idx + inner_height).min(total_events);

    let inner_width = area.width.saturating_sub(2) as usize;
    let visible_events = &events[start_idx..end_idx];

    let list_items: Vec<ListItem> = visible_events
        .iter()
        .enumerate()
        .map(|(offset, ev)| {
            let actual_idx = start_idx + offset;
            let is_selected = actual_idx == selected_idx;

            let type_style = if ev.event_type == "START" {
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD)
            } else if ev.event_type.contains("completed") {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else if ev.event_type.contains("failed") {
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)
            } else {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            };

            let pointer_span = if is_selected {
                Span::styled(
                    "▶ ",
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                )
            } else {
                Span::raw("  ")
            };

            let prefix_fixed = 2 + 11 + 15 + ev.short_id.len() + 1 + ev.agent.len() + 2;
            let label_avail = inner_width.saturating_sub(prefix_fixed);

            let label_display = if ev.label.chars().count() + 2 <= label_avail {
                format!("\"{}\"", ev.label)
            } else if label_avail > 5 {
                let take_chars = label_avail.saturating_sub(5);
                let truncated: String = ev.label.chars().take(take_chars).collect();
                format!("\"{}...\"", truncated)
            } else {
                "...".to_string()
            };

            let label_style = if is_selected {
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            let spans = vec![
                pointer_span,
                Span::styled(
                    format!("[{}] ", ev.timestamp_str),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(format!("{: <14} ", ev.event_type), type_style),
                Span::styled(
                    format!("{} ", ev.short_id),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(format!("{}: ", ev.agent), Style::default().fg(Color::Cyan)),
                Span::styled(label_display, label_style),
            ];

            ListItem::new(Line::from(spans))
        })
        .collect();

    let list = List::new(list_items).block(block);
    f.render_widget(list, area);
}

pub fn render_event_detail_modal(f: &mut Frame, app: &App, area: Rect) {
    let ev: &FormattedRecentEvent = match app.selected_event() {
        Some(e) => e,
        None => return,
    };

    let modal_width = (area.width * 7 / 10).clamp(46, 70);
    let modal_height = (area.height * 7 / 10).clamp(13, 18);

    let modal_x = area.x + (area.width.saturating_sub(modal_width)) / 2;
    let modal_y = area.y + (area.height.saturating_sub(modal_height)) / 2;

    let modal_area = Rect {
        x: modal_x,
        y: modal_y,
        width: modal_width.min(area.width),
        height: modal_height.min(area.height),
    };

    f.render_widget(Clear, modal_area);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " Event Details ",
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ));

    let type_style = if ev.event_type == "START" {
        Style::default()
            .fg(Color::Green)
            .add_modifier(Modifier::BOLD)
    } else if ev.event_type.contains("completed") {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else if ev.event_type.contains("failed") {
        Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)
    } else {
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD)
    };

    let mut text_lines = vec![
        Line::from(vec![
            Span::styled("Event Type:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("[{}]", ev.event_type), type_style),
        ]),
        Line::from(vec![
            Span::styled("Timestamp:   ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format_local_datetime(&ev.full_timestamp),
                Style::default().fg(Color::White),
            ),
        ]),
        Line::from(vec![
            Span::styled("Activity ID: ", Style::default().fg(Color::DarkGray)),
            Span::styled(ev.full_id.clone(), Style::default().fg(Color::Cyan)),
        ]),
        Line::from(vec![
            Span::styled("Agent:       ", Style::default().fg(Color::DarkGray)),
            Span::styled(ev.agent.clone(), Style::default().fg(Color::White)),
        ]),
    ];

    if let Some(ref node) = ev.node {
        text_lines.push(Line::from(vec![
            Span::styled("Node:        ", Style::default().fg(Color::DarkGray)),
            Span::styled(node.clone(), Style::default().fg(Color::Yellow)),
        ]));
    }

    text_lines.push(Line::raw(""));
    text_lines.push(Line::from(vec![Span::styled(
        "Activity Label:",
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
    )]));
    text_lines.push(Line::from(vec![Span::styled(
        format!("\"{}\"", ev.label),
        Style::default().fg(Color::White),
    )]));
    text_lines.push(Line::raw(""));
    text_lines.push(Line::from(vec![
        Span::styled("Press ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            "Esc",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" or ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            "Enter",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" to close this view.", Style::default().fg(Color::DarkGray)),
    ]));

    let paragraph = Paragraph::new(text_lines)
        .block(block)
        .alignment(Alignment::Left)
        .wrap(Wrap { trim: true });

    f.render_widget(paragraph, modal_area);
}
