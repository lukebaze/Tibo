# HTML Output Contract (`--html`)

When `--html` is active, `ak:explain` produces a self-contained, offline, interactive visual HTML artifact that provides an intuitive, structured explanation.

## Composition Sequence

1. **Resolve Live Skill Catalog**
   - Query available capabilities dynamically from the runtime catalog.
   - Do NOT assume `ak:diagram` exists on the filesystem (it is an Engineer-tier skill).

2. **Activate Frontend Design**
   - Activate `ak:frontend-design` for page layout, typography hierarchy, design tokens, responsive containers, light/dark mode styles, and accessibility checks.

3. **Activate Diagram (When Installed)**
   - When `ak:diagram` is available in the resolved catalog:
     - Identify the primary archetype: `architecture` (components/boundaries), `workflow` (steps/decisions), `sequence` (messages over time), `dataflow` (sources/stores/flows), or `lifecycle` (states/transitions).
     - Author typed JSON IR matching that archetype.
     - Invoke the diagram compiler to obtain an embeddable, scoped SVG/reader fragment.
   - When `ak:diagram` is absent (e.g. Core-only or Marketing kit):
     - Render an accessible, semantic inline SVG/CSS diagram directly in the HTML document.
     - Include `<title>`, `<desc>`, clear node labels, and directional arrows.
     - Disclose the reduced interaction capability in the artifact metadata.

4. **Single-Document Assembly**
   - `ak:explain` owns the document structure (`<!DOCTYPE html>`, `<html>`, `<head>`, `<body>`).
   - Embed the diagram fragment into the visual section. Never embed full nested HTML documents or `<iframe>`s.
   - Required document sections:
     - **Hero Header**: Title, 1–2 sentence summary, badge tags.
     - **Visual Mental Model**: The embedded diagram (interactive or semantic fallback).
     - **Step-by-Step Walkthrough**: Structured, progressive explanation cards.
     - **Concrete Example / Trace**: Realistic code snippet, request payload, or event log.
     - **Warnings & Failure Modes**: Highlighted alert panels for risks and invariants.
     - **Glossary & Analogy Limits**: Definitions of terms and analogy boundaries (especially for `--eli5`).

5. **Artifact Location & Naming**
   - Plan-aware path: `{plan_dir}/visuals/explain-{slug}.html` when an active plan exists; otherwise `plans/visuals/explain-{slug}.html`.
   - Never embed timestamps inside output filenames or content. Use a descriptive kebab-case slug.

6. **Offline & Accessibility Verification**
   - All CSS, JS, and SVG assets must be 100% inline or vendored local assets.
   - Zero external network calls (no CDNs, Google Fonts, or external image links).
   - Test that the document opens directly via `file://`.
   - Ensure semantic headings (`<h1>`–`<h3>`), keyboard-accessible controls (`tabindex`, visible focus rings), sufficient color contrast, and `@media (prefers-reduced-motion: reduce)` support.
