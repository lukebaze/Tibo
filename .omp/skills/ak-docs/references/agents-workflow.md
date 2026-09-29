# Agents Workflow

Load for `/ak:docs agents`. Mine bounded git and CI history for recurring
failure modes and non-derivable gotchas, and — with `--source` — current
source-code markers, then distill confirmed rules into the **root** agent
context file (`CLAUDE.md`/`AGENTS.md`).

The context file is **behavioral memory**, not a codebase map. Rules take the
form of "DO X" / "DON'T Y" that raise agent success rate, cut trial-and-error,
and cover project best practices and edge cases. Anything an agent can learn
by running `ls`, `grep`, or reading a config file is out of scope — see the
"Anti-patterns" section.

This workflow operationalizes the "add on failure, not up front" principle in
`agent-context-rules.md`. Every rule it produces still passes the keep-or-cut
filter and write/don't-write table in that file; this workflow adds mining and
ranking only, and never invents a second filter.

Before proposing or applying a test-related root-context edit, load and apply
`../../ak-test/references/practical-principles-for-setting-up-and-running-tests.md`. It does
not bypass the evidence, keep-or-cut, placement, or user-confirmation gates.

## Hard constraints

- **Read-only mining.** No git mutation. No CI re-runs. No settings/hook edits
  (recommend-only, per `agent-context-rules.md`).
- **Bounded window.** Default: 90 days OR 300 commits (whichever is smaller),
  200 CI runs. Positional override: `agents 30d`, `agents 500`.
  Never open-ended: old history describes code that no longer exists.
- **Confirm before write.** Nothing lands in the agent context file without
  explicit user approval on the proposed diff. This mining operation keeps its
  own confirmed-change contract; the routine write authority in
  `doc-content-rules.md` belongs to the other documentation operations.
- **`--advice` is implied.** The Kongming review pass is built into step 5.
  A separate `--advice` flag is redundant here.
- **`--dry-run` stops after step 3.** Reports mined signals and watchlist,
  makes no rule proposals, spawns no advisor, writes no file.
- **`--source` is additive.** Layers `ak:scout` source-tree mining onto git/CI
  mining; never replaces them or their gates. Scout runs read-only: no
  generators, no tests. Composes with `--dry-run` and `--audit`.

## 1. Gate and bounds

Run the parent skill's opening gate (bounded). Confirm:

- repository and current branch;
- window (defaults above, or user-supplied positional);
- whether `gh` is authenticated (`gh auth status`); if not, degrade to
  git-only and report "CI signals skipped: gh unauthenticated";
- current root agent context file + any path-scoped rules already in place
  (read them now — dedupe and conflict-check depend on this);
- whether `--source` is set; if so, note vendored, generated, and
  dependency directories to exclude from scout patterns.

## 2. Signal mining

Use `git` for local history, `gh` for CI and PR reviews when available.
Exclude merge commits and mass renames when counting incidents
(`git log -M --no-merges --diff-filter=ACDM`).

### Git

| Signal | Command (illustrative) | Rule class |
|---|---|---|
| Reverts | `git log --since=<w> --grep='^Revert' --oneline` + touched files | Deny-list, definition of done |
| Fix-of-fix chains | `git log --since=<w> -iE --grep='fix (again\|properly\|actually)\|really fix\|follow-?up\|typo in prev'` | Missing verification step |
| Fix-density hotspots | `git log --since=<w> --grep='^fix' --name-only --pretty=format: \| sort \| uniq -c \| sort -rn` | Non-derivable gotcha on file/module |
| CI-repair after merge | commits like `fix ci`, `fix lint`, `fix build` on the integration branch | "Run X before push" (DoD) |
| Co-change coupling | pair-mine `git log --pretty=%h --name-only`: file pairs that change together but were split across two commits (second commit added the missing half) | "When editing X, also update Y" — the highest-value generator |
| Commit velocity / size | — | **Skip.** Almost always yields vibe rules that fail the verifiability test |

### CI (via `gh`, degrade gracefully)

- `gh run list --limit 200 --json workflowName,conclusion,headBranch,event,createdAt,displayTitle`
  → failure-rate and cancelled-rate per workflow.
- Flakiness: runs whose `run_attempt > 1` passed on a later attempt for the
  same head SHA (`gh api repos/{owner}/{repo}/actions/runs?per_page=100`).
- Recurring failure signature: for top failing workflows,
  `gh run view <id> --log-failed`, cluster by job name + first error line.
- Long-running jobs → "full suite is slow, use `<filter>`" candidates.

