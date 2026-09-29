# Session protocol

## Before the next step

Ask what evidence is missing and which bounded action can supply it. Search for the
owner, read enough context to understand the contract, and avoid speculative loading.
A large file may need whole-file analysis; a small file may be irrelevant. Size is a
routing hint, not a substitute for relevance or mandatory repository instructions.

Match effort to stakes, irreversibility and uncertainty. Direct answers need little
bookkeeping. Long work benefits from a compact ledger of decisions, evidence, failed
approaches and open items. Avoid a write call after every read.

## Safe output handling

Prefer structured output and the harness's native output cap when it preserves exit
status. A plain `command | tail` can return tail's success after the producer fails.
In Bash, this pattern saves full evidence and preserves the producer status:

```bash
log=$(mktemp "${TMPDIR:-/tmp}/agentkit-check.XXXXXX")
status=0
command_to_check >"$log" 2>&1 || status=$?
tail -n 40 "$log"
printf 'exit_code=%s full_log=%s (showing last 40 lines)\n' "$status" "$log"
exit "$status"
```

Run this as a bounded child command. If the tail omits the failure, search the retained
log and read the relevant range before deciding. Redact secrets before exposing any
log; avoid sensitive commands when a structured safe query exists. Remove logs you
own after evidence is no longer needed; never remove another session's files.
For pipelines, enable `set -o pipefail` or capture the producer's own status. Other
shells require their native equivalent. Output truncation is not evidence of success.

## Budget and checkpoints

- Use measured occupancy when available. Unknown remains unknown; tool-call count
  merely prompts a check after sustained work and never implies a utilization band.
- Consider the next result, output and checkpoint reserve before starting work.
- Green/Yellow: work normally with selective reads; avoid speculative references.
- Orange or insufficient headroom: checkpoint at an atomic boundary and compact
  through a capability actually available to the agent.
- Red: prioritize safe completion/checkpoint. Do not start broad exploration, but
  preserve necessary checks and user scope. Never silently abandon work.
- Symptoms (lost constraints, repeated reads, persistent wrong beliefs) justify
  checking the note and source even below a threshold; a keyword score does not.

Checkpoint sections: Intent, Files/revisions, Decisions, Verified State, Open Items,
Next Step. Mark OBSERVED, DERIVED and REPORTED where the distinction affects action.
Merge current state, replace stale entries, retain important negative findings and
constraints. Include remaining allocations and running processes when relevant.

After compaction, load the note, refresh changed or consequential state, and continue.
Do not repeat every old check solely because a summary was produced.

## Retry and delegation

Transient errors may use bounded retries with backoff when the operation is safe to
repeat. Deterministic failures require diagnosis and a changed premise. When uncertain
whether a mutation happened, inspect state before retrying to avoid duplicate effects.

A delegate needs scope, inputs, acceptance, decisions, budget unit, stop conditions and
a bounded report. A cheaper scan can help only if it saves more than setup and review.
Delegate reports are evidence claims; validate consequential ones with focused checks,
not by blindly redoing the entire assignment. Shared workspace freshness still matters.

## Self-check

Did each action supply needed evidence? Were full logs available for failures? Did the
producer exit status survive filtering? Are the ledger and budget current? Can a fresh
session resume without guessing constraints, changed files or remaining checks?
