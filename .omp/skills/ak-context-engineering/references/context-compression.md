# Compression and continuation quality

Optimize total cost to finish correctly. Aggressive compression can omit constraints
and force re-fetching; no universal reduction percentage guarantees quality.

## Retain the continuation contract

Merge current intent/constraints, artifacts/revisions, decisions/reasons, verified
checks, open failures and next safe action. Replace superseded content rather than
recreating the note from memory. Keep source pointers for exact error text and contracts.
Never promote a transcript summary to system authority or discard active tool pairs.

Choose a safe task boundary using available headroom and the next operation's expected
size. Use only supported compaction or authorized handoff capabilities. Test whether a
successor can continue from the summary without guessing or repeating discarded work.

## Lexical checks are not semantic evaluation

```bash
python3 scripts/compression_evaluator.py generate-probes original.json > candidates.json
python3 scripts/compression_evaluator.py evaluate original.json summary.txt
```

`original.json` is a list of message objects with string `content`, or an object with
that `messages` list. Generated probes are unreviewed candidates, not verified ground
truth; edit them and add missing constraints before evaluation. Empty candidates are
legitimate. A phrase and its negation may both match lexically.

Schema v2 defaults to `quality_status: ungraded`, `quality_score: null` and null dimension
scores. `lexical_evidence` reports text matches only. `compression_ratio` is a numeric
estimated reduction (negative means expansion; null for empty source), no longer a
formatted percentage. It uses source message text, not JSON wrapper overhead. Character
estimates are not tokenizer counts, especially for multilingual/code/media content.

## Explicit external grading

Use independent model/human grading of a continuation exercise against reviewed probes.
The script validates supplied grading, not the truth of the grader's judgment. Include
response/evidence and judge identity/method so the result can be audited.

A reviewed rubric is a JSON array, for example:

```json
[{"id":"tls","type":"constraint","question":"Which TLS constraint must remain true?",
  "ground_truth":"Keep TLS verification enabled.",
  "context_reference":"Keep TLS verification enabled.","critical":true,"reviewed":true}]
```

`context_reference` must be exact source text. IDs are unique. Types and required scores:

| Type | Scores |
|---|---|
| recall | accuracy, completeness |
| artifact | accuracy, artifact_trail |
| continuation | continuity, context_awareness |
| decision | accuracy, context_awareness |
| constraint | accuracy, instruction_following |

Run `evaluate original.json summary.txt --probes probes.json` and copy `input_binding`
into the grade file. Bindings cover canonical source messages, exact summary UTF-8 text
and the full normalized rubric (SHA-256). Do not reuse grades after any input changes.

```json
{"schema_version":1,"source_sha256":"<source hash>","summary_sha256":"<summary hash>",
 "probes_sha256":"<rubric hash>","judge":{"id":"reviewer/run","method":"continuation rubric"},
 "results":[{"probe_id":"tls","response":"Keep TLS verification enabled.",
 "evidence":"Cite the actual continuation result and source constraint here.",
 "scores":{"accuracy":1,"instruction_following":1}}]}
```

This is an input-shape illustration, not an observed model evaluation. Replace every
placeholder with actual evidence; never manufacture a passing grade.

```bash
python3 scripts/compression_evaluator.py evaluate original.json summary.txt \
  --probes probes.json --grades grades.json
```

Results must cover all reviewed probes exactly once with the correct dimensions and
finite scores in [0,1]. Missing, duplicate, stale or malformed grades fail. Untested
dimensions remain null. The aggregate is the mean of probe means; any critical score
below 1 yields `failed_critical_constraint` with quality_score 0, preserving the ungated
`graded_mean_score`. Complete supplied grading reports `externally_graded`, never a
claim of universal quality. Coverage is relative to the supplied rubric only; reviewers
must ensure it covers original user intent, artifacts, failures and next actions.

## Local comparison

Compare baseline and compressed continuations on the same tasks, tools and settings.
Include omitted constraints, opposite meaning, stale state and unrecoverable evidence.
Use executable acceptance checks first, attributable judgments where necessary, and
[the four task metrics](model-selection.md). Do not call lexical overlap a quality gate.
