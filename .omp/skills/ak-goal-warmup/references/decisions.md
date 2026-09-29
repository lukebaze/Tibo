# Goal Warmup v1 decisions

Locked product defaults for implementers and runtime skill text.

| ID | Decision | Default |
|----|----------|---------|
| D1 | Public name | `ak:goal-warmup` (keywords may include prepare; no second skill export) |
| D2 | Contract persistence | Session + handoff packet only |
| D3 | Fast path | Only when user accepts reduced assurance AND no external deps/credentials/deploy/approval signals AND task looks local-only |
| D4 | Preflight | Portable baseline first (`command -v`, env presence, config shape, safe identity). Adapter extensions optional. |
| D5 | Handoff | Reviewable copy/paste Markdown; Codex `/goal` + Claude long-run openers; no provider context injection claim |
| D6 | Kit placement | Engineer kit |
| D7 | Red-team | Warmup-local outcome-preserving mode only; do not change global `ak:plan red-team` |
| D8 | ADR disposition | Decision ledger in `docs/system-architecture.md`; no standalone ADR file |

## Abort rules

- Auto-start of `/goal` or long-run execution
- Silent outcome/scope mutation after contract approval
- Secret values in any artifact
- Mutating/chargeable third-party probes by default
