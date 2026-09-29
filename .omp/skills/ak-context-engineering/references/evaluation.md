# Outcome evaluation and benchmark records

Evaluate whether the agent achieves the requested outcome with intact constraints.
A shorter transcript or fewer calls is insufficient evidence. Use executable acceptance
checks first; use attributable human/model judgments for outcomes that require judgment.
Keep judges blind to configuration where feasible, check disagreement and record failures.

## Controlled local comparison

1. Select representative tasks across lookup, bug repair, cross-file changes and long
   continuation work, including the actual languages used. Keep frozen inputs/revisions.
2. Compare no skill, prior skill and updated skill on the same model/effort/harness,
   tools and limits. Add model/effort candidates as separate configurations, not hidden changes.
3. Predeclare binary success criteria and critical constraints. Retain raw transcripts,
   tool outcomes, final artifacts and grading evidence in authorized storage.
4. Use matched task/trial IDs and multiple independent trials when feasible. Record failed,
   timed-out and unknown runs instead of dropping them. Record every retry separately.
5. Report success counts and uncertainty, all four metrics, p50/p95 duration, metric
   coverage and exclusions. Inspect tail failures and whether required checks were skipped.
6. Select only configurations meeting the caller's quality floor; trade cost and speed
   according to the task. Treat small-sample differences as provisional.

No paid run, provider access or automatic model switch is required by this skill. If no
representative traces are available, report implementation/tests separately and make no
claim of savings or cross-model effectiveness. Unit fixtures test accounting, not models.

## Offline reducer input (schema version 1)

`python3 scripts/benchmark_metrics.py runs.json` (or `-` for standard input) accepts:

```json
{
  "schema_version": 1,
  "runs": [{
    "config": {"id":"baseline","model":"<exact model>","effort":"<setting>","harness":"<version>"},
    "metadata": {
      "benchmark":"<name>","benchmark_version":"<version>",
      "source":"<source URL or receipt>","date":"2026-09-08","cohort":"<snapshot ID>",
      "success_definition":"All task acceptance checks pass without user repair",
      "duration_definition":"end-to-end wall-clock seconds including tools",
      "step_definition":"assistant turns, including tool-use turns",
      "limits":"<time, step and token limits>",
      "cost_basis":{"currency":"USD","pricing":"<invoice or dated rate source>",
                    "cache":"<cache inclusion>","tools":"<included/excluded costs>"}
    },
    "rows":[{"task_id":"<task>","trial_id":"1","attempt":1,
             "success":null,"cost":null,"duration_seconds":null,"agent_steps":null}]
  }]
}
```

This shape example deliberately contains unknown observations, not invented measurements.
Text placeholders must be replaced with actual configuration/provenance. Add one run per
configuration. Cost/duration must be finite nonnegative numbers; agent steps nonnegative
integers. Success is boolean or null, not partial-credit/benchmark intelligence score.
Attempts must start at 1, be contiguous per task/trial, and stop after a success. Rows
and configuration IDs cannot duplicate. Unknown required observations use explicit null.

For comparison, add `"comparison":{"success_floor":0.9,"config_ids":["baseline","candidate"]}`.
The 0.9 is an illustrative caller policy, not a universal recommendation. No policy means
no automatic shortlist. At least two selected configurations are needed.

## Outputs and comparison boundaries

- `runs[].summary` reports first-attempt average cost, duration, steps, success rate,
  estimated cost per first success, duration percentiles, coverage and retry accounting.
- A metric is null when required observations are missing, with counts/reasons rather
  than a mean that silently discards missing expensive or failed runs.
- Zero successes yields null cost per first success with an explicit reason.
- `comparison` refuses metadata mismatches. The reducer uses a conservative exact match
  for declared source/date/basis too; normalize only genuinely identical methodologies.
- It intersects selected task/trial cohorts, reports exclusions, and **recomputes** metrics
  on that intersection. Do not use full-cohort averages to compare unmatched task sets.
- Complete first-attempt observations and the caller's observed success floor are needed
  for shortlist membership. Wilson 95% intervals include an independence assumption;
  repeated tasks may be correlated and the floor is not a statistical guarantee.
- Pareto membership uses cost per first success and duration. Steps only order exact ties,
  never replace success or remove a cost/time trade-off. The result does not switch models.

Four metrics are defined in [model selection](model-selection.md). Compression's separate
external grading contract is in [context compression](context-compression.md).

## Public benchmark discipline

Read current methodology and prefer matched, reproducible agent tasks with explicit costs,
time definitions, limits and success checks. Do not mix API estimates with subscription
quota equivalents or decode time with elapsed time. Store dated benchmark snapshots
outside stable skill instructions. Use public results to shortlist and local results to
calibrate; do not substitute an aggregate leaderboard for a role-specific evaluation.

[Anthropic's research-system evaluation](https://www.anthropic.com/engineering/multi-agent-research-system)
reports a BrowseComp-specific relationship between token use and outcomes, not a universal
80/10/5 decomposition or evidence that more tokens always beat a better model.
[Artificial Analysis](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-1)
explains its per-task and cached-input reporting; consult the specific evaluation too.

Use distinct `config.id` values for baseline/prior/updated skill variants. Keep
`model`, `effort`, and `harness` identical when those conditions did not change;
record the exact skill version or revision in the variant ID.
