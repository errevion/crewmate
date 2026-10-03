use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::app::{App, AppPage};

pub fn render_footer(f: &mut Frame, app: &App, area: Rect) {
    // Global segment, identical on every page:
    // [q] Quit  [h] Help  [Tab] Switch page
    let mut spans = vec![
        Span::styled(" [q]", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::styled(" Quit  ", Style::default().fg(Color::White)),
        Span::styled("[h]", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::styled(" Help  ", Style::default().fg(Color::White)),
        Span::styled("[Tab]", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::styled(" Switch page", Style::default().fg(Color::White)),
    ];

    // Page-specific segment, appended after the global one:
    match app.current_page {
        AppPage::Workflow => {
            spans.extend(vec![
                Span::styled("  │  ", Style::default().fg(Color::DarkGray)),
                Span::styled("[←/→]", Style::default().fg(Color::Cyan)),
                Span::styled(" Pan  ", Style::default().fg(Color::White)),
                Span::styled("[↑/↓]", Style::default().fg(Color::Cyan)),
                Span::styled(" Select  ", Style::default().fg(Color::White)),
                Span::styled("[Enter]", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                Span::styled(" Inspect", Style::default().fg(Color::White)),
            ]);
        }
        AppPage::Tasks => {
            spans.extend(vec![
                Span::styled("  │  ", Style::default().fg(Color::DarkGray)),
                Span::styled("[↑/↓]", Style::default().fg(Color::Cyan)),
                Span::styled(" Select  ", Style::default().fg(Color::White)),
                Span::styled("[Enter]", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                Span::styled(" Inspect", Style::default().fg(Color::White)),
            ]);
        }
        AppPage::Contracts => {
            if app.show_contract_detail {
                spans.extend(vec![
                    Span::styled("  │  ", Style::default().fg(Color::DarkGray)),
                    Span::styled("[↑/↓]", Style::default().fg(Color::Cyan)),
                    Span::styled(" Scroll  ", Style::default().fg(Color::White)),
                    Span::styled("[Esc/Enter]", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                    Span::styled(" Close Fullscreen", Style::default().fg(Color::White)),
                ]);
            } else {
                spans.extend(vec![
                    Span::styled("  │  ", Style::default().fg(Color::DarkGray)),
                    Span::styled("[m/a/p]", Style::default().fg(Color::Cyan)),
                    Span::styled(" Sub-view  ", Style::default().fg(Color::White)),
                    Span::styled("[←/→]", Style::default().fg(Color::Cyan)),
                    Span::styled(" Cycle  ", Style::default().fg(Color::White)),
                    Span::styled("[↑/↓]", Style::default().fg(Color::Cyan)),
                    Span::styled(" Select  ", Style::default().fg(Color::White)),
                    Span::styled("[Enter]", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                    Span::styled(" Fullscreen", Style::default().fg(Color::White)),
                ]);
            }
        }
    }

    let paragraph = Paragraph::new(Line::from(spans)).alignment(Alignment::Left);
    f.render_widget(paragraph, area);
}