### Source (`--source`, via `ak:scout`)

Only when `--source` is set. Spawn `ak:scout` **once** with the fixed pattern
query list below, read-only, excluding vendored/generated/dependency dirs
noted in step 1. Do not force Explore delegation; native search is fine.

| Signal | Pattern (illustrative) | Rule class |
|---|---|---|
| Editor-directed imperative in header comments | `-iE 'do not (edit\|modify\|touch\|use)\|generated by\|autogenerated\|source of truth'` | Deny-list / editor guidance |
| Sync invariants across paired files | `-iE 'keep (in sync\|synchronized) with\|mirror(s)? of\|must match'` | "When editing X, also update Y" |
| Generated-artifact mapping to owner script | `-iE '^// Code generated\|// GENERATED FILE\|@generated\|do not edit; regenerate with'` | Owner-script pointer |
| Guarded boundaries (privileged paths, safety walls) | `-iE 'requires elevated\|privileged\|sandbox\|do not run outside\|guarded by'` | Boundary rule |
| Silent-failure preconditions | `-iE 'must (be set\|be initialized)\|precondition\|assumes\|only valid when'` | Non-derivable gotcha |
| Skip / quarantine with reason | `-iE '@skip\|xit\(\|skip\(\|// TODO: re-enable when'` (Tier 2) | Test-coverage gotcha |
| Inverted convention / legacy twin | `-iE 'legacy\|deprecated in favor of\|prefer .* over\|do not use .* use'` (Tier 2) | Convention rule |

Skip from mining: bare `TODO`/`FIXME`/`XXX`/`HACK` markers, redundant
`@deprecated` annotations already surfaced by tooling, `readonly` keyword
occurrences, and loud-crash env-var reads the agent can derive from a config
file.

Cluster raw hits by `(rule class, module/dir)`. Aim for ≤10 clusters → ≤5
distilled proposals; the same ranking cost tie-breaker applies.

### Optional secondary sources

- PR review comments on ~30 recent merged PRs (when `gh` is authenticated) —
  reviewers repeatedly correcting the same class of mistake is the highest-
  quality signal for a rule.
- `plans/journals/` and `plans/reports/` if present — postmortems already
  written.

Do **not** re-run tests, re-request CI runs, or open the sandbox to reproduce.
This is mining, not investigation.

## 3. Signal ranking

Apply all four gates. Missing any one → cut.

1. **Recurrence: ≥3 independent incidents.** Independent = different day *or*
   different author/PR. A fixup chain on the same day counts as **one** incident.
   Two incidents → watchlist (chat-only, no file, no proposal). One → drop.
2. **Preventability.** Would one imperative line read *before* acting have
   prevented the incident? If prevention requires judgment/context depth, this
   is not a root-context rule — route it via placement router in step 4.
3. **Already-enforced test.** Check current live state (lint config, hook,
   branch protection, CI required checks). If the failure mode is now
   deterministically blocked, do not write a rule; report "already enforced by
   `<owner>`".
4. **Recency decay.** If the signal stops after a rule/enforcement landed,
   consider it resolved and skip. Compare the incident's last timestamp to the
   fix's timestamp.

Tie-break by **cost**, not count: protected-branch/release/team-wide CI
failures outrank local churn. Exclude any incident window dominated by a bulk
refactor or repository-wide rename.

**Source-signal gates** (only when `--source` produced candidates): replace
gate 1 with a **corroboration gate** — a source cluster qualifies only when
one of these holds: (a) the marker appears at ≥2 independent sites in the
cluster; (b) a code/test guard already relies on the invariant (import,
assertion, matching test name); or (c) git or CI history in this window
corroborates the same class of failure at least once. Gates 2 (preventability),
3 (already-enforced), and 4 (recency) still apply verbatim — a source hit
already blocked by a linter, hook, or generator regenerate script is out.

**`--dry-run` stops here** and reports raw counts, ranked candidates, and the
watchlist. No distillation, no advisor, no diff.

## 4. Distillation template

Fill for every candidate that survived ranking. Aim ≤5 candidates per run
(if more, keep top-5 by cost).

```text
Signal:     <pattern> — N incidents/anchors: <shas / run-ids / path:line>, window <w>
Cost:       <what broke, time/CI-minutes lost>
Behavior:   <the specific wrong action taken>
Rule:       "<one imperative, verifiable line — exact command/path,
             no history narration>"
Placement:  root context file | path-scoped rule
          | reviewer playbook / standards doc
          | enforcement snippet (recommend-only)
Filter:     findable-itself? N | prevents-costly-action? <action>
          | verifiable? Y | conflicts? <checked-against>
Cut offer:  <existing line this replaces or makes redundant, if any>
Confidence: high | medium | low
```

