# Multi-agent patterns and total cost

Use independent contexts when a bounded subtask can reduce coordinator load or improve
coverage. A second agent adds startup input, reasoning, communication and integration;
isolation does not automatically reduce total tokens or elapsed time.

## Delegate only with a reason

Prefer one agent for coupled edits, a small lookup, or a task whose inputs already fit.
Delegate independent scans/reviews when they can return concise evidence and the runtime
allows it. Do not spawn merely because a task is parallelizable or a quota is high.
No universal worker count, cost multiplier or default cheaper model is justified.

## Packet

```text
Task: concrete outcome
Read: exact sources/search terms
May modify: exclusive paths, or none
Acceptance: checkable results
Decisions and constraints: preserve verbatim scope flags and user choices
Budget: amount + unit + what it includes; mark advisory or enforced
Stop: criteria met; deterministic blocker; allocation nearly spent
Escalate: new dependency, insufficient evidence, unexpected scope/cost
Report: bounded summary, evidence/revisions, checks, spend if known, remaining gaps
```

Do not pass full history by default. Give enough decisions and interfaces to avoid
re-derivation. Bound recursive delegation and reports. Integration and verification
reserve belongs to the coordinator, not to the last worker that asks for more tokens.

## Accounting

Count every agent and retry in cumulative task spend. Unspent allocations are commitments,
not additional consumed tokens. Reconcile them as work proceeds. Cheaper model routing is
a configuration choice requiring runtime support and user authority; use
[model selection](model-selection.md), not assumptions from a model's name.

Consequence and uncertainty determine report verification. Do not re-run every delegate
step; check important claims against actual changed state and executable evidence.

## Evidence boundary

[Anthropic's 2025 research-system report](https://www.anthropic.com/engineering/multi-agent-research-system)
found approximately 4x token use for agents and 15x for multi-agent systems **relative to
chat interactions** in its data. Its 80% variance observation concerned BrowseComp.
These are historical workload-specific observations, not general multipliers for coding
agents or evidence that model upgrades matter less than budget. Measure the actual pair.
