# Zernio integration

`scripts/post-social.cjs` dispatches journal posts through
[`mrgoonie/zernio-cli`](https://github.com/mrgoonie/zernio-cli) (a
user-linked fork of `zernio-dev/zernio-cli`), invoked via `npx` — no global
install required.

## Pinned version

**Current pin:** `github:mrgoonie/zernio-cli#946ee2aa1f7e9c5abf2ccf5d30ae730ce40e621e`

Every emitted `npx ... github:mrgoonie/zernio-cli...` command pins this exact
commit SHA. **Never invoke `github:mrgoonie/zernio-cli` without a `#<sha>`.**
An unpinned `HEAD` reference combined with `ZERNIO_API_KEY` in the
environment is a supply-chain / account-takeover risk: a malicious or
compromised push to the fork's default branch would run with your API key on
your next invocation.

### Bump procedure

1. Review the new commits on `mrgoonie/zernio-cli` (diff against the
   currently pinned SHA) before bumping.
2. Update the `ZERNIO_SHA` constant in `scripts/post-social.cjs`.
3. Update the "Current pin" line above in this file.
4. Re-run `scripts/post-social.test.cjs` and a manual `--dry-run` smoke test.
5. Ship as its own small PR — never bundle a version bump with unrelated changes.

## Install

No install step is required for normal use — `post-social.cjs` invokes the
pinned commit via `npx -y`. For faster local iteration you may install the
pinned fork globally instead (do NOT install the upstream `zernio-cli` from
npm — this skill targets the `mrgoonie` fork at the pinned commit):

```bash
npm install -g github:mrgoonie/zernio-cli#946ee2aa1f7e9c5abf2ccf5d30ae730ce40e621e
```

## Auth

Two options, resolved by zernio-cli itself:

```bash
# Interactive browser login (writes ~/.zernio/config.json)
npx -y github:mrgoonie/zernio-cli#946ee2aa1f7e9c5abf2ccf5d30ae730ce40e621e auth:login

# Headless / CI — API key via env
export ZERNIO_API_KEY="sk_your-api-key"
```

`post-social.cjs` requires `ZERNIO_API_KEY` to be resolvable through the
env cascade (`references/env-cascade.md`) before it will do anything —
including `--dry-run` — and exits 1 with a clear message if it isn't set.

The published zernio-cli binary does **not** auto-load a project `.env`
file. `post-social.cjs` resolves secrets itself via `scripts/env-loader.cjs`
and passes the resolved values into the child process's environment, along
with `ZERNIO_CLI_LOAD_ENV=1` so zernio-cli's own env loading (if any) stays
consistent.

Add `.agentkit/.env` to your project's `.gitignore` — never commit
`ZERNIO_API_KEY`.

## `posts:create` flags used by this skill

| Flag | Used for |
|------|----------|
| `--text <body>` | The post body (already localized/styled by the calling agent — see Layering below). |
| `--accounts <accountId>` | The channel's `account_id` from `.agentkit/journal.yaml`. |
| `--threadJson '["post1","post2",...]'` | Native thread mode for `platform: x` / `platform: threads` when the body needed splitting — see `references/channels-config.md` and `scripts/split-thread.cjs`. |
| `--media <url>` (repeatable) | The public URL(s) returned by `zernio media:upload`, for `--image`/`--image-ai`/`--video`/`--video-ai` — see `references/media-flags.md`. |

Full upstream flag set (for reference; not all used by this skill yet):
`--scheduledAt`, `--quoteTweetId`, `--replyToTweetId`, `--replySettings`,
`--threadFile`, `--platformSpecificData`, `--debug-safe`. See the upstream
README for the authoritative list — flags can change between pins, which is
exactly why every invocation is SHA-pinned.

## `--threadJson` shape

A JSON array of strings, one per post in the thread, already split and
numbered by `scripts/split-thread.cjs`:

```json
["First post of the thread (1/3)", "Second post (2/3)", "Third post (3/3)"]
```

If zernio-cli ever renames or removes `--threadJson`, `post-social.cjs`'s
fallback path is N sequential `posts:create` calls chained with
`--replyToTweetId` (not yet implemented — the pinned SHA above is verified
to support `--threadJson`).

## `media:upload`

`--image` / `--image-ai` / `--video` / `--video-ai` resolve local file(s)
(see `references/media-flags.md`), which are then uploaded once via `zernio
media:upload <file> --json` → the returned public URL is captured and passed
via `--media <url>` (repeatable) on every targeted channel's `posts:create`
call. If a specific channel's `posts:create` rejects the attached media
downstream, that channel falls back to a text-only post automatically
(`MEDIA_UNSUPPORTED` in the summary) — see `references/media-flags.md` for
the full contract, cache-key shape, and platform size-limit table.

## Rate limits and retries

`post-social.cjs` detects a rate-limited response (exit code non-zero plus a
`429` / "rate limit" marker in stdout/stderr), honors a `Retry-After`
duration if present (default 1s, capped at 30s), and retries **once**. If
the retry also fails, the channel is marked `RATE_LIMITED` in the summary
and other channels continue unaffected.

## Layering — no translation in scripts

Per the plan's locked layering decision: `post-social.cjs` never translates
or tone-transforms text. It accepts a body per channel — either from
`--channel-bodies <path-to-json>` (a `{channel_id: body}` map the calling
agent already localized/styled) or a single fallback body applied to every
channel. The agent (LLM) is responsible for producing per-channel bodies
using `references/writing-styles-resolver.md` guidance; the script only
splits (for thread platforms), counts, and dispatches.

## Retry contract

The `--json` summary is the retry contract:

```json
{
  "results": [
    { "channelId": "x_main", "status": "SUCCESS", "url": "https://x.com/...", "argv": [...], "error": null },
    { "channelId": "li_main", "status": "RATE_LIMITED", "url": null, "argv": [...], "error": "..." }
  ],
  "dryRun": false,
  "statePath": "/path/to/plans/reports/journal-media-2026-08-07-my-entry/posted.json"
}
```

Successful posts are recorded in `posted.json` next to the journal
(`plans/reports/journal-media-<journal-file-slug>/posted.json`). A bare
re-run of `post-social.cjs` against the same `--journal-file` automatically
skips (`SKIPPED_ALREADY_POSTED`) any channel already marked `SUCCESS` there —
it will not double-post. To retry only the channels that failed, pass
`--channels <failed-id-1>,<failed-id-2>` explicitly, or simply re-run without
`--channels`: already-succeeded channels are always skipped regardless.
