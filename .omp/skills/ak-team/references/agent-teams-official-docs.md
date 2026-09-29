# Agent Teams: Stable Operating Model

> Canonical live source: <https://code.claude.com/docs/en/agent-teams>

This reference records the durable model used by `ak:team`. It deliberately
does not copy current flags, tool schemas, model choices, storage paths,
shortcuts, client support, limits, or experimental status. Inspect those from
the live runtime and canonical documentation at execution time.

## Purpose

Agent Teams coordinate independent teammate sessions through a lead, shared
work state, and direct messages. Use them when parallel workers need separate
context and must coordinate. Use ordinary subagents for focused work that only
needs to return a result to its parent.

Good team work has independent boundaries:

- research from different angles
- implementation across non-overlapping files or isolated worktrees
- review from distinct specialties
- debugging with competing hypotheses

Avoid teams for sequential work, same-file editing, or tasks whose coordination
cost exceeds their parallel value.

## Runtime Boundary

Before creating a team:

1. Inspect the live team, task, delegation, message, shutdown, and cleanup
   capabilities and their schemas.
2. Inspect current model, permission, isolation, display, and capacity controls
   only when the task needs them.
3. Create the team through the live capability.
4. If creation is unavailable or fails, stop and report the observed error.
   Do not guess an enablement flag, supported client, or state directory.

The executable operation sequence belongs to `../SKILL.md`. This reference
must not become a second tool-schema authority.

## Stable Invariants

- The lead owns decomposition, non-overlapping file ownership, task state,
  integration, and the final answer.
- Each teammate receives explicit scope, acceptance criteria, work context,
  report path, and project rules.
- Implementation workers use isolation when concurrent edits could conflict.
- Teammates report actionable results and mark their shared work state.
- The lead verifies results and runs integrated tests; a teammate's completion
  message is not verification.
- Shutdown every teammate before cleanup.
- If cleanup fails, use the live runtime recovery guidance; never delete a
  guessed directory.

## Live Facts to Resolve, Not Cache

Consult the active runtime or canonical source for:

- capability and parameter names
- enablement and availability
- model routing and mixed-model support
- permissions and inheritance
- display modes, clients, terminals, and shortcuts
- concurrency and cost limits
- task and hook event schemas
- session, memory, storage, resume, and cleanup behavior
