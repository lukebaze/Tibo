# Per-type JSON schemas

Each schema describes the **intended** shape of a JSON spec passed to
`render.py --input <spec>.json --type <slug>`. The slot filler
replaces `{{key}}` tokens in the template with `str(spec[key])`.

## Status: aspirational

Upstream templates ship as finished exemplars with **no `{{key}}` slots
declared yet**. The `_fill_template` code path in `render.py` is fully
wired, but until a template opts in by placing slots in its HTML, a JSON
spec's structured keys (arrays / nested objects) do not render.

The intended progression per template is:
1. Author identifies a piece of content in the exemplar HTML that should
   be user-driven (e.g. the four labels of a `loop`).
2. Author replaces that content with `{{key}}` matching a schema property.
3. Author records the change in `references/vendoring-metadata.yaml`
   (a `slots:` list per template) so re-vendoring won't blow it away.

Until then, treat these schemas as documentation of the eventual API and
use the raw HTML editing path (Tier 3 in `SKILL.md`).

## Common keys (every type)

| Key | Type | Purpose |
|-----|------|---------|
| `variant` | string | `"light"`, `"dark"`, or `"full"` (chooses template file) |
| `title` | string | Rendered as `<h1 class="ak-diag__title">` when the template supports it |
| `caption` | string | Optional editorial subtitle |
| `accent` | string | CSS color override for `--ak-diag-accent` |

## Schemas provided

Not every template requires a schema — mermaid-native ones
(`flowchart`, `sequence`, `state`, `gantt`) accept plain Mermaid
source instead. Their schemas are intentionally omitted. The 20
schemas here cover the 20 editorial types where the JSON slot-filler
flow is the primary input path (19 base editorial types + `loop.json`
that also demonstrates the shape as a canonical example):

- `architecture.json`, `high-level.json`, `layers.json`,
  `medallion.json`, `dp-integration.json`, `dp-security-matrix.json`,
  `data-flow.json` — architecture cluster
- `swimlane.json`, `process.json`, `org-chart.json` — flow cluster
- `loop.json`, `pyramid.json`, `quadrant.json`, `radar.json`,
  `timeline.json`, `nested.json`, `it-state.json` — storytelling cluster
- `bar.json`, `line.json`, `scatter.json` — data-viz cluster

The template HTML is the ground truth for supported keys. When in
doubt, `grep -o '{{[a-z_]*}}' assets/templates/<type>/light.html`
lists every slot the template expects.

## Validation

Schemas are drafted as
[JSON Schema draft-07](https://json-schema.org/draft-07/schema).
`render.py` does not validate against them at runtime — they exist
for documentation and IDE completion. If you want strict validation,
run `jsonschema` externally before calling render.
