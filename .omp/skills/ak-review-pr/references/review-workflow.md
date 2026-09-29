## Context

Detected PRs and API mode (prelude — heavy metadata loads per-PR inside Instructions):

```
!`_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh; [ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"; [ -f "$_ak_lib" ] || _ak_lib=kits/engineer/skills/ak-review-pr/references/gh-api-helpers.sh; [ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }; [ -f "$_ak_lib" ] && . "$_ak_lib" && _ak_probe_gh_api 2>/dev/null; ARGS_STRIPPED="$(printf '%s' "$ARGUMENTS" | sed -E 's/[[:space:]]*--(fix|reply|merge|advice|ultra)([[:space:]]+|$)/ /g; s/,/ /g; s/^[[:space:]]+//; s/[[:space:]]+$//')"; PR_REFS="$ARGS_STRIPPED"; printf 'PR_REFS: %s\nAK_GH_REST: %s (%s)\nLIB: %s\n' "$PR_REFS" "${AK_GH_REST:-?}" "$( [ "${AK_GH_REST:-0}" = 1 ] && echo 'GraphQL blocked — REST fallback active' || echo 'GraphQL available — native gh pr commands preferred' )" "${_ak_lib:-not-found}"`
```

## Instructions

Perform a thorough code review of **each PR listed in `PR_REFS`**, one at a time. For each `PR_REF`, run steps 0–4 below, then continue into Fix loop / Reply / Merge modes if their flags are set, then move to the next PR ref.

### 0. Resolve writing language and per-PR context

```bash
WL_BIN=.claude/hooks/lib/writing-language.cjs
test -f "$WL_BIN" || WL_BIN=kits/core/hooks/lib/writing-language.cjs
node "$WL_BIN" --json
```

Load `writing-language.md`. Author Summary, Risk level, Findings,
Verdict, blocker/handoff text, and reply prose in that language. Keep severity
labels and GitHub review mechanics (`--approve` / `--request-changes` /
`--comment`) independent of language. If `fallbackReason` is set, note the
fallback in the review body.

Also load `pr-body-contract.md`. One block sources the helper library
once and runs every per-PR read against it, so the GraphQL probe and the split PR
ref resolve a single time:

```bash
_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"
[ -f "$_ak_lib" ] || _ak_lib=kits/engineer/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }
[ -f "$_ak_lib" ] || { echo "gh-api-helpers.sh not found" >&2; exit 1; }
. "$_ak_lib"
read OWNER REPO NUMBER < <(_ak_split_pr "$PR_REF")
PR_BIN=.claude/hooks/lib/pr-body-contract.cjs
test -f "$PR_BIN" || PR_BIN=kits/core/hooks/lib/pr-body-contract.cjs
_ak_pr_body   "$OWNER" "$REPO" "$NUMBER" | node "$PR_BIN"
_ak_pr_meta   "$OWNER" "$REPO" "$NUMBER"
_ak_pr_diff   "$OWNER" "$REPO" "$NUMBER"
_ak_pr_files  "$OWNER" "$REPO" "$NUMBER" | head -50
_ak_pr_checks "$OWNER" "$REPO" "$NUMBER"
```

Missing required evidence sections or unsupported claims in the PR body →
**Important** findings. Do not encourage content padding; prefer honest gaps.

### 1. Understand the PR
- Read the PR title, description, and linked issues
- Understand the intent and scope of the changes
- Compare stated scope vs `additions`/`deletions`/`changedFiles` — a wide gap is itself a signal (see anti-slop reference)

### 2. Analyze the diff
- Read every changed file carefully
- For modified files, read the full file (not just the diff) to understand surrounding context
- Check if the changes align with the stated PR purpose

### 3. Check for issues

Load `review-checklist.md` and work through it: correctness, security,
performance, breaking changes, code quality, and testing. Also apply
`anti-ai-slop.md`.
### 4. Summarize findings

Present your review as:

**Summary**: 1-2 sentence overview of what the PR does.

**Risk level**: Low / Medium / High — based on scope, complexity, and breakage potential.

**Findings**: List issues found, categorized by severity:
- **Critical**: Must fix before merge (bugs, security, data loss)
- **Important**: Should fix (logic issues, missing validation, *structural* AI slop)
- **Suggestion**: Nice to have (style, minor improvements, *micro* AI slop)

> Anti-slop severity rule: **structural** slop (new dumping-ground file, parallel reimpl, abstraction with one caller, schema change without migration, large file growth) → **Important**. **Micro** slop (over-comments, defensive paranoia, one-line wrappers) → **Suggestion**. This keeps `--fix` from churning the diff with cosmetic rewrites the original author won't recognize.

**Verdict**: One of:
- **Approve** — No critical or important issues found
- **Request changes** — Critical or important issues need addressing
- **Comment** — Minor suggestions only, safe to merge as-is
