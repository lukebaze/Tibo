# AntV Infographic — Editorial visual layer

Optional CDN library for polished, template-driven SVG infographic panels (KPI dials, ranked cards, bar/pie/line micro-charts, compare panels). Complements Mermaid (diagram layout) and Chart.js (interactive dashboards); does not replace either.

**License:** MIT · **Pinned version:** `@antv/infographic@0.2.19` · **Deps at runtime:** none (bundled)

The `visual.antv.version` and `visual.antv.integrity` keys are effectively
**user-scope-only** knobs. A committed project-scope override to a version whose
SRI hash was not verified locally will fail-closed at browser load time for
every other collaborator on the repo — set them in `~/.agentkit/config.yaml`,
not in `.agentkit/config.yaml`. The `enabled` toggle remains fully valid at
project scope.

## When to use / not use

Use when a single artifact needs 3–8 branded infographic panels arranged in a static composition (retro tiles, show-off KPI headline, CTI chart mirror). Prefer Mermaid for automatic layout of nodes/edges; prefer Chart.js for interactive dashboards; prefer diagram-design for architecture / concept / semantic patterns.

Do NOT use when the panel is just one number and a label — hand-authored SVG is smaller and reads better.

## Load (CDN + SRI)

The bundle's global is `window.AntVInfographic` (NOT `Infographic`). The distributed file is `infographic.min.js` — the `package.json` `unpkg`/`jsdelivr` fields incorrectly reference `infographic.umd.min.js`, so use the exact URL below.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@antv/infographic@0.2.19/dist/infographic.min.js"
  integrity="sha384-yIMmVGR7iq/lwiw1nxM0HBFtQop+F1gGc+5CyobDbz6P7sp+SJSSblD7rLkCj0Sd"
  crossorigin="anonymous"
  referrerpolicy="no-referrer"></script>
```

Sizes (verified 2026-08-16 against the tarball at `registry.npmjs.org/@antv/infographic/-/infographic-0.2.19.tgz`):

| Metric | Value | Plan target |
|--------|-------|-------------|
| Uncompressed | 874 KB | ≤ 500 KB (**exceeded** — surface in each artifact) |
| Gzipped | 288 KB | ≤ 150 KB (**exceeded**) |

Because the bundle is larger than target, include AntV only when the artifact really uses ≥3 panels; below that threshold, hand-author SVG.

## Standalone smoke — confirmed

Verified in headless Chromium 1194: `window.AntVInfographic` is present after script load; the `Infographic` class constructs; `.render(spec)` succeeds without console/page errors. Node-only paths (`process.env`, `Buffer.from`) exist inside the bundle but are not hit during browser render.

## Minimum render

```html
<div id="panel" style="width:600px;height:400px"></div>
<script>
  // Guards against Node-only globals the bundle references defensively.
  window.process = window.process || { env: {}, browser: true };
</script>
<script src="https://cdn.jsdelivr.net/npm/@antv/infographic@0.2.19/dist/infographic.min.js"
        integrity="sha384-yIMmVGR7iq/lwiw1nxM0HBFtQop+F1gGc+5CyobDbz6P7sp+SJSSblD7rLkCj0Sd"
        crossorigin="anonymous"></script>
<script>
  const { Infographic } = window.AntVInfographic;
  const infographic = new Infographic({
    container: document.getElementById('panel'),
    width: 600,
    height: 400,
    theme: {
      colors: ['#b8232c', '#0f0e0d', '#8a7f74', '#c89a3c', '#4a6b3f'],
      fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
    },
  });
  infographic.render({
    type: 'ChartPie',
    data: [
      { label: 'Owned', value: 42 },
      { label: 'Shared', value: 33 },
      { label: 'External', value: 25 },
    ],
  });
