# Runtime awareness and budget accounting

## Discover capabilities

Prefer runtime-supplied usage tools/metadata. Inspect the available tool catalog and
runtime help; do not assume that a terminal slash command is an agent-callable tool.
Claude Code commonly exposes /context and /compact, Codex CLI /status and /compact,
and Gemini CLI /stats and /compress. These are user-interface examples, not a promise
for every installed version. Verify support locally before offering or executing them.
If no compaction capability is callable, write a checkpoint and continue safely or
explain the required user action; do not claim a reset occurred.

The engineer usage hooks refresh a cosmetic quota cache for the statusline; their
presence does not prove usage was injected into the conversation. Follow installed
hook/statusline source and runtime observations. Never read credentials to fetch usage.
Core is internal composition input, not an installable user kit.

## Distinct quantities

| Quantity | Unit / source | Purpose |
|---|---|---|
| Context occupancy | Current request tokens / verified window | Capacity and compaction |
| Task consumption | Sum across calls, agents, retries | Overall allocation |
| Cost | Actual invoice or dated pricing estimate | Economic selection |
| Provider quota | Provider-specific rolling limit | Scheduling/pacing |

Cached input still occupies context; cache billing is a different calculation. A
statusline may already include reserved capacity. Record that basis, and do not count
the same buffer again. Report measured, caller-reported, estimated or unknown values.
A chars/4 file estimate is English-oriented, not a tokenizer count for all languages,
code or media, and excludes unobserved system/tools/history. Do not infer session usage
from file totals. Use a native tokenizer/counter when available; never invent precision.

## Analyzer

```bash
python3 scripts/context_analyzer.py analyze messages.json --limit 200000 \
  --used-tokens 120000 --next-step 30000 --output-reserve 8000 --checkpoint-reserve 4000
```

`--used-tokens` is caller-reported telemetry; without it, supplied message content is
estimated. Without `--limit`, utilization and capacity band are unknown. Lexical matches
are diagnostics, not evidence of poisoning. `health_score`, `degradation_risk` and
`poisoning_risk` are null in schema version 2. They cannot drive automatic recovery.

## Two independent budgets

```bash
python3 scripts/context_analyzer.py budget --system 2000 --tools 2000 \
  --docs 4000 --history 12000 --window 100000 --next-step 10000 \
  --output-reserve 4000 --checkpoint-reserve 2000 \
  --task-limit 200000 --task-spent 70000 --agent-budget scan=20000 \
  --verification-reserve 30000
```

Context headroom = window minus disjoint current input categories. The next step fits
only if result estimate + output reserve + checkpoint reserve fit in that headroom.
Do not count tool results separately if already included in history. Verify that the
runtime's window accounting includes the output budget before applying this calculation.

Unallocated task budget = task limit minus cumulative spend across all agents/retries,
minus **unspent** worker allocations, minus verification/integration reserve. When a
worker spends tokens, transfer that amount from its allocation to cumulative spend;
never count the same consumption twice. Checkpointing reduces window occupancy, not
cumulative task spend. A negative remaining budget is reported as overcommitted.

The legacy `--buffer` fraction is a subtotal-based planning estimate. It does not infer
the model window; explicit `--output-reserve` overrides it. Warning/critical thresholds
are null without a window. Supplied limits must be valid; no limit means unknown.
These are planning calculations, not enforced provider limits or hidden reasoning caps.

## Timing

Bands Green <50%, Yellow 50–<70%, Orange 70–<85%, Red ≥85% are fallback policy hints.
Override the timing with observed headroom, the next atomic operation, and model/task
calibration. Provider quota affects pacing but never authorizes cutting user scope,
changing model/effort, or skipping required verification.
