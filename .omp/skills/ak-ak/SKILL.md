---
name: ak-ak
description: "Operate the ak control-plane CLI itself — the AgentKit binary that installs, inspects, updates, recovers, and removes kits and their skills. Use when the next action is invoking an ak subcommand (init, kit, skills, plan, journal, doctor, recover, self-update, login), deciding between read-only inspection and lifecycle mutation, disambiguating project vs global scope, or interpreting ak --json output. Not for authoring skills (use ak:skill-creator) or routing generic work (use ak:agentkit)."
user-invocable: true
when_to_use: "Invoke when the next action is running an ak subcommand or interpreting its output. Do not invoke for skill authoring (ak:skill-creator), plan writing (ak:plan), journal writing (ak:journal), generic task routing (ak:agentkit), or kit-specific workflows already covered by their own skills."
category: meta
keywords: [ak, cli, lifecycle, install, kit, skills, scope, adapter, doctor, recover, self-update]
argument-hint: "[goal or subcommand]"
metadata:
  author: agentkit
  version: "1.0.2"
---

# ak — safe CLI operation

Purpose: teach agents how to use the `ak` control-plane CLI without breaking
user-owned state. This skill owns the safe **operating model**, not the flag
reference. The generated appendix at
[`references/command-reference.md`](./references/command-reference.md) is a
starting index; `ak <cmd> --help` and `--json` output are always
authoritative.

## When to use vs when not to use

Use `ak:ak` when the next concrete action is:

- running an `ak` subcommand (`init`, `kit`, `skills`, `plan`, `journal`,
  `doctor`, `recover`, `self-update`, …);
- deciding between a read-only inspection command and a mutating lifecycle
  command;
- disambiguating project vs user/global scope, adapter, or delivery mode
  before a change lands somewhere the user did not expect;
- interpreting an `ak <cmd> --json` envelope.

Do **not** invoke for:

| Intent | Route to |
|--------|----------|
| Authoring or refining a Claude skill | `ak:skill-creator` |
| Writing or executing an implementation plan | `ak:plan`, `ak:cook` |
| Writing a technical journal entry | `ak:journal` |
| Choosing which installed skill fits a task | `ak:agentkit` (task router) |
| Any kit-specific workflow already covered by its own skill | that skill |

`ak:agentkit` decides *which skill runs*. `ak:ak` runs *the ak binary itself*.

## Safe operating protocol

Classify effects and resolve scope first. Reuse help and inspection evidence for the
same binary/version and target; refresh only when either changes or syntax is uncertain.

1. **Triage the goal.** Which category of the safety legend does the intent
   fall into?
   - `read-only` — never mutates disk, config, or remote state
   - `mutating` — installs, updates, removes, or writes durable state
   - `diagnostic` — long-running or interactive (TUI, GUI, watch, daemon
     serve); user judgement is the main side effect
2. **Inspect before acting.** Run `ak <cmd> --help` for the intended
   subcommand. For **read-only** scripted work also pass
   `--json --no-interactive` so the response is a versioned envelope
   (`schema_version`, `kind`, `data`) that can be parsed instead of scraped.
   Use supported `--no-interactive` or `--yes` within the user-authorized scope.
   Additive/reconcilable updates proceed without another approval. Destructive
   collision overwrites, unknown-content removal and state resets require a scoped
   preview, snapshot and authorization covering those specific effects.
   For human diagnostics, use `--verbose` on a safe read-only reproduction or
   the next authorized invocation. Never repeat a mutating command solely for
   diagnostic detail; inspect partial state and retry only within the existing authorization.
   `--quiet` overrides `--verbose`; `--verbose` does not change the typed JSON
   envelope.
3. **Confirm scope.** Where does this command act?
   - Project scope: current working tree; changes live under the project.
   - User/global scope: `~/.claude`, `~/.agents`, `~/.codex`, or the
     equivalent adapter home; changes affect every project.
   - Kit installation source (embedded vs remote registry vs local path).
   - Adapter/delivery mode (native emission vs plugin package). See the
     runtime support matrix before claiming a capability is active on any
     harness.