</script>
```

## Common 20 templates (safe LLM whitelist)

Restrict generated code to these named exports on `window.AntVInfographic`. Unfamiliar names risk runtime `undefined` when the LLM improvises.

| Panel intent | Template name | Notes |
|---|---|---|
| KPI dial | `CircularProgress` | Single ring; `min/max/value` fields |
| KPI card | `CompactCard`, `BadgeCard` | Number + label; badge variant for status |
| KPI callout | `CandyCardLite` | Big serif number over caption |
| Ranked list | `CompareBinaryHorizontal` | Two-column bar compare |
| Distribution | `ChartPie` | Prefer over Chart.js when tiled next to other AntV panels for visual consistency |
| Bar / column | `ChartBar`, `ChartColumn` | Horizontal / vertical |
| Trend | `ChartLine` | Line + area fill |
| Composition | `ChartWordCloud` | Terms + weights |
| Comparison | `CompareHierarchyLeftRight` | Two hierarchies mirrored |
| Node / entity | `CircleNode`, `CapsuleItem` | Building blocks for custom compositions |
| Container | `BtnsGroup`, `BadgeCard` | Chrome around panels |
| Interaction | `BrushSelect`, `ClickSelect` | Selection controls (rarely needed in static plans) |

For the full ~200 template list, inspect `Object.keys(window.AntVInfographic)` in a browser once and record which names actually landed in this pin — the upstream API surface is not versioned semver.

## Fallback rules (contract with the skill guide)

1. If `window.AntVInfographic` is `undefined` after 3s load timeout → render a Mermaid equivalent (bar/pie via `pie showData`, timeline via `gantt`) or a plain HTML table. Log `[antv] load-timeout, fell back to <engine>`.
2. If `.render(spec)` throws or the target `<div>` stays empty after 500ms → same fallback, log `[antv] render-error, fell back to <engine>`.
3. Never crash the artifact on AntV failure — the artifact is the deliverable, the panel is optional.

## Font override

AntV defaults to its own sans; override to match the editorial contract:

```javascript
theme: {
  fontFamily: 'Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  serifFamily: '"Instrument Serif", Iowan Old Style, Palatino, Georgia, serif',
}
```

## AgentWiki iframe CSP

AgentWiki's default `Content-Security-Policy` for hosted documents does NOT include `cdn.jsdelivr.net` in `script-src`. Two options when publishing an artifact through the `--wiki` path:

1. **Inline the UMD** — download the pinned file, embed inline in a `<script>` tag (adds 874 KB to the artifact). This is the documented exception for `ak:cti-expert --format html --wiki` where offline-in-incident viewing matters.
2. **Skip AntV in wiki artifacts** — for anything else, drop to Mermaid/Chart.js.

The publish helper should detect the wiki target and switch to inline automatically; skill guides refer to that helper rather than embedding raw fetch code.

## Airgapped / disable path

Users on airgapped machines set `visual.antv.enabled: false` in `~/.agentkit/config.yaml` (or pass `--no-antv` per invocation). All 7 target skills honor that flag and route to Mermaid/Chart.js/hand-authored SVG instead. Explicitly not shipping a vendored blob in v1 — the honest offline story is "diagram-design + Mermaid only" since Mermaid itself is CDN-dependent.

## Known constraints

- Bundle contains `process.env` and `Buffer.from` references (Node-only). They are gated by feature detection but any browser without `window.process` polyfill hits a `ReferenceError` inside the exporter path. Always inject the tiny polyfill shown in "Minimum render" above.
- The `unpkg` and `jsdelivr` fields in `package.json` point to `dist/infographic.umd.min.js` which is not shipped. Always use the exact URL in this file.
- No CommonJS require support in browser — script tag only.
- License notice (MIT) MUST be preserved in inlined-UMD variants; embed as an HTML comment above the `<script>` block.

## References

- Upstream repo: `github.com/antvis/Infographic` (MIT)
- Verified pin: `@antv/infographic@0.2.19`
- Editorial contract in `html-libraries.md` "Editorial visual layer" section
