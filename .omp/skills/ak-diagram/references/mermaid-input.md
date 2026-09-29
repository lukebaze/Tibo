# ak:diagram — Mermaid input notes

Pinned to vendored `assets/mermaid.min.js` v11.4.1. Do not rely on
Mermaid features shipped after that release.

## Supported diagram kinds

Tier 1 wraps `.mmd` source into an editorial frame and runs
mermaid.initialize with `theme: 'base'`. All standard Mermaid
diagram kinds work: `flowchart`, `sequenceDiagram`, `classDiagram`,
`stateDiagram-v2`, `erDiagram`, `journey`, `gantt`, `pie`, `mindmap`,
`timeline`, `quadrantChart`, `requirementDiagram`, `xychart-beta`.

## Editorial framing

Every Mermaid render inherits the token palette from `assets/tokens.css`:

- `--ak-diag-paper` background
- `--ak-diag-ink` foreground / stroke
- `--ak-diag-accent` reserved for focal elements (do not overuse)
- `--ak-diag-font` type family

Pass `--title` and `--caption` to `render.py` to add editorial
headings above the diagram — Mermaid's own `title:` directive is
ignored so we can control typography.

## Animation

Native Mermaid has no animation primitives. To animate connectors on
a Mermaid-rendered SVG:

1. Render once to HTML (`render.py --input diagram.mmd --no-png --no-svg`)
2. Post-process the emitted SVG: add `data-fx="<name>"` to the paths
   you want to animate (typically identifiable by their id/class).
3. Re-open the modified HTML and re-render or record.

For animation-heavy work, an editorial template from Tier 2 is usually
the better choice — templates ship with `data-fx` slots already wired.

## Deterministic rendering caveats

- Mermaid auto-layout can vary slightly between minor versions. The
  pinned version + vendored `mermaid.min.js` prevents drift.
- Font metrics: rendering uses the token font stack. If a system
  font is unavailable, fallback to the next in the stack may shift a
  few pixels. `--font-render-hinting=none` reduces but does not
  eliminate this.
- Long labels wrap at the browser default; use `<br/>` in labels for
  intentional breaks so the wrap point is reproducible.

## Golden hash coverage

Mermaid-native diagrams are not part of the golden snapshot suite —
their layout depends on label content and is expected to drift with
input changes. Templates (Tier 2) are the deterministic surface.

## Escape hatch: mmdc

If `mmdc` (mermaid-cli) is on PATH, `render.py` will not shortcut to
it — the HTML pipeline is used uniformly so editorial framing and
token overrides always apply. Use `mmdc` directly if you want the
un-framed Mermaid default.
