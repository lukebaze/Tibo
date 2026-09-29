# GitHub Projects & Actions

## GitHub Projects (v2)

Projects v2 is the current model — items, fields, views. The legacy
`gh api /projects` REST endpoints are deprecated; use `gh project` (GraphQL
under the hood). Requires the `project` scope: if commands fail with
authorization errors, report that `gh auth refresh -s project` is needed —
do not silently retry.

### Discover before mutating

```bash
gh project list --owner <org-or-user>
gh project view <number> --owner <owner>
gh project field-list <number> --owner <owner>       # field IDs for edits
gh project item-list <number> --owner <owner> --limit 50 --format json
```

### Common mutations

```bash
# Add an existing issue/PR to a board
gh project item-add <number> --owner <owner> --url <issue-or-pr-url>

# Draft item (idea not yet an issue)
gh project item-create <number> --owner <owner> --title "..." --body "..."

# Move status (single-select field): need project-id, item-id, field-id, option-id
gh project item-edit --project-id <PID> --id <ITEM_ID> \
  --field-id <FIELD_ID> --single-select-option-id <OPT_ID>

gh project item-archive <number> --owner <owner> --id <ITEM_ID>
```

IDs come from the `--format json` outputs above; never guess them. For bulk
board syncs, fetch the item list once, compute the delta, and report the
planned mutations before applying when >10 items change.

## GitHub Actions CI/CD

### Inspect runs

```bash
gh run list --limit 10                          # recent runs, any workflow
gh run list --workflow <file.yml> --branch <b>  # scoped
gh run view <run-id>                            # job summary + conclusions
gh run view <run-id> --log-failed               # only failing steps' logs
gh run watch <run-id> --exit-status             # block until done, exit code = conclusion
```

Diagnosis discipline: fetch `--log-failed` and quote the exact failing lines
as evidence before concluding anything. A failure that also reproduces on the
base branch predates the change — verify with
`gh run list --branch <base> --workflow <wf>` before blaming the PR. To fix a
diagnosed failure in code, activate `ak:fix` with the run URL, job name, and
log excerpt.

### Rerun / dispatch

```bash
gh run rerun <run-id> --failed     # rerun failed jobs, same SHA (preferred)
gh run rerun <run-id>              # full rerun, same SHA
gh workflow run <file.yml> --ref <branch> -f key=value   # workflow_dispatch
gh workflow list                   # includes disabled state
gh workflow enable|disable <file.yml>
```

Rules: `--failed` beats full rerun (cheaper, same head SHA so evidence stays
comparable). A cancelled run is never a pass. After `gh workflow run`, find
the spawned run via `gh run list --workflow <file.yml> --limit 1` and watch
it — dispatching without watching is an unverified claim.

### Workflow file changes

Editing `.github/workflows/*.yml` is a code change: branch + PR, never a
direct push to a protected branch. Validate syntax locally when possible
(`actionlint` if installed). Pin third-party actions to a SHA in
security-sensitive repos. Secrets in workflows: reference by name
(`${{ secrets.NAME }}`); adding the secret itself is an admin operation —
see `admin-operations.md`.

### Failure triage table

| Symptom | Check | Likely cause |
|---------|-------|--------------|
| Run not triggered | `gh workflow list`; `on:` filters | Disabled workflow, path/branch filter |
| `startup_failure` | `gh run view <id>` | Workflow YAML syntax error |
| Job queued forever | runner labels in YAML | No matching runner online |
| Secret empty in run | `gh secret list` at repo + env level | Secret set at wrong scope, or fork PR (secrets withheld) |
| Works locally, fails in CI | runner OS/env in job logs | Env/OS mismatch, missing setup step |
| Fails only on merge to base | compare `gh run list --branch <base>` | Semantic conflict with newer base commits |
