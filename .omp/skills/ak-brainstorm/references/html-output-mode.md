## HTML Output Mode (`--html`)

When `--html` is present, capture the accepted brainstorm outcome as a
self-contained HTML brief the user can preview before delivery starts. The brief
augments the handoff; it never replaces the four contract fields passed to the
next workflow.

- Write `brainstorm.html` in the repository's configured report location.
  Self-contained: inline CSS and JavaScript, no build step, no network-required
  assets, safe to open directly from disk. Keep it accessible, responsive, and
  reduced-motion friendly.
- Include the contract fields, including Trade-offs and Better approaches when present, the compared approaches with trade-offs, the
  recommendation and its rationale, and any unresolved risks or questions.
- **Implementation workflow diagram (required):** render at least one inline
  diagram (HTML/CSS/SVG) that visualizes what the chosen direction will build
  and how its steps or components connect — the delivery flow, not only the
  decision tree.
- **UI/UX mockups with annotations (required when the topic touches UI/UX):**
  embed annotated mockups of the proposed interface directly in the HTML so the
  user previews intended UI before planning. Derive layout, color, type,
  spacing, and component states from the project design guidelines
  (`docs/design-guidelines.md` when present, otherwise a restrained built-in
  editorial contract). Add callouts tying each element to design tokens,
  interaction states, and the acceptance evidence it satisfies.
- Follow the shared HTML composition contract in `../../ak-preview/references/html-skill-composition.md`:
  1. Activate `ak:frontend-design` first for layout, tokens, responsive shell, and design critique.
  2. Activate `ak:diagram` second (when installed) to compile typed JSON IR for the implementation workflow diagram.
  3. If `ak:diagram` is absent, produce a clean semantic inline SVG/CSS fallback with `<title>/<desc>`.
- **Editorial visual layer (on by default, additive):** for approach comparisons, prefer the
  diagram-design Quadrant vernacular over a plain 2×2 table when
  `.prefs.visual.diagramDesign.enabled` (read from
  `ak config prefs resolve --json`). For KPI-shaped tiles (approach
  effort/impact scoring), prefer AntV Infographic `CandyCardLite` /
  `CompactCard` when `.prefs.visual.antv.enabled`. Nested keys arrive in
  the hook-facing camelCase spelling — `diagram_design` in `config.yaml`
  resolves as `diagramDesign` at that surface. Kill switches: `--no-antv`,
  `--no-diagram-design`, `--no-editorial-visuals`. See the sibling `ak-preview`
  skill's `../../ak-preview/references/html-diagram-design.md` and
  `../../ak-preview/references/html-antv-infographic.md` for exact template usage.
