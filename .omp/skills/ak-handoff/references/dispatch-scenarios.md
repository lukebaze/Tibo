# Dispatch mode acceptance scenarios

## Scenarios

### Scenario 1 — Generated handoff without recorded write authority

**Given** no matching recorded write authority and no `--handoff` is passed, and the user runs
`/ak:handoff --dispatch --agent claude-code "continue the OAuth callback fix"`.
**When** the skill runs.
**Expect** `ak:handoff` produces a fresh artifact under `plans/handoffs/`;
the artifact passes schema validation; the built job spec has
`runtime: claude-code`, `prompt:` containing both the handoff read
instruction and the task text, `approval: require`, `effect: scoped-write`;
orchestrate runs a preflight and dispatches; final report includes all
seven fields listed above.

### Scenario 2 — Supplied handoff, codex

**Given** `plans/handoffs/oauth-callback.md` exists and is valid.
**When** `/ak:handoff --dispatch --agent codex --handoff plans/handoffs/oauth-callback.md`
runs.
**Expect** no new `ak:handoff` invocation; the supplied artifact is
validated against the schema and secret patterns; the job spec's
`runtime: codex`.

### Scenario 3 — Runtime preflight failure, no silent fallback

_(Replaces the "explicit fallback opt-in" scenario the original design anticipated. `--fallback-agent` is out of scope. Orchestrate's `fallback_runtime` YAML field remains
available for advanced users who author a spec directly.)_

**Given** `--agent opencode` is chosen but the binary is missing or
unauthenticated.
**When** the skill runs.
**Expect** orchestrate's live matrix marks the candidate `unavailable`;
`ak:handoff --dispatch` prints a blocker naming the missing capability and suggests
`--agent <alternative>`; **no silent substitution**; the handoff artifact
was written and is included in the blocker report so no work is lost.

### Scenario 4 — Destructive continuation lacking sufficient authority

**Given** the task text explicitly requests destructive or write work
(the handoff's Exact next actions section says "delete legacy adapter" or
similar).
**When** `/ak:handoff --dispatch --agent claude-code "delete the legacy adapter"`
runs without `--yes`.
**Expect** the job spec classifies destructive effects according to the Scope section, uses `approval: require` and the required isolation;
orchestrate stops at the confirmation gate; the report notes the block and
suggests rerunning with `--yes` once the user approves.

### Scenario 5 — Secret in `--task` text

**Given** the user pastes a Bearer token into the task string.
**When** `/ak:handoff --dispatch --agent claude-code "use Bearer eyJ… to test"` runs.
**Expect** immediate refusal (before the handoff step) with a message
asking the user to rephrase without the credential. No artifact is
written. No orchestrate invocation.

### Scenario 6 — Successful captured + arbited completion

**Given** all preflight passes, `--yes` is set, `--agent claude-code`.
**When** orchestrate dispatches and the job completes.
**Expect** the report cites the run dir, the arbiter verdict, produced
artifacts (patch, diff, run log), the verification-status summary, and the
next action. The handoff artifact path is still surfaced.

### Scenario 7 — `--agent internal` with `--model` rejection

**Given** `/ak:handoff --dispatch --agent internal --model anthropic/claude-sonnet-5
"…"`.
**When** the skill runs.
**Expect** immediate refusal explaining that job-spec.md forbids `model:`
on internal jobs; suggests rerunning without `--model` or with a CLI
runtime.
