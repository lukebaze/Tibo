# Interactive Reader Runtime Guide

The `ak:diagram` interactive reader provides rich, browser-free, self-contained tools embedded directly into emitted HTML artifacts.

## Grounded Reader Tools

Every interaction operates strictly on **authored nodes and relationships** in the JSON IR; it never infers unverified topology or runtime causality.

| Action / Feature | Shortcut / Button | Behavior |
|---|---|---|
| **Search & Filter** | `/` or Search input | Filters nodes by label, ID, or description; highlights matches and dims others |
| **Node Focus** | Click on node | Focuses selected node, dims unrelated nodes, and highlights direct incoming/outgoing edges |
| **Clear Focus** | `Escape` or Click canvas | Clears all focus and dimming states |
| **Reach Tracing** | Context Menu / Script API | Traverses directed edges upstream (incoming) or downstream (outgoing) using BFS |
| **Route Inspection** | `R` or Path controls | Computes and highlights the deterministic shortest directed path between two nodes |
| **Role Lens** | `L` or Role filter | Highlights all nodes matching a declared semantic role (e.g., `database`, `gateway`) |
| **Presentation Stage** | `F` | Toggles distraction-free full-window presentation stage; `Escape` restores normal view |
| **Guided Stories** | `[` / `]` or Chapter UI | Plays through authored `meta.views` chapters sequentially |
| **Share Card Export** | 📤 Card button | Exports a canonical 1200×630 SVG share card representing the current diagram state |
| **Theme Toggle** | ☀️ / 🌙 | Toggles between `light` and `dark` color tokens without altering geometry or preset |
| **Replay Motion** | `M` or Replay button | Re-arms the finite entrance (and trace pass when authored) from the first column |

## Visual Presets

Visual presets modify typography, line vocabulary, and density without mutating the underlying graph semantics:

- **`classic`** (default): Neutral, clean system architecture aesthetic.
- **`signal-flow`**: Luminous connector emphasis, vibrant active routes, high contrast.
- **`blueprint`**: Technical drafting grid, monospaced typography, precise bounding boxes.
- **`editorial`**: Publication-grade typography, generous whitespace, warm accent colors.

## Finite Motion & Accessibility

- Every diagram plays a finite staggered entrance: nodes rise in by column (`--step` index), edges draw along their route, labels fade in last.
- `meta.animation: "trace"` adds one finite flow pass along every route plus a single stroke pulse per node after the entrance; nothing loops indefinitely and the whole sequence stays under 8 s.
- Motion is user-replayable (`M` or the Replay button) and lives entirely in CSS (`assets/diagram-core.css`), so standalone SVG output animates the same way.
- Under `@media (prefers-reduced-motion: reduce)`, all transitions and animations are completely disabled and final state is rendered statically.
- All controls feature visible keyboard focus rings, semantic labels, and ARIA attributes.
