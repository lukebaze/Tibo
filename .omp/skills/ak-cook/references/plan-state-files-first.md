# Plan State: Files-First Model

Shared by every skill that creates, resolves, or mutates a plan (`ak:plan`,
`ak:issue-to-plan`, `ak:cook`, and any other skill referencing this file).
This is the single description of where plan state lives — do not restate a
divergent copy in another skill; link here instead.

## Canonical state = repo files

- `plans/<timestamp>-<slug>/plan.md` plus `phase-NN-*.md` in the repo ARE the
  plan. Hand-editable Markdown, legacy-claudekit style. They are the
  deliverable of planning skills and the only thing implementation skills read
  to know what to build.
- A project with no GitHub remote, no `gh` auth, and no network still has a
  fully working plan — because the files are the plan.

## `ak plan` / `plans.db` = a rebuildable index, not canonical

- The `ak plan` CLI (backed by a local SQLite `plans.db`) is a cache/index
  built FROM the files: fast lookup, search, kanban, cross-repo listing,
  current-plan resolution.
- If the index and the files ever disagree, the files win. `ak plan reindex`
  rebuilds the index from disk when they drift (e.g. after a hand-edit or a
  pull that changed plan files without going through the CLI).
- File-writing commands (`create`, `add-phase`, `check`, `uncheck`, and
  `update --status`) write the Markdown files and re-sync the index in the same
  operation — use them for status changes instead of hand-editing a phases
  table, and the write target is always the files. `status` is read-only;
  `close` and `archive` are index-only lifecycle transitions that never touch
  the files (the files already carry their terminal `status:` from the ship
  commit). Because `close` is index-only, closing an unmerged or abandoned plan
  whose file still reads `in-progress` will reindex as active on another machine
  or after a rebuild — pair such a close with `ak plan update <id> --status
  cancelled` so the terminal state lives in the files.

## Current-plan resolution

- `ak plan use <plan-dir>` sets the current-plan pointer for this worktree so
  downstream tooling (`ak:cook`, dashboards, other agents) can resolve the
  active plan without re-scanning or requiring a GitHub link.
- `ak plan resolve` finds the plan matching the current repo remote + branch
  (worktree path as tiebreaker) when no explicit pointer is set.
- `ak plan show <plan-dir>` reads plan/phase content (frontmatter, checklists,
  body) for a skill to consume — read plan state this way, not from GitHub
  issue comments.

## GitHub issue = optional visibility projection, never canonical

- Publishing is the agent's job, not the CLI's: the agent projects a validated
  plan onto a GitHub issue (create or update) with `gh` / the GitHub API. There
  is no `ak plan publish` command.
- Publishing is never required and never the source of truth. Skip it entirely
  in a repo with no GitHub remote, no `gh` auth, or when the user does not ask
  for it — the plan is still fully usable as files. When the user asks to publish
  but `gh`/GitHub auth is unavailable, skip without failing and report one line
  suggesting how to enable it (e.g. `gh auth login`).
- Publishing never overwrites the body of a pre-existing issue a plan was
  created from (e.g. via `ak:issue-to-plan`); it only adds links, comments, or
  labels.
- If the index and a linked issue ever disagree on status, the local files
  (and the index rebuilt from them) win. The issue is a mirror, not a lock.

### Publish-safety protocol

When an agent does project a plan onto an issue, follow this so the projection is
safe, idempotent, and recoverable. Run `ak plan --help` and each subcommand's
`--help` for exact flags.

1. **Gate every publish, not just the first.** Visibility can flip and new phase
   evidence appears, so on each write confirm the target repo/issue visibility is
   acceptable for the content, then run a secret scan over the *rendered*
   projection text after composing it. Never project raw logs, env values,
   tokens, credentials, or local absolute paths. If the rendered body would
   exceed GitHub's comment limit (65,536 chars), truncate to a repo-relative
   plan-path link — do not split across comments.
2. **Provenance lives in the index, not the files.** Persist the linkage with the
   shipped commands (a hand-written `issue:` front-matter key is inert — the
   parser ignores unknown front matter):
   - `ak plan update --issue <n> --root-comment-id <id>` for the plan's issue and
     root tracking comment;
   - `ak plan phase update --comment-id <id>` for a per-phase tracking comment.
   Persist the ids **immediately** after creating the comment, before any further
   writes; if the persist fails, print the ids in the report for manual recovery.
   A human-readable `Tracking: #<n>` line in the plan *body* is a fine
   non-authoritative breadcrumb.
3. **Adopt before you create (bootstrap).** The index is per-machine and
   rebuildable, so a fresh clone, a teammate's machine, or a lost `plans.db` has
   no recorded ids even when the issue already carries the projection. Embed a
   stable marker in every bot-authored projected comment:
   `<!-- agentkit-plan <plan-dir-basename> hash=<12-hex> branch=<branch> -->`.
   Before creating a new root comment, scan the issue's existing comments for that
   marker; on a unique authored-by-self match, **adopt** it (persist its id via
   step 2) instead of posting a duplicate.
