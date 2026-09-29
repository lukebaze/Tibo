# Admin Operations: Orgs, Repos, Environments, Secrets

Administration mutations are high-blast-radius. Preview target + scope, get
confirmation for the destructive/irreversible ones (see SKILL.md Safety
gates), and report every mutation with its verifying command output.

## Repositories

```bash
gh repo view <owner>/<repo> --json name,visibility,defaultBranchRef,isArchived
gh repo create <owner>/<name> --private --description "..."   # confirm visibility choice
gh repo edit <owner>/<repo> --enable-auto-merge --delete-branch-on-merge
gh repo edit <owner>/<repo> --visibility public   # irreversible exposure — always confirm
```

Never `gh repo delete` or `gh repo archive` without explicit user
confirmation naming the exact repo, even in auto mode.

### Branch protection (via API)

No first-class `gh` subcommand — use `gh api`. Read before write, and echo
the current rules back before replacing them (PUT replaces the whole object):

```bash
gh api repos/<owner>/<repo>/branches/<branch>/protection        # current state
gh api -X PUT repos/<owner>/<repo>/branches/<branch>/protection \
  --input protection.json                                        # full replacement
# Newer model: rulesets
gh api repos/<owner>/<repo>/rulesets
```

Weakening protection (removing required checks/reviews) is a confirm-first
operation and must be reported explicitly, never buried in a summary.

## Organizations

```bash
gh org list
gh api orgs/<org>/members --paginate -q '.[].login'
gh api orgs/<org>/teams --paginate -q '.[].slug'
gh api orgs/<org>/teams/<team>/repos     # team repo grants
```

Membership and permission changes (invite, remove, role change) are
confirm-first. When auditing, produce a table (member → role → teams) with
the API call that produced each row.

## Environments

```bash
gh api repos/<owner>/<repo>/environments
gh api -X PUT repos/<owner>/<repo>/environments/<env> \
  -F "deployment_branch_policy[protected_branches]=true" \
  -F "deployment_branch_policy[custom_branch_policies]=false"
# Required reviewers / wait timers go in the same PUT payload
```

Deleting an environment deletes its secrets and protection rules with it —
confirm-first, and list what will be lost before deleting.

## Secrets & variables

**Never print secret values.** List names and metadata only; set values via
non-echoing paths; report only success/failure.

```bash
gh secret list                                  # repo scope
gh secret list --env <env>                      # environment scope
gh secret list --org <org>                      # org scope
gh secret set NAME < value.txt                  # value via stdin/file, never inline in argv
gh secret set NAME --env <env> < value.txt
gh secret set NAME --org <org> --visibility selected --repos "r1,r2" < value.txt   # scoped org grant
gh secret delete NAME                           # confirm-first
gh variable list / set / delete                 # same shapes, non-sensitive config
```

Rules:
- Value sources: prompt the user to provide via file/stdin, or a secret
  store. Never accept a value pasted into chat and echo it back; never
  `echo "$VALUE" |` in a way that lands the value in logs.
- Scope deliberately: repo < environment < org. Put deploy credentials at
  environment scope so protection rules gate their use.
- Rotation: set the new value, verify the consuming workflow passes
  (`gh run watch`), then delete the old secret if it had a different name.
- Fork PRs do not receive secrets — that is by design, not a bug to fix.

## Labels at scale

Sync a consistent label set across repos (taxonomy in
`issue-workflows.md`):

```bash
gh label list --repo <owner>/<repo> --json name,color,description
gh label clone <source-repo> --repo <target-repo>   # copies missing labels
gh label edit <name> --color <hex> --description "..."
gh label delete <name>    # confirm-first: detaches from all issues
```

Prefer `gh label clone` from a canonical repo over hand-recreating. Renames:
`gh label edit <old> --name <new>` preserves issue associations; delete+create
does not.

## Audit-style tasks

For "review our org/repo settings" requests: read-only pass first, produce a
findings table (setting → current → recommended → risk), and change nothing
until the user picks items. Read-only auditing never needs confirmation.
