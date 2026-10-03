use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::App;
use crate::data::activity::format_local_datetime;
use crate::data::task::TaskItem;
use crate::ui::footer::render_footer;
use crate::ui::header::render_header;

pub fn render_tasks_page(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Shared Header
            Constraint::Min(4),    // Tasks Content Panel (progress, tasks)
            Constraint::Length(1), // Shared Footer
        ])
        .split(area);

    render_header(f, app, chunks[0], None);
    render_tasks_content_panel(f, app, chunks[1]);
    render_footer(f, app, chunks[2]);
}

fn render_tasks_content_panel(f: &mut Frame, app: &App, area: Rect) {
    let inner_width = area.width.saturating_sub(4) as usize;
    let available_height = area.height.saturating_sub(2) as usize;

    let mut lines: Vec<Line> = Vec::new();
    let mut selectable_row_index: usize = 0;
    let mut task_row_indices: Vec<usize> = Vec::new();

    // 1. Progress bar
    let total = app.task_snapshot.total_count;
    let done = app.task_snapshot.done_count;
    let running = app.task_snapshot.running_count;
    let waiting = app.task_snapshot.waiting_count;

    let bar_width = inner_width.clamp(10, 50);

    let progress_spans = if let (Some(done_width), Some(running_width)) = (
        (done * bar_width).checked_div(total),
        (running * bar_width).checked_div(total),
    ) {
        let done_w = if done > 0 && done_width == 0 {
            1
        } else {
            done_width
        };
        let running_w = if running > 0 && running_width == 0 {
            1
        } else {
            running_width
        };
        let waiting_w = bar_width.saturating_sub(done_w + running_w);

        vec![
            Span::raw(" "),
            Span::styled("█".repeat(done_w), Style::default().fg(Color::Green)),
            Span::styled("█".repeat(running_w), Style::default().fg(Color::Yellow)),
            Span::styled("█".repeat(waiting_w), Style::default().fg(Color::DarkGray)),
        ]
    } else {
        vec![
            Span::raw(" "),
            Span::styled("─".repeat(bar_width), Style::default().fg(Color::DarkGray)),
        ]
    };
    lines.push(Line::from(progress_spans));

    // 2. <done>/<total> done · <n> running · <n> waiting
    let counts_line = Line::from(vec![
        Span::raw(" "),
        Span::styled(
            format!("{}/{} done", done, total),
            Style::default().fg(Color::Green),
        ),
        Span::styled(" · ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            format!("{} running", running),
            Style::default().fg(Color::Yellow),
        ),
        Span::styled(" · ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            format!("{} waiting", waiting),
            Style::default().fg(Color::DarkGray),
        ),
    ]);
    lines.push(counts_line);
    lines.push(Line::raw(""));

    // 3. Running · <n>
    lines.push(Line::from(vec![
        Span::raw(" "),
        Span::styled(
            "Running · ",
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("{}", app.task_snapshot.running.len()),
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ),
    ]));

    if app.task_snapshot.running.is_empty() {
        lines.push(Line::from(vec![Span::styled(
            "   (no active tasks)",
            Style::default().fg(Color::DarkGray),
        )]));
    } else {
        for task in &app.task_snapshot.running {
            let is_selected = selectable_row_index == app.selected_task_index;
            task_row_indices.push(lines.len());
            selectable_row_index += 1;

            let row_style = if is_selected {
                Style::default().bg(Color::Rgb(26, 38, 54))
            } else {
                Style::default()
            };

            let prefix = if is_selected {
                Span::styled(
                    "▌ ",
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                )
            } else {
                Span::raw("  ")
            };

            let dot = Span::styled(
                "● ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            );

            let right_side = format!("{:>12}  {:>7}", task.agent, task.elapsed_str);
            let right_len = right_side.len();
            let max_label_len = inner_width.saturating_sub(right_len + 6);

            let label = if task.goal.len() > max_label_len && max_label_len > 3 {
                format!("{}…", &task.goal[..max_label_len - 1])
            } else {
                task.goal.clone()
            };

            let pad_len = inner_width.saturating_sub(label.len() + right_len + 4);
            let pad = " ".repeat(pad_len);

            lines.push(
                Line::from(vec![
                    prefix,
                    dot,
                    Span::styled(label, Style::default().fg(Color::White)),
                    Span::raw(pad),
                    Span::styled(
                        format!("{:>12}", task.agent),
                        Style::default().fg(Color::Cyan),
                    ),
                    Span::raw("  "),
                    Span::styled(
                        format!("{:>7}", task.elapsed_str),
                        Style::default().fg(Color::Yellow),
                    ),
                ])
                .style(row_style),
            );
        }
    }

    lines.push(Line::raw(""));

    // 4. Waiting · <n>
    lines.push(Line::from(vec![
        Span::raw(" "),
        Span::styled(
            "Waiting · ",
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("{}", app.task_snapshot.waiting.len()),
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        ),
    ]));

    if app.task_snapshot.waiting.is_empty() {
        lines.push(Line::from(vec![Span::styled(
            "   (none waiting)",
            Style::default().fg(Color::DarkGray),
        )]));
    } else {
        for task in &app.task_snapshot.waiting {
            let is_selected = selectable_row_index == app.selected_task_index;
            task_row_indices.push(lines.len());
            selectable_row_index += 1;

            let row_style = if is_selected {
                Style::default().bg(Color::Rgb(26, 38, 54))
            } else {
                Style::default()
            };

            let prefix = if is_selected {
                Span::styled(
                    "▌ ",
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                )
            } else {
                Span::raw("  ")
            };

            let dot = Span::styled("o ", Style::default().fg(Color::DarkGray));

            let dep_text = task.blocking_reason.as_deref().unwrap_or("");
            let dep_len = dep_text.len();
            let max_label_len = inner_width.saturating_sub(dep_len + 6);

            let label = if task.goal.len() > max_label_len && max_label_len > 3 {
                format!("{}…", &task.goal[..max_label_len - 1])
            } else {
                task.goal.clone()
            };

            let pad_len = inner_width.saturating_sub(label.len() + dep_len + 4);
            let pad = " ".repeat(pad_len);

            let dep_style = if dep_text.contains("lock") {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default().fg(Color::DarkGray)
            };

            lines.push(
                Line::from(vec![
                    prefix,
                    dot,
                    Span::styled(label, Style::default().fg(Color::White)),
                    Span::raw(pad),
                    Span::styled(dep_text, dep_style),
                ])
                .style(row_style),
            );
        }
    }

    lines.push(Line::raw(""));

    // 5. Done · <n> (Always expanded)
    lines.push(Line::from(vec![
        Span::raw(" "),
        Span::styled(
            "Done · ",
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("{}", app.task_snapshot.done.len()),
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD),
        ),
    ]));

    if app.task_snapshot.done.is_empty() {
        lines.push(Line::from(vec![Span::styled(
            "   (none done)",
            Style::default().fg(Color::DarkGray),
        )]));
    } else {
        for task in &app.task_snapshot.done {
            let is_selected = selectable_row_index == app.selected_task_index;
            task_row_indices.push(lines.len());
            selectable_row_index += 1;

            let row_style = if is_selected {
                Style::default().bg(Color::Rgb(26, 38, 54))
            } else {
                Style::default()
            };

            let prefix = if is_selected {
                Span::styled(
                    "▌ ",
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                )
            } else {
                Span::raw("  ")
            };

            let mark = Span::styled("✓ ", Style::default().fg(Color::Green));

            let elapsed_str = &task.elapsed_str;
            let right_len = elapsed_str.len();
            let max_label_len = inner_width.saturating_sub(right_len + 6);

            let label = if task.goal.len() > max_label_len && max_label_len > 3 {
                format!("{}…", &task.goal[..max_label_len - 1])
            } else {
                task.goal.clone()
            };

            let pad_len = inner_width.saturating_sub(label.len() + right_len + 4);
            let pad = " ".repeat(pad_len);

            lines.push(
                Line::from(vec![
                    prefix,
                    mark,
                    Span::styled(label, Style::default().fg(Color::DarkGray)),
                    Span::raw(pad),
                    Span::styled(elapsed_str.clone(), Style::default().fg(Color::DarkGray)),
                ])
                .style(row_style),
            );
        }
    }

    let total_tasks = task_row_indices.len();
    let lines_count = lines.len();

    let scroll_offset = if lines_count > available_height && total_tasks > 0 {
        let sel_idx = app.selected_task_index.min(total_tasks - 1);
        let target_row = task_row_indices[sel_idx];
        let max_scroll = lines_count.saturating_sub(available_height);
        if target_row >= available_height {
            (target_row + 1)
                .saturating_sub(available_height)
                .min(max_scroll)
        } else {
            0
        }
    } else {
        0
    };

    let title = if total_tasks == 0 {
        " Tasks (0) ".to_string()
    } else if lines_count > available_height {
        let current_num = app.selected_task_index.min(total_tasks - 1) + 1;
        format!(" Tasks ({}/{}) [↑/↓ scroll] ", current_num, total_tasks)
    } else {
        format!(" Tasks ({}) ", total_tasks)
    };

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

    let visible_lines: Vec<Line> = lines
        .into_iter()
        .skip(scroll_offset)
        .take(available_height)
        .collect();

    let paragraph = Paragraph::new(visible_lines).block(block);
    f.render_widget(paragraph, area);
}

