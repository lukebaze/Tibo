# Merge mode (`--merge`)

If `$ARGUMENTS` contains `--merge`, run this stage LAST **for each PR** — after the review, after the fix loop converges (`--fix`), and after the review is posted (`--reply`). Complete the merge stage for the current PR before starting the next PR's flow.

When `--advice` is originally set, run the "before triggering `--merge`" checkpoint from Advisory supervision now — pass verdict, `reviewDecision`, `mergeable`, CI status, and any known blockers to `kongming`, treat its output as a risk sanity check, and proceed to the readiness gate below regardless of counsel presence (the gate is authoritative).

## 1. Merge-readiness gate

Merge ONLY when ALL of these hold for the current PR:

- Verdict is **Approve** (no Critical or Important findings; in `--fix` mode the loop converged with no actionable findings).
- The fix loop (if run) did not terminate on a blocker.
- PR is `OPEN` and `mergeable` (no conflicts): fetch via `_ak_pr_meta` and inspect `state`, `mergeable`, `reviewDecision` (native `--json state,mergeable,reviewDecision` fields; REST JSON has `state`, `mergeable`, and a separate `/reviews` call for the decision).
- `reviewDecision` is not `CHANGES_REQUESTED` from another reviewer.
- CI checks are all passing, or only pending (pending is acceptable — the merge step uses auto-merge).

If any condition fails, do NOT merge that PR. Record the PR as not-ready with the exact failed condition in the Final output, and move on to the next PR ref. `--merge` is an authorization to merge a ready PR, never an instruction to force an unready one through.

## 2. Merge and watch CI

Activate `ak:git merge-pr` with the current PR reference:

```
ak:git merge-pr <PR_REF>
```

`ak:git merge-pr` (documented in the `ak:git` skill) owns the mechanics:

- re-checks readiness with the same `gh-api-helpers.sh` loader (adaptive `_ak_pr_meta` / `_ak_pr_checks`), picks the repo's merge method, merges via `gh pr merge`; when GraphQL is blocked (`AK_GH_REST=1`) it polls checks to terminal-green and then falls back to `gh api -X PUT repos/{o}/{r}/pulls/{n}/merge -f merge_method=...` — REST has no auto-merge endpoint, so pending-checks mode degrades to poll-then-PUT
- watches post-merge CI on the target branch until every run for the merge commit concludes
- on deterministic CI failure, drives a follow-up fix (`ak:fix --auto` on a new branch) and repeats, up to 3 attempts
- verifies follow-up: PR state `MERGED`, merge commit on the target branch, all watched runs green
- closes the index row of a plan-backed change (matches the merged PR to its plan via `--linked-pr` or head branch, then `ak plan close`; skips silently when there is no plan) per the shared "Delivery finalization" protocol

Do not bypass its readiness gate or stop conditions. Do not advance to the next PR while the current PR's post-merge CI is still pending — a PR's run is complete only when its target-branch CI is green, an external blocker remains, or the fix attempts are exhausted.

When `--advice` is originally set AND post-merge target-branch CI reaches terminal-green for the current PR, run the MANDATORY post-CI-green checkpoint from Advisory supervision: spawn `kongming` to review the whole implementation, then post its assessment plus concrete next steps as a comment on the PR via `_ak_pr_comment` (native first, REST fallback):

```bash
_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"
[ -f "$_ak_lib" ] || _ak_lib=kits/engineer/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }
[ -f "$_ak_lib" ] || { echo "gh-api-helpers.sh not found" >&2; exit 1; }
. "$_ak_lib"
read OWNER REPO NUMBER < <(_ak_split_pr "$PR_REF")
printf '%s\n' "$KONGMING_BODY" | _ak_pr_comment "$OWNER" "$REPO" "$NUMBER"
```

Append the same-style traceability footer used by `--reply` (`*Posted by the installed review-pr skill at <ISO-8601 UTC timestamp>*`) so the source is obvious. The comment fires once per PR; do not repost per fix-loop iteration. Apply the empty-counsel fallback and honor the writing-language resolution from step 0.

## 3. Failure handling

- If `ak:git merge-pr` refuses (gate failure, branch protection, conflicts): record the blocker for this PR and continue with the next; do not retry with different flags to force the merge.
- If post-merge CI ends red after exhausted fix attempts or an external blocker: record the failing runs, the fixes attempted, and hand off to the user in the Final output.
