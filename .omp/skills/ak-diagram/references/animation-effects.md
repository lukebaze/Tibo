# ak:diagram — animation effects catalog

All eight effects are pure CSS living in `assets/connector-effects.css`.
Apply via `data-fx="<name>"` on any SVG `<path>` (or on an `<svg>` for
container-scope). No JS runtime, no external animation library.

CSS custom properties tune each effect. Set them inline
(`style="--ak-fx-speed: 3s"`) or in a scoped stylesheet.

Reduced-motion is respected globally — every keyframed effect freezes
under `@media (prefers-reduced-motion: reduce)`.

## Effect reference

### marching-ants — `data-fx="marching-ants"`
Dashed stroke slides continuously along the path. Classic "flowing"
connector.

| CSS var | Default | Meaning |
|---------|---------|---------|
| `--ak-fx-dash` | `10 8` | dasharray length pair |
| `--ak-fx-speed` | `2.4s` | full cycle duration |

Best on: architecture connectors, data-flow arrows.

---

### comet — `data-fx="comet"`
A single bright dash-segment travels the length of the path, leaving
a faint trail (opacity-tapered stroke).

| CSS var | Default | Meaning |
|---------|---------|---------|
| `--ak-fx-length` | `28` | segment length (path units) |
| `--ak-fx-speed` | `3.2s` | traversal duration |
| `--ak-fx-color` | `var(--ak-diag-accent)` | comet head color |

Best on: focal-point flows, "this is the important edge".

---

### wave — `data-fx="wave"`
Stroke width breathes with a sine wave; effect stays in place, only
thickness modulates.

| CSS var | Default | Meaning |
|---------|---------|---------|
| `--ak-fx-min` | `1.2px` | minimum stroke width |
| `--ak-fx-max` | `3.4px` | maximum stroke width |
| `--ak-fx-speed` | `2.0s` | full wave cycle |

Best on: async / event-driven links.

---

### morse — `data-fx="morse"`
Long-short dot/dash pattern travels along the path.

| CSS var | Default | Meaning |
|---------|---------|---------|
| `--ak-fx-dash` | `12 6 3 6` | Morse dasharray |
| `--ak-fx-speed` | `3.0s` | cycle |

Best on: intermittent / batched flows.

---

### glow — `data-fx="glow"`
Drop-shadow pulses on the stroke. No geometric motion — purely a
soft halo.

| CSS var | Default | Meaning |
|---------|---------|---------|
| `--ak-fx-glow` | `var(--ak-diag-accent)` | glow color |
| `--ak-fx-blur-max` | `10px` | peak blur radius |
| `--ak-fx-speed` | `2.4s` | pulse cycle |

Best on: alert / anomaly connectors.

---

### silhouette — `data-fx="silhouette"`
A tiny SVG shape (default: filled circle sibling) rides the path
via `offset-path: path(...)`. Requires the shape to declare
`--ak-fx-path` matching the parent stroke's `d`.

| CSS var | Default | Meaning |
|---------|---------|---------|
| `--ak-fx-speed` | `3.6s` | traversal cycle |
| `--ak-fx-shape-size` | `10px` | rider dimensions |
| `--ak-fx-path` | *(required)* | path spec for offset-path |

Best on: "packet in transit" visuals.

---

### pulse — `data-fx="pulse"`
Stroke width + opacity breathe together. Combines wave + glow into a
single subtle beat.

| CSS var | Default | Meaning |
|---------|---------|---------|
| `--ak-fx-speed` | `1.8s` | cycle |
| `--ak-fx-min-op` | `0.55` | minimum opacity |

Best on: heartbeat / health indicators.

---

### dashed-flow — `data-fx="dashed-flow"`
Slow ambient dash-drift for background structure. Lower contrast,
longer cycle than marching-ants.

| CSS var | Default | Meaning |
|---------|---------|---------|
| `--ak-fx-dash` | `4 8` | dasharray |
| `--ak-fx-speed` | `6.0s` | cycle |

Best on: secondary connectors that should feel alive but not compete.

## Composition rules

- **One accent color per diagram.** Effects using `--ak-diag-accent`
  should be reserved for the one edge that carries the argument.
- **Never stack effects on the same path.** Pick one; layered effects
  read as noise.
- **Freeze before screenshot.** The pipeline applies `.ak-fx-frozen`
  to every SVG before `page.screenshot()` so the golden PNG is
  determined solely by the path geometry + final-frame state.
- **Reduced motion:** effects auto-freeze under
  `@media (prefers-reduced-motion: reduce)` — verify by toggling your OS
  reduce-motion preference or by emulating in DevTools.

## Adding a new effect

1. Define keyframes + selector in `assets/connector-effects.css`,
   scoped to `svg:not(.ak-fx-frozen) path[data-fx="<name>"]`.
2. Add a `.ak-fx-frozen path[data-fx="<name>"]` rule that pins the
   effect to its resting state.
3. Add a row to this file with the CSS var API.
4. Add a demo entry to `assets/effects-demo.html`.
5. Run `scripts/snapshot_test.py --update-goldens` after visual review.
