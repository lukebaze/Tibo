# Optional semantic routing evaluation

Use `scripts/semantic_routing_eval.py` explicitly; normal authoring and
`eval_skill.py` do not call it. Standard-library Python. Live inference delegates
only to `ak eval decision`; this script never reads a credential or implements HTTP.

## Snapshots and cases

Start with an export of the **actual runtime-visible catalog**, including all
competing skills after namespace resolution, precedence and runtime filtering.
The runtime/exporting tool attests completeness: source directory scans, package
inventories and guessed manifests cannot establish it. If the runtime cannot export
its visible catalog, retain an unverified snapshot and report evaluation unavailable.
The evaluator checks the export contract; it cannot independently prove that an
external exporter told the truth. Preserve the export source beside results.

`assets/semantic-routing/catalog-before.json` shows the versioned catalog contract:
runtime name/version/settings, scope, provenance kind/source/complete, canonical
namespaced skill ids, descriptions, optional when_to_use/keywords and trace paths.
Use opaque IDs only inside decision requests; reports retain canonical identities.
`cases.json` shows stable IDs, natural unforced prompts, expected canonical skill or
`none`, positive/indirect/near-miss class and fixed train/holdout split. Expected
labels stay local and never enter the shared decision request. The public fixtures
are protocol examples, not measured skill quality or an independent holdout.

```bash
python3 scripts/semantic_routing_eval.py snapshot --export visible-catalog.json --output catalog.json
```

Each batch contains the complete 2–127-skill catalog plus `none`, and 1–8 cases.
The case file supports 10,000 cases. Every normalized request and exact provider
encoding must fit the Go-owned 16 KiB state/32 KiB request ceilings. No truncation,
competitor removal or partial-catalog selection is permitted. Catalogs that cannot
fit even one case are unavailable. Case batches execute sequentially.

## Offline replay and comparison

```bash
python3 scripts/semantic_routing_eval.py replay --catalog assets/semantic-routing/catalog-before.json --cases assets/semantic-routing/cases.json --responses assets/semantic-routing/replay-before.jsonl --output before.json
python3 scripts/semantic_routing_eval.py replay --catalog assets/semantic-routing/catalog-after.json --cases assets/semantic-routing/cases.json --responses assets/semantic-routing/replay-after.jsonl --output after.json
python3 scripts/semantic_routing_eval.py compare --baseline before.json --candidate after.json --output comparison.json
```

Replay starts no process/network and needs no key. JSONL envelopes bind catalog,
case content/labels and exact request hashes to each batch. Missing/extra/duplicate,
stale or malformed batches produce incomplete results, never true negatives.
Streaming `.records.jsonl` keeps complete probabilities and bounded top competitors;
`.envelopes.jsonl` preserves shared CLI responses for replay. Counts include only
completed cases; missing metrics/costs remain null. Inspect `status`, coverage,
per-skill TP/FP/FN/TN, precision/recall, confusion pairs and probability deltas.

The example intentionally recovers one image positive while adding an adjacent
video false positive. It demonstrates a regression being retained in the report;
it is not a measured improvement. Comparison permits changed metadata hashes but
requires matching cases/splits, holdout identity, canonical roster, runtime/settings,
scope, resolved provider/model, Go profile version, protocol and batch schedule. Mismatch is confounded.

## Explicit live experiment and fixed holdout

Review all metadata/prompts for sensitive material before allowing external egress.
Use the repository semantic-decision operating guide: user-scope master enablement,
provider selection and **explicit** `consumers.skill-routing-eval=true` are required.
Ambient credentials and `--live` alone do not grant provider consent. Supply keys
through your existing secret mechanism, never in fixtures, commands or reports.
Paid calls are possible. Disable the consumer or master preference to stop them.

```bash
python3 scripts/semantic_routing_eval.py schedule --catalog catalog.json --candidate-catalog candidate.json --cases cases.json --output schedule.json --ak /absolute/ak
python3 scripts/semantic_routing_eval.py run --live --catalog catalog.json --cases cases.json --batch-size 1 --output train-before.json --ak /absolute/ak
```

Use the schedule's common batch size for both variants. Scheduling invokes only
`--validate-only`, and `run` validates every batch before its first paid call.
Tune on train findings only. Once selected, freeze the final candidate:

```bash
python3 scripts/semantic_routing_eval.py freeze --catalog candidate.json --cases cases.json --output frozen.json
python3 scripts/semantic_routing_eval.py run --live --catalog candidate.json --cases cases.json --split holdout --freeze frozen.json --batch-size 1 --output holdout.json --ak /absolute/ak
```

Freeze binds the candidate, full case set and holdout identity. This is a reproducible
workflow receipt, not access control: keep holdout content outside rewrite context.
Do not retune on the holdout. Provider outage, incomplete probabilities or ambiguous
model selection stays unavailable/incomplete; no cost or quality benefit is inferred.

## Runtime evidence stays separate

`diagnostic_model_choice` is never activation. Run smaller, fresh unforced sessions
in isolated Claude Code, Codex and Pi homes using each actual visible catalog.
Retain effective runtime/model/settings and native traces. Normalize trace events
from observed reads (`skill_read` + catalog `path`) or invocations (`skill_invoke`
+ canonical `skill_id`), preserving every activation, including adjacent false
positives. Do not create events from model claims, expected labels or diagnostics.

Observed runtime evidence requires `runtime.settings.effective_model` with the
actual resolved consumer model; missing identity remains unknown. Unresolved or
ambiguous skill activation targets also remain unknown, never `none`.

The importer consumes a bounded JSON trace with runtime, case_id, catalog_hash,
prompt_hash, complete boolean and events. Each run record supplies those identity
fields, expected skill, unforced=true, trace_path and SHA-256 trace_digest. Keep the
original native trace and normalization provenance beside this normalized artifact;
the importer checks integrity/identity, not authenticity of an external producer.

```bash
python3 scripts/semantic_routing_eval.py summarize --catalog catalog.json --records runtime-record.json --output runtime-summary.json
```

Summaries retain multiple activations and per-runtime counts. Missing Claude Code,
Codex or Pi observations remain unknown. Incomplete/unreadable/digest-mismatched
traces never become no-activation passes. A semantic report cannot fill these gaps.
