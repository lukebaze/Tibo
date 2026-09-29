# diagram-design — Editorial visual layer

Zero-JS, self-contained HTML+SVG diagrams in an opinionated editorial style. Author templates by hand or via LLM; validate with the pinned Python scripts. Complements Mermaid (auto-layout) and AntV Infographic (KPI panels); does not replace either.

**License:** MIT · **Pinned upstream:** `cathrynlavery/diagram-design@09df49d8d1a1c7fb2efdfcdc7a2a0713534350a6` · **Deps at runtime:** none

## When to use

Use for architecture, semantic patterns, ordered process, timeline, quadrant, radar, layers, medallion, DP integration, DP security matrix — anywhere the layout is intentional and the frame reads as editorial. Prefer Mermaid when node positioning should be automatic; prefer AntV when the panel is data-heavy KPI tiling.

## Type index (22 layout types + 4 primitives)

Load a per-type file lazily only when the skill routes to that type. Each per-type file gives viewBox spec, connector patterns, and one minimal SVG example. Ship-critical types have local copies under `html-diagram-design-types/`; the rest follow upstream at the pinned SHA.

| Type | Local | Upstream reference path |
|---|:---:|---|
| architecture | ✓ | `skills/diagram-design/references/type-architecture.md` |
| quadrant | ✓ | `skills/diagram-design/references/type-quadrant.md` |
| timeline (gantt) | ✓ | `skills/diagram-design/references/type-gantt.md` |
| flowchart | | `.../type-flowchart.md` |
| sequence | | `.../type-sequence.md` |
| dp-security-matrix | | `.../type-dp-security-matrix.md` |
| dp-integration | | `.../type-dp-integration.md` |
| medallion | | `.../type-medallion.md` |
| high-level | | `.../type-high-level.md` |
| process | | `.../type-process.md` |
| data-flow | | `.../type-data-flow.md` |
| radar | | `.../type-radar.md` |
| loop | | `.../type-loop.md` |
| nested | | `.../type-nested.md` |
| org-chart | | `.../type-org-chart.md` |
| layers | | `.../type-layers.md` |
| pyramid | | `.../type-pyramid.md` |
| er | | `.../type-er.md` |
| bar / line / scatter | | `.../type-bar.md`, `type-line.md`, `type-scatter.md` (prefer Chart.js for these) |
| it-state | | `.../type-it-state.md` |

Primitives (`primitive-annotation.md`, `primitive-icons.md`, `primitive-sketchy.md`, `primitive-terminal.md`) apply across types and are always upstream-only.

## Editorial design tokens (override for AgentKit)

Upstream defaults ship atomic-tangerine `#eb6c36` as accent. AgentKit overrides to the wine-red editorial contract:

```css
:root {
  --paper:  #faf7f2;                                            /* warm cream */
  --ink:    #0f0e0d;                                            /* near-black */
  --accent: #b8232c;                                            /* wine-red — override, was #eb6c36 */
  --taupe:  #8a7f74;                                            /* secondary text */
  --rule:   #d8d1c4;                                            /* hairline dividers */
  --moss:   #4a6b3f;                                            /* success/complete */
  --ochre:  #c89a3c;                                            /* warning/P1 */
  --font-serif: "Instrument Serif", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --font-sans:  Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono:  "Geist Mono", "SF Mono", Menlo, Consolas, monospace;
}

:root:not([data-theme="light"]) {
  @media (prefers-color-scheme: dark) {
    --paper: #12100e; --ink: #f2ece0; --accent: #e14a53;
    --taupe: #a89e94; --rule: #2f2a24;
  }
}
:root[data-theme="dark"] {
  --paper: #12100e; --ink: #f2ece0; --accent: #e14a53;
  --taupe: #a89e94; --rule: #2f2a24;
}
```

Font pairing is #14 in `html-libraries.md` ("Editorial serif — Instrument Serif + Geist + Geist Mono").

## 6 connector rules (verbatim from upstream style-guide)

1. **Horizontal or vertical only**; diagonals are reserved for `primitive-sketchy` explicit hand-drawn types.
2. **Right-angle bends** land on rule grid coordinates; never rounded.
3. **Arrowheads** are the same stroke as the line, filled black at ink color; solid = primary flow, dashed = optional / async.
4. **Line weight** matches text weight of its endpoint labels; heavier lines belong on the critical path only.
5. **Junctions are dots**, not crossings — where two connectors meet, drop a filled circle at ink; where they only cross, one uses a small break to visually pass under.
6. **Never label mid-arrow**; place the label above the horizontal run or beside the vertical run, aligned to the same baseline.