pub fn render_task_detail_modal(f: &mut Frame, app: &App, area: Rect) {
    let task: &TaskItem = match app.selected_task() {
        Some(t) => t,
        None => return,
    };

    let modal_width = (area.width * 7 / 10).clamp(50, 76);
    let modal_height = (area.height * 7 / 10).clamp(14, 20);

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
            " Task Details ",
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ));

    let status_style = match task.status.as_str() {
        "active" => Style::default()
            .fg(Color::Green)
            .add_modifier(Modifier::BOLD),
        "done" => Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
        "blocked" => Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
        "failed" => Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        _ => Style::default().fg(Color::DarkGray),
    };

    let mut text_lines = vec![
        Line::from(vec![
            Span::styled("Task ID:      ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                task.id.clone(),
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled("Status:       ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("[{}]", task.status), status_style),
        ]),
        Line::from(vec![
            Span::styled("Agent:        ", Style::default().fg(Color::DarkGray)),
            Span::styled(task.agent.clone(), Style::default().fg(Color::Cyan)),
        ]),
        Line::from(vec![
            Span::styled("Contract:     ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                if task.contract.is_empty() {
                    "-".to_string()
                } else {
                    task.contract.clone()
                },
                Style::default().fg(Color::White),
            ),
        ]),
        Line::from(vec![
            Span::styled("Goal:         ", Style::default().fg(Color::DarkGray)),
            Span::styled(task.goal.clone(), Style::default().fg(Color::White)),
        ]),
    ];

    if !task.files.is_empty() {
        text_lines.push(Line::from(vec![
            Span::styled("Scope Files:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(task.files.join(", "), Style::default().fg(Color::Cyan)),
        ]));
    }

    if !task.depends_on.is_empty() {
        text_lines.push(Line::from(vec![
            Span::styled("Depends On:   ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                task.depends_on.join(", "),
                Style::default().fg(Color::Yellow),
            ),
        ]));
    }

    if let Some(ref reason) = task.blocking_reason {
        text_lines.push(Line::from(vec![
            Span::styled("Block Reason: ", Style::default().fg(Color::DarkGray)),
            Span::styled(reason.clone(), Style::default().fg(Color::Yellow)),
        ]));
    }

    if let Some(ref c) = task.created_at {
        text_lines.push(Line::from(vec![
            Span::styled("Created At:   ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format_local_datetime(c),
                Style::default().fg(Color::DarkGray),
            ),
        ]));
    }

    if let Some(ref s) = task.started_at {
        text_lines.push(Line::from(vec![
            Span::styled("Started At:   ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format_local_datetime(s),
                Style::default().fg(Color::DarkGray),
            ),
        ]));
    }

    if let Some(ref d) = task.completed_at {
        text_lines.push(Line::from(vec![
            Span::styled("Completed At: ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format_local_datetime(d),
                Style::default().fg(Color::DarkGray),
            ),
        ]));
    }

    text_lines.push(Line::from(vec![
        Span::styled("Duration:     ", Style::default().fg(Color::DarkGray)),
        Span::styled(task.elapsed_str.clone(), Style::default().fg(Color::Yellow)),
    ]));

    text_lines.push(Line::raw(""));
    text_lines.push(Line::from(vec![
        Span::styled("Press ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            "[Esc/Enter/q]",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" to close", Style::default().fg(Color::DarkGray)),
    ]));

    let p = Paragraph::new(text_lines)
        .block(block)
        .alignment(Alignment::Left)
        .wrap(Wrap { trim: true });

    f.render_widget(p, modal_area);
}
