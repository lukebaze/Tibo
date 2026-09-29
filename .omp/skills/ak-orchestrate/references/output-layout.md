# Output Layout

```text
<run-dir>/
  jobs.yaml             # private resolved input; do not export wholesale
  state.json            # authoritative attempts and acceptance fingerprints
  metrics.jsonl         # per-attempt observed outcomes
  runtimes.json         # current discovery and control evidence
  report.md             # checks, arbiter verdict, integration and questions
  <job-id>/
    result.md           # internal final output when declared as artifact
    artifacts/
<agentkit-home>/orchestrate/runs/<supervisor-run-id>/
  state.json
  graph.json            # private invocation; may contain argv/env
  events.jsonl          # bounded normalized observation journal
  output-<job-id>.log   # bounded redacted merged output
```

Use `diagnose --json` for an observation bundle; never export a private graph
or job spec as a substitute. Internal handles and interventions belong to the
coordinator evidence and must not invent subprocess identity.
