use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::data::activity::ActivitySnapshot;
use crate::data::contracts::{
    ContractsSnapshot, ContractsSubView, ModuleContract, ModuleIndexEntry,
};
use crate::data::heartbeat::HeartbeatStatus;
use crate::data::state::EngineStateSnapshot;
use crate::data::task::TaskSnapshot;
use crate::data::workflow::WorkflowModel;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AppPage {
    #[default]
    Workflow,
    Tasks,
    Contracts,
}

#[derive(Debug, Clone)]
pub struct TransitionAnimation {
    pub from_node: String,
    pub to_node: String,
    pub start_time: Instant,
    pub duration: Duration,
}

impl TransitionAnimation {
    pub fn new(from: String, to: String, duration_ms: u64) -> Self {
        Self {
            from_node: from,
            to_node: to,
            start_time: Instant::now(),
            duration: Duration::from_millis(duration_ms),
        }
    }

    pub fn progress(&self) -> f32 {
        let elapsed = self.start_time.elapsed().as_secs_f32();
        let total = self.duration.as_secs_f32();
        if total <= 0.0 {
            1.0
        } else {
            (elapsed / total).clamp(0.0, 1.0)
        }
    }

    pub fn is_finished(&self) -> bool {
        self.start_time.elapsed() >= self.duration
    }
}

pub struct App {
    pub project_root: PathBuf,
    pub tick_rate: Duration,
    pub should_quit: bool,
    pub show_help: bool,
    pub current_page: AppPage,
    pub workflow: Option<WorkflowModel>,
    pub state: EngineStateSnapshot,
    pub activity: ActivitySnapshot,
    pub heartbeat: HeartbeatStatus,
    pub task_snapshot: TaskSnapshot,
    pub contracts: ContractsSnapshot,
    pub contracts_subview: ContractsSubView,
    pub selected_module_index: usize,
    pub selected_arch_index: usize,
    pub selected_cap_index: usize,
    pub selected_task_index: usize,
    pub tasks_done_expanded: bool,
    pub show_task_detail: bool,
    pub show_contract_detail: bool,
    pub contract_detail_scroll: u16,
    pub previous_node: Option<String>,
    pub transition_animation: Option<TransitionAnimation>,
    pub graph_focus_index: Option<usize>,
    pub selected_event_index: usize,
    pub show_event_detail: bool,
    pub frame_count: u64,
    pub start_time: Instant,
    pub last_poll: Instant,
    pub poll_interval: Duration,
}

impl App {
    pub fn new(project_root: PathBuf, fps: u64) -> Self {
        let tick_ms = if fps == 0 {
            100
        } else {
            1000 / fps.clamp(1, 60)
        };
        let tick_rate = Duration::from_millis(tick_ms);

        let state = EngineStateSnapshot::load_from_root(&project_root);
        let workflow =
            WorkflowModel::load_from_root(&project_root, state.active_workflow.as_deref()).ok();
        let activity = ActivitySnapshot::load_from_root(&project_root);
        let heartbeat = HeartbeatStatus::load_from_root(&project_root);
        let task_snapshot =
            TaskSnapshot::load_from_root(&project_root, &activity, workflow.as_ref());
        let contracts = ContractsSnapshot::load_from_root(&project_root);
        let current_node = state.current_node.clone();

        Self {
            project_root,
            tick_rate,
            should_quit: false,
            show_help: false,
            current_page: AppPage::Workflow,
            workflow,
            state,
            activity,
            heartbeat,
            task_snapshot,
            contracts,
            contracts_subview: ContractsSubView::Modules,
            selected_module_index: 0,
            selected_arch_index: 0,
            selected_cap_index: 0,
            selected_task_index: 0,
            tasks_done_expanded: true,
            show_task_detail: false,
            show_contract_detail: false,
            contract_detail_scroll: 0,
            previous_node: current_node,
            transition_animation: None,
            graph_focus_index: None,
            selected_event_index: 0,
            show_event_detail: false,
            frame_count: 0,
            start_time: Instant::now(),
            last_poll: Instant::now(),
            poll_interval: Duration::from_millis(100),
        }
    }

