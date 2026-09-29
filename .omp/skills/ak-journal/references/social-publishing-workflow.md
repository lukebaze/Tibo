## Configuration

Channels, language, writing style, and AI model defaults resolve from
`.agentkit/journal.yaml` and `.agentkit/config.yaml` / `~/.agentkit/config.yaml`
via `scripts/resolve-config.cjs`:

```bash
node scripts/resolve-config.cjs --json
```

- Full schema + precedence: `config-schema.md`
- Secret/env resolution cascade: `env-cascade.md`
- Writing-style discovery: `writing-styles-resolver.md`
- Channel shape (X, Threads, LinkedIn, Facebook, Bluesky, Mastodon):
  `channels-config.md`
- Copyable starter config: `assets/journal.yaml.example`

## Social publishing

**Prerequisites:** `ZERNIO_API_KEY` resolvable via the env cascade (or
`zernio auth:login` already run), and a `.agentkit/journal.yaml` with at
least one channel configured (`channels-config.md`).

**Workflow:**

1. Write and persist the journal via `ak journal create` as above.
2. Resolve config + read the discovered writing style (`writing-styles-resolver.md`).
3. Draft a per-channel body for each configured channel — the agent handles
   any localization or tone/style adaptation here; the scripts never do.
4. Write the per-channel bodies to a JSON file (`{channel_id: body}`) and
   invoke the posting script:

```bash
node scripts/post-social.cjs \
  --journal-file <path-to-journal.md> \
  --channel-bodies <path-to-channel-bodies.json> \
  --dry-run --json
```

Inspect the `--dry-run` output first — it prints the exact per-channel
`posts:create` argv (including `--threadJson` for long X/Threads bodies,
auto-split ≤ 6 posts) without contacting zernio. Drop `--dry-run` to publish.

5. A summary table prints to stderr; machine-readable results print to
   stdout with `--json`. Successful channels are recorded so a bare re-run
   never double-posts — see `zernio-integration.md` for the
   retry contract, rate-limit handling, and the pinned zernio-cli commit.

Full reference: `zernio-integration.md`.

## Media

Attach an image and/or video to a `--social` post: `--image <path-or-glob>`
or `--image-ai <prompt>` (AI-generated via multix), and `--video
<path-or-glob>` or `--video-ai <prompt>`. If you want a generated
template/highlight image or video rather than a raw AI prompt, orchestrate
that yourself first — invoke the installed ak-design/ak-frontend-design
skill (image) or the installed ak-hyperframes/ak-remotion skill (video) —
then pass the resulting file through `--image`/`--video`; the router
scripts here are pure path-in/path-out delegators, not generators of their
own templates. Resolved media is uploaded once and attached to every
targeted channel; a channel whose platform rejects the attached media falls
back to a text-only post automatically (`MEDIA_UNSUPPORTED` in the
summary), other channels are unaffected.

Full reference: `media-flags.md`.
