# Context fundamentals

Context includes instructions, tools, retrieved material, history and observations.
Their proportions vary by workload; no fixed share describes all agents.

## Capacity versus consumption

A context window limits one request's active content. Task consumption sums every call,
including repeated/cached input, outputs and provider-reported reasoning where applicable.
Do not double-count reasoning already included in output totals. Billing categories
are provider-specific and may differ from context accounting.

Keep a stable instruction/tool prefix when the harness supports caching; put changing
query data after it. Cache hits can reduce billed cost without shrinking active context.
Load only relevant material, but retain enough surrounding evidence to avoid false edits.

## Progressive disclosure

Metadata routes to a skill; the entry file provides a short operating procedure;
references load only for a current question. Repeated instructions and oversized initial
prompts are costs too. Follow required runtime/project instructions rather than silently
removing them; fix duplication at its owning source when authorized.

## Meaningful compaction

An application-owned harness may replace an older history segment with a summary:

```python
older, recent = split_at_safe_boundary(history)
summary = summarize_as_untrusted_task_state(older)
history = [summary] + recent
```

This is pseudocode for harness authors, not a callable capability in every runtime.
Appending a summary without replacing old history increases context. Never promote
untrusted transcript content into system authority. Preserve higher-priority instructions,
active tool-call/result pairs, decisions, constraints and recoverable evidence pointers.
Compare a continuation task before/after to detect information loss.

## Attention and evidence

Long-context retrieval and instruction-following depend on model, task and placement.
Put concise goals/constraints where easily retrieved and test retention; do not infer
accuracy from a universal U-shaped attention curve or token-position threshold.
See [Anthropic's context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

Use [runtime awareness](runtime-awareness.md) for budgets, [compression](context-compression.md)
for retained state and [evaluation](evaluation.md) for outcome checks.
