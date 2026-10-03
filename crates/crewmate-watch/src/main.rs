use std::error::Error;
use std::io;
use std::path::PathBuf;
use std::time::Instant;

use clap::Parser;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

use crewmate_watch::app::{App, AppPage};
use crewmate_watch::data::contracts::ContractsSubView;
use crewmate_watch::ui;

#[derive(Parser, Debug)]
#[command(
    name = "crewmate-watch",
    about = "Read-only live TUI observer for Crewmate workflow engine",
    version
)]
struct Args {
    /// Workspace root directory containing .crewmate/ and workflow definitions
    #[arg(short, long, default_value = ".")]
    root: PathBuf,

    /// UI polling and refresh rate in frames per second
    #[arg(long, default_value_t = 10)]
    fps: u64,
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();

    // Setup terminal panic hook to ensure restoration on error
    let default_panic_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
        default_panic_hook(panic_info);
    }));

    // Setup crossterm terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new(args.root, args.fps);

    let res = run_app(&mut terminal, &mut app);

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    if let Err(err) = res {
        eprintln!("crewmate-watch error: {err:?}");
    }

    Ok(())
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> io::Result<()> {
    let mut last_tick = Instant::now();

    loop {
        terminal.draw(|f| ui::render(f, app))?;

        let timeout = app
            .tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or_else(|| std::time::Duration::from_secs(0));

        if event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                // Ignore key release events on platforms that emit them
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') => {
                            if app.show_event_detail {
                                app.show_event_detail = false;
                            } else if app.show_task_detail {
                                app.show_task_detail = false;
                            } else if app.show_help {
                                app.show_help = false;
                            } else {
                                app.should_quit = true;
                            }
                        }
                        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            app.should_quit = true;
                        }
                        KeyCode::Tab => {
                            app.switch_page();
                        }
                        KeyCode::Char('1') => {
                            app.set_page(AppPage::Workflow);
                        }
                        KeyCode::Char('2') => {
                            app.set_page(AppPage::Tasks);
                        }
                        KeyCode::Char('3') => {
                            app.set_page(AppPage::Contracts);
                        }
                        KeyCode::Esc => {
                            if app.show_event_detail {
                                app.show_event_detail = false;
                            } else if app.show_task_detail {
                                app.show_task_detail = false;
                            } else if app.show_contract_detail {
                                app.close_contract_detail();
                            } else if app.show_help {
                                app.show_help = false;
                            } else {
                                app.should_quit = true;
                            }
                        }
                        KeyCode::Enter => match app.current_page {
                            AppPage::Workflow => {
                                if app.show_event_detail {
                                    app.show_event_detail = false;
                                } else {
                                    app.open_event_detail();
                                }
                            }
                            AppPage::Tasks => {
                                if app.show_task_detail {
                                    app.show_task_detail = false;
                                } else {
                                    app.open_task_detail();
                                }
                            }
                            AppPage::Contracts => {
                                if app.show_contract_detail {
                                    app.close_contract_detail();
                                } else {
                                    app.open_contract_detail();
                                }
                            }
                        },
                        KeyCode::Char('h') | KeyCode::Char('?') => {
                            app.toggle_help();
                        }
                        KeyCode::Up | KeyCode::Char('k') => match app.current_page {
                            AppPage::Workflow => {
                                app.scroll_events_up();
                            }
                            AppPage::Tasks => {
                                app.select_previous_task();
                            }
                            AppPage::Contracts => {
                                if app.show_contract_detail {
                                    app.scroll_contract_detail_up();
                                } else {
                                    app.select_previous_contract_item();
                                }
                            }
                        },
                        KeyCode::Down | KeyCode::Char('j') => match app.current_page {
                            AppPage::Workflow => {
                                app.scroll_events_down();
                            }
                            AppPage::Tasks => {
                                app.select_next_task();
                            }
                            AppPage::Contracts => {
                                if app.show_contract_detail {
                                    app.scroll_contract_detail_down();
                                } else {
                                    app.select_next_contract_item();
                                }
                            }
                        },
                        KeyCode::Left => match app.current_page {
                            AppPage::Workflow => app.scroll_graph_left(),
                            AppPage::Contracts if !app.show_contract_detail => {
                                app.cycle_contracts_subview_back();
                            }
                            _ => {}
                        },
                        KeyCode::Right => match app.current_page {
                            AppPage::Workflow => app.scroll_graph_right(),
                            AppPage::Contracts if !app.show_contract_detail => {
                                app.cycle_contracts_subview();
                            }
                            _ => {}
                        },
                        KeyCode::Char('a') => match app.current_page {
                            AppPage::Workflow => app.scroll_graph_left(),
                            AppPage::Contracts if !app.show_contract_detail => {
                                app.set_contracts_subview(ContractsSubView::Architecture);
                            }
                            _ => {}
                        },
                        KeyCode::Char('d') if app.current_page == AppPage::Workflow => {
                            app.scroll_graph_right();
                        }
                        KeyCode::Char('m')
                            if app.current_page == AppPage::Contracts
                                && !app.show_contract_detail =>
                        {
                            app.set_contracts_subview(ContractsSubView::Modules);
                        }
                        KeyCode::Char('p')
                            if app.current_page == AppPage::Contracts
                                && !app.show_contract_detail =>
                        {
                            app.set_contracts_subview(ContractsSubView::Capabilities);
                        }
                        KeyCode::Char('c') | KeyCode::Char('f')
                            if app.current_page == AppPage::Workflow =>
                        {
                            app.reset_graph_focus();
                        }
                        KeyCode::Home if app.current_page == AppPage::Workflow => {
                            app.scroll_graph_start();
                        }
                        KeyCode::End if app.current_page == AppPage::Workflow => {
                            app.scroll_graph_end();
                        }
                        _ => {}
                    }
                }
            }
        }

        if last_tick.elapsed() >= app.tick_rate {
            app.on_tick();
            last_tick = Instant::now();
        }

        if app.should_quit {
            break;
        }
    }

    Ok(())
}
