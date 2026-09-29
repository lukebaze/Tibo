# Conditional skill integration: research, debug, test, docs

These four skills join the pipeline **only when their trigger predicate holds**.
Each step is skippable; record the skip reason in the run so it is auditable.
Never run a step for ceremony, and never fabricate work to justify a step.
Never prompt interactively to decide a conditional step: evaluate the predicate
deterministically; if 50/50, skip and record why.

## Research (`/ak:research`) — technology present

**Trigger:** the request (or the resolved issue) names a specific technology —
a library, framework, plugin, SDK, API, protocol, service, or a pinned version
— whose current behavior, API, or best practice the implementation depends on.

**Skip when:** the change is purely internal to this repo with no external
dependency surface, or the technology is already well-understood and stable in
this codebase.

**Action:** before planning, run `/ak:research "<tech topics>"` for latest docs,
recent updates/breaking changes, best practices, and common issues/pitfalls.
Prefer a fresh-context subagent so findings are unbiased. Feed the research
summary into `/ak:plan` and the issue body. Note: vibe deliberately scopes
`--ultra` to plan and code-review only; do not forward `--ultra` or `--advice`
to `/ak:research`.

## Debug (`/ak:debug`) — bugfix route

**Trigger:** the request is on the bugfix route (bug, regression, broken
behavior, failing test/CI, incident, error log, or explicit fix/repair).

**Skip when:** the request is a net-new feature/enhancement with no defect to
diagnose.

**Action:** before planning or fixing, run `/ak:debug "<error/issue + evidence>"`
to prove the **root cause with concrete evidence** (reproduction command,
logs, traced call stack) — no guessing, no symptom-patching. Carry the
confirmed root cause into `/ak:plan` and `/ak:fix`. Note: `/ak:debug` does not
accept `--advice`; do not forward it there. Investigation proves root cause;
the actual code fix stays with `/ak:fix`.

## Test (`/ak:test`) — coverage that earns its place

**Trigger:** the change adds or alters observable behavior, boundaries,
invariants, transitions, precedence, or real error paths that a plausible bug
could break and existing coverage would miss.

Choose the operation:
- `create` — meaningful new behavior lacks covering tests.
- `audit` — existing/added tests look weak, deceptive, or "pass-only".
- `optimize` — the suite is slow/expensive and can be cut safely.

**Skip when:** the change is trivial, has no observable contract, or `/ak:cook
--tdd` / `/ak:fix` already produced adequate, honest coverage. Do NOT add tests
just so the change "has tests".

**Anti-cheat:** never write pass-only, tautological, or implementation-echoing
tests. Each test must fail on a plausible bug and assert consumer-observable
behavior. Never forward `--interview` (prompts stall autonomy). Forward
`--advice` when vibe ran with it (`/ak:test <op> --advice`).

## Docs (`/ak:docs`) — documentation impact

**Trigger:** the change alters a public contract, user-facing behavior, usage,
configuration, or an operating workflow that documentation must reflect.

**Skip when:** the change is invisible to docs consumers (pure internal
refactor with no contract change).

**Mode-aware execution (prevent race with ship):**
- **Official mode:** `/ak:ship official` already runs `/ak:docs update` as a
  background step. Vibe does NOT run `/ak:docs update` here (avoids two concurrent
  writers on the same worktree). Vibe only records the docs impact in the
  issue/PR and handles external docs (below).
- **Beta mode:** `/ak:ship beta` skips docs, so vibe runs `/ak:docs update`
  directly. Reuse accepted scope and authorization; forward advisory context only
  when supported by the installed mode. Always pass explicit operation `update`.
- **External docs:** when official docs live in a separate repo (e.g.
  `bestagentkits/agentkit-docs`), do NOT edit them directly. Search open and
  closed issues in that repo, then link or create a follow-up issue with the
  `ai-handle` label describing the documentation change.

Record docs impact (reason + disposition) in the PR and completion report.
