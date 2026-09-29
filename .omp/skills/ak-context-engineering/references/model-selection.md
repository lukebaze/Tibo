# Model selection from task outcomes

## Selection order

1. Match task type and required capabilities; retain the user's model/effort choices.
2. Require a task-specific success floor before optimizing cost or speed. The floor is
   a caller policy, never a guessed universal constant or an intelligence-score proxy.
3. Compare cost per successful first attempt and task duration on a matched cohort.
   Prefer candidates not beaten on both dimensions (the Pareto frontier).
4. Use raw cost per task to allocate spend; inspect agent steps for loops and omissions.
   Fewer steps alone does not justify dropping verification. Avoid a weighted score that
   counts raw cost, success-adjusted cost and correlated steps repeatedly.
5. Choose among the candidates according to the task's budget and latency needs. A
   Pareto candidate is not an automatic winner. Recheck consequential work locally.

Selection unit: model + reasoning effort + harness + task cohort. An agent must not
silently switch models/settings or override the user's choice. Public benchmarks provide
an initial shortlist, not a guarantee for a different repository, language or workflow.

## Four core metrics

| Metric | Definition for the offline reducer | Interpretation |
|---|---|---|
| Average cost per task | Total first-attempt cost / first-attempt count | Includes failures |
| Average task duration | Mean first-attempt duration, under the declared time definition | Retain p50/p95 too |
| Estimated cost per successful first attempt | All first-attempt costs / first-attempt successes | Includes money spent on failures |
| Average agent steps | Mean first-attempt steps under a declared step definition | Diagnostic, not correctness |

With complete observations and binary success, cost per first success equals mean cost
per task divided by first-attempt success rate. It is **not** the mean cost only among
successful runs, and **not** a prediction for retry-until-success. Retried attempts are
reported separately; they never turn a first-attempt failure into a first-attempt success.
Zero successes or missing cost means this ratio is undefined, not zero.

Do not divide cost by Elo, an intelligence index or partial-credit score as if it were
a success probability. Missing duration/steps/cost remains null with coverage counts.
API list-price estimates, invoice costs and subscription/quota equivalents are different
bases. Keep cache, tool and infrastructure inclusion explicit.

## Comparable evidence

Record benchmark/version, source/date, task/trial cohort, success definition, model/effort,
harness, time/step definitions, run limits and pricing/cache/tool basis. Require matched
first-attempt task/trial keys. Mixed sources or methodologies may be shown separately,
but do not rank them as interchangeable. Small samples need uncertainty and raw counts.
For observational success floors, inspect the reported Wilson interval before high-risk
selection; the point estimate is not a guarantee.

Duration can mean end-to-end elapsed time or decode time excluding tool/network overhead.
For example, [AA-AnalystAgent](https://artificialanalysis.ai/evaluations/aa-analyst-agent)
labels its published time metric as weighted decode time excluding TTFT and overhead.
Do not merge it with wall-clock measurements. An agent step can mean an LLM turn,
a tool invocation or a batched action; record which one was counted.

[Anthropic's multi-agent study](https://www.anthropic.com/engineering/multi-agent-research-system)
reports BrowseComp-specific observations, not universal model rankings or token multipliers.
[Artificial Analysis's per-task methodology](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-1)
illustrates why pricing per task and cache accounting matter. Read the current methodology
before adapting any public data. Store dated snapshots outside this skill's stable prompt;
refresh on model, price, benchmark or harness changes rather than every tool call.

## Offline records and use

Run `python3 scripts/benchmark_metrics.py runs.json`. It reads records and computes
metrics; it does not call models, estimate missing prices or measure a live task.
The input contract and a minimal example are in [evaluation](evaluation.md).
A controlled local comparison should hold task corpus, harness, tools and limits fixed,
vary the skill/model configuration intentionally, and report quality alongside all costs.
