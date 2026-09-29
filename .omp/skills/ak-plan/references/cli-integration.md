# CLI Integration & Plan Scaffolding

This skill orchestrates planning, while the AgentKit CLI (`ak`) owns plan file scaffolding and phase state mutations whenever available.

## Files-First Architecture

- `plan.md` + `phase-NN-*.md` under `<timestamp>-<slug>/` in the configured plans directory (`plans/` by default) ARE the plan.
- `ak plan` (backed by a local `plans.db`) is a rebuildable index over those files, not the source of truth. Run `ak plan reindex` if index and files drift.
- A GitHub issue is an optional visibility projection; plans remain fully functional as local files without GitHub.

## CLI Scaffolding Rules

- Use `ak plan` scaffolding operations when available.
- Default scope is project-local (`plans/` under current workspace root).
- When `--html` is active, `plan.html` is the primary user-facing deliverable; `plan.md` acts as the concise index.
- Use the live plan CLI's status operations for phase state toggles rather than hand-editing status tables when `ak` is installed.

## Mandatory Generated-File Read Pass

After CLI scaffolding and before composing replacement content:
1. Enumerate generated files: `plan.md` plus all `phase-*.md`.
2. Read `plan.md`.
3. Read every generated `phase-*.md` stub, including future phases.
4. Write or edit the full content only after the read pass.

## Canonical Phase File Template

```markdown
---
phase: <N>
title: "<Phase Name>"
status: pending       # pending | in-progress | completed
priority: P2          # P1 | P2 | P3
effort: ""            # e.g. "4h", "2d"
dependencies: []      # phase IDs this blocks on
---

# Phase <id>: <Name>

## Goal
[One clear sentence defining what this phase accomplishes]

## Files to Create / Modify
- Create: `path/to/file.ts`
- Modify: `path/to/existing.ts`

## Tasks & Steps
1. [Concrete actionable step]
2. [Concrete actionable step]

## Verification
- [Command to verify]
```
