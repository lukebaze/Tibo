# Issue Workflows

Playbooks for creating, updating, and closing issues with `gh`. Every claim in
an issue must carry evidence (`file:line`, command output, commit SHA, run
URL). Author prose in the resolved writing language.

## Create an issue

### 1. Ground source-dependent claims

Reuse supplied scout/reproduction evidence for the same revision. Inspect source
only when the issue's claims depend on behavior not already verified; an external
service request or administrative issue does not require a repository-wide scout.
Keep the evidence links and run the dedup/history checks relevant to the issue.

### 2. Dedup + already-resolved check (mandatory)

Never create a duplicate, and never file a bug that is already fixed:

```bash
# Open AND closed issues — closed catches "already resolved"
gh issue list --state all --search "<keywords>" --limit 20 \
  --json number,title,state,closedAt,url
gh search issues "<keywords> repo:<owner>/<repo>" --limit 10
# PRs may have fixed it without an issue
gh pr list --state merged --search "<keywords>" --limit 10 --json number,title,url
```

Then check git history and other branches — a fix may exist unmerged:

```bash
git log --all --oneline --grep "<keywords>" -20
git log --all -S "<code fragment>" --oneline -10   # pickaxe: when the code changed
git branch -r --contains <sha>                      # which branches carry the fix
```

Outcomes:
- **Duplicate open issue** → comment on it with your new evidence instead of
  creating a new one; report the existing URL.
- **Already resolved** (closed issue / merged PR / fix on a branch) → do not
  create; report where it was resolved, and whether the fix has shipped to the
  default branch.
- **Genuinely new** → proceed.

### 3. Labels

Keep the label set consistent. Inspect before use; create missing standard
labels rather than inventing near-duplicates:

```bash
gh label list --limit 100 --json name -q '.[].name' > /tmp/labels.txt
grep -qxF "bug" /tmp/labels.txt \
  || gh label create "bug" --color d73a4a --description "Something isn't working"
```

Guard with an explicit existence check instead of `2>/dev/null || true` —
the latter swallows permission and network errors alongside the intended
"already exists" case.

Standard taxonomy (create on demand, reuse existing spellings when the repo
already has equivalents — never create `enhancement` next to `enhance`):

| Label | Use for |
|-------|---------|
| `bug` | Incorrect behavior with reproduction evidence |
| `feature` | New capability |
| `enhancement` | Improvement to existing behavior |
| `docs` | Documentation only |
| `security` | Vulnerability or hardening (never include exploit secrets) |
| `ci` | Pipeline/workflow issues |
| `refactor` | Internal restructuring, no behavior change |
| `question` | Needs clarification/decision |
| `priority:high/medium/low` | Triage priority |

Apply 1 type label + optional priority. In `--interactive`, confirm new label
creation with the user.

### 4. Structure the body

Use `assets/templates/issue-*.md` (repo's own `.github/ISSUE_TEMPLATE/` wins
when present). Requirements for every issue body:

- **Short summary first** — one paragraph a reader understands immediately.
- **Flow description** — how the behavior works today vs expected, with
  `file:line` anchors.
- **Diagram when flow is non-trivial** — a small Mermaid block
  (`flowchart` or `sequenceDiagram`) beats three paragraphs. Skip diagrams
  for one-step issues.
- **Conditions / constraints** — versions, platforms, config required.
- **Open questions** — explicit list of decisions needed from maintainers.
- **Notes** — pitfalls, related issues/PRs (link them), affected branches.
- Concise. Cut every sentence that adds no decision-relevant information.

### 5. Create

```bash
gh issue create --title "<type>: <concise title>" \
  --body-file <tmpfile> --label bug --label "priority:high" \
  --assignee <user>            # only when the task specifies one
```

Write the body to a temp file (scratchpad) and use `--body-file` to avoid
shell-quoting damage. Report the created URL.

## Update an issue

1. **Fetch current state**: `gh issue view <n> --json title,body,state,labels,comments,assignees`.
2. **Verify actual progress against evidence** — diff the issue's claims
   against live code: run `ak:scout` on the affected paths, check
   `git log --oneline -10 -- <paths>`, and linked PR states
   (`gh pr view <ref> --json state,mergedAt`). Do not trust checkbox state or
   old comments; verify each item.
3. **Update the TODO checklist** in the body: mark verified-done items
   `- [x]` with the proving commit/PR link appended; leave unproven items
   unchecked; add newly discovered work as new items.
4. **Summarize what remains to implement** in a progress comment: done (with
   evidence links), remaining (ordered), blockers/questions.

```bash
gh issue edit <n> --body-file <updated-body>
gh issue comment <n> --body-file <progress-summary>
gh issue edit <n> --add-label "..." --remove-label "..."   # keep labels current
```

## Close an issue

1. **Full review pass**: read the entire issue — body, every checklist item,
   every comment, linked PRs/commits.
2. **Verify each acceptance item** against live state (code, tests, merged
   PRs, deployed runs). Item done = evidence exists; no evidence = not done.
3. Decide:
   - **All items verified done** → close with a completion comment listing
     each item and its evidence link, then:
     ```bash
     gh issue close <n> --reason completed --comment "<summary>"
     ```
   - **Not fully done** → do NOT close. Post a comment with the exact
     remaining task list (ordered, each with what evidence would prove it
     done) and report that list to the user.
   - **Obsolete/won't fix** (only when the task says so) →
     `gh issue close <n> --reason "not planned" --comment "<why>"`.

Always set the close reason explicitly. Closing someone else's issue outside
the task's explicit target requires user confirmation.

## Triage sweep (bulk)

For "triage the backlog" tasks: list open issues oldest-first, apply the
dedup/resolved checks per issue, label consistently, and report a table of
issue → action taken → evidence. Bulk closing still requires per-issue
verification; never close on staleness alone without the task saying so.
