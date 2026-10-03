use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::App;
use crate::data::contracts::ContractsSubView;
use crate::ui::footer::render_footer;
use crate::ui::header::render_header;

pub fn render_contracts_page(f: &mut Frame, app: &App, area: Rect) {
    if app.show_contract_detail {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3), // Shared Header
                Constraint::Min(4),    // Fullscreen Contract Detail
                Constraint::Length(1), // Shared Footer
            ])
            .split(area);

        render_header(f, app, chunks[0], None);
        render_contract_detail_fullscreen(f, app, chunks[1]);
        render_footer(f, app, chunks[2]);
        return;
    }

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Shared Header
            Constraint::Length(3), // Subview Tabs Bar
            Constraint::Min(4),    // Main Content
            Constraint::Length(1), // Shared Footer
        ])
        .split(area);

    render_header(f, app, chunks[0], None);
    render_contracts_subview_tabs(f, app, chunks[1]);
    render_contracts_main_panel(f, app, chunks[2]);
    render_footer(f, app, chunks[3]);
}

fn render_contracts_subview_tabs(f: &mut Frame, app: &App, area: Rect) {
    let mod_count = app.contracts.index.modules.len();
    let arch_count = app.contracts.architecture.modules.len();
    let cap_count = app.contracts.capabilities.capabilities.len();

    let tab_style = |active: bool| -> Style {
        if active {
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::DarkGray)
        }
    };

    let indicator = |active: bool| -> Span {
        if active {
            Span::styled(" ◆ ", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))
        } else {
            Span::styled("   ", Style::default().fg(Color::DarkGray))
        }
    };

    let is_modules = app.contracts_subview == ContractsSubView::Modules;
    let is_arch = app.contracts_subview == ContractsSubView::Architecture;
    let is_caps = app.contracts_subview == ContractsSubView::Capabilities;

    let mut tab_spans = vec![
        indicator(is_modules),
        Span::styled(format!("[m] Modules ({})", mod_count), tab_style(is_modules)),
        Span::styled("  │  ", Style::default().fg(Color::DarkGray)),
        indicator(is_arch),
        Span::styled(format!("[a] Architecture ({})", arch_count), tab_style(is_arch)),
        Span::styled("  │  ", Style::default().fg(Color::DarkGray)),
        indicator(is_caps),
        Span::styled(format!("[p] Capabilities ({})", cap_count), tab_style(is_caps)),
    ];

    if !app.contracts.loaded {
        tab_spans.push(Span::styled("  │  ", Style::default().fg(Color::DarkGray)));
        tab_spans.push(Span::styled(
            "(no contracts found in .crewmate/contracts/)",
            Style::default().fg(Color::Red),
        ));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " Contracts Registry ",
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    let paragraph = Paragraph::new(Line::from(tab_spans))
        .block(block)
        .alignment(Alignment::Left);

    f.render_widget(paragraph, area);
}

fn render_contracts_main_panel(f: &mut Frame, app: &App, area: Rect) {
    match app.contracts_subview {
        ContractsSubView::Modules => render_modules_subview(f, app, area),
        ContractsSubView::Architecture => render_architecture_subview(f, app, area),
        ContractsSubView::Capabilities => render_capabilities_subview(f, app, area),
    }
}

fn render_modules_subview(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(32), // Left list
            Constraint::Percentage(68), // Right detail
        ])
        .split(area);

    render_module_list(f, app, chunks[0]);
    render_module_detail(f, app, chunks[1]);
}