4. **Prefer status / inspect before lifecycle mutation.** Before `ak update`,
   `ak kit refresh`, `ak self-update`, `ak uninstall`, or `ak recover`, run
   the corresponding read-only path: `ak doctor`, `ak kit list-kits`,
   `ak kit validate`, `ak skill verify`, `ak plan status`, `ak sessions
   list`, `ak backups list`, `ak diagnostics export`, etc. Preview conflicts
   instead of guessing. **Snapshot before mutate:** before `ak recover`,
   `ak backups restore`, `ak uninstall`, or any command combined with
   `--fresh`, first run `ak backups create` (or confirm a current backup
   with `ak backups list`) so the mutation is reversible.
5. **Preserve unknown files.** AgentKit mutates only paths it owns. Never
   suggest `--force` combined with `--fresh`; never propose a destructive
   reset unless the user has explicitly asked. Surface a conflict; do not
   silently overwrite.
6. **Never run destructive commands against real maintainer state.** For
   installer/refresh/recovery smoke tests, use a fresh temporary home and
   set every applicable env var: `AGENTKIT_HOME`, `AGENTKIT_CLAUDE_HOME`,
   `CODEX_HOME`, cache/config/transcript/project paths. See
   [`docs/operations/implementation-smoke.md`](../../../../docs/operations/implementation-smoke.md).