    pub fn on_tick(&mut self) {
        self.frame_count = self.frame_count.wrapping_add(1);

        // Clean up finished transition animation
        if let Some(ref anim) = self.transition_animation {
            if anim.is_finished() {
                self.transition_animation = None;
            }
        }

        // Poll filesystem if interval elapsed
        if self.last_poll.elapsed() >= self.poll_interval {
            self.last_poll = Instant::now();
            self.poll_files();
        }
    }

    pub fn poll_files(&mut self) {
        // Reload state
        let new_state = EngineStateSnapshot::load_from_root(&self.project_root);

        // Detect if workflow changed or not yet loaded
        let workflow_changed = new_state.active_workflow != self.state.active_workflow;
        if self.workflow.is_none() || workflow_changed {
            self.workflow = WorkflowModel::load_from_root(
                &self.project_root,
                new_state.active_workflow.as_deref(),
            )
            .ok();
        }

        // Detect node transition
        if let Some(ref new_node) = new_state.current_node {
            if let Some(ref prev) = self.previous_node {
                if prev != new_node {
                    // Reset graph focus to auto-follow active node on transition
                    self.graph_focus_index = None;

                    // Trigger tweened transition dot animation
                    self.transition_animation = Some(TransitionAnimation::new(
                        prev.clone(),
                        new_node.clone(),
                        500, // 500ms duration
                    ));
                }
            }
            self.previous_node = Some(new_node.clone());
        }

        self.state = new_state;

        // Reload activity and heartbeat
        self.activity = ActivitySnapshot::load_from_root(&self.project_root);
        self.heartbeat = HeartbeatStatus::load_from_root(&self.project_root);

        // Reload tasks snapshot
        self.task_snapshot = TaskSnapshot::load_from_root(
            &self.project_root,
            &self.activity,
            self.workflow.as_ref(),
        );

        // Reload contracts snapshot
        self.contracts = ContractsSnapshot::load_from_root(&self.project_root);

        // Clamp task selection index if needed
        let total_selectable = self.total_selectable_tasks();
        if total_selectable == 0 {
            self.selected_task_index = 0;
        } else if self.selected_task_index >= total_selectable {
            self.selected_task_index = total_selectable - 1;
        }
    }

    pub fn switch_page(&mut self) {
        self.current_page = match self.current_page {
            AppPage::Workflow => AppPage::Tasks,
            AppPage::Tasks => AppPage::Contracts,
            AppPage::Contracts => AppPage::Workflow,
        };
    }

    pub fn set_page(&mut self, page: AppPage) {
        self.current_page = page;
    }

    pub fn cycle_contracts_subview(&mut self) {
        self.contracts_subview = match self.contracts_subview {
            ContractsSubView::Modules => ContractsSubView::Architecture,
            ContractsSubView::Architecture => ContractsSubView::Capabilities,
            ContractsSubView::Capabilities => ContractsSubView::Modules,
        };
    }

    pub fn cycle_contracts_subview_back(&mut self) {
        self.contracts_subview = match self.contracts_subview {
            ContractsSubView::Modules => ContractsSubView::Capabilities,
            ContractsSubView::Architecture => ContractsSubView::Modules,
            ContractsSubView::Capabilities => ContractsSubView::Architecture,
        };
    }

    pub fn open_contract_detail(&mut self) {
        self.show_contract_detail = true;
        self.contract_detail_scroll = 0;
    }

    pub fn close_contract_detail(&mut self) {
        self.show_contract_detail = false;
        self.contract_detail_scroll = 0;
    }

    pub fn scroll_contract_detail_up(&mut self) {
        if self.contract_detail_scroll > 0 {
            self.contract_detail_scroll = self.contract_detail_scroll.saturating_sub(1);
        }
    }

    pub fn scroll_contract_detail_down(&mut self) {
        if self.contract_detail_scroll < 500 {
            self.contract_detail_scroll = self.contract_detail_scroll.saturating_add(1);
        }
    }

    pub fn set_contracts_subview(&mut self, subview: ContractsSubView) {
        self.contracts_subview = subview;
    }

    pub fn select_previous_contract_item(&mut self) {
        match self.contracts_subview {
            ContractsSubView::Modules => {
                if self.selected_module_index > 0 {
                    self.selected_module_index -= 1;
                }
            }
            ContractsSubView::Architecture => {
                if self.selected_arch_index > 0 {
                    self.selected_arch_index -= 1;
                }
            }
            ContractsSubView::Capabilities => {
                if self.selected_cap_index > 0 {
                    self.selected_cap_index -= 1;
                }
            }
        }
    }

