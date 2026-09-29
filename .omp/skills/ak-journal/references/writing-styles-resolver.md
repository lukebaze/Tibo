# Writing-styles resolver

Journal bodies posted via `--social` should read consistently with a
project's established voice. `resolve-config.cjs` discovers and selects a
writing-style file from the project; the calling agent reads that file's
content and applies its guidance when drafting per-channel bodies (the
resolver only picks *which* file — it never rewrites text itself, per the
layering rule in `references/zernio-integration.md`).

## Source of truth

Project `<project>/assets/writing-styles/*.md`. Each file is a short
markdown doc describing tone, sentence length, emoji policy, formatting
preferences, etc.

## Selection order

1. **Explicit config** — `journal.writing_style` set in `.agentkit/journal.yaml`
   or `.agentkit/config.yaml` / `~/.agentkit/config.yaml` (`journal.writing_style`).
   The value is the filename without `.md`, e.g. `writing_style: casual` selects
   `assets/writing-styles/casual.md`.
2. **Alphabetical first** — when no explicit style is configured and multiple
   files exist in `assets/writing-styles/`, the alphabetically first filename
   (by `localeCompare`) wins.
3. **Built-in fallback** — when the directory doesn't exist or is empty,
   `resolve-config.cjs` returns `writing_style: null`. The calling agent
   should then apply the built-in "professional-technical" voice: concise,
   accurate, first-person plural or first-person singular depending on
   project convention, no marketing language, concrete over vague.

## Example writing-style file

`assets/writing-styles/casual.md`:

```markdown
# Casual

- Short sentences, active voice.
- One idea per paragraph.
- Light emoji use is fine (🚀, ✅) but never more than one per post.
- Avoid corporate jargon ("synergy", "leverage", "unlock").
- End technical posts with a concrete outcome or number, not a vague claim.
```

## How the agent applies it

1. Run `node scripts/resolve-config.cjs --json` and read `writing_style`.
2. If non-null, read `<project>/assets/writing-styles/<writing_style>.md`
   and use its guidance when drafting the per-channel body.
3. If `null`, apply the built-in professional-technical voice described above.
4. Pass the drafted body to `scripts/post-social.cjs` via `--channel-bodies`
   (see `references/zernio-integration.md`).

The resolver and the posting scripts never perform this drafting step
themselves — only the agent (LLM) reads the style guidance and writes the
final text.
