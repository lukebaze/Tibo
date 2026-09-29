## Advisory supervision (`--advice`)

When `--advice` is present, run this skill under `kongming` supervision.
Load `../../ak-brainstorm/references/advisory-supervision.md` for supervisor
identity, host detection, and model routing (Claude subscription → Fable 5;
Codex → `gpt-6-astra` + low effort; Cursor → `claude-fable-5-high`).

Spawn `kongming` at these checkpoints (**per PR**, not once per run):

- **After the initial review completes** — pass the PR reference, the diff
  summary, the findings list with severities, and the tentative verdict; ask
  for a go/no-go on the verdict, missed findings, and — when `--fix` is set —
  which findings are actually worth fixing versus over-reach.
- **When the `--fix` loop is stuck** — same finding survives 3 attempts,
  `ak:fix` is blocked, or CI keeps reding for the same reason; pass every
  approach already tried, the exact failure, and ask for a new angle or a
  legitimate stop condition.
- **Before posting `--reply`** — pass the final review body (summary, risk
  level, findings, verdict) and ask kongming to sanity-check tone, evidence,
  and severity assignments before the review lands on GitHub. If kongming
  flags a Critical/Important issue with the body, revise before posting; do
  not treat kongming counsel as a veto on the verdict itself.
- **Before triggering `--merge`** — pass the merge-readiness evidence
  (verdict, `reviewDecision`, `mergeable`, CI status, blockers) and ask for a
  risk sanity check before authorizing the merge. Do not weaken the
  merge-readiness gate documented under Merge mode.
- **MANDATORY after the PR is open AND CI is terminal-green** — spawn
  `kongming` to review the whole implementation (diff + PR body + linked
  issue when one exists), then post its assessment plus concrete next steps
  as a comment directly on the PR via the adaptive write helper
  (`_ak_pr_comment "$OWNER" "$REPO" "$NUMBER"`; see GitHub API
  compatibility). Append the same-style traceability footer used by
  `--reply` so the source is obvious. This gate fires once per PR after
  that PR's CI-green
  transition; it does not run per fix-loop iteration. When `--merge` is
  present, the transition happens inside Merge mode step 2. When `--merge`
  is absent, fire this gate at the end of the PR's iteration if
  `_ak_pr_checks` is terminal-green; otherwise skip it and note the reason
  (CI red, pending, or unavailable) in the Final output.

**Empty-counsel fallback**: if `kongming` returns an empty final message,
errors, or is otherwise unreachable, record the failure in chat and continue
with the review/fix/reply/merge flow. Never fail the whole skill on a missing
advisory step.

**Forward-carry in the fix loop**: when `--advice` was originally set, the
`--fix` re-invocation of this skill must carry `--advice` forward alongside
`--reply` and `--merge` so supervision persists across iterations.

`--advice` adds supervision; it never bypasses this skill's approval gates,
tests, code-review blockers, branch protections, or security policy. When the
review verdict is authoritative under Modes/Findings rules, kongming counsel
informs the write-up and the decision; it does not override the verdict.

## Ultra Verifier Mode (`--ultra`)

When `--ultra` is present, run the **initial review of each PR** as a best-of-5
verifier pass. The controller assembles one immutable evidence packet per PR —
the diff, PR body, linked issue, and CI status — plus the review rubric,
dispatches exactly five independent read-only candidate reviews in one parallel
wave, then a single strongest-model verifier validates the findings.

- **Candidate task:** each candidate performs the full review of the same PR
  evidence packet and returns its findings list with severities and cited
  evidence. Candidates never comment, commit, or call `gh` mutations.
- **Finalizer:** the verifier returns the evidence-validated, deduplicated union
  of findings across the five reviews — it never selects one review wholesale,
  because a real defect may appear in only one candidate. It drops findings it
  cannot validate against cited evidence and merges duplicates; ranking orders
  severity and confidence only.
- The fix/reply/merge flow then runs once on that union; re-reviews in the
  fix loop stay single-pass. Multi-PR mode fans per PR, still sequentially
  across PRs.

Full mechanics — anonymization, the five-usable-candidate gate, reject-all, and
the fail-closed runtime rule — are in
`../../ak-brainstorm/references/ultra-verifier-mode.md`. It is a best-of-5
verifier mode inspired by LLM-as-a-Verifier, not the full framework.
