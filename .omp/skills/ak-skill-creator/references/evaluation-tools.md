# Evaluation tooling

`scripts/eval_skill.py` uses standard-library Python. It validates cases, grades
existing artifacts and summarizes records; it never calls providers or executes
commands. Run from this skill's root or use the script's absolute path from any cwd.

## Cases and assertions

```bash
python3 scripts/eval_skill.py validate assets/eval-cases.example.json
python3 scripts/eval_skill.py validate /absolute/target-skill/evals/evals.json
```

Assertions have `id`, `text`, and optional `kind`:

| Kind | Required fields | Evidence |
|---|---|---|
| `file-exists` | `path` | Contained file exists |
| `json-equals` | `path`, `expected` | Parsed artifact matches expected JSON |
| `text-contains` | `path`, `expected` string | Required contract fragment exists |
| `rubric` (default) | `text` | Independent review with cited artifact evidence |

Use exact equality for machine contracts, not wording preferences. Paths are
relative to the output root; escaping paths and symlinks fail. Missing or malformed
artifacts fail. Rubric checks stay ungraded until reviewed. For richer checks,
run the existing domain verifier and retain its command, exit status and output.

## Run and grade

Discover available model runners and current flags from their help. Use a fresh
context with explicit output location. Do not assume provider credentials, model
names, isolation flags or delegation tools. If unavailable, record behavioral
verification as blocked and continue structural work with that limitation stated.

After an actual consumer run:

```bash
python3 scripts/eval_skill.py grade assets/eval-cases.example.json \
  --case-id normalize-valid --outputs /absolute/run/outputs \
  --run-id unique-session-id --variant candidate \
  --model effective-model-id --runtime observed-runtime-version \
  --skill /absolute/skill-snapshot > /absolute/run/record.json
```

No-skill: `--variant without_skill`, omit `--skill`. Other variants require a hash.
Optional observed metrics: `--tokens`, `--duration-ms`, `--tool-calls`, `--corrections`.
Omitted metrics stay null. For execution that did not complete, set `--status blocked`
or `--status failed` and retain the reason/provider error beside the record.

### Import observed configuration and usage

Add `--observations /absolute/run/observations.json` to `grade` to import a
provider-neutral evidence object. This file supplies observations only; it cannot
override run identity, skill hash, status or check verdicts. The parser in
`scripts/eval_contract.py` owns accepted fields and validation.

Illustrative shape (null means unavailable, not zero):

```json
{
  "effective_effort": null,
  "cache_state": null,
  "fingerprints": {
    "configuration": null, "cases": null, "tools": null, "catalog": null
  },
  "usage": {
    "input_tokens": null, "output_tokens": null,
    "cache_read_tokens": null, "cache_write_tokens": null,
    "source": null, "semantics": null
  },
  "cost": {
    "amount": null, "currency": null, "source": null, "pricing_date": null
  },
  "loaded_references": null
}
```

Use observed effective effort rather than a requested alias. Fingerprints identify
the actual configuration, frozen cases, available tools and catalog; do not put raw
settings or secrets into records. `loaded_references: []` means the trace showed no
references read; null means reads were not observed. Usage source and semantics
describe how the runner mapped provider fields, including whether input includes
cached tokens. Do not sum fields using an assumed universal billing formula.

Cost records carry currency, evidence source and pricing date (YYYY-MM-DD).
Separate measured billing from an estimate in the source description; do not claim
actual savings from estimated or missing costs. Cache state is cold, warm, disabled
or null for unknown/mixed observations. Cold denotes no cached reads in the observed
span; disabled denotes no cache reads or writes. A session that starts cold and later
hits cache is mixed, not a cold-span record.

The importer neither changes model/effort nor operates provider caches. Use verified
runner controls for any authorized experiment, hold task conditions constant and
retain provider observations. Keep provider-specific caching recipes outside shared
skill instructions. Unknown metrics or unsupported providers remain explicit gaps.

Exit 0 means all checks passed (or valid cases/summary); 1 means failed, blocked or
ungraded; 2 means invalid input/configuration. Save records even on exit 1. Reviewers
may fill rubric verdicts with concrete evidence, preserving the original record
and reviewer identity separately.

```bash
python3 scripts/eval_skill.py summarize /absolute/run-a/record.json \
  /absolute/run-b/record.json > /absolute/comparison.json
```

Groups retain model, runtime, split, variant and hash; duplicate run ids fail.
Compare matching case sets, repetitions and conditions before interpreting deltas.
Summaries describe observations, not automatic promotion. Preserve redacted raw
outputs/traces. Missing metrics or uncovered targets never become zero-cost passes.

Extended groups also separate effort, cache state, fingerprints, usage semantics
and cost provenance. They expose `comparison_context`, `missing_evidence`,
`comparison_ready`, and per-metric observation counts. Incomplete extended records
remain separate runs; complete observations permit grouping, not a causal claim.
`observed_runs` retains reference reads per run, including null versus an observed
empty list. Reads are execution outcomes, so different paths through the same
assigned task/configuration remain visible within a group rather than splitting
matched repetitions. Inspect those outcomes and quality before interpreting means;
`comparison_ready` means the evidence fields are complete, not equal execution paths.
Legacy records still load and keep their previous aggregates, explicitly marked
without sufficient comparison evidence. Compare quality first and do not interpret
their aggregate tokens as a proven cost improvement.

## Optional catalog routing diagnostics

Use [semantic routing evaluation](semantic-routing-evaluation.md) only when explicitly
requested. Its separate script adds streaming probability diagnostics and trace-backed
runtime summaries; the commands above retain their offline behavior.
