# Agent Teams: Runtime Controls

> Canonical live source: <https://code.claude.com/docs/en/agent-teams>

Controls are runtime-owned. Before a team run, inspect the active capability
schemas and current documentation. Do not cache model lists, configuration
keys, terminal support, UI shortcuts, storage paths, or cleanup commands here.

## Control Resolution

Map the workflow's semantic needs to the live runtime:

- create and clean up a team
- create, assign, read, update, and list shared work
- spawn, message, wait for, interrupt, and shut down teammates
- approve or reject a plan when a plan gate is requested
- select isolation, permissions, model routing, and display mode when supported

If a required capability is absent or fails, report the observed error and stop
the team workflow. Do not silently substitute ordinary subagents or prescribe a
cached environment change.

## Plan Approval

When plan approval is requested:

1. Keep the teammate read-only while it plans.
2. Require the plan to include scope, ownership, validation, and risks.
3. Approve only through the live approval capability.
4. On rejection, return concrete feedback and keep implementation blocked.
5. Begin writes only after approval is confirmed.

## Delegate Mode

Delegate mode is a behavioral contract even when the runtime exposes a UI
control for it. The lead coordinates, assigns, monitors, integrates reports,
and communicates with the user. It does not edit code, run implementation
commands, or perform the merge; those actions belong to assigned teammates.

## Isolation

Use separate worktrees or the runtime's equivalent isolation for concurrent
implementation. Assign non-overlapping ownership even when isolation exists.
Read-only research and review normally do not need worktree isolation.

## Monitoring and Cleanup

- Act on verified shared task state and direct teammate messages.
- Contact a stale owner before reassigning work.
- Replace a failed teammate without widening its file ownership.
- Verify integrated changes and tests before shutdown.
- Shut down all teammates, then invoke the live cleanup capability.
- If cleanup fails, follow live recovery guidance; never remove guessed state.