**Placement router** (a lesson does not automatically belong in the root
context file):

- imperative, always-apply, blocks a specific action → root context file;
- applies only to a path or file type → path-scoped rule
  (see `agent-context-rules.md` "Activation scope");
- absolute rule ("never push X", "never touch Y") → **recommend** a
  settings/hook snippet, do not edit `settings.json` or hook files yourself;
- judgment call or historical scar → reviewer playbook or code standards
  via `update`, not an `agents` output.

**Forbidden in rule text:** SHA, dates, "we once…", plan/finding IDs,
uppercase-as-emphasis, and any wording that narrates history. The rule
describes *future behavior*.

## 5. Kongming review pass — spawn once

Spawn `kongming` a single time with:

- the full candidate set (all templates from step 4);
- the current root agent context file (verbatim) and any path-scoped rules;
- the ranked evidence table from steps 2–3;
- the keep-or-cut filter and write/don't-write table from
  `agent-context-rules.md`;
- the current net line budget for the context file.

Ask Kongming to: cut noise, catch conflicts and duplicates against existing
lines, correct placement mistakes, and propose cut-offers so the net size
stays bounded. A per-signal spawn is wasted cost and yields inconsistent
counsel; the value comes from Kongming seeing the whole file and the whole
candidate set together. Spawn again only when stuck or before an irreversible
change (matches the existing `--advice` semantics in the parent skill).

## 6. Confirmation

Default: **batch diff**. Present the proposed adds, cut-offers, and
migrations as a single diff plus the evidence table. The user approves or
rejects per line in one round. This is the natural extension of
`agent-context-rules.md` audit-procedure step 3.

With `--audit`: interview one question per rule (keep / cut / fix / migrate),
same cadence as the existing `--audit` flag.

**Never write unconfirmed changes.**

## 7. Write and verify

- Apply only the confirmed lines.
- Report the line-count delta. Target net ≤ +10 lines per run; net-negative
  runs (more cut than added) are a healthy sign.
- Re-run the conflict check against the file as written.
- Report: proposed / accepted / rejected / watchlisted / enforcement-recommended
  counts, plus the exact evidence anchors for each accepted rule (stored in
  the commit message body, not the rule text).

## Anti-patterns

- Rule sourced from 1–2 incidents (recency bias, one-off flake).
- Rule that narrates history rather than commanding future behavior.
- Rule duplicating what a linter, formatter, hook, or branch protection
  **currently** enforces (check live state, not memory).
- Derivable rule — anything the agent can learn from `ls`, `grep`, a config
  file, or a CI log (fails filter question 1).
- Vibe rule ("be careful with X", "prefer clean code") — fails verifiability.
- Bloat: adds without cut-offers when the file is already long, or breaching
  the net budget without user approval.
- Absolute rule written as uppercase markdown instead of a recommended
  settings/hook snippet.
- Judgment call forced into an absolute rule in the root context file
  instead of routed to a reviewer playbook.
- Counting churn inside a bulk refactor or rename window without exclusion.
- Any git or CI mutation during mining.
- Persisting the watchlist to a new state file (governance machinery). Users
  who want cross-run trend tracking should route through `ak:journal`.
- `--source` rule from a single anchor without a code/test guard or git-CI
  corroboration (fails the corroboration gate).
- `--source` rule sourced from a vendored, generated, or dependency
  directory not excluded in step 1.
- `--source` rule that only paraphrases a linter, formatter, generator, or
  hook already enforcing the marker.
- Copying a header comment verbatim into the context file instead of
  distilling one imperative line describing future behavior.
- Restating repository structure, module inventory, or command lists mined
  from source — those fail the keep-or-cut filter regardless of anchor count.
- Turning a `TODO`/`FIXME`/`HACK` marker into a rule (transient state, not a
  behavior directive).
- Running `ak:scout` more than once per invocation, or using it to open a
  sandbox / run tests / regenerate artifacts.

## Success signals

- ≤5 rules proposed per run, each with ≥3 incident references — or, for
  `--source` rules, ≥2 anchors backed by a code/test guard or a single
  git-CI corroboration.
- User acceptance rate high enough (>50%) to indicate ranking is calibrated.
- Root context file line-count net change stays inside the budget; some runs
  are net-negative.
- Over 2–3 cycles, the mined signal's own frequency falls in the next
  window — the workflow closes its own feedback loop, measurable by rerunning
  the mining commands.
