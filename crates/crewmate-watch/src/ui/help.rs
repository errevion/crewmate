use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph};
use ratatui::Frame;

pub fn render_help_overlay(f: &mut Frame, area: Rect) {
    // Center a modal in the frame
    let modal_width = (area.width * 7 / 10).clamp(48, 68);
    let modal_height = (area.height * 7 / 10).clamp(17, 24);

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
            " Help ",
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ));

    let text = vec![
        Line::from(vec![Span::styled(
            "Keybindings:",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )]),
        Line::from(vec![
            Span::styled(
                "  q, Esc, Ctrl+C ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   Quit watch / close popup"),
        ]),
        Line::from(vec![
            Span::styled(
                "  Tab / 1, 2, 3  ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   Switch page (Workflow / Tasks / Contracts)"),
        ]),
        Line::from(vec![
            Span::styled(
                "  m, a, p        ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   Contracts sub-view (Modules / Arch / Caps)"),
        ]),
        Line::from(vec![
            Span::styled(
                "  h, ?           ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   Toggle this help overlay"),
        ]),
        Line::from(vec![
            Span::styled(
                "  ←, →, a, d     ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   Pan workflow graph left / right"),
        ]),
        Line::from(vec![
            Span::styled(
                "  c, f           ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   Re-center graph on active node"),
        ]),
        Line::from(vec![
            Span::styled(
                "  ↑, ↓, k, j     ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   Navigate items (events, tasks, contracts)"),
        ]),
        Line::from(vec![
            Span::styled(
                "  Enter          ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   Inspect selected item details"),
        ]),
        Line::raw(""),
        Line::from(vec![
            Span::styled("Press ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                "h",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" or ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                "Esc",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                " to close this overlay.",
                Style::default().fg(Color::DarkGray),
            ),
        ]),
    ];

    let paragraph = Paragraph::new(text).block(block).alignment(Alignment::Left);
    f.render_widget(paragraph, modal_area);
}