    pub fn select_next_contract_item(&mut self) {
        match self.contracts_subview {
            ContractsSubView::Modules => {
                let total = self.contracts.index.modules.len();
                if total > 0 && self.selected_module_index + 1 < total {
                    self.selected_module_index += 1;
                }
            }
            ContractsSubView::Architecture => {
                let total = self.contracts.architecture.modules.len();
                if total > 0 && self.selected_arch_index + 1 < total {
                    self.selected_arch_index += 1;
                }
            }
            ContractsSubView::Capabilities => {
                let total = self.contracts.capabilities.capabilities.len();
                if total > 0 && self.selected_cap_index + 1 < total {
                    self.selected_cap_index += 1;
                }
            }
        }
    }

    pub fn selected_module(&self) -> Option<&ModuleIndexEntry> {
        let modules = &self.contracts.index.modules;
        if modules.is_empty() {
            None
        } else {
            let idx = self.selected_module_index.min(modules.len() - 1);
            Some(&modules[idx])
        }
    }

    pub fn selected_module_contract(&self) -> Option<&ModuleContract> {
        if let Some(m) = self.selected_module() {
            self.contracts.module_contracts.get(&m.name)
        } else {
            None
        }
    }

    pub fn selected_arch_module(
        &self,
    ) -> Option<(&String, &crate::data::contracts::ModuleArchEntry)> {
        let arch = &self.contracts.architecture.modules;
        if arch.is_empty() {
            None
        } else {
            let mut keys: Vec<&String> = arch.keys().collect();
            keys.sort();
            let idx = self.selected_arch_index.min(keys.len() - 1);
            let key = keys[idx];
            Some((key, &arch[key]))
        }
    }

    pub fn selected_capability(&self) -> Option<&crate::data::contracts::CapabilityEntry> {
        let caps = &self.contracts.capabilities.capabilities;
        if caps.is_empty() {
            None
        } else {
            let idx = self.selected_cap_index.min(caps.len() - 1);
            Some(&caps[idx])
        }
    }

    pub fn select_previous_task(&mut self) {
        if self.selected_task_index > 0 {
            self.selected_task_index -= 1;
        }
    }

    pub fn select_next_task(&mut self) {
        let total = self.total_selectable_tasks();
        if total > 0 && self.selected_task_index + 1 < total {
            self.selected_task_index += 1;
        }
    }

    pub fn total_selectable_tasks(&self) -> usize {
        self.task_snapshot.running.len()
            + self.task_snapshot.waiting.len()
            + self.task_snapshot.done.len()
    }

    pub fn selected_task(&self) -> Option<&crate::data::task::TaskItem> {
        let running_len = self.task_snapshot.running.len();
        let waiting_len = self.task_snapshot.waiting.len();
        let done_len = self.task_snapshot.done.len();
        let total = running_len + waiting_len + done_len;

        if total == 0 {
            return None;
        }

        let idx = self.selected_task_index.min(total - 1);
        if idx < running_len {
            self.task_snapshot.running.get(idx)
        } else if idx < running_len + waiting_len {
            self.task_snapshot.waiting.get(idx - running_len)
        } else {
            self.task_snapshot.done.get(idx - running_len - waiting_len)
        }
    }

    pub fn open_task_detail(&mut self) {
        if self.selected_task().is_some() {
            self.show_task_detail = true;
        }
    }

    pub fn close_task_detail(&mut self) {
        self.show_task_detail = false;
    }

    pub fn scroll_events_up(&mut self) {
        if self.selected_event_index > 0 {
            self.selected_event_index -= 1;
        }
    }

    pub fn scroll_events_down(&mut self) {
        let total = self.activity.recent_events.len();
        if total > 0 && self.selected_event_index + 1 < total {
            self.selected_event_index += 1;
        }
    }

    pub fn open_event_detail(&mut self) {
        if !self.activity.recent_events.is_empty() {
            self.show_event_detail = true;
        }
    }

    pub fn close_event_detail(&mut self) {
        self.show_event_detail = false;
    }

