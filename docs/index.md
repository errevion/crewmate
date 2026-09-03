---
layout: home

hero:
  name: "Crewmate"
  text: "AI Agent Workflow Orchestration"
  tagline: Discuss it first. Then let the agents build it. Structured briefs, dependency DAGs, file locking, and multi-agent governance.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Architecture
      link: /guide/architecture
    - theme: alt
      text: CLI Reference
      link: /reference/cli

features:
  - title: Structured Project Briefs
    details: Prevent agent derailment and hallucination by enforcing clear goal, scope, requirements, and acceptance criteria before implementation starts.
  - title: Specialized Agent Roles
    details: Clean separation of concerns between Frontman (orchestrator), Scout (codebase explorer), Planner (task DAG generator), and Executor (parallel worker).
  - title: Conflict-Free File Locking
    details: Parallel executors acquire atomic, leased file locks with automatic heartbeat renewal and tool-interception guards to eliminate race conditions.
  - title: Graph Workflow Engine
    details: Define and execute multi-stage development pipelines with DAG execution, conditional branching, context passing, and modular JSON workflows.
  - title: Incremental Knowledge Memory
    details: Facts, design decisions, API contracts, and constraints persist across sessions in local SQLite and automatically flow into ancestor tasks.
  - title: Real-Time Terminal Observability
    details: Live TUI dashboard (powered by blessed) featuring animated agent rails, dynamic task boards, event feeds, and full modal inspectors.
---

## Quick Look

```bash
# Initialize a workspace for OpenCode
crewmate init --harness opencode

# Start a workflow run
crewmate workflow start

# Watch real-time execution in another terminal
crewmate watch
```

## How It Works

```
              ┌───────────────┐
              │   Frontman    │ (Primary Orchestrator - Zero File I/O)
              └───────┬───────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
   ┌───────────┐ ┌──────────┐ ┌──────────┐
   │   Scout   │ │ Planner  │ │ Executor │ (Parallel workers with
   │(Read-only)│ │(Task DAG)│ │ (Locks)  │  atomic write leases)
   └───────────┘ └──────────┘ └──────────┘
```
