use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};
use ratatui::Frame;

use crate::app::App;

enum NodeState {
    Done,
    Current,
    Pending,
}

pub fn render_canvas_graph(f: &mut Frame, app: &App, area: Rect) {
    let wf = match app.workflow {
        Some(ref w) => w,
        None => {
            let p = Paragraph::new("No workflow definition (graph.yaml) found")
                .style(Style::default().fg(Color::DarkGray))
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .title(" Workflow Graph "),
                )
                .alignment(Alignment::Center);
            f.render_widget(p, area);
            return;
        }
    };

    let nodes = &wf.nodes_in_order;
    let n = nodes.len();
    if n == 0 {
        let p = Paragraph::new("Workflow graph has 0 nodes")
            .style(Style::default().fg(Color::DarkGray))
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .title(" Workflow Graph "),
            )
            .alignment(Alignment::Center);
        f.render_widget(p, area);
        return;
    }

    // Determine current node index and status
    let current_node = app.state.current_node.as_deref();
    let is_completed = app.state.status == "completed" || current_node == Some("done");
    let current_idx = current_node.and_then(|c| nodes.iter().position(|node_id| node_id == c));
    let focus_idx = app.current_focus_index().min(n.saturating_sub(1));

    // Dynamic title based on focus and manual scroll state
    let title_text = if n <= 1 {
        " Workflow Graph ".to_string()
    } else if let Some(man_idx) = app.graph_focus_index {
        format!(" Workflow Graph [Viewing step {}/{} - 'c' to center] ", man_idx + 1, n)
    } else if let Some(curr) = current_idx {
        format!(" Workflow Graph [{}/{}] ", curr + 1, n)
    } else {
        " Workflow Graph ".to_string()
    };

    let elapsed_ms = app.start_time.elapsed().as_millis() as f64;
    let wave = ((elapsed_ms / 350.0).sin() * 0.5 + 0.5) as f32;
    let pulse_color = tachyonfx::color_from_hsl(120.0, 0.95, 0.35 + 0.35 * wave);

    let outer_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            title_text,
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));
    let inner = outer_block.inner(area);
    f.render_widget(outer_block, area);

    // Height of node box is 3 rows (top border, content, bottom border).
    if inner.height < 3 {
        return;
    }

    // Calculate node states
    let node_states: Vec<NodeState> = (0..n)
        .map(|i| {
            if is_completed {
                NodeState::Done
            } else if let Some(curr) = current_idx {
                if i < curr {
                    NodeState::Done
                } else if i == curr {
                    NodeState::Current
                } else {
                    NodeState::Pending
                }
            } else if i == 0 && app.state.status == "active" {
                NodeState::Current
            } else {
                NodeState::Pending
            }
        })
        .collect();

    // Vertically center 3-row boxes within inner area, leaving room for goal if height >= 6
    let box_y = if inner.height >= 6 {
        inner.y + (inner.height.saturating_sub(6)) / 2 + 1
    } else {
        inner.y + (inner.height.saturating_sub(3)) / 2
    };

    if n == 1 {
        let box_w = (nodes[0].len() as u16 + 8).clamp(12, inner.width.min(24));
        let box_x = inner.x + (inner.width.saturating_sub(box_w)) / 2;
        let rect = Rect::new(box_x, box_y, box_w, 3);
        render_node_box(f, &nodes[0], &node_states[0], rect, pulse_color);
    } else {
        // Check if all nodes can fit with comfortable widths and gaps
    let max_name_len = nodes.iter().map(|id| id.len()).max().unwrap_or(6);
    let content_w = (max_name_len as u16 + 2).min(14); // account for " ✓" or "● "
    let ideal_box_w = (content_w + 4).clamp(10, 16);
    let total_gaps = (n - 1) as u16;

    // Minimum width needed to render all boxes simultaneously
    let min_box_w = (content_w + 2).max(8);
    let min_needed_all = n as u16 * min_box_w + total_gaps * 3;
    let can_fit_all = inner.width >= min_needed_all;

    if can_fit_all {
        // Fit all nodes horizontally across the available width
        let box_w = ((inner.width.saturating_sub(total_gaps * 3)) / n as u16).clamp(8, ideal_box_w);
        let total_nodes_w = n as u16 * box_w;
        let remaining_w = inner.width.saturating_sub(total_nodes_w);
        let gap = if total_gaps > 0 {
            (remaining_w / total_gaps).clamp(3, 8)
        } else {
            0
        };

        let total_layout_w = total_nodes_w + total_gaps * gap;
        let margin = (inner.width.saturating_sub(total_layout_w)) / 2;

        for (i, node_name) in nodes.iter().enumerate() {
            let node_x = inner.x + margin + i as u16 * (box_w + gap);
            let node_rect = Rect::new(node_x, box_y, box_w, 3);
            render_node_box(f, node_name.as_str(), &node_states[i], node_rect, pulse_color);

            if i < n - 1 {
                let conn_x = node_x + box_w;
                let next_node_x = inner.x + margin + (i + 1) as u16 * (box_w + gap);
                let conn_len = next_node_x.saturating_sub(conn_x);

                if conn_len > 0 {
                    let is_past = is_completed || current_idx.map_or(false, |curr| i < curr);
                    render_connector(f, app, &nodes[i], &nodes[i + 1], is_past, conn_x, box_y + 1, conn_len);
                }
            }
        }
    } else {
        // Focused View with horizontal sliding window
        let ind_text_w = 9u16; // "◀(3 past)" or "(4 more)▶"
        let ind_conn_w = 4u16; // "───▶"
        let side_w = ind_text_w + ind_conn_w; // 13 chars
        let box_w = 12u16.min(inner.width.saturating_sub(4));
        let gap = 4u16;

        // If the area is extremely narrow, fall back to compressed view
        if inner.width < 26 {
            render_compressed_content(f, nodes, current_idx, is_completed, pulse_color, inner);
            return;
        }

        // Available width when both left and right indicators are present
        let avail_for_boxes = inner.width.saturating_sub(2 * side_w);
        let visible_count = (((avail_for_boxes + gap) / (box_w + gap)) as usize)
            .clamp(1, n.saturating_sub(1).max(1));

        let half = visible_count / 2;
        let start_idx = if focus_idx >= half {
            (focus_idx - half).min(n.saturating_sub(visible_count))
        } else {
            0
        };
        let end_idx = (start_idx + visible_count).min(n);
        let visible_nodes = &nodes[start_idx..end_idx];

        let left_hidden = start_idx;
        let right_hidden = n - end_idx;

        let left_w = if left_hidden > 0 { side_w } else { 0 };
        let right_w = if right_hidden > 0 { side_w } else { 0 };
        let total_vis = visible_nodes.len() as u16;
        let nodes_w = total_vis * box_w + total_vis.saturating_sub(1) * gap;
        let total_content_w = left_w + nodes_w + right_w;

        let margin = (inner.width.saturating_sub(total_content_w)) / 2;
        let mut cur_x = inner.x + margin;

        // 1. Render Left Indicator
        if left_hidden > 0 {
            let p_txt = Paragraph::new(Span::styled(
                format!("◀({} past)", left_hidden),
                Style::default().fg(Color::Cyan),
            ));
            f.render_widget(p_txt, Rect::new(cur_x, box_y + 1, ind_text_w, 1));
            cur_x += ind_text_w;

            let is_entering = if let Some(ref anim) = app.transition_animation {
                anim.from_node == nodes[start_idx - 1] && anim.to_node == nodes[start_idx]
            } else {
                false
            };
            render_styled_connector(f, app, is_entering, true, cur_x, box_y + 1, ind_conn_w);
            cur_x += ind_conn_w;
        }

        // 2. Render Visible Nodes and Inter-node Connectors
        for (v_i, node_name) in visible_nodes.iter().enumerate() {
            let actual_idx = start_idx + v_i;
            let node_rect = Rect::new(cur_x, box_y, box_w, 3);
            render_node_box(f, node_name.as_str(), &node_states[actual_idx], node_rect, pulse_color);
            cur_x += box_w;

            if v_i < visible_nodes.len() - 1 {
                let is_past = is_completed || current_idx.map_or(false, |curr| actual_idx < curr);
                render_connector(
                    f,
                    app,
                    &nodes[actual_idx],
                    &nodes[actual_idx + 1],
                    is_past,
                    cur_x,
                    box_y + 1,
                    gap,
                );
                cur_x += gap;
            }
        }

        // 3. Render Right Indicator
        if right_hidden > 0 {
            let is_exiting = if let Some(ref anim) = app.transition_animation {
                anim.from_node == nodes[end_idx - 1] && anim.to_node == nodes[end_idx]
            } else {
                false
            };
            render_styled_connector(f, app, is_exiting, false, cur_x, box_y + 1, ind_conn_w);
            cur_x += ind_conn_w;

            let p_txt = Paragraph::new(Span::styled(
                format!("({} more)▶", right_hidden),
                Style::default().fg(Color::Cyan),
            ));
            f.render_widget(p_txt, Rect::new(cur_x, box_y + 1, ind_text_w, 1));
        }
    }
    }

    // Render active node instruction/goal neatly below the graph
    if inner.height >= 5 {
        if is_completed {
            let line = Line::from(vec![
                Span::styled("Status: ", Style::default().fg(Color::DarkGray)),
                Span::styled("Workflow completed successfully", Style::default().fg(Color::Cyan)),
            ]);
            let goal_y = inner.y + inner.height.saturating_sub(2);
            let goal_rect = Rect::new(inner.x + 2, goal_y, inner.width.saturating_sub(4), 1);
            let p = Paragraph::new(line).alignment(Alignment::Center);
            f.render_widget(p, goal_rect);
        } else if let Some(goal) = app.current_goal_subtitle() {
            let max_w = inner.width.saturating_sub(12) as usize;
            let display_text = if goal.len() > max_w && max_w > 3 {
                format!("{}…", &goal[..max_w - 3])
            } else {
                goal
            };
            let line = Line::from(vec![
                Span::styled("Goal: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                Span::styled(display_text, Style::default().fg(Color::White)),
            ]);
            let goal_y = inner.y + inner.height.saturating_sub(2);
            let goal_rect = Rect::new(inner.x + 2, goal_y, inner.width.saturating_sub(4), 1);
            let p = Paragraph::new(line).alignment(Alignment::Center);
            f.render_widget(p, goal_rect);
        }
    }
}