    pub fn selected_event(&self) -> Option<&crate::data::activity::FormattedRecentEvent> {
        let total = self.activity.recent_events.len();
        if total == 0 {
            None
        } else {
            let idx = self.selected_event_index.min(total - 1);
            Some(&self.activity.recent_events[idx])
        }
    }

    pub fn toggle_help(&mut self) {
        self.show_help = !self.show_help;
    }

    pub fn active_node_index(&self) -> usize {
        if let Some(ref wf) = self.workflow {
            if let Some(ref curr) = self.state.current_node {
                if let Some(idx) = wf.nodes_in_order.iter().position(|n| n == curr) {
                    return idx;
                }
            }
        }
        0
    }

    pub fn current_focus_index(&self) -> usize {
        if let Some(idx) = self.graph_focus_index {
            idx
        } else {
            self.active_node_index()
        }
    }

    pub fn scroll_graph_left(&mut self) {
        let curr = self.current_focus_index();
        if curr > 0 {
            self.graph_focus_index = Some(curr - 1);
        }
    }

    pub fn scroll_graph_right(&mut self) {
        if let Some(ref wf) = self.workflow {
            let total = wf.nodes_in_order.len();
            let curr = self.current_focus_index();
            if curr + 1 < total {
                self.graph_focus_index = Some(curr + 1);
            }
        }
    }

    pub fn scroll_graph_start(&mut self) {
        self.graph_focus_index = Some(0);
    }

    pub fn scroll_graph_end(&mut self) {
        if let Some(ref wf) = self.workflow {
            let total = wf.nodes_in_order.len();
            if total > 0 {
                self.graph_focus_index = Some(total - 1);
            }
        }
    }

    pub fn reset_graph_focus(&mut self) {
        self.graph_focus_index = None;
    }

    /// Single source of truth: returns (current_node_name, 1-based index, total_nodes)
    pub fn current_node_position(&self) -> (String, usize, usize) {
        if let Some(ref wf) = self.workflow {
            let total = wf.nodes_in_order.len();
            if let Some(ref curr) = self.state.current_node {
                if let Some(pos) = wf.nodes_in_order.iter().position(|n| n == curr) {
                    (curr.clone(), pos + 1, total)
                } else if curr == "done" {
                    (curr.clone(), total, total)
                } else {
                    (curr.clone(), 0, total)
                }
            } else {
                ("-".to_string(), 0, total)
            }
        } else {
            (
                self.state
                    .current_node
                    .clone()
                    .unwrap_or_else(|| "-".to_string()),
                0,
                0,
            )
        }
    }

    /// Single source of truth: workflow display name
    pub fn workflow_display_name(&self) -> String {
        if let Some(ref active_wf) = self.state.active_workflow {
            if active_wf != "feature-pipeline" && active_wf != "default" {
                active_wf.clone()
            } else if let Some(ref wf) = self.workflow {
                wf.name.clone()
            } else {
                active_wf.clone()
            }
        } else if let Some(ref wf) = self.workflow {
            wf.name.clone()
        } else {
            "Workflow".to_string()
        }
    }

    /// Single source of truth: total event count across tasks and activities
    pub fn total_events_count(&self) -> usize {
        if self.task_snapshot.events_count > 0 {
            self.task_snapshot.events_count
        } else {
            self.activity.recent_events.len()
        }
    }

    /// Single source of truth: formatted elapsed duration
    pub fn elapsed_display(&self) -> String {
        if let Some(ref ts) = self.state.last_timestamp {
            crate::data::activity::format_elapsed(ts)
        } else {
            format!("{}s", self.start_time.elapsed().as_secs())
        }
    }

    /// Single source of truth: optional goal / instructions subtitle for current node
    pub fn current_goal_subtitle(&self) -> Option<String> {
        let goal = if let Some(ref wf) = self.workflow {
            if let Some(ref curr) = self.state.current_node {
                wf.node_defs
                    .get(curr)
                    .and_then(|d| d.instructions.lines().find(|l| !l.trim().is_empty()))
                    .unwrap_or("")
            } else {
                ""
            }
        } else if let Some(first_task) = self.task_snapshot.running.first() {
            &first_task.goal
        } else {
            ""
        };

        if goal.trim().is_empty() {
            None
        } else {
            Some(goal.to_string())
        }
    }
}
