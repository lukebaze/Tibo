# Evidence-rich PR body contract (#1195)

`ak:ship` must create/update PR bodies with these sections (headings localized
to the effective writing language; English forms shown). Validate with:

```bash
gh pr view "$PR" --json body -q .body | PR_BIN=.claude/hooks/lib/pr-body-contract.cjs
test -f "$PR_BIN" || PR_BIN=kits/core/hooks/lib/pr-body-contract.cjs
node "$PR_BIN"
```

## Required sections

### 1. End-to-end work summary
Workflow from task/issue/plan → implementation → verification → review → ship.
Facts only; do not invent steps that did not run.

### 2. Subagent delegation
Count used. For each: role, task, status, concise result. If none: say so.

### 3. Technical decisions
Material decisions + rationale/evidence. Do not fabricate filler.

### 4. Deviations from plan
Compare to the active plan when one exists. If none/no deviations: state that.

### 5. Completion evidence
Map acceptance criteria to tests, commands, artifacts, review, CI. UI/UX PRs
need relevant screenshots (or an explicit unavailable reason). Non-UI PRs must
not add decorative screenshots.

### 6. Checklist
Completed vs incomplete/skipped with reasons. Never mark unknown work done.

### 7. Human actions required
Decisions, credentials, manual QA, rollout, approvals. If none: `None` (localized).

## Traceability (retain)

Fold prior ship fields into this body without duplicating facts:

- **Linked Issues** (`Closes #N` / `Relates to #N`)
- Pre-landing review outcome (under Completion evidence or Checklist)
- Test results (under Completion evidence / Checklist)
- Diff/changes summary (under Completion evidence)
- **Ship Mode** (mode + target branch)

## `ak:review-pr` validation

- Missing required sections → **Important** findings.
- Unsupported claims / empty evidence where evidence is asserted → **Important**.
- Missing Linked Issues / Ship Mode on ship-authored PRs → **Suggestion**.
- Do not pad sections; prefer honest `None` / `Not run` / `Unavailable`.
