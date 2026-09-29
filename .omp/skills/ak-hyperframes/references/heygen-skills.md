# HeyGen HyperFrames agent skills

<!-- verified: 2026-09-26, against hyperframes@0.8.77 skills-manifest.json and README -->

HeyGen ships a family of specialized agent skills alongside the
[`hyperframes`](https://github.com/heygen-com/hyperframes) CLI, each covering
one facet of HTML-first video composition. `ak:hyperframes` does not copy or
re-implement any of them — it wraps the CLI itself and points here so the
agent can install the deeper skill set on demand.

For agents and non-interactive runs, install the core set with the CLI's own
`skills` command:

```bash
npx -y hyperframes@0.8.77 skills update
```

This installs the router (`hyperframes`), the `hyperframes-*` domain skills,
and `media-use`. The router then installs each creation workflow on demand
(`hyperframes skills update <workflow>`, e.g. `pr-to-video`). Use
`npx -y hyperframes@0.8.77 skills` for the full published set, and
`hyperframes skills check` to report whether installed skills are current.
Skills land in the shared `~/.agents/skills/` store and are mirrored to the
detected coding agents. The interactive picker
`npx skills add heygen-com/hyperframes` also works but reads the skills.sh
registry, which can lag upstream `main`.

As of `0.8.77` upstream publishes 21 skills:

| Group | Skills |
| --- | --- |
| Core | `hyperframes`, `hyperframes-animation`, `hyperframes-audio`, `hyperframes-cli`, `hyperframes-core`, `hyperframes-creative`, `hyperframes-keyframes`, `hyperframes-registry`, `hyperframes-studio`, `media-use` |
| On demand | `embedded-captions`, `faceless-explainer`, `figma`, `general-video`, `motion-graphics`, `music-to-video`, `pr-to-video`, `product-launch-video`, `remotion-to-hyperframes`, `slideshow`, `talking-head-recut` |

This list is upstream's own to change; run `hyperframes skills check --json`
or diff `~/.agents/skills/` before treating names or counts here as current —
update the `<!-- verified: ... -->` marker above when you do.

Once installed, each skill's `SKILL.md` auto-discovers in Claude Code and
other supported agents — consult them directly for composition-level
technique rather than duplicating their content here.
