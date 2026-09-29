# Creator to consumer evaluation

Measure whether a creator improvement yields skills that help independent models
complete work. The author is not the sole judge of its own output.

## Matched briefs

Select representative domains: deterministic data transformation, a tool workflow
with recovery, and judgment work with a rubric. Begin small and expand from real
failures. Each brief states audience, outcome, inputs, tools, constraints and
acceptance. Give both creator versions the same brief and available references.
Include creating a skill and updating one while preserving prior behavior.

Illustrative brief: create a record-normalization skill for analysts. Decimal
amounts become integer cents, ordering is preserved, invalid rows produce indexed
errors, and consumers write JSON. Update it to add refunds while preserving the
original valid/invalid cases. Author sees train examples, not holdout prompts.

## Author stage

1. Freeze creator baseline/candidate, including references and scripts.
2. Run each in fresh context with equal brief, tools and budget. Save generated
   files, effective model/runtime and redacted transcript.
3. Validate output skills. Invalid output is a failure; do not quietly repair one
   version before comparison. If allowing repairs, give both the same allowance
   and retain first-attempt results.
4. Freeze/hash generated skills and record their creator provenance.

## Consumer stage

Use independent fresh consumers for baseline-generated, candidate-generated and
no-skill conditions with identical fixtures and tool permissions. Exercise the
model/runtime combinations actually claimed to be supported. Separate author
context from consumer context; include another model family when available.
Requested model aliases and effective ids are different evidence.

A strong author does not imply a smaller consumer has sufficient guidance. A
portable prompt also does not prove discovery, permissions or path correctness
on another runtime. Check those boundaries. Consumers receive neither author
transcripts nor hidden answers. Tool tasks check actual side effects and recovery.

Grade using `references/evaluation-tools.md` and independent rubrics where needed.
Re-run prior functional cases after updates. Test routing near-misses in the real
catalog separately from forced-skill functional runs.

## Decisions

Retain results per creator, consumer model, runtime, case and repetition. Lead with
success/invariants, then corrections, tokens, latency and tool calls. Do not hide
weak models inside an average. Small samples need raw counts and limitations.
If no-skill already passes, the case shows non-regression, not added value; add a
challenging case reflecting a real missing capability.

Record configuration/case/tool/catalog fingerprints and observed reference loading
alongside usage when the runner supports them. Compare equal effort and cache
conditions first; label a configuration experiment separately from a prose change.
Use the optional observations import in `references/evaluation-tools.md` and retain
unknown fields. Root size reduction is structural evidence, not measured savings.

Unavailable targets are blocked coverage. State exactly what ran and label evidence
as structural, forced execution, discovery or provider behavior. Do not claim general
improvement until consumer evidence supports it. New failure patterns become
regression cases before promotion.
