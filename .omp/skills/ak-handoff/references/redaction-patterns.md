# `ak:handoff` Redaction Patterns

Every artifact and every appended `--include-diff` / `--include-status`
block passes through redaction before write. Redaction is a hard gate:
never post-hoc, never optional.

## Categories

Match at least these categories. Replace each hit with a stable, non-raw
marker of the form `[REDACTED:<category>]`. Do not include any part of the
original value, its length, or its hash.

| Category | Pattern class | Marker |
|---|---|---|
| AWS access key ID | `AKIA[0-9A-Z]{16}` | `[REDACTED:aws-key-id]` |
| AWS secret access key | `[A-Za-z0-9/+=]{40}` in `AWS_SECRET_*=…` context | `[REDACTED:aws-key]` |
| Generic API key | `(?i)(api[_-]?key|apikey|access[_-]?token|secret)\s*[:=]\s*\S+` | `[REDACTED:api-key]` |
| Bearer token | `(?i)authorization:\s*bearer\s+\S+` | `[REDACTED:bearer]` |
| JWT | `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | `[REDACTED:jwt]` |
| SSH/PEM private key block | `-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----` | `[REDACTED:private-key-block]` |
| `.env` credential-like line | `^[A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|PASSWD|API|AUTH|SESSION)[A-Z0-9_]*=.+$` | `[REDACTED:env-value]` |
| Database URL with credentials | `(?i)(postgres|postgresql|mysql|mongodb|redis)://[^:@\s]+:[^@\s]+@\S+` | `[REDACTED:db-url]` |
| Private URL with signed token | URL with `?token=`, `?sig=`, `?signature=`, `X-Amz-Signature`, `Goog-Signature`, `sv=…&sig=…` (SAS) query params | `[REDACTED:signed-url]` |
| Internal/staging host | Hosts matching `*.internal`, `*.corp`, `*.staging.<org>`, RFC1918 IPs in URL context, or private CIDR ranges | `[REDACTED:internal-host]` |
| GitHub PAT / OAuth token | `gh[pousr]_[A-Za-z0-9]{36,}`, `github_pat_[A-Za-z0-9_]{22,}` | `[REDACTED:github-token]` |
| Slack token | `xox[abpr]-[A-Za-z0-9-]+` | `[REDACTED:slack-token]` |
| Basic-auth in URL | `https?://[^:/\s]+:[^@\s]+@\S+` | `[REDACTED:basic-auth-url]` |
| Personal/customer data captured incidentally | full-name/email/phone/address matches from workspace probes that were not the user's own repo-committed data | `[REDACTED:pii]` |

Add categories as they appear in real capture; do not remove categories.

## Rules

1. Redact before write. Do not print raw values to logs, console, or
   telemetry as a debugging step.
2. Never store or emit the hash, length, or first/last N characters of a
   redacted value. `[REDACTED:<category>]` is stable and opaque.
3. Multiple hits collapse to per-category markers; the artifact's
   Work performed section reports the **count** (`N redactions applied.`),
   never the values.
4. If the `[task focus]` string itself matches any category, refuse the
   invocation. Do not sanitize it silently; the user has to see the
   refusal.
5. Diff and status blocks (`--include-diff`, `--include-status`) run
   through the same redaction pass. Diffs are the most likely leak vector.
6. When the same value would be redacted in more than one category, apply
   the most specific marker (JWT before generic API key, private-key-block
   before generic secret).

## "Not captured in this session"

When a required section has no trustworthy content — no probe result, no
in-session decision, no verification evidence — write literally:

```markdown
Not captured in this session
```

Do **not** substitute:

- an empty section body,
- a placeholder like `TBD` or `TODO`,
- fabricated content ("appears clean", "presumably all tests passed"),
- inferences from unrelated files.

The successor agent uses `Not captured in this session` as a signal to
gather that evidence itself before acting, and `ak:handoff --dispatch` treats an
empty required section as a validation failure.

## Verification recipe (for the `--advice` reviewer)

The Scenario 4 fixture in [`../SKILL.md`](../SKILL.md) supplies the
canonical redaction test:

- Input contains one `AWS_SECRET_ACCESS_KEY=…` line and one
  `Authorization: Bearer eyJ…` line (both fake).
- Expected artifact contains `[REDACTED:aws-key]` and `[REDACTED:jwt]`.
- Expected artifact contains no substring of either raw value.
- Expected Work performed section ends with `2 redactions applied.` (or a
  higher count if the same raw values also appeared elsewhere).
