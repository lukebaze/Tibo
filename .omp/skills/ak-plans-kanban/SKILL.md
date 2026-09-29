---
name: ak-plans-kanban
description: Open the AgentKit plans dashboard in the CLI config UI. Use for plan kanban views, progress tracking, timeline checks, and quick navigation into plan files.
user-invocable: true
when_to_use: "Invoke to open or inspect the plans dashboard."
category: meta
keywords: [plans, dashboard, kanban, progress, timeline]
argument-hint: "[deprecated flags are accepted with warnings]"
metadata:
  author: agentkit
  version: "2.0.1"
---

# plans-kanban

Thin launcher for the AgentKit CLI dashboard plans view.

It opens the integrated dashboard at `http://127.0.0.1:8766/plans` instead of starting the legacy standalone server.
If the dashboard is already running on another port, the launcher follows the URL reported by `ak config status --json`.

## Quick Start

```bash
node scripts/open-dashboard.cjs
```

If the dashboard is not already running, the launcher starts:

```bash
ak config start --port 8766 --no-open --no-interactive
```

Then it opens the plans route in your browser.

## Purpose

Use this skill when you want the visual plans dashboard for:
- Multi-plan kanban and grid views
- Timeline and progress overview
- Navigating into `plan.md` and `phase-*.md` files
- Quick visibility into active vs completed work

Scope note:
- Project dashboards should show project-scoped plans only.
- Global dashboards should show global-scoped plans only.
- The live `ak plan --help` surface is authoritative for dependency/status and
  mutation operations; `plans-kanban` is only a launcher.
- The generic `/plans` route defaults to `plans` unless a `dir` query param is already present; scope-aware plan roots come from the project/global dashboard context, not from deprecated launcher flags.

## Dashboard Workflow

```bash
# Open the plans dashboard
node scripts/open-dashboard.cjs

# Run the dashboard manually if you want to keep it in the foreground
ak config start --port 8766
```

Primary URL:

```text
http://127.0.0.1:8766/plans
```

## Compatibility And CLI Authority

The launcher still recognizes legacy standalone inputs only to warn, ignore,
or translate them. [`scripts/open-dashboard.cjs`](./scripts/open-dashboard.cjs)
owns that compatibility behavior. Do not copy its flag roster into this skill.

For direct dashboard or plan operations, inspect `ak config --help` or
`ak plan --help` at runtime. Those help surfaces own the current commands,
flags, and examples.

## Requirements

### CLI Compatibility

The launcher performs a capability probe before opening the browser.
The dashboard at `/plans` is only opened when the running AgentKit CLI instance supports it, detected by either:

- `/api/health` response containing `"plans-dashboard"` in its `features` array, or
- `/api/plans` responding with a 2xx status (backward-compat for early dev builds).

If neither probe succeeds, the launcher prints an upgrade message and exits with code 1 without opening the browser. Upgrade the CLI to a version that exposes the plans-dashboard capability to use this launcher.

Legacy migration details: `references/legacy-migration.md` when troubleshooting old launchers.

## Troubleshooting

**`ak` not found**
Install the AgentKit CLI and confirm `ak --version` works in your shell, or set `AGENTKIT_CLI` to the local binary path.

**Dashboard did not open**
Start it manually with `ak config start --port 8766`, then open `/plans` on whichever port the CLI reports.

**Need to stop a launcher-started dashboard**
Run the launcher again with `--stop`, or run `ak config stop`, only for a dashboard
this task started/owns. Reuse the actual status URL and do not stop another session.

**Need custom host or different port**
Run `ak config start` directly with the flags you need. The `plans-kanban` launcher intentionally stays thin and opinionated.
