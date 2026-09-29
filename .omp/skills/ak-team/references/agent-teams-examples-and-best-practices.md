# Agent Teams: Portable Examples and Practices

> Canonical live source: <https://code.claude.com/docs/en/agent-teams>

These examples describe collaboration semantics, not host operation names or
parameter schemas. Discover the live team, work, delegation, message, wait,
shutdown, and cleanup surfaces before execution.

## Parallel Code Review

Create three independent read-only scopes:

- security and trust boundaries;
- performance and resource behavior; and
- test coverage and failure paths.

Assign one owner and report destination per scope. Wait for all required
reports, then deduplicate findings and reconcile disagreements before
synthesis.

## Competing-Hypothesis Investigation

Give each debugger a distinct, testable theory with predicted evidence. Require
evidence for and against the theory. Encourage direct messages that challenge
other hypotheses. The lead waits for the relevant evidence and records why the
surviving theory fits better than the rejected alternatives.

## Parallel Feature Implementation

Split the feature by non-overlapping file ownership, for example:

- API and model files;
- UI and page files; and
- integration tests after both implementation scopes complete.

Represent the tester's prerequisites in shared work state. Use isolated
worktrees or the live runtime's equivalent for concurrent writers. Integrate
only after implementation scopes are verified complete.

## Parallel Research

Use distinct questions rather than duplicate searches. Each researcher writes
a durable report with sources, findings, trade-offs, and unanswered questions.
The lead compares evidence quality before recommending a direction.

## Give Enough Context

Teammates do not inherit the lead's full conversation. Include:

- exact outcome and acceptance criteria;
- bounded files or read-only scope;
- relevant project constraints;
- work, plan, and report locations;
- dependencies and ownership; and
- expected completion and blocked handoffs.

Avoid sending unrelated session history.

## Size Work Correctly

- Too small: coordination costs more than the work.
- Too large: the owner runs too long without useful checkpoints.
- Right-sized: one owner, one clear deliverable, explicit acceptance criteria,
  and a bounded verification path.

Use ordinary subagents for short or sequential work.

## Protect File Ownership

- Assign distinct file globs before spawning implementation teammates.
- Give testers ownership of test files only unless the plan says otherwise.
- If two teammates need the same file, restructure ownership or isolate and
  integrate deliberately.
- Never assume isolation removes merge risk.

## Coordinate Through Live Capabilities

- Discover the live shared-work, message, and wait surfaces.
- Record active, completed, and blocked state as work changes.
- Send concise completion or blocked messages with actionable evidence.
- Wait through the live surface and re-inspect shared state after relevant
  updates or a bounded interval appropriate to the task.
- Treat idle as waiting, not completion.
- Contact a stale owner before reassignment.

Do not copy a monitoring command or fixed polling interval into workflow
guidance.

## Verify Before Integration

A completion message is a handoff, not proof. The lead must inspect reports or
changes, confirm prerequisite state, and run integrated verification before
claiming success or shutting down the team.

## Message Discipline

- Use direct messages for scoped questions, corrections, and handoffs.
- Use team-wide messages only for issues that affect every teammate.
- Include the decision or evidence needed next; avoid status-only chatter.
- Refer to teammates by the live roster's stable names.

## Plan Approval

When plan approval is enabled, keep the teammate read-only until the lead has
reviewed its scope, ownership, validation, and risks through the live approval
surface. A rejection should include concrete revision requests.

## Shutdown and Cleanup

1. Confirm required work is complete or has a durable blocked handoff.
2. Request graceful shutdown through the live surface.
3. Wait for acknowledgement or a documented refusal.
4. Shut down every teammate before team cleanup.
5. If cleanup fails, report the observed error and follow current runtime
   guidance. Never remove guessed storage or configuration paths.

## Recovery Patterns

### Required Capability Missing

Stop the team workflow and report the capability or configuration error that
the live runtime returned. Do not prescribe a remembered enablement flag,
client restriction, or environment setting.

### Teammate Appears Stalled

Inspect shared work and messages, contact the owner, and wait for a bounded
response. If replacement is necessary, preserve the handoff and assign the
same scope without widening ownership.

### Shared State Is Stale

Ask the owner to reconcile its actual progress, then verify the underlying
artifact. Do not synthesize or release dependent work from an idle signal.

### Integration Conflicts

Stop parallel integration, preserve both branches, and assign one owner to
resolve the conflict against the accepted plan. Re-run integrated verification.

## Live Facts, Not Documentation Snapshots

Resolve current availability, models, permissions, display modes, limits,
resume behavior, memory, client support, and storage through the live runtime
or canonical source. They are intentionally absent from this reference.
