# Quota Management

Google Stitch free tier quota tracking and conservation strategies.

## Limits

Use current service/account evidence for limits, operation costs and resets. The bundled script’s default 400 is a local configuration assumption, not a verified service entitlement.

## Local Tracking

The bundled tracker reads a local file rather than querying the service. Verify whether the installed SDK/service exposes account usage before choosing an observation route:

**File:** `~/.claudekit/.stitch-quota.json`

```json
{
  "date": "2026-03-23",
  "count": 42,
  "limit": 400
}
```

**Auto-reset:** When `date` != today (UTC), count resets to 0.

**Override limit:** `export STITCH_QUOTA_LIMIT="300"` (if Google increases limits).

## Warning Thresholds

| Remaining | Action |
|-----------|--------|
| > 20% | Normal operation |
| < 20% | `[!] Low quota` warning printed |
| 0 | `[X] Exhausted` — exit code 2, suggest fallback |

## Conservation Tips

1. **Use variants instead of regenerating** — 3 variants = 3 credits vs regenerating 3 times = 3 credits, but variants are more purposeful
2. **Use `screen.edit()` to refine** — Editing costs 1 credit but preserves context
3. **Export early** — Don't regenerate just to see the design again; export HTML/image once
4. **Batch planning** — Plan all designs for the day, generate in one session
5. **Review prompts** — Better prompts = fewer regenerations

## Fallback Workflow

When quota is exhausted:

1. `stitch-quota.ts check` returns exit code 2
2. Skill prints: "Daily quota exhausted. Use ak:ui-ux-pro-max as fallback."
3. Activate `ak:ui-ux-pro-max` with the same design prompt
4. `ui-ux-pro-max` generates text-based design spec (no external API needed)
5. Proceed with implementation using text-based spec

## Drift Warning

Local tracking can drift if user generates designs outside AgentKit (via Stitch web UI or other tools). If you hit `RATE_LIMITED` error despite local tracker showing credits available:

1. Preserve the local observation and report the service rate-limit response.
2. Follow the service retry/reset guidance; unknown usage must not become zero.
3. Reconcile the tracker only with observed usage. Resetting a local file does not reset service quota.
