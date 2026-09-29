# Channels config

`.agentkit/journal.yaml` (project-scoped, not committed with secrets — only
account ids, never API keys) declares the social channels `--social`
publishes to.

## Schema

```yaml
channels:
  - id: <string, unique>            # referenced by --channels and posted.json
    platform: <string>              # x | threads | linkedin | facebook | bluesky | mastodon | ...
    account_id: <string>            # zernio account id (see `zernio accounts:list`)
    language: <string, optional>    # per-channel override of journal.language
    build_in_public: <bool, optional>  # tag for ak-ship --social targeting

groups:
  build_in_public: [<channel-id>, ...]  # optional named group, e.g. used by ak-ship --social
```

### Field reference

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Stable identifier, used by `--channels <ids>` and recorded in `posted.json` for retry-skip tracking. |
| `platform` | yes | Determines char limit + thread behavior (`x` and `threads` get auto-split; others post as one call). |
| `account_id` | yes | The zernio-side account id — run `zernio accounts:list --pretty` after `zernio auth:login` to find it. |
| `language` | no | Falls back to `journal.language` (see `references/config-schema.md`) when unset. |
| `build_in_public` | no | Informational tag; `groups.build_in_public` is what `ak-ship --social` actually reads. |

## Character limits by platform

| Platform | Limit | Counting | Auto-thread split |
|----------|-------|----------|--------------------|
| `x` | 280 | URL-weighted (t.co: every URL counts as 23 chars) | yes, up to 6 posts |
| `threads` | 500 | plain `.length` | yes, up to 6 posts |
| `linkedin` | ~3000 (platform-enforced, not checked by this skill) | plain `.length` | no |
| `facebook` | ~63,206 (platform-enforced) | plain `.length` | no |
| `bluesky` | 300 (platform-enforced) | plain `.length` | no |
| `mastodon` | 500 (instance-configurable, not checked by this skill) | plain `.length` | no |

Only `x` and `threads` get auto-split via `scripts/split-thread.cjs` in this
release; other platforms post the body as a single call and rely on the
platform's own truncation/rejection behavior.

## Examples

### X (Twitter)

```yaml
channels:
  - id: x_main
    platform: x
    account_id: acc_x_123456
    build_in_public: true
```

### Threads (Meta)

```yaml
channels:
  - id: threads_main
    platform: threads
    account_id: acc_threads_654321
```

### LinkedIn

```yaml
channels:
  - id: li_company
    platform: linkedin
    account_id: acc_li_789012
    language: English
```

### Facebook

```yaml
channels:
  - id: fb_page
    platform: facebook
    account_id: acc_fb_345678
```

### Bluesky

```yaml
channels:
  - id: bsky_main
    platform: bluesky
    account_id: acc_bsky_901234
```

### Mastodon

```yaml
channels:
  - id: masto_main
    platform: mastodon
    account_id: acc_masto_567890
    language: English
```

See `assets/journal.yaml.example` for a complete multi-channel file, and
`references/config-schema.md` for how `channels` merges with the rest of the
resolved config.