fn render_module_list(f: &mut Frame, app: &App, area: Rect) {
    let modules = &app.contracts.index.modules;
    let mut lines = Vec::new();

    if modules.is_empty() {
        lines.push(Line::from(Span::styled(
            " No modules in index.yaml",
            Style::default().fg(Color::DarkGray),
        )));
    } else {
        for (i, m) in modules.iter().enumerate() {
            let is_selected = i == app.selected_module_index;
            let pointer = if is_selected { "▸ " } else { "  " };

            let name_style = if is_selected {
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            let count_label = format!("({} exports)", m.public_surface.len());

            let mut row = vec![
                Span::styled(pointer, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                Span::styled(&m.name, name_style),
                Span::raw(" "),
                Span::styled(count_label, Style::default().fg(Color::DarkGray)),
            ];

            if let Some(mc) = app.contracts.module_contracts.get(&m.name) {
                if mc.status == "draft" {
                    row.push(Span::styled(
                        " [DRAFT]",
                        Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
                    ));
                }
            }

            lines.push(Line::from(row));
        }
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " Modules ",
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}

fn render_module_detail(f: &mut Frame, app: &App, area: Rect) {
    let selected_mod = app.selected_module();
    let contract = app.selected_module_contract();
    let mut lines = Vec::new();

    let title = match selected_mod {
        Some(m) => {
            let status_tag = contract.map(|c| c.status.as_str()).unwrap_or("final");
            format!(" Module Contract: {} (v{}, {}) ", m.name, m.version, status_tag.to_uppercase())
        }
        None => " Module Contract ".to_string(),
    };

    if let Some(m) = selected_mod {
        let status_str = contract.map(|c| c.status.as_str()).unwrap_or("final");
        let (status_color, status_text) = if status_str == "draft" {
            (Color::Yellow, "DRAFT (future contract)")
        } else {
            (Color::Green, "FINAL (authoritative)")
        };

        lines.push(Line::from(vec![
            Span::styled("Status: ", Style::default().fg(Color::DarkGray)),
            Span::styled(status_text, Style::default().fg(status_color).add_modifier(Modifier::BOLD)),
        ]));

        // Path & Responsibility
        lines.push(Line::from(vec![
            Span::styled("Path: ", Style::default().fg(Color::DarkGray)),
            Span::styled(&m.path, Style::default().fg(Color::Cyan)),
        ]));

        lines.push(Line::from(vec![
            Span::styled("Responsibility: ", Style::default().fg(Color::DarkGray)),
            Span::styled(&m.responsibility, Style::default().fg(Color::White)),
        ]));

        lines.push(Line::raw(""));

        // Public API
        let api_count = contract.map(|c| c.public_api.len()).unwrap_or(m.public_surface.len());
        lines.push(Line::from(vec![
            Span::styled(
                format!("Public API ({} exports):", api_count),
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ),
        ]));

        if let Some(c) = contract {
            if c.public_api.is_empty() {
                lines.push(Line::from(Span::styled(
                    "  (no exports declared in contract)",
                    Style::default().fg(Color::DarkGray),
                )));
            } else {
                for exp in &c.public_api {
                    let sig_text = exp.signature.as_deref().unwrap_or("()");
                    lines.push(Line::from(vec![
                        Span::styled("  • ", Style::default().fg(Color::Cyan)),
                        Span::styled(&exp.export, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                        Span::styled(format!(": {}", sig_text), Style::default().fg(Color::White)),
                    ]));

                    if !exp.file.is_empty() {
                        lines.push(Line::from(vec![
                            Span::styled("    file: ", Style::default().fg(Color::DarkGray)),
                            Span::styled(&exp.file, Style::default().fg(Color::DarkGray)),
                        ]));
                    }

                    if let Some(ref desc) = exp.description {
                        if !desc.is_empty() {
                            lines.push(Line::from(vec![
                                Span::styled("    desc: ", Style::default().fg(Color::DarkGray)),
                                Span::styled(desc, Style::default().fg(Color::DarkGray)),
                            ]));
                        }
                    }
                }
            }
        } else if !m.public_surface.is_empty() {
            for exp in &m.public_surface {
                lines.push(Line::from(vec![
                    Span::styled("  • ", Style::default().fg(Color::Cyan)),
                    Span::styled(exp, Style::default().fg(Color::Cyan)),
                ]));
            }
        } else {
            lines.push(Line::from(Span::styled(
                "  (no public surface declared)",
                Style::default().fg(Color::DarkGray),
            )));
        }

        lines.push(Line::raw(""));

        // Invariants
        let invariants = contract.map(|c| c.invariants.as_slice()).unwrap_or(&[]);
        lines.push(Line::from(vec![
            Span::styled(
                format!("Invariants ({}):", invariants.len()),
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ),
        ]));

        if invariants.is_empty() {
            lines.push(Line::from(Span::styled(
                "  (no invariants declared)",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            for inv in invariants {
                lines.push(Line::from(vec![
                    Span::styled("  • ", Style::default().fg(Color::Yellow)),
                    Span::styled(inv, Style::default().fg(Color::White)),
                ]));
            }
        }

        lines.push(Line::raw(""));

        // Allowed Dependencies & Declared Consumers
        let arch_entry = app.contracts.architecture.modules.get(&m.name);
        let deps = arch_entry.map(|a| a.allowed_dependencies.as_slice()).unwrap_or(&[]);

        lines.push(Line::from(vec![
            Span::styled("Allowed Dependencies: ", Style::default().fg(Color::DarkGray)),
            if deps.is_empty() {
                Span::styled("(none)", Style::default().fg(Color::DarkGray))
            } else {
                Span::styled(deps.join(", "), Style::default().fg(Color::Green))
            },
        ]));

        let consumers = contract.map(|c| c.declared_consumers.as_slice()).unwrap_or(&[]);
        lines.push(Line::from(vec![
            Span::styled("Declared Consumers: ", Style::default().fg(Color::DarkGray)),
            if consumers.is_empty() {
                Span::styled("(none)", Style::default().fg(Color::DarkGray))
            } else {
                Span::styled(consumers.join(", "), Style::default().fg(Color::Magenta))
            },
        ]));
    } else {
        lines.push(Line::from(Span::styled(
            " Select a module on the left to inspect its contract.",
            Style::default().fg(Color::DarkGray),
        )));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            title,
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    let paragraph = Paragraph::new(lines).block(block).wrap(Wrap { trim: false });
    f.render_widget(paragraph, area);
}

fn render_architecture_subview(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = Vec::new();
    let arch_modules = &app.contracts.architecture.modules;

    if arch_modules.is_empty() {
        lines.push(Line::from(Span::styled(
            " No modules declared in architecture.yaml",
            Style::default().fg(Color::DarkGray),
        )));
    } else {
        // Collect sorted module names
        let mut mod_names: Vec<&String> = arch_modules.keys().collect();
        mod_names.sort();

        // Build consumer lookup map (who depends on X)
        let mut consumers_map: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::new();
        for (m, entry) in arch_modules {
            for dep in &entry.allowed_dependencies {
                consumers_map.entry(dep.as_str()).or_default().push(m.as_str());
            }
        }

        for (i, &name) in mod_names.iter().enumerate() {
            let entry = &arch_modules[name];
            let is_selected = i == app.selected_arch_index;

            let pointer = if is_selected { "▸ " } else { "  " };
            let name_style = if is_selected {
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
            };

            lines.push(Line::from(vec![
                Span::styled(pointer, Style::default().fg(Color::Cyan)),
                Span::styled(name, name_style),
            ]));

            if let Some(ref resp) = entry.responsibility {
                lines.push(Line::from(vec![
                    Span::styled("    responsibility: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(resp, Style::default().fg(Color::White)),
                ]));
            }

            let deps_display = if entry.allowed_dependencies.is_empty() {
                "(none / root)".to_string()
            } else {
                entry.allowed_dependencies.join(", ")
            };
            lines.push(Line::from(vec![
                Span::styled("    → allowed dependencies: ", Style::default().fg(Color::DarkGray)),
                Span::styled(deps_display, Style::default().fg(Color::Green)),
            ]));

            if let Some(consumers) = consumers_map.get(name.as_str()) {
                lines.push(Line::from(vec![
                    Span::styled("    ← consumed by: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(consumers.join(", "), Style::default().fg(Color::Magenta)),
                ]));
            }

            lines.push(Line::raw(""));
        }
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " Architecture & Dependency Graph ",
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    let paragraph = Paragraph::new(lines).block(block).wrap(Wrap { trim: false });
    f.render_widget(paragraph, area);
}

fn render_capabilities_subview(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = Vec::new();
    let capabilities = &app.contracts.capabilities.capabilities;

    if capabilities.is_empty() {
        lines.push(Line::from(Span::styled(
            " No capabilities declared in capabilities.yaml",
            Style::default().fg(Color::DarkGray),
        )));
    } else {
        for (i, cap) in capabilities.iter().enumerate() {
            let is_selected = i == app.selected_cap_index;
            let pointer = if is_selected { "▸ " } else { "  " };

            let name_style = if is_selected {
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
            };

            lines.push(Line::from(vec![
                Span::styled(pointer, Style::default().fg(Color::Cyan)),
                Span::styled(&cap.name, name_style),
                Span::styled("  [module: ", Style::default().fg(Color::DarkGray)),
                Span::styled(&cap.module, Style::default().fg(Color::White)),
                Span::styled("]", Style::default().fg(Color::DarkGray)),
            ]));

            if let Some(ref entrypoint) = cap.entrypoint {
                lines.push(Line::from(vec![
                    Span::styled("    entrypoint: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(entrypoint, Style::default().fg(Color::Green)),
                ]));
            }

            if !cap.description.is_empty() {
                lines.push(Line::from(vec![
                    Span::styled("    desc: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(&cap.description, Style::default().fg(Color::White)),
                ]));
            }

            lines.push(Line::raw(""));
        }
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " Capabilities Registry ",
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    let paragraph = Paragraph::new(lines).block(block).wrap(Wrap { trim: false });
    f.render_widget(paragraph, area);
}

pub fn render_contract_detail_fullscreen(f: &mut Frame, app: &App, area: Rect) {
    f.render_widget(Clear, area);

    match app.contracts_subview {
        ContractsSubView::Modules => render_module_detail_fullscreen(f, app, area),
        ContractsSubView::Architecture => render_architecture_detail_fullscreen(f, app, area),
        ContractsSubView::Capabilities => render_capabilities_detail_fullscreen(f, app, area),
    }
}

fn render_module_detail_fullscreen(f: &mut Frame, app: &App, area: Rect) {
    let selected_mod = app.selected_module();
    let contract = app.selected_module_contract();
    let mut lines = Vec::new();

    let title = match selected_mod {
        Some(m) => {
            let status_tag = contract.map(|c| c.status.as_str()).unwrap_or("final");
            format!(" [FULL SCREEN] Module Contract: {} (v{}, {}) ", m.name, m.version, status_tag.to_uppercase())
        }
        None => " [FULL SCREEN] Module Contract ".to_string(),
    };

    if let Some(m) = selected_mod {
        let status_str = contract.map(|c| c.status.as_str()).unwrap_or("final");
        let (status_color, status_text) = if status_str == "draft" {
            (Color::Yellow, "DRAFT (future contract)")
        } else {
            (Color::Green, "FINAL (authoritative)")
        };

        lines.push(Line::from(vec![
            Span::styled("Status:             ", Style::default().fg(Color::DarkGray)),
            Span::styled(status_text, Style::default().fg(status_color).add_modifier(Modifier::BOLD)),
        ]));

        lines.push(Line::from(vec![
            Span::styled("Module Name:        ", Style::default().fg(Color::DarkGray)),
            Span::styled(&m.name, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::styled(format!("  (version {})", m.version), Style::default().fg(Color::DarkGray)),
        ]));

        lines.push(Line::from(vec![
            Span::styled("Implementation:     ", Style::default().fg(Color::DarkGray)),
            Span::styled(&m.path, Style::default().fg(Color::Cyan)),
        ]));

        lines.push(Line::from(vec![
            Span::styled("Contract File:      ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!(".crewmate/contracts/modules/{}.contract.yaml", m.name),
                Style::default().fg(Color::White),
            ),
        ]));

        lines.push(Line::from(vec![
            Span::styled("Responsibility:     ", Style::default().fg(Color::DarkGray)),
            Span::styled(&m.responsibility, Style::default().fg(Color::White)),
        ]));

        lines.push(Line::raw(""));

        // Public API Section
        let api_count = contract.map(|c| c.public_api.len()).unwrap_or(m.public_surface.len());
        lines.push(Line::from(vec![
            Span::styled(
                format!("── Public API ({} exports) ───────────────────────────────────────────────────", api_count),
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ),
        ]));

        if let Some(c) = contract {
            if c.public_api.is_empty() {
                lines.push(Line::from(Span::styled(
                    "  (no exports declared in contract)",
                    Style::default().fg(Color::DarkGray),
                )));
            } else {
                for (i, exp) in c.public_api.iter().enumerate() {
                    let sig_text = exp.signature.as_deref().unwrap_or("()");
                    lines.push(Line::from(vec![
                        Span::styled(format!("  {:>2}. ", i + 1), Style::default().fg(Color::DarkGray)),
                        Span::styled(&exp.export, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                        Span::styled(format!(": {}", sig_text), Style::default().fg(Color::White)),
                    ]));

                    if !exp.file.is_empty() {
                        lines.push(Line::from(vec![
                            Span::styled("      file: ", Style::default().fg(Color::DarkGray)),
                            Span::styled(&exp.file, Style::default().fg(Color::DarkGray)),
                        ]));
                    }

                    if let Some(ref desc) = exp.description {
                        if !desc.is_empty() {
                            lines.push(Line::from(vec![
                                Span::styled("      desc: ", Style::default().fg(Color::DarkGray)),
                                Span::styled(desc, Style::default().fg(Color::DarkGray)),
                            ]));
                        }
                    }
                }
            }
        } else if !m.public_surface.is_empty() {
            for (i, exp) in m.public_surface.iter().enumerate() {
                lines.push(Line::from(vec![
                    Span::styled(format!("  {:>2}. ", i + 1), Style::default().fg(Color::DarkGray)),
                    Span::styled(exp, Style::default().fg(Color::Cyan)),
                ]));
            }
        } else {
            lines.push(Line::from(Span::styled(
                "  (no public surface declared)",
                Style::default().fg(Color::DarkGray),
            )));
        }

        lines.push(Line::raw(""));

        // Invariants Section
        let invariants = contract.map(|c| c.invariants.as_slice()).unwrap_or(&[]);
        lines.push(Line::from(vec![
            Span::styled(
                format!("── Invariants ({} rules) ─────────────────────────────────────────────────────", invariants.len()),
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ),
        ]));

        if invariants.is_empty() {
            lines.push(Line::from(Span::styled(
                "  (no invariants declared)",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            for (i, inv) in invariants.iter().enumerate() {
                lines.push(Line::from(vec![
                    Span::styled(format!("  {:>2}. ", i + 1), Style::default().fg(Color::Yellow)),
                    Span::styled(inv, Style::default().fg(Color::White)),
                ]));
            }
        }

        lines.push(Line::raw(""));

        // Allowed Dependencies & Declared Consumers
        lines.push(Line::from(vec![
            Span::styled(
                "── Architecture & Boundaries ─────────────────────────────────────────────────",
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ),
        ]));

        let arch_entry = app.contracts.architecture.modules.get(&m.name);
        let deps = arch_entry.map(|a| a.allowed_dependencies.as_slice()).unwrap_or(&[]);

        lines.push(Line::from(vec![
            Span::styled("  Allowed Dependencies: ", Style::default().fg(Color::DarkGray)),
            if deps.is_empty() {
                Span::styled("(none)", Style::default().fg(Color::DarkGray))
            } else {
                Span::styled(deps.join(", "), Style::default().fg(Color::Green))
            },
        ]));

        let consumers = contract.map(|c| c.declared_consumers.as_slice()).unwrap_or(&[]);
        lines.push(Line::from(vec![
            Span::styled("  Declared Consumers:   ", Style::default().fg(Color::DarkGray)),
            if consumers.is_empty() {
                Span::styled("(none)", Style::default().fg(Color::DarkGray))
            } else {
                Span::styled(consumers.join(", "), Style::default().fg(Color::Magenta))
            },
        ]));
    } else {
        lines.push(Line::from(Span::styled(
            " No module selected.",
            Style::default().fg(Color::DarkGray),
        )));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::Cyan))
        .title(Span::styled(
            title,
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    let paragraph = Paragraph::new(lines)
        .block(block)
        .scroll((app.contract_detail_scroll, 0))
        .wrap(Wrap { trim: false });

    f.render_widget(paragraph, area);
}

fn render_architecture_detail_fullscreen(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = Vec::new();
    let arch_modules = &app.contracts.architecture.modules;

    let selected = app.selected_arch_module();
    let title = match selected {
        Some((name, _)) => format!(" [FULL SCREEN] Architecture Module: {} ", name),
        None => " [FULL SCREEN] Architecture Module ".to_string(),
    };

    if let Some((name, entry)) = selected {
        lines.push(Line::from(vec![
            Span::styled("Module:           ", Style::default().fg(Color::DarkGray)),
            Span::styled(name, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        ]));

        if let Some(ref resp) = entry.responsibility {
            lines.push(Line::from(vec![
                Span::styled("Responsibility:   ", Style::default().fg(Color::DarkGray)),
                Span::styled(resp, Style::default().fg(Color::White)),
            ]));
        }

        lines.push(Line::from(vec![
            Span::styled("Config File:      ", Style::default().fg(Color::DarkGray)),
            Span::styled(".crewmate/contracts/architecture.yaml", Style::default().fg(Color::White)),
        ]));

        lines.push(Line::raw(""));

        // Allowed Dependencies
        lines.push(Line::from(vec![
            Span::styled(
                format!("── Allowed Dependencies ({}) ────────────────────────────────────────────────", entry.allowed_dependencies.len()),
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ),
        ]));

        if entry.allowed_dependencies.is_empty() {
            lines.push(Line::from(Span::styled(
                "  (no allowed dependencies — this module is an independent boundary)",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            for (i, dep) in entry.allowed_dependencies.iter().enumerate() {
                lines.push(Line::from(vec![
                    Span::styled(format!("  {:>2}. → ", i + 1), Style::default().fg(Color::Green)),
                    Span::styled(dep, Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
                ]));
            }
        }

        lines.push(Line::raw(""));

        // Known Consumers (modules that depend on this module)
        let mut consumers: Vec<&str> = Vec::new();
        for (other_name, other_entry) in arch_modules {
            if other_entry.allowed_dependencies.contains(name) {
                consumers.push(other_name.as_str());
            }
        }
        consumers.sort();

        lines.push(Line::from(vec![
            Span::styled(
                format!("── Known Consumers ({}) ────────────────────────────────────────────────────", consumers.len()),
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ),
        ]));

        if consumers.is_empty() {
            lines.push(Line::from(Span::styled(
                "  (no other modules currently declare dependencies on this module)",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            for (i, cons) in consumers.iter().enumerate() {
                lines.push(Line::from(vec![
                    Span::styled(format!("  {:>2}. ← ", i + 1), Style::default().fg(Color::Magenta)),
                    Span::styled(*cons, Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD)),
                ]));
            }
        }
    } else {
        lines.push(Line::from(Span::styled(
            " No architecture module selected.",
            Style::default().fg(Color::DarkGray),
        )));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::Cyan))
        .title(Span::styled(
            title,
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    let paragraph = Paragraph::new(lines)
        .block(block)
        .scroll((app.contract_detail_scroll, 0))
        .wrap(Wrap { trim: false });

    f.render_widget(paragraph, area);
}

fn render_capabilities_detail_fullscreen(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = Vec::new();
    let selected = app.selected_capability();

    let title = match selected {
        Some(cap) => format!(" [FULL SCREEN] Capability: {} ", cap.name),
        None => " [FULL SCREEN] Capability ".to_string(),
    };

    if let Some(cap) = selected {
        lines.push(Line::from(vec![
            Span::styled("Capability Name:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(&cap.name, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        ]));

        lines.push(Line::from(vec![
            Span::styled("Owning Module:    ", Style::default().fg(Color::DarkGray)),
            Span::styled(&cap.module, Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        ]));

        lines.push(Line::from(vec![
            Span::styled("Config File:      ", Style::default().fg(Color::DarkGray)),
            Span::styled(".crewmate/contracts/capabilities.yaml", Style::default().fg(Color::White)),
        ]));

        if let Some(ref ep) = cap.entrypoint {
            lines.push(Line::from(vec![
                Span::styled("Entrypoint:       ", Style::default().fg(Color::DarkGray)),
                Span::styled(ep, Style::default().fg(Color::Green)),
            ]));
        }

        lines.push(Line::raw(""));

        lines.push(Line::from(vec![
            Span::styled(
                "── Description ───────────────────────────────────────────────────────────────",
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ),
        ]));

        lines.push(Line::from(vec![
            Span::styled("  ", Style::default().fg(Color::DarkGray)),
            Span::styled(&cap.description, Style::default().fg(Color::White)),
        ]));

        lines.push(Line::raw(""));

        // Module details if contract exists
        if let Some(mc) = app.contracts.module_contracts.get(&cap.module) {
            lines.push(Line::from(vec![
                Span::styled(
                    "── Owning Module Contract ────────────────────────────────────────────────────",
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
                ),
            ]));

            let (status_color, status_text) = if mc.status == "draft" {
                (Color::Yellow, "DRAFT")
            } else {
                (Color::Green, "FINAL")
            };

            lines.push(Line::from(vec![
                Span::styled("  Contract Status: ", Style::default().fg(Color::DarkGray)),
                Span::styled(status_text, Style::default().fg(status_color).add_modifier(Modifier::BOLD)),
                Span::styled(format!("  (version {})", mc.version), Style::default().fg(Color::DarkGray)),
            ]));

            lines.push(Line::from(vec![
                Span::styled("  Exports Count:   ", Style::default().fg(Color::DarkGray)),
                Span::styled(format!("{}", mc.public_api.len()), Style::default().fg(Color::Cyan)),
            ]));
        }
    } else {
        lines.push(Line::from(Span::styled(
            " No capability selected.",
            Style::default().fg(Color::DarkGray),
        )));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::Cyan))
        .title(Span::styled(
            title,
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ));

    let paragraph = Paragraph::new(lines)
        .block(block)
        .scroll((app.contract_detail_scroll, 0))
        .wrap(Wrap { trim: false });

    f.render_widget(paragraph, area);
}