fn format_node_label(name: &str, max_width: usize) -> String {
    if name.chars().count() <= max_width {
        name.to_string()
    } else if max_width <= 3 {
        name.chars().take(max_width).collect()
    } else {
        let prefix_len = max_width - 3;
        let prefix: String = name.chars().take(prefix_len).collect();
        format!("{}...", prefix)
    }
}

fn render_node_box(
    f: &mut Frame,
    node_id: &str,
    state: &NodeState,
    area: Rect,
    pulse_color: Color,
) {
    let inner_width = area.width.saturating_sub(2) as usize;

    let (border_type, border_style, spans) = match state {
        NodeState::Done => {
            let avail = inner_width.saturating_sub(2);
            let formatted = format_node_label(node_id, avail);
            let spans = vec![
                Span::styled(formatted, Style::default().fg(Color::Cyan)),
                Span::styled(" ✓", Style::default().fg(Color::Cyan)),
            ];
            (BorderType::Plain, Style::default().fg(Color::Cyan), spans)
        }
        NodeState::Current => {
            let avail = inner_width.saturating_sub(2);
            let formatted = format_node_label(node_id, avail);
            let spans = vec![
                Span::styled("● ", Style::default().fg(pulse_color).add_modifier(Modifier::BOLD)),
                Span::styled(
                    formatted,
                    Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
                ),
            ];
            (
                BorderType::Thick,
                Style::default().fg(Color::Green),
                spans,
            )
        }
        NodeState::Pending => {
            let formatted = format_node_label(node_id, inner_width);
            let spans = vec![Span::styled(formatted, Style::default().fg(Color::DarkGray))];
            (BorderType::Plain, Style::default().fg(Color::DarkGray), spans)
        }
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(border_type)
        .border_style(border_style);

    let paragraph = Paragraph::new(Line::from(spans))
        .alignment(Alignment::Center)
        .block(block);

    f.render_widget(paragraph, area);
}

fn render_connector(
    f: &mut Frame,
    app: &App,
    from_node: &str,
    to_node: &str,
    is_past: bool,
    x: u16,
    y: u16,
    conn_len: u16,
) {
    let is_animating = if let Some(ref anim) = app.transition_animation {
        anim.from_node == from_node && anim.to_node == to_node
    } else {
        false
    };
    render_styled_connector(f, app, is_animating, is_past, x, y, conn_len);
}

fn render_styled_connector(
    f: &mut Frame,
    app: &App,
    is_animating: bool,
    is_past: bool,
    x: u16,
    y: u16,
    conn_len: u16,
) {
    if conn_len == 0 {
        return;
    }

    let base_color = if is_past { Color::Cyan } else { Color::DarkGray };

    let active_dot_idx = if is_animating {
        let progress = app
            .transition_animation
            .as_ref()
            .map(|anim| tachyonfx::Interpolation::CubicInOut.alpha(anim.progress()))
            .unwrap_or(0.0);
        let max_dot_pos = conn_len.saturating_sub(2) as usize;
        Some(((progress * max_dot_pos as f32).round() as usize).min(max_dot_pos))
    } else {
        None
    };

    let mut spans = Vec::new();
    if let Some(dot_idx) = active_dot_idx {
        if dot_idx > 0 {
            spans.push(Span::styled("─".repeat(dot_idx), Style::default().fg(base_color)));
        }
        spans.push(Span::styled(
            "●",
            Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
        ));
        let after_count = (conn_len.saturating_sub(1) as usize).saturating_sub(dot_idx + 1);
        if after_count > 0 {
            spans.push(Span::styled("─".repeat(after_count), Style::default().fg(base_color)));
        }
        spans.push(Span::styled("▶", Style::default().fg(base_color)));
    } else {
        let dash_count = conn_len.saturating_sub(1) as usize;
        if dash_count > 0 {
            spans.push(Span::styled("─".repeat(dash_count), Style::default().fg(base_color)));
        }
        spans.push(Span::styled("▶", Style::default().fg(base_color)));
    }

    let conn_paragraph = Paragraph::new(Line::from(spans));
    f.render_widget(conn_paragraph, Rect::new(x, y, conn_len, 1));
}

fn render_compressed_content(
    f: &mut Frame,
    nodes: &[String],
    current_idx: Option<usize>,
    is_completed: bool,
    pulse_color: Color,
    area: Rect,
) {
    let mut spans = Vec::new();

    for (i, node_id) in nodes.iter().enumerate() {
        if i > 0 {
            let is_past = is_completed || current_idx.map_or(false, |curr| i <= curr);
            let arrow_color = if is_past { Color::Cyan } else { Color::DarkGray };
            spans.push(Span::styled(" ──► ", Style::default().fg(arrow_color)));
        }

        let is_curr = !is_completed && current_idx == Some(i);
        let is_past = is_completed || current_idx.map_or(false, |curr| i < curr);

        if is_curr {
            spans.push(Span::styled(
                "● ",
                Style::default().fg(pulse_color).add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(
                format!("[[ {} ]]", node_id),
                Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
            ));
        } else if is_past {
            spans.push(Span::styled(
                format!("[ {} ✓ ]", node_id),
                Style::default().fg(Color::Cyan),
            ));
        } else {
            spans.push(Span::styled(
                format!("[ {} ]", node_id),
                Style::default().fg(Color::DarkGray),
            ));
        }
    }

    let y_center = area.y + area.height / 2;
    let text_area = Rect::new(area.x, y_center, area.width, 1);
    let paragraph = Paragraph::new(Line::from(spans)).alignment(Alignment::Center);
    f.render_widget(paragraph, text_area);
}

pub fn render_compressed_graph(f: &mut Frame, app: &App, area: Rect) {
    let wf = match app.workflow {
        Some(ref w) => w,
        None => {
            let p = Paragraph::new("No graph.yaml found")
                .style(Style::default().fg(Color::DarkGray))
                .block(Block::default().borders(Borders::ALL).border_type(BorderType::Rounded));
            f.render_widget(p, area);
            return;
        }
    };

    let nodes = &wf.nodes_in_order;
    let current_node = app.state.current_node.as_deref();
    let is_completed = app.state.status == "completed" || current_node == Some("done");
    let current_idx = current_node.and_then(|c| nodes.iter().position(|n| n == c));

    let elapsed_ms = app.start_time.elapsed().as_millis() as f64;
    let wave = ((elapsed_ms / 350.0).sin() * 0.5 + 0.5) as f32;
    let pulse_color = tachyonfx::color_from_hsl(120.0, 0.95, 0.35 + 0.35 * wave);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " Workflow Graph ",
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    let inner = block.inner(area);
    f.render_widget(block, area);

    render_compressed_content(f, nodes, current_idx, is_completed, pulse_color, inner);
}