4. **Author-verify before editing.** Only edit a comment the current `gh`
   identity authored (`gh api .../comments/<id> -q .user.login` equals the
   authenticated login). Identities differ across machines and CI (a
   `GITHUB_TOKEN` acts as `github-actions[bot]`), so on a mismatch — or a missing
   or edited marker — **append a new marked comment**; never edit another author's
   comment and never abort the delivery over it.
5. **Rev-echo for idempotency and tamper detection.** The marker carries a short
   content hash of the rendered body. Before rewriting, re-read the comment: if
   the hash matches what you last wrote, skip the write; if the marker or hash is
   missing or altered, a human or another bot touched it — append rather than
   overwrite. Do not build compare-and-swap or "the on-issue revision is newer,
   stop and reconcile" logic: the projection is derived and regenerable, the files
   always win, and GitHub's comment API has no atomic swap. Last-writer-wins among
   your own verified projections is acceptable.
6. **Fail safe on missing or rate-limited issues.** A 404/410 (issue transferred,
   deleted, or locked) → report and stop; never auto-create a replacement issue,
   and never clear recorded ids without user confirmation (a transfer only
   changes the repo-scoped API path, so 404 ≠ deleted). On rate limits or a
   partial write, back off, skip, and report — never retry-loop; create-then-
   record ordering plus the adoption marker keeps a lost write self-healing.

## Delivery finalization (close on ship)

When a plan-backed change ships, finalize the plan so its files stop reading as
active work — the core "stale plan read as false context" mitigation. The file
write and the index close are **two different commands at two different moments**,
because the CLI splits them:

**On ship success, before the ship commit — finalize the FILES:**

1. Resolve the active plan (`ak plan resolve`). A resolve-miss means no active
   plan for this repo + branch — **skip finalization silently**; most ships carry
   no plan. Only an ambiguity error, or a failure partway through the steps
   below, warrants a warning plus the exact plan-dir path.
2. Verify the phase checkboxes reflect reality (`ak plan status` prints the
   progress summary). If the diff proves a phase's boxes done, `ak plan check
   <phase-file>` them. If the work is genuinely partial, `ak plan update <id>
   --status in-progress` and stop — never blind-complete a half-done plan.
3. When the plan is actually complete, `ak plan update <id> --status completed`.
   `--status` is file-owned: it rewrites the `plan.md` front-matter `status:`
   (the canonical state) and updates the index in one operation. Inspect the
   finalized plan diff, then stage only the intended, owned plan files with
   `git add -- <owned-plan-paths>`, preserving unrelated staged and dirty work.
   The ship commit then carries those finalized plan files onto the branch,
   so `status: completed` reaches the target branch in the **same merge** as the
   code it describes — the files can never claim completion for code that did not
   land. Make this a synchronous/foreground step; do not fold it into a
   background writer.

Do **not** run `ak plan close` here. During the review window the correct
intermediate state is `status: completed` (file) + `state: active` (index):
`ak plan resolve` only returns `state='active'` plans, so an early close would
blind cook/vibe during review-fix cycles, and the index close is a one-way
transition with no CLI reopen — a rejected PR must not leave a stuck-closed plan.
`ak plan reindex` preserves `state`.

**After PR creation — record the linkage:** `ak plan update <id> --linked-pr <n>`
(index-only) so the merge flow can match this plan to its PR unambiguously.

**On merge success — close the INDEX and optionally project:**

1. Match the merged PR to its plan via the recorded `--linked-pr` (or plan branch
   == PR head branch). A match-miss means already closed or unrelated — skip
   silently; on ambiguity, skip and report rather than guessing.
2. `ak plan close <id>` — an index-only transition to `state=closed`. The files
   already carry `status: completed` from the ship commit, so this changes index
   visibility only.
3. Optional projection: if the plan records an issue / root-comment id, **append**
   a new marked comment (e.g. "plan completed, PR #N merged" with the
   `<!-- agentkit-plan … -->` marker) — never edit the root comment, so a
   close-time projection cannot clobber anyone. Still apply the publish gates from
   the publish-safety protocol above (visibility check, secret scan of the
   rendered text, 65,536-char truncation).

Degrade honestly: if `ak` is unavailable or any step fails, report the exact
plan-dir path and reason and complete the delivery with a warning — never
hand-edit a status line and never delete plan files.

## Rules for skills consuming this model

1. Resolve the current plan via the current-plan pointer (`ak plan use`) first,
   falling back to `ak plan resolve` — never assume a GitHub issue must exist.
2. Read phase content via `ak plan show` (or the files directly), not via
   issue comments.
3. Mutate status via `ak plan` file-mutating commands so the files and index
   stay in sync; do not hand-edit a phases table or a status cell.
4. Treat `--github` (the agent publishing via `gh` / the GitHub API) as an
   additive, opt-in visibility step that runs after the plan is already valid as
   files — never as a prerequisite for planning or implementation to proceed.
5. Before invoking any subcommand, run `ak plan --help` and the subcommand's
   own `--help`; those live surfaces own exact flags, not this file.
