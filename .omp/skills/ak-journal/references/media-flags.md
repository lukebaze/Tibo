# Media flags — `--image` / `--image-ai` / `--video` / `--video-ai`

`ak journal ... --social` can attach one image and/or one video to a post.
Attachment is opt-in: without these flags, `scripts/post-social.cjs` posts
text-only exactly as before.

## Flags

| Flag | Router script | Input |
|------|----------------|-------|
| `--image <path-or-glob>` | `scripts/generate-image.cjs` | User-provided file(s); a plain path or a `dir/*.ext` glob. Multiple `--image` allowed. |
| `--image-ai <prompt>` | `scripts/generate-image.cjs` | AI-generated image via `multix`, model from `journal.ai.image_model`. |
| `--video <path-or-glob>` | `scripts/generate-video.cjs` | User-provided file(s); same glob rules as `--image`. |
| `--video-ai <prompt>` | `scripts/generate-video.cjs` | AI-generated video via `multix`, model from `journal.ai.video_model`. |

**No other input modes.** There is no "generate a template image with no
prompt" branch inside these scripts. If you want an auto-generated OG-style
image or a rendered highlight video, orchestrate it yourself first — invoke
the installed ak-design or ak-frontend-design skill (image) or the installed
ak-hyperframes or ak-remotion skill (video) to produce a file, then pass that
file's path via `--image <path>` / `--video <path>`. Keeping this scripted
router a pure delegator (path-in, path-out) keeps it deterministic and
testable without depending on those skills' internals.

## `--image-ai` / `--video-ai` model resolution

Resolved via `scripts/resolve-config.cjs` (see `references/config-schema.md`):

- `journal.ai.image_model` — default `google/gemini-2.5-flash-image`.
- `journal.ai.video_model` — default `veo-3`.

Both invoke `multix` via `npx -y multix image|video --model <model> --prompt
<prompt> --output <path>` (Windows: `shell: true`, per AMENDMENTS.md G4).

## Video engine selection

`generate-video.cjs` also resolves an `engine` value (`hyperframes` |
`remotion`) — informational, and part of the AI-generation cache key, since
a project switching its default local render engine should invalidate
previously cached AI clips. Precedence:

1. `--engine <name>` CLI flag on `generate-video.cjs`.
2. `journal.video.engine` in project `.agentkit/config.yaml` or
   `.agentkit/journal.yaml`.
3. `journal.video.engine` in user `~/.agentkit/config.yaml`.
4. Auto-detect: probes `~/.claude/skills/ak-hyperframes/SKILL.md` — if
   present, `hyperframes`; otherwise `remotion`.

(2) and (3) are already merged by `resolve-config.cjs`'s own precedence —
`generate-video.cjs` only sees the single resolved `journal.video.engine`
value, plus the CLI override.

## Cache keys (retry-safe, avoids re-generating on every retry)

- Image: sha256 of `journal_body + writing_style + language + model +
  TEMPLATE_VERSION`.
- Video: sha256 of `journal_body + engine + model + TEMPLATE_VERSION +
  duration + resolution`.

`TEMPLATE_VERSION` is a constant at the top of each script — bump it when
the generation prompt/template shape changes to deliberately invalidate all
prior cache entries. Changing only the journal body (holding everything
else constant) always produces a cache miss, since the body is part of the
key.

Cache files live at `plans/reports/journal-media-<journal-file-slug>/` —
the **same directory** `post-social.cjs` uses for its `posted.json`
retry-state file. Housekeeping follows the `plans/` dir's normal lifecycle
(the user cleans it; there is no separate TTL).

## Upload + attach

`post-social.cjs` uploads every resolved local media file once (shared
across all targeted channels — the same image/video is attached to each
channel's post) via `zernio media:upload <path> --json`, extracts the
returned URL, and appends `--media <url>` (repeatable) to each channel's
`posts:create` call.

- **`--dry-run`:** media generation still runs in dry-run mode (skips actual
  AI generation, returns the would-be cached path) but `media:upload` is
  never invoked — the argv preview shows a mocked
  `https://dry-run.mock/media/<filename>` URL so you can see the shape of
  the live call.
- **Upload failure** (network error, rejected format at upload time): a
  warning prints to stderr and that file is dropped from the run — other
  media and all channels still post normally.
- **Downstream rejection** (upload succeeds, but a specific channel's
  `posts:create` rejects the attached media — e.g. a platform enforcing a
  stricter size/format limit than `media:upload` itself checks): that one
  channel retries text-only automatically and is marked `MEDIA_UNSUPPORTED`
  in the summary (counted as a successful post for retry-skip purposes).
  Other channels are unaffected.

## Redaction

Every log/error path that touches a `multix` or `zernio` child-process
output runs through a redaction pass before printing: known secret-value
shapes (`sk-`/`sk_`, `ghp_`/`github_pat_`, `xoxb-`, `AKIA`, JWTs) are
replaced with `[redacted]`, and any sensitive env var's *value* (a key
containing `KEY`/`TOKEN`/`SECRET`/`PASSWORD`) is stripped from any string
before it reaches stdout/stderr. Env values are never echoed.

## Platform size limits (best-effort — not enforced by this skill)

| Platform | Image | Video |
|----------|-------|-------|
| X | ~5MB (JPG/PNG/GIF/WEBP) | ~512MB, up to 2:20 |
| Threads | ~8MB | up to 5 min |
| LinkedIn | ~5MB | ~5GB, up to 10 min |
| Facebook | ~4MB (post attach limits vary) | ~4GB |
| Bluesky | ~1MB per image (max 4 images) | video support platform-dependent |
| Mastodon | instance-configurable (commonly ~8-16MB) | instance-configurable |

These are the platforms' own limits, not something `generate-image.cjs` /
`generate-video.cjs` / `post-social.cjs` check locally — they're listed so
you can size AI-generated media (`--duration`, `--resolution` on
`generate-video.cjs`) sensibly before attaching. If a channel rejects an
oversized file, the "Downstream rejection" fallback above still applies.
