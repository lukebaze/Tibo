# Test Report Format

Structured QA report template. Write complete sentences; keep it short by selecting content.

## Template

```markdown
# Test Report — {date} — {scope}

## Test Results Overview
- **Total**: X tests
- **Passed**: X | **Failed**: X | **Skipped**: X
- **Duration**: Xs

## Coverage Metrics
| Metric   | Value | Threshold | Status |
|----------|-------|-----------|--------|
| Lines    | X%    | 80%       | PASS/FAIL |
| Branches | X%    | 70%       | PASS/FAIL |
| Functions| X%    | 80%       | PASS/FAIL |

## Failed Tests
### `test/path/file.test.ts` — TestName
- **Error**: Error message
- **Stack**: Relevant stack trace (truncated)
- **Cause**: Brief root cause analysis
- **Fix**: Suggested resolution

## UI Test Results (if applicable)
- **Pages tested**: X
- **Screenshots**: ./screenshots/
- **Console errors**: none | [list]
- **Responsive**: checked at [viewports] | skipped
- **Performance**: LCP Xs, FID Xms, CLS X

## Build Status
- **Build**: PASS/FAIL
- **Warnings**: none | [list]
- **Dependencies**: all resolved | [issues]

## Critical Issues
1. [Blocking issue description + impact]

## Recommendations
1. [Actionable improvement with priority]

## Unresolved Questions
- [Any open questions, if any]
```

## Guidelines

- Include ALL failed tests with error messages — don't summarize away details
- Coverage: highlight specific uncovered files/functions, not just percentages
- Screenshots: embed paths directly in report for easy access
- Recommendations: prioritize by impact (critical > high > medium > low)
- Keep report under 200 lines — split into sections if larger scope needed
- Save report using naming pattern from `## Naming` section injected by hooks

## Impact-selection receipts

For `optimize`, include source/manifest/policy fingerprints, provider provenance,
selected and skipped group reasons, required checks, broadening, observed exit
status, retries, and elapsed time. Report unobserved cost as unknown, never zero.
For comparisons, separate baseline validity and missed known regressions from
wall-time differences. Synthetic corpus savings are not production savings.

Semantic reports keep baseline, effective and hypothetical plans separate. Include
consumer status, profile/threshold revisions, attempted/completed/abstained counts,
source-bound invocation batches and original capture kind. Report integration
success separately from model-quality eligibility. E2E label accuracy/confusion
is separate from regression recall; unknown provider cost/billed minutes stay
null. No live-provider or beta claim follows from synthetic replay success.
