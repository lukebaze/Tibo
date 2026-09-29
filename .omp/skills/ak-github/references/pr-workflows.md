# PR Workflows

Playbooks for the PR lifecycle with `gh`. Delegate review mechanics to
`ak:review-pr` and commit/push mechanics to `ak:git` — this reference owns
the orchestration and the gh-specific state handling.

## Create a PR

1. Branch state: `git status`, `git log origin/<base>..HEAD --oneline` —
   confirm the commits belong to this PR and nothing unrelated rides along.
2. Push via `ak:git cp` (or `git push -u origin <branch>` when already
   committed).
3. Body: repo template (`.github/pull_request_template.md` or
   `.github/PULL_REQUEST_TEMPLATE/`) wins; otherwise `assets/templates/pr-body.md`.
   Fill with evidence: what changed, why, test output, linked issue
   (`Closes #N`). Prose in resolved language; conventional-commit title in
   English.
4. Create as draft by default when CI has not run yet:

```bash
gh pr create --draft --base <base> --title "feat(scope): ..." --body-file <tmpfile>
gh pr ready <n>          # once CI is green and body is final
```

## Review a PR

Activate `ak:review-pr <ref>` — it owns the full review protocol
(correctness, security, breaking changes, anti-slop), plus `--fix` (fix
loop), `--reply` (post formal review), `--merge` (merge + watch CI).
Do not reimplement review logic here.

For a security-focused pass, additionally activate `ak:security` scoped to
the PR's changed files and attach its findings to the review as evidence.

## Update / rebase a PR branch

Check mergeability first — decide from live state, not assumption:

```bash
gh pr view <n> --json state,mergeable,mergeStateStatus,baseRefName,headRefName
```

- `mergeable: CONFLICTING` → resolve locally: `git fetch origin <base>`,
  then merge the base into the head (or rebase when the repo convention is
  linear history), fix conflicts, run affected tests, push. Never resolve
  conflicts blind on the web UI.
- Behind but clean (`mergeStateStatus: BEHIND`) → `gh pr update-branch <n>`
  (add `--rebase` for linear-history repos). This triggers a fresh CI run;
  in strict-status repos, update only the PR whose turn it is to merge —
  mass-updating parallel PRs burns CI and re-invalidates them in a loop.

## Merge / auto-merge

Merge readiness gate (all must hold; verify, do not assume):

```bash
gh pr view <n> --json state,mergeable,reviewDecision,statusCheckRollup
gh pr checks <n>
```

- state `OPEN`, `mergeable` clean, no `CHANGES_REQUESTED`, required checks
  passing (pending is acceptable only with auto-merge).
- Respect the repo's merge method (`gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed`
  and linear-history protection). Squash is required in squash-only repos.

```bash
gh pr merge <n> --squash --auto     # auto-merge: merges when checks pass
gh pr merge <n> --squash            # immediate, only when checks already green
```

Enable auto-merge when checks are pending instead of polling. After an
immediate merge, watch post-merge CI on the target branch for the merge
commit until every required check concludes (`gh run list --branch <base> --commit <sha>`,
`gh run watch <id>`); a red post-merge run is your follow-up, not someone
else's. Prefer `ak:review-pr <ref> --merge` / `ak:git merge-pr` when
installed — they own the watch-and-fix loop.

Never merge red/stale evidence; never bypass branch protection; a cancelled
check is not a pass — rerun it (`gh run rerun <id> --failed`).

## PR state debugging

| Symptom | Check | Fix |
|---------|-------|-----|
| Merge button blocked | `gh pr view --json mergeStateStatus` | `BLOCKED`=missing review/check; `BEHIND`=update branch; `DIRTY`=conflicts |
| Checks not starting | `gh run list --branch <head>` | Workflow path filters, or `gh workflow enable` |
| Auto-merge silently off | `gh pr view --json autoMergeRequest` | Re-enable after force-push; verify repo allows auto-merge |
| Approval reset after push | repo setting "dismiss stale reviews" | Expected cost; re-request review, never hold a fix to keep approval |
| Draft cannot merge | `gh pr view --json isDraft` | `gh pr ready <n>` |