Every generated SVG must satisfy these. `verify-geometry.py` (see below) catches most violations.

## Motion contract

Three motion tiers (default is `none`); set via `visual.diagram_design.motion` in `ckprefs`:

- `none` — no motion at all; static SVG. **Default for docs / plans.**
- `reveal` — staggered fade-in on first paint via CSS `animation-delay`, respects `prefers-reduced-motion`.
- `step` — user-driven step-through with `<button>` cycling `data-active-step`.
- `loop` — subtle repeating animation for background / status indicators.

`verify-motion.py` asserts the class markers match the declared tier and that `prefers-reduced-motion` rules exist for anything non-`none`.

## Template skeleton (minimum viable file)

```html
<!doctype html>
<html lang="en" data-diagram-type="architecture" data-motion="none">
<head>
<meta charset="utf-8">
<title>[Diagram title]</title>
<style>
  :root { /* tokens from section above */ }
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--font-sans); }
  .frame { padding: 32px; }
  .frame svg { display: block; width: 100%; max-width: 1080px; margin: 0 auto; }
  text.dd-label { font-size: 12px; fill: var(--ink); }
  text.dd-caption { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em;
                    text-transform: uppercase; fill: var(--taupe); }
  .dd-ink    { stroke: var(--ink);    fill: none; stroke-width: 1.4; }
  .dd-accent { stroke: var(--accent); fill: none; stroke-width: 1.6; }
  .dd-paper2 { fill: color-mix(in oklab, var(--paper) 88%, var(--ink) 12%); }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>
</head>
<body>
<div class="frame">
  <svg viewBox="0 0 1080 600" role="img" aria-label="[Alt text]">
    <!-- Per-type content per html-diagram-design-types/type-<name>.md -->
  </svg>
</div>
</body>
</html>
```

The 5 style hooks (`dd-ink`, `dd-accent`, `dd-paper2`, `dd-label`, `dd-caption`) are the entire style contract — every per-type file uses only these.

## Validators (advisory in v1)

Scripts vendored under `references/vendor/diagram-design-scripts/` at pinned SHA `09df49d8d1a1c7fb2efdfcdc7a2a0713534350a6`. **All three are advisory-only** — they warn on stderr and return the artifact anyway. Skill guides never gate rendering on validator exit code in v1.

```bash
python3 references/vendor/diagram-design-scripts/self_check.py       out.html
python3 references/vendor/diagram-design-scripts/verify-geometry.py  out.html
python3 references/vendor/diagram-design-scripts/verify-motion.py    out.html
```

Graceful skip: the vendor directory ships a `run-validators.sh` that detects `python3`; if absent it prints one line (`[diagram-design] python3 not found, skipping validators`) and exits 0. Skill guides call the shell wrapper, not `python3` directly, so users without Python are never blocked.

## Fallback rules

1. If a per-type file is not present locally and the artifact must be air-tight, either (a) hand-author the SVG from the upstream reference, or (b) fall back to Mermaid for that panel and note the substitution in the artifact colophon.
2. If `verify-geometry.py` fails after 1 retry with a corrective prompt, drop to Mermaid.
3. Never crash the artifact on validator failure — validators are advisory in v1.

## Do not

- Do not install the upstream Claude Code plugin (`/plugin marketplace add cathrynlavery/diagram-design`), because AgentKit vendors the references and a dual install creates routing conflicts. If the plugin is already installed, defer to its routing and skip the AgentKit variant.
- `mermaid_extract.py` and `drawio_extract.py` are conversion tools rather than generators, so import them only when the artifact origin is a `.mmd` or `.drawio` file.
- `primitive-sketchy` is reserved for `ak:brainstorm --html` and `ak:advise --html`, where hand-drawn intent is on-brand; leave it off plan, retro, and CTI artifacts.

## References

- Upstream repo: `github.com/cathrynlavery/diagram-design` (MIT)
- Pinned commit: `09df49d8d1a1c7fb2efdfcdc7a2a0713534350a6`
- Editorial contract in `html-libraries.md` "Editorial visual layer" section (font pairing #14)
