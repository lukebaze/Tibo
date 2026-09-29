## HTML Output Mode (`--html`)

Adding `--html` to any generation flag (or running HTML-implying modes `--diff`, `--plan-review`, `--recap`) switches output to a self-contained HTML file.

Follow the shared HTML composition contract in `html-skill-composition.md`:
1. Activate `ak:frontend-design` first for layout, design tokens, responsive shell, and accessibility.
2. Activate `ak:diagram` second (when installed) to compile typed JSON IR or trusted diagram fragments.
3. If `ak:diagram` is absent, produce a clean semantic inline SVG/CSS fallback with `<title>/<desc>`.

**Output:** Single `.html` file with all CSS/JS inline. Opens directly in browser — no server needed.
**Location:** `{plan_dir}/visuals/{slug}.html` (same plan-aware logic as markdown mode)
**Browser open:** `open` (macOS) / `xdg-open` (Linux) / `start` (Windows)
**Theme toggle:** Every HTML page includes a light/dark theme toggle button, because these pages get read in both themes and a page that only works in one is the most common complaint. See `html-css-patterns.md` → "Theme Toggle Button" for the exact CSS, HTML, and JS to include.
### Reference Loading (HTML mode)

Select references by artifact and complexity; reuse a previously loaded unchanged design contract:

| Mode | Read when needed | Mode-specific |
|------|-------------|---------------|
| All HTML modes | `html-design-guidelines.md` | — |
| `--explain` | `html-css-patterns.md`, `html-libraries.md` | Template: `architecture.html` |
| `--diagram` | `html-css-patterns.md`, `html-libraries.md` | Template: `mermaid-flowchart.html` or `architecture.html` |
| `--slides` | `html-slide-patterns.md`, `html-css-patterns.md`, `html-libraries.md` | Template: `slide-deck.html` |
| `--diff` | `html-css-patterns.md`, `html-libraries.md` | Templates: `data-table.html`, `architecture.html` |
| `--plan-review` | `html-css-patterns.md`, `html-libraries.md` | Templates: `architecture.html`, `data-table.html` |
| `--recap` | `html-css-patterns.md`, `html-libraries.md` | Templates: `architecture.html`, `data-table.html` |

Multi-section pages (`--explain`, `--diff`, `--plan-review`, `--recap`): also read `html-responsive-nav.md`.

Use `/ak:mermaidjs-v11` skill for Mermaid syntax validation.

### Editorial visual layer (on by default, additive)

Two libraries extend Mermaid/Chart.js when the intent maps cleanly to an editorial vernacular. Both are on by default with a 3-tier opt-out — resolve via `ak config prefs resolve --json | jq '.prefs.visual'` (nested keys use hook-facing camelCase, so `diagram_design` returns as `diagramDesign`); both fall back cleanly when disabled or when render fails.

| Intent | Default engine | Editorial alternate | Reference |
|--------|---------------|---------------------|-----------|
| Architecture / concept | Mermaid C4 | **diagram-design Architecture** | `html-diagram-design.md` |
| Quadrant 2×2 | (none) | **diagram-design Quadrant** | `html-diagram-design.md` |
| Timeline | Mermaid gantt | **diagram-design Timeline** OR **AntV timeline** | both refs |
| KPI panel (≥3 tiles) | Chart.js | **AntV Infographic** (`CandyCardLite`, `CircularProgress`) | `html-antv-infographic.md` |
| Ranked list / compare | HTML table | **AntV `CompareBinaryHorizontal`** | `html-antv-infographic.md` |
| DP security / integration / medallion | (none) | **diagram-design** (upstream types) | `html-diagram-design.md` |

Resolution ladder per invocation: `--no-editorial-visuals` > `--no-antv` / `--no-diagram-design` > project `.agentkit/config.yaml` > user `~/.agentkit/config.yaml` > default `enabled: true`. No env-var tier. Read the corresponding reference file only when the intent matches — do not preload both.

**Fallback contract (advisory in v1):** if AntV load or render fails, log `[antv] fell back to <engine>` and drop to Mermaid/Chart.js. If a diagram-design SVG fails geometry validation twice, drop to Mermaid. Vendored validator wrapper: `vendor/diagram-design-scripts/run-validators.sh` (exits 0 when `python3` is absent).

### HTML-Only Modes

#### `--diff [ref]` (implies --html)
Visual diff review. Scope detection: branch name, commit hash, HEAD, PR number, commit range, default=main.
Data: git diff --stat, --name-status, changed files, new API surface, CHANGELOG.
Output: executive summary, KPI dashboard, module architecture (Mermaid), feature comparisons (side-by-side), flow diagrams, file map, test coverage, code review cards (Good/Bad/Ugly/Questions), decision log, re-entry context.

#### `--plan-review [plan-file]` (implies --html)
Plan vs codebase comparison. Input: plan file path or detect from active plan context.
Data: read plan, read all referenced files, map blast radius, cross-reference assumptions.
Output: plan summary, impact dashboard, current vs planned architecture (paired Mermaid), change breakdown (side-by-side), dependency analysis, risk assessment, review cards, understanding gaps.
Visual language: blue=current, green=planned, amber=concern, red=gap.

#### `--recap [timeframe]` (implies --html)
Project context snapshot. Time window: shorthand (2w, 30d, 3m) or default 2w.
Data: project identity, git log, git status, decision context, architecture scan.
Output: project identity, architecture snapshot (Mermaid), recent activity, decision log, state KPI cards, mental model essentials, cognitive debt hotspots, next steps.

### Style Strategy
- Default: static anti-slop rules from `html-design-guidelines.md` (6 curated presets)
- For `--slides`: consider invoking `/ak:ui-ux-pro-max` for richer style selection
- Agent must vary aesthetics between consecutive HTML outputs (different font pair, palette)
