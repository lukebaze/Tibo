# Vendored from cathrynlavery/diagram-design

**Pinned commit:** `09df49d8d1a1c7fb2efdfcdc7a2a0713534350a6`
**Upstream:** https://github.com/cathrynlavery/diagram-design
**License:** MIT — see `UPSTREAM-LICENSE`

## Files

| File | Upstream path | Purpose |
|---|---|---|
| `self_check.py` | `skills/diagram-design/scripts/self_check.py` | Overall self-lint on a diagram-design HTML artifact |
| `verify-geometry.py` | [upstream geometry script](https://github.com/cathrynlavery/diagram-design/blob/09df49d8d1a1c7fb2efdfcdc7a2a0713534350a6/scripts/verify-geometry.py) | Enforces the 6 connector rules (right-angle, dot junctions, arrowhead style, etc.) |
| `verify-motion.py` | [upstream motion script](https://github.com/cathrynlavery/diagram-design/blob/09df49d8d1a1c7fb2efdfcdc7a2a0713534350a6/scripts/verify-motion.py) | Verifies motion tier declarations match CSS and honor `prefers-reduced-motion` |
| `run-validators.sh` | AgentKit-authored | Graceful wrapper; skips silently when python3 is absent (v1 advisory-only) |

## Advisory contract (v1)

All three scripts are **advisory-only**. They warn on stderr and never block artifact delivery. Callers use `run-validators.sh` (which exits 0 unconditionally) rather than the raw Python scripts.

## Update procedure

1. Bump the pinned commit above.
2. Re-copy the three scripts from the same paths.
3. Re-copy `UPSTREAM-LICENSE`.
4. Note behavior changes in the release notes.

Do **not** shim, patch, or modify the vendored scripts — that would fragment upstream. Instead, wrap or configure via `run-validators.sh`.
