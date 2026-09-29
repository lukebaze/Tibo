# Visual Explanation Routing

Use this file when a workflow asks for a visual explanation, diagram, slide deck,
diff review, or recap. Load `../SKILL.md` first for command syntax, then use this
file to choose the mode.

## Mode Selection

| Need | Preview mode |
|---|---|
| View an existing Markdown file or directory | `/ak:preview <path>` |
| Explain a concept or code path | `/ak:preview --explain <topic>` |
| Generate a focused architecture/data-flow diagram | `/ak:preview --diagram <topic>` |
| Terminal-friendly diagram only | `/ak:preview --ascii <topic>` |
| Self-contained HTML explanation | `/ak:preview --html --explain <topic>` |
| Slide deck | `/ak:preview --html --slides <topic>` |
| Visual diff review for a branch, PR, or commit | `/ak:preview --html --diff [ref]` |
| Compare an implementation plan to code | `/ak:preview --html --plan-review <plan>` |
| Recap recent project context | `/ak:preview --html --recap [timeframe]` |

## Specialist Handoffs

- Mermaid syntax: load `/ak:mermaidjs-v11`.
- Publish-grade SVG/PNG architecture diagrams (non-templated): use
  `/ak:tech-graph`.
- Generated images or multimodal analysis: use `/ak:ai-multimodal`.
- UI/UX style selection for slides or high-polish HTML: use
  `/ak:ui-ux-pro-max`.
- Documentation update after a durable visual: use `/ak:docs update` and
  `../../docs/references/documentation-management.md`.

## Output Rules

- Prefer the active plan's `visuals/` folder when a plan exists.
- If no plan exists, save under `plans/visuals/`.
- For HTML output, always include the theme toggle required by
  `html-css-patterns.md`.
- For diagrams, render and inspect the output; syntax validity alone is not
  enough.
