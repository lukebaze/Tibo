# Review and Merge Workflow

## Step 13: Review, fix, reply, and merge

Run only when `--merge` is present and after Step 12 created or updated a PR,
its body passed validation, and Step 12b completed or explicitly skipped
without a plan. Capture one concrete PR URL or number as `PR_REF`; missing or
ambiguous PR state is a blocker.

Activate the inherited review skill exactly once:

```text
ak:review-pr <PR_REF> --fix --reply --merge
```

When `--advice` was passed, preserve supervision across the handoff:

```text
ak:review-pr <PR_REF> --fix --reply --merge --advice
```

`ak:review-pr` exclusively owns PR review, fix convergence, GitHub reply,
merge-readiness, merge mechanics, and post-merge CI convergence. Do not
reimplement or bypass those gates. `--skip-review` affects only local Step 5;
it never removes `--fix --reply` here.

Interpret the downstream final table fail-closed. Continue to social publishing
or claim a successful merge only when the current PR reports
`Verdict=Approve`, `Merge=merged`, and `CI=green`. For `not-ready`, `blocked`,
red, pending, unavailable, or missing evidence, stop the ship path, report the
exact reason, and do not publish social content or claim completion.
