# GitHub API compatibility

Some hosted environments (notably Claude Cloud Environment) block the GitHub GraphQL API at the egress proxy. `gh pr view`, `gh pr diff`, `gh pr checks`, and `gh pr list` all issue GraphQL under the hood and error with:

```
HTTP 403: This GraphQL query is not enabled for this session — only the pinned set of PR-review operations is served. Use REST via `gh api repos/{owner}/{repo}/...` instead.
```

A single shell library — `references/gh-api-helpers.sh` — owns the probe and every adaptive command. Source it at the top of every per-PR bash block in this skill with the multi-install-path loader below. The ladder covers project-scoped installs (`.claude/skills/…`), user-scoped installs (`~/.claude/skills/…`), the AgentKit monorepo checkout (`kits/core/skills/…`), and a plugin-delivered install (`${CLAUDE_PLUGIN_ROOT}/skills/…`) — the last rung is a best-effort fallback: it fires when `CLAUDE_PLUGIN_ROOT` reaches the shell either as an exported env var or via literal placeholder substitution in this file's own text, whichever the runtime provides. If none of the four rungs resolve, the block fails fast with an explicit "not found" error instead of sourcing an unchecked path.

```bash
_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"
[ -f "$_ak_lib" ] || _ak_lib=kits/engineer/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }
[ -f "$_ak_lib" ] || { echo "gh-api-helpers.sh not found" >&2; exit 1; }
. "$_ak_lib"
```

Functions the library exports (all safe to call many times per run):

| Function                                | Purpose                                                                                     |
|-----------------------------------------|---------------------------------------------------------------------------------------------|
| `_ak_probe_gh_api`                      | One-shot GraphQL availability probe. Sets `AK_GH_REST=1` when GraphQL is blocked.           |
| `_ak_split_pr <ref>`                    | Splits `123` / `#123` / full PR URL into `OWNER REPO NUMBER`. Uses `git remote`, no API.    |
| `_ak_pr_meta OWNER REPO NUMBER`         | JSON metadata — mirrors `gh pr view --json …`. GraphQL native or REST fallback.             |
| `_ak_pr_diff OWNER REPO NUMBER`         | Unified diff. GraphQL native or REST via `Accept: application/vnd.github.v3.diff`.          |
| `_ak_pr_files OWNER REPO NUMBER`        | Changed file list, one path per line.                                                       |
| `_ak_pr_checks OWNER REPO NUMBER`       | CI check summary — `<name>\t<status>\t<conclusion>\t<url>` per run; `No checks found` else. |
| `_ak_pr_body OWNER REPO NUMBER`         | PR body text — feeds `pr-body-contract.cjs` on stdin.                                       |
| `_ak_pr_review OWNER REPO NUMBER EVENT` | Formal review from stdin. `EVENT` ∈ `APPROVE`, `REQUEST_CHANGES`, `COMMENT`. Native → REST. |
| `_ak_pr_comment OWNER REPO NUMBER`      | Post an issue/PR comment from stdin. Native → REST.                                         |

The probe is silent by design; the library never fails hard on probe failure — it falls back to REST as if GraphQL were blocked. Write helpers (`_ak_pr_review`, `_ak_pr_comment`) skip the native attempt when the probe already reports `AK_GH_REST=1`; when the probe reports GraphQL available they try native `gh pr …` first (the proxy's "pinned set of PR-review operations" allowlist accepts most write ops) and only fall back to REST if the native call fails.

## Merge write op

`gh pr merge` is handled by `ak:git merge-pr`. This PR updates that workflow (`kits/core/skills/ak-git/references/workflow-merge-pr.md`) to source the same `gh-api-helpers.sh` loader for its readiness-gate reads (`gh pr view`, `gh pr checks`, `gh pr list`) and to fall back to `gh api -X PUT repos/{o}/{r}/pulls/{n}/merge -f merge_method=…` when GraphQL is blocked.

Important gap: GitHub's auto-merge enable is **GraphQL-only** (`enablePullRequestAutoMerge`) with no REST endpoint. When `AK_GH_REST=1`, the merge-pr workflow degrades from "merge with `--auto` while checks pending" to "poll checks until terminal-green, then `PUT /pulls/{n}/merge`". That's documented in the merge-pr workflow, not here.

## Self-PR approve

Approving your own PR returns HTTP 422 under both native and REST. The fallback rule in Reply mode step 4 applies to both paths (downgrade to `COMMENT`).
