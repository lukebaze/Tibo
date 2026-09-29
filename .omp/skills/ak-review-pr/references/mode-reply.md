# Reply mode (`--reply`)

If `$ARGUMENTS` contains `--reply`, post the review back to GitHub as a formal review after the review (review-only) or after the fix loop converges (`--fix`), **per PR**.

## 1. Pre-flight checks

Run these checks. On any failure, **fall back to printing the review locally** and warn the user — never fail the whole skill:

```bash
command -v gh >/dev/null 2>&1 || { echo "gh CLI not installed — printing review locally"; exit 0; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated — printing review locally"; exit 0; }
```

## 2. Build the review body

Construct the full markdown body containing the summary, risk level, findings (by severity), and verdict. Append a single-line footer for traceability:

```
*Posted by the installed review-pr skill at <ISO-8601 UTC timestamp>*
```

Use `date -u +"%Y-%m-%dT%H:%M:%SZ"` for the timestamp.

**Length cap**: GitHub limits comment bodies to ~65,536 chars. If the body exceeds 60,000 chars, truncate the *Findings* section and append `[truncated — N findings omitted; see local output]` so the reviewer knows to consult the full chat output.

## 3. Map verdict to gh flag

When `--advice` is originally set, run the "before posting `--reply`" checkpoint from Advisory supervision now: pass the final review body to `kongming`, apply any Critical/Important body revisions it flags (tone, missed evidence, mis-scoped severities), and only then post the review. Skip the checkpoint silently on the empty-counsel fallback.

Post via `_ak_pr_review` from the sourced helpers — it tries native `gh pr review` first and falls back to `gh api …/reviews` on the GraphQL-not-enabled error:

```bash
_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"
[ -f "$_ak_lib" ] || _ak_lib=kits/engineer/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }
[ -f "$_ak_lib" ] || { echo "gh-api-helpers.sh not found" >&2; exit 1; }
. "$_ak_lib"
read OWNER REPO NUMBER < <(_ak_split_pr "$PR_REF")
# EVENT ∈ {APPROVE, REQUEST_CHANGES, COMMENT} — chosen from the verdict:
printf '%s\n' "$REVIEW_BODY" | _ak_pr_review "$OWNER" "$REPO" "$NUMBER" "$EVENT"
```

Verdict → `EVENT`:

| Verdict         | `EVENT`           |
|-----------------|-------------------|
| Approve         | `APPROVE`         |
| Request changes | `REQUEST_CHANGES` |
| Comment         | `COMMENT`         |

Pipe the body via stdin to avoid shell-quoting issues with backticks and code blocks.

## 4. Self-PR fallback

GitHub blocks approving your own PR under both native and REST paths. If the approve call exits non-zero with a self-review error (HTTP 422, message matching "Can not approve your own pull request"), retry with `EVENT=COMMENT`:

```bash
printf '%s\n' "$REVIEW_BODY" | _ak_pr_review "$OWNER" "$REPO" "$NUMBER" COMMENT
```

The review still lands in the timeline; the verdict text inside the body still reads "Approve". Note the downgrade in the chat output.

## 5. Composition with `--fix`

In `--fix --reply` mode, post **only the final re-review** when the loop converges. Iteration history lives in the commit log; the PR conversation stays clean.

If the loop terminates due to a blocker (non-converging, `ak:fix` blocked, CI unresolvable), still post the final review — but the verdict will reflect remaining findings (likely **Request changes** or **Comment**), and the body should include the blocker so the human reviewer knows where to take over.

## 6. Idempotency

V2 does not dedupe. Re-running `review-pr 123 --reply` posts a fresh review each time. The traceability footer (step 2) is the seed for future dedup work but is not consumed here.
