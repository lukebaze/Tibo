# HTML Plan Output Contract (`--html`)

When `--html` is passed, `plan.html` is the primary, authoritative user-facing plan artifact produced after validation and red-team gates.

## Shared Composition Contract

Follow the shared HTML composition contract in `../ak-preview/references/html-skill-composition.md`:
1. **Activate `ak:frontend-design` first** for page layout architecture, typography hierarchy, tokens, responsive shell, modal styling, and accessibility.
2. **Activate `ak:diagram` second** (when installed) to author and compile typed JSON IR for architecture, sequence, and implementation workflow diagrams.
3. **Fallback**: If `ak:diagram` is absent, produce clean semantic inline SVG/CSS with `<title>` and `<desc>`.

## Artifact Rules

- **Location**: Write `plan.html` in the active plan directory (`plans/<slug>/plan.html`).
- **Self-contained**: Inline CSS and JavaScript, 0 build steps, 0 network-required assets. Safe to open directly via `file://`.
- **Companion `plan.md`**: Keep `plan.md` as a concise metadata index for GitHub/cook compatibility; do not duplicate the full plan body.
- **Embedded Visuals**: Embed any generated illustrations as data URIs.

## Required Sections & Features

1. **Header & Roadmap**: Plan title, status, metadata, and overview roadmap.
2. **Visible Phase Outlines**: Every phase shows title, priority, status, dependencies, objective, 3–6 key bullets, touched files, success criteria, and validation gates.
3. **Phase Detail Modals**: Clicking a phase opens an accessible modal displaying the complete phase details with rendered markdown, code blocks, and checkboxes.
4. **Implementation Workflow Diagram**: At least one visual diagram (architecture, sequence, or workflow) rendered inline via `ak:diagram` typed IR.
5. **Annotated UI/UX Mockups**: When the plan touches UI/UX, embed annotated visual mockups tied to design tokens and interaction states.
6. **Open Questions & Citations**: Visible URL citations for external docs and GitHub issues; clear list of unresolved questions (or "None").

## Design Direction

Use editorial magazine styling: warm paper `#faf7f2`, paper panels `#f0ebe1`, ink `#0a0a0a`, muted `#6b6258`, accent red `#b8232c`, serif headings, monospace labels, and hairline dividers.

## Editorial Visual Layer

For KPI tiles or comparison panels, prefer AntV Infographic or diagram-design Quadrant when enabled (`.prefs.visual`). Kill switches: `--no-antv`, `--no-diagram-design`, `--no-editorial-visuals`. See `../ak-preview/references/html-diagram-design.md` and `../ak-preview/references/html-antv-infographic.md`.