7. **Report the exact command, scope, and result.** Include the resolved
   `--json` envelope where relevant. Name what changed on disk and any
   unresolved constraint (e.g. "matrix says cursor is production but the
   local install claims it as spike").

## Command families by task

Names below are the *task category*; the full command list with
classifications is in
[`references/command-reference.md`](./references/command-reference.md).
Use the appendix to find the exact command, then `ak <cmd> --help` for
flags.

- **Bootstrap and setup** — start here for a new project or a new machine.
  `ak init`, `ak new`, `ak setup`, `ak onboard`. All `mutating`.
  `ak setup` writes user config only. `ak onboard` runs setup, CLI login, then kit install.
- **Kits** — install, refresh, validate, and remove kits.
  `ak kit init|install|refresh|validate|uninstall|list-kits|repair-install-mode`.
  `ak kit list-kits` and `ak kit validate` are read-only; the rest mutate.
- **Skills** — inventory and per-skill environment.
  `ak skills list|show|search|install|remove|graph` for the inventory;
  `ak skill install|remove|repair|upgrade|verify` for one skill.
- **Agents, content, commands** — mirror the skills shape.
  Reads (`list`, `show`, `search`), writes (`install`, `remove`), and one
  domain-specific mutating action per group.
- **Plans and journals** — file-first plan and journal management. `ak plan
  list|show|status|search|validate|resolve|parse` are read-only. `ak plan
  create|check|uncheck|add-phase|update|use|archive|close|reindex|migrate`
  mutate the plan store or plan files. `ak plan kanban` is a diagnostic
  TUI. `ak journal list|show|validate` read; `ak journal create` writes.
- **Diagnostics** — `ak doctor`, `ak activity`, `ak audit`, `ak sessions`,
  `ak analytics`, `ak backups`, `ak versions`, `ak changelog`,
  `ak diagnostics export`. Nearly all read-only; enable/disable/delete
  under `analytics` and `content-search` are mutating.
- **Effectiveness** — `ak insights skills|agents|evidence|compare|improvements`
  read local quality, cost, time, uncertainty and coverage. `consent` changes
  collection/sharing only for supplied flags; `collect`, `record`, and
  `evaluate` write local evidence. A completed process is not acceptance.
  `skills` and `agents` support `--since`/`--until` in Unix milliseconds and
  `--previous-period` for descriptive changes across equally long windows.
  Keep configuration/evaluator revisions and unknown resource coverage visible;
  use paired evaluations before attributing improvement to a skill or runtime.
  `ak eval run <suite.json>` executes trusted commands in isolated workspaces
  and runtime homes; model calls may cost money. Inspect the suite first.
  `ak eval decision <request.json|->` performs an explicit shadow comparison.
  It is classified as mutating because enabled calls send data externally and
  may incur charges, even though it writes no local report. User-scope
  `semantic_decision` consent is required; project config may only restrict it.
  Never enable it from an ambient credential or as part of ordinary routing.
  Check `status`, `fallback_reason`, and provenance; the effective decision
  always remains the supplied legacy decision. See the repository operations
  guide for profile inputs and the privacy boundary.
  `ak eval workflow <request.json|->` validates scenario/fix/debug facts in off
  mode; `--mode shadow` additionally requires explicit `workflow-controller`
  consent and may incur charges. Effective actions and policy authority remain
  unchanged. `ak eval workflow-benchmark <corpus.json|->` replays local labeled
  evidence offline; inspect completion and coverage before interpreting metrics.
  `ak insights contribute preview --month YYYY-MM` freezes an aggregate
  locally. `contribute send --month YYYY-MM --digest <preview-digest>` sends
  that exact payload only with separate sharing consent and an approved HTTPS
  endpoint. Sharing defaults off; never infer remote grading consent.
- **Runtime orchestration** — inspect installed `ak orchestrate --help` first.
  `probe` runs bounded version/help checks and writes an owned metadata cache;
  it does not prove authentication or invoke inference. `prepare`, `advance`
  and `accept` persist resolved job/attempt and artifact evidence. `events`,
  `output` and `diagnose` inspect recorded evidence; `plan-status` and lifecycle
  `status`/`resume` may persist reclassification. External process supervision
  requires Darwin. Follow `all_settled` and cursor pagination, never infer all
  writers stopped from aggregate failure. Existing scoped user authorization
  remains valid across reconciliation; uncertain attempts must be inspected
  before replacement. Diagnostic bundles exclude private argv/environment.
- **Recovery** — `ak recover`, `ak backups restore`. Always confirm scope
  and preview before invoking; both are mutating and irreversible without
  a prior `ak backups create`.
- **Watch / daemons** — `ak watch start|stop|status|dry-run`,
  `ak content schedule daemon`, `ak codex-agent-runtime serve`,
  `ak api start|stop|status`, `ak config start|stop|status`. Long-running
  processes; `start` classifies as diagnostic, `stop` as mutating (it kills
  the process), `status` and `dry-run` as read-only.
- **Config, auth, and MCP** — `ak config prefs
  resolve|set|unset|validate`, top-level auth commands (`ak login`,
  `ak logout`, `ak whoami`, `ak licenses`), and `ak mcp
  add|link|list|remove|show|verify`. Writes here reach user-scope
  state; verify scope before invoking. Note: auth commands are
  top-level, not under an `ak auth` parent.
- **Selfupdate and migrations** — `ak self-update`, `ak migrate
  prefs|rollback`. Always run `ak versions` and check `ak changelog`
  before invoking; keep the installed skill copies in mind (see
  source-of-truth clause below — the binary can advance without the
  skill copies moving).
- **Background auto-update (opt-in, off by default)** — settings live in the
  top-level `auto_update:` section of the user `config.yaml`, not in `updates:`.
  `ak update --schedule daily|weekly|off` and
  `ak update --project <dir>` / `--no-project <dir>` are `mutating`. They write
  only that section and update nothing right away. `--project` requires a
  project already registered with `ak projects add`. `--schedule off` also
  clears the auto-update state file (session heartbeats and the run lock file
  stay). `ak update --status [--json]` is `read-only`; adding `--ack` marks the
  last result as seen, and `acknowledged_now` is true only for the call that
  marked it. None of these combine with the update flags or a project-dir
  argument. Once scheduled, the first ordinary `ak` command after each
  interval starts a detached update. That update covers the CLI and global
  kits whether or not agent sessions are live, plus each opted-in project
  whose git tree is clean and that has no live agent session. Runtime-home
  overrides such as `CODEX_HOME` apply to it as to an interactive
  `ak update`. `AK_NO_AUTO_UPDATE=1` or a set `CI` skips the trigger, and so
  do `--json` invocations and the lifecycle and interactive commands
  themselves (install, setup, onboarding, backup restore, the desktop app). A
  "kit installs are being modified" busy error may mean a background update
  is running; check `ak update --status`, which also keeps showing a result
  whose session-start notice was missed. A `deferred (spawn_in_job)` result
  means the caller's Windows job object would not let the update run
  detached. Do not enable the
  schedule or opt a project in without an explicit user request. Read
  `ak update --status --json` before diagnosing a background result, and take
  details from `ak update --help`.

## Maintaining this skill

When an `ak` CLI command is added, removed, renamed, reparented, or changes
flags, scope, mutation behavior, or output, consider activating
`ak:skill-creator`. Update this skill when the change affects its operating
guidance, command classifications, examples, or safety rules. Regenerate
`references/command-reference.md` with `make skill-ref`; never hand-edit it.
Run `make skill-ref-check` to fail closed on stale output or unclassified
commands.

## Source-of-truth clause (do not remove)

The generated appendix carries a version stamp. If it lags behind
`ak --version`, treat the appendix as a **starting hint** and re-check
flags with `ak <cmd> --help` before any mutating call. `ak self-update`
advances the binary independently of installed skill content, so version
skew is normal after self-update and before the next `ak update` refresh.

Never rely on the appendix's flag list for a mutating command. The
authoritative surfaces, in order:

1. `ak <cmd> --help` (always current for the running binary)
2. `ak <cmd> --json` output (versioned envelope, parseable)
3. `references/command-reference.md` (starting index, may lag)

## Anti-patterns

- Do **not** combine `--force` with `--fresh` on any lifecycle command.
- Do **not** run installer, refresh, migration, uninstall, or destructive
  smoke tests against real maintainer state. Set a temp home per
  [`docs/operations/implementation-smoke.md`](../../../../docs/operations/implementation-smoke.md).
- Do **not** invent flags not present in `ak <cmd> --help`. The Cobra
  metadata is authoritative; if the flag is not there, it is not shipped.
- Do **not** treat a source-only capability as active in the installed
  binary. Confirm via `ak versions` or `ak doctor`.
- Do **not** infer adapter capability from another adapter. Check
  `docs/conformance/runtime-support-matrix.yaml` and adapter output.
- Do **not** hand-edit the appendix at `references/command-reference.md`;
  regenerate via `make skill-ref`.
- Do **not** report a mutating command's outcome without the resolved
  scope. "Installed the engineer kit" is not enough — say project vs
  global, adapter, and any conflict skipped.

## Reference

- [`references/command-reference.md`](./references/command-reference.md) —
  auto-generated command index with classifications, regenerated by
  `make skill-ref`. Fail-closed drift gate: `make skill-ref-check`.
- Runtime support matrix: `docs/conformance/runtime-support-matrix.yaml`
  (owner of adapter capability truth).
- Temp-home discipline: `docs/operations/implementation-smoke.md`.
- Owner-locked packaging model: repo root `CLAUDE.md` §"Owner-locked kit
  packaging and installation safety".

For deliberate finding-triage experiments, inspect `ak eval triage --help`.
Default off and shadow reports preserve review authority. `ak eval triage-benchmark`
uses frozen local evidence only; inspect safety and coverage before savings.

### UI semantic experiments

`ak eval ui` defaults to off and reads a reviewed text capture. `--mode shadow`
can incur provider charges only with explicit user `ui-regression` consent and a
key; classify this as an external diagnostic experiment. `--output` additionally
creates a new local receipt without overwriting. It never runs the browser,
vision investigation, or changes deterministic test outcomes. `ak eval
ui-benchmark` is offline read-only evaluation of independently labeled records.
Inspect each command's live help and retain unknown measurement fields.

## Test-impact operation

`ak test optimize --base <ref> --json` plans without executing checks. Its command
classification is mutating because `--run` executes trusted repository commands
and `--output` creates a new receipt; explicitly granted semantic modes can send
compact facts externally and incur charges. Default semantic mode is off. Shadow
retains the baseline; advisory only adds checks. `ak test classify-e2e` requires
its own consumer grant, may incur charges, and never edits the class manifest.
`ak test benchmark --semantic-replay` stays offline; frozen synthetic success is
not model-quality evidence or permission for selective skipping.
Inspect the manifest before execution;
external evidence never supplies commands. Missing required policy mappings
block execution. See [test-impact operations](../../../../docs/operations/test-impact.md).
