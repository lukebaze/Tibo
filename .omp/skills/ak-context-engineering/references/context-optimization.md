# Context optimization

Measure cost per completed task, duration, success and agent steps before choosing an
optimization. Token reduction alone is not proof of better economics or task quality.

| Dominant cost | Candidate action | Check |
|---|---|---|
| Verbose tool results | Filter before emission; retain full evidence pointer | Exit status and relevant failures survive |
| Irrelevant retrieved material | Search and read logical ranges | Contract/caller context remains sufficient |
| Replayed old history | Checkpoint and supported compaction | Constraints and continuation survive |
| Repeated stable input | Provider-supported prompt caching | Actual cache billing and unchanged outcomes |
| Independent large investigations | Bounded delegation | Total worker plus coordinator spend |

Prefer the least disruptive effective action. Filtering at the source may avoid the
need for compaction. Summarization costs tokens and can force re-fetching; do not compact
on a timer solely to meet a reduction percentage. Do not assume a fixed compression
ratio or cache hit target is optimal for every model.

Mask obsolete observations only when the harness supports it, after retaining essential
facts and an authorized retrieval pointer. Keep active errors, unresolved contradictions,
current tool-call/result pairs and safety-relevant evidence. Missing detail must be
recoverable; masking is not deletion of the source artifact.

Stable prompts/tool definitions can help prefix caching, but changing timestamps should
remain accurate wherever they are needed. Caching changes cost/latency, not context
capacity. Do not claim access to KV-cache internals absent runtime support.

[Context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
describes compaction, note-taking and isolation as complementary techniques.
Use [evaluation](evaluation.md) to measure their task-specific trade-offs.
