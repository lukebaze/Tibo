# Config schema

`scripts/resolve-config.cjs` merges three optional YAML sources into one
resolved config object. Run it directly to see what your project resolves to:

```bash
node scripts/resolve-config.cjs --json
```

## Sources (highest → lowest precedence)

| # | Source | Scope | Keys read |
|---|--------|-------|-----------|
| 1 | `<project>/.agentkit/journal.yaml` | project, journal-specific | all `journal.*` keys, at the file's top level (no `journal:` wrapper needed) |
| 2 | `<project>/.agentkit/config.yaml` | project, general config | the `journal:` block |
| 3 | `~/.agentkit/config.yaml` | user, general config | the `journal:` block |
| 4 | built-in defaults | — | — |

Per-channel fields (e.g. a channel's own `language`) live inside each entry
of the `channels` array and are resolved by the calling script
(`scripts/post-social.cjs`), not by `resolve-config.cjs` — they are the
highest-priority layer overall, but they're per-channel, not global.

Project root is discovered by walking up from the current working directory
looking for `.agentkit/` or `.git/`; pass `--project-root <path>` to skip
discovery.

## Resolved shape

```json
{
  "language": "English",
  "channels": [],
  "writing_style": null,
  "ai": {
    "image_model": "google/gemini-2.5-flash-image",
    "video_model": "veo-3"
  },
  "video": { "engine": "auto" },
  "auto": true,
  "projectRoot": "/absolute/path/to/project"
}
```

## Field reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `journal.language` | string | `"English"` | Default body language when a channel doesn't set its own. |
| `journal.channels` | array of channel objects | `[]` | See `references/channels-config.md` for the full channel shape. |
| `journal.writing_style` | string \| null | `null` | Explicit filename (without `.md`) in `<project>/assets/writing-styles/`. Overrides alphabetical discovery — see `references/writing-styles-resolver.md`. |
| `journal.auto` | boolean | `true` | Controls automatic journal creation in cook/ship hooks. Does **not** control posting — `--social` is always explicit. |
| `journal.video.engine` | `"hyperframes" \| "remotion" \| "auto"` | `"auto"` | `"auto"` detects an installed video-generation skill; prefers hyperframes if both are present. |
| `journal.ai.image_model` | string | `"google/gemini-2.5-flash-image"` | Model id passed to the image-generation skill for `--image-ai`. |
| `journal.ai.video_model` | string | `"veo-3"` | Model id passed to the video-generation skill for `--video-ai`. |

## Example: project `.agentkit/journal.yaml`

```yaml
language: English
writing_style: casual
auto: true
channels:
  - id: x_main
    platform: x
    account_id: acc_x_123456
    build_in_public: true
  - id: threads_main
    platform: threads
    account_id: acc_threads_654321
    language: Vietnamese
groups:
  build_in_public: [x_main, threads_main]
```

## Example: user `~/.agentkit/config.yaml`

```yaml
journal:
  language: English
  ai:
    image_model: google/gemini-2.5-flash-image
    video_model: veo-3
  video:
    engine: auto
```

## YAML support

`resolve-config.cjs` ships a hand-rolled minimal YAML parser
(`scripts/mini-yaml-parser.cjs`) — no external dependency. It supports
nested maps, block-style and flow-style (`[{...}, {...}]`) array-of-maps,
quoted/unquoted scalars, booleans, and comments. It intentionally does not
support anchors, multi-document streams, or block scalars (`|`/`>`) — this
skill's config files never need them.
