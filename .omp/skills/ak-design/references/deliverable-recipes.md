## Logo Design (Built-in)

55+ styles, 30 color palettes, 25 industry guides, driven by `scripts/logo/`.
Load `logo-builtin-usage.md` when the task is a logo: it holds the brief,
search, and generation command recipes plus the post-generation preview step.

## CIP Design (Built-in)

50+ deliverables, 20 styles, 20 industries, driven by `scripts/cip/`.
Load `cip-builtin-usage.md` when the task is a corporate identity program:
it holds the brief, search, mockup, model, and HTML-presentation command recipes.

## Slides (Built-in)

Strategic HTML presentations with Chart.js, design tokens, copywriting formulas.

Load `slides-create.md` for the creation workflow.

### Slides: Knowledge Base

| Topic | File |
|-------|------|
| Creation Guide | `slides-create.md` |
| Layout Patterns | `slides-layout-patterns.md` |
| HTML Template | `slides-html-template.md` |
| Copywriting | `slides-copywriting-formulas.md` |
| Strategies | `slides-strategies.md` |

## Banner Design (Built-in)

22 art direction styles across social, ads, web, print. Uses `frontend-design`, `ai-artist`, `ai-multimodal`, and browser capture tools.

Load `banner-sizes-and-styles.md` for complete sizes and styles reference.

### Banner: Workflow

1. **Gather requirements** — use the batched intake in `design-workflow.md`. If the brief names a real brand or product, run `brand-asset-protocol.md` first.
2. **Research** — Activate `ui-ux-pro-max`, browse Pinterest for references
3. **Design** — Create HTML/CSS banner with `frontend-design`, generate visuals with `ai-artist`/`ai-multimodal`
4. **Export** — Screenshot to PNG at exact dimensions via `ak:agent-browser`, Chrome headless, or Playwright
5. **Present** — Show all options side-by-side, iterate on feedback

### Banner: Quick Size Reference

| Platform | Type | Size (px) |
|----------|------|-----------|
| Facebook | Cover | 820 x 312 |
| Twitter/X | Header | 1500 x 500 |
| LinkedIn | Personal | 1584 x 396 |
| YouTube | Channel art | 2560 x 1440 |
| Instagram | Story | 1080 x 1920 |
| Instagram | Post | 1080 x 1080 |
| Google Ads | Med Rectangle | 300 x 250 |
| Website | Hero | 1920 x 600-1080 |

### Banner: Top Art Styles

| Style | Best For |
|-------|----------|
| Minimalist | SaaS, tech |
| Bold Typography | Announcements |
| Gradient | Modern brands |
| Photo-Based | Lifestyle, e-com |
| Geometric | Tech, fintech |
| Glassmorphism | SaaS, apps |
| Neon/Cyberpunk | Gaming, events |

### Banner: Design Rules

- Safe zones: critical content in central 70-80%
- One CTA per banner, bottom-right, min 44px height
- Max 2 fonts, min 16px body, ≥32px headline
- Text under 20% for ads (Meta penalizes)
- Print: 300 DPI, CMYK, 3-5mm bleed

## Icon Design (Built-in)

15 styles, 12 categories, driven by `scripts/icon/generate.py` (SVG text output).
Load `icon-builtin-usage.md` when the task is an icon or icon set: it holds
the single, batch, and multi-size command recipes plus the style table and model note.

## Poster Design (Built-in)

Model-agnostic poster prompts (style x palette x layout x texture) from `scripts/poster/`.
Load `poster-builtin-usage.md` when the task is a poster: it holds the axis
rules, search, brief, prompt-generation, and knowledge-base rebuild command recipes.

## Social Photos (Built-in)

Multi-platform social image design: HTML/CSS → screenshot export. Uses `ui-ux-pro-max`, `brand`, `design-system`, and browser capture tools.

Load `social-photos-design.md` for sizes, templates, best practices.

### Social Photos: Workflow

1. **Orchestrate** — `project-management` skill for TODO tasks; parallel subagents for independent work
2. **Analyze** — Parse prompt: subject, platforms, style, brand context, content elements
3. **Ideate** — 3-5 concepts using the 4-pass discipline in `design-workflow.md` (assumptions + placeholders → real + variations → polish → verify); present via `ask_user capability`.
4. **Design** — `the marketing brand skill` → `the marketing design-system skill` → randomly invoke `/ak:ui-ux-pro-max` OR `/ak:frontend-design`; HTML per idea × size
5. **Export** — `ak:agent-browser`, Chrome headless, or Playwright screenshot at exact px (2x deviceScaleFactor)
6. **Verify** — Use Chrome MCP / `chrome-devtools-mcp`, `ak:agent-browser`, or Playwright to visually inspect exported designs; fix layout/styling issues and re-export
7. **Report** — Summary to `plans/reports/` with design decisions
8. **Organize** — Invoke `assets-organizing` skill to sort output files and reports

### Social Photos: Key Sizes

| Platform | Size (px) | Platform | Size (px) |
|----------|-----------|----------|-----------|
| IG Post | 1080×1080 | FB Post | 1200×630 |
| IG Story | 1080×1920 | X Post | 1200×675 |
| IG Carousel | 1080×1350 | LinkedIn | 1200×627 |
| YT Thumb | 1280×720 | Pinterest | 1000×1500 |

## Workflows

### Complete Brand Package

1. **Logo** → `scripts/logo/generate.py` → Generate logo variants
2. **CIP** → `scripts/cip/generate.py --logo ...` → Create deliverable mockups
3. **Presentation** → Load `slides-create.md` → Build pitch deck

### New Design System

1. **Brand** (brand skill) → Define colors, typography, voice
2. **Tokens** (design-system skill) → Create semantic token layers
3. **Implement** (ui-styling skill) → Configure Tailwind, shadcn/ui
