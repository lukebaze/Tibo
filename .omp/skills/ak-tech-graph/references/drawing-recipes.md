## UML Coverage Map

Full mapping of UML 14 diagram types to supported diagram types:

| UML Diagram | Supported As | Notes |
|-------------|-------------|-------|
| Class | Class Diagram | Full UML notation |
| Component | Architecture Diagram | Use colored fills per component type |
| Deployment | Architecture Diagram | Add node/instance labels |
| Package | Architecture Diagram | Use dashed grouping containers |
| Composite Structure | Architecture Diagram | Nested rects within components |
| Object | Class Diagram | Instance boxes with underlined name |
| Use Case | Use Case Diagram | Full actor/ellipse/relationship |
| Activity | Flowchart / Process Flow | Add fork/join bars |
| State Machine | State Machine Diagram | Full UML notation |
| Sequence | Sequence Diagram | Add alt/opt/loop frames |
| Communication | — | Approximate with Sequence (swap axes) |
| Timing | Timeline | Adapt time axis |
| Interaction Overview | Flowchart | Combine activity + sequence fragments |
| ER Diagram | ER Diagram | Chen/Crow's foot notation |

## Shape Vocabulary

Map semantic concepts to consistent shapes across all diagram types:

| Concept | Shape | Notes |
|---------|-------|-------|
| User / Human | Circle + body path | Stick figure or avatar |
| LLM / Model | Rounded rect with brain/spark icon or gradient fill | Use accent color |
| Agent / Orchestrator | Hexagon or rounded rect with double border | Signals "active controller" |
| Memory (short-term) | Rounded rect, dashed border | Ephemeral = dashed |
| Memory (long-term) | Cylinder (database shape) | Persistent = solid cylinder |
| Vector Store | Cylinder with grid lines inside | Add 3 horizontal lines |
| Graph DB | Circle cluster (3 overlapping circles) | |
| Tool / Function | Gear-like rect or rect with wrench icon | |
| API / Gateway | Hexagon (single border) | |
| Queue / Stream | Horizontal tube (pipe shape) | |
| File / Document | Folded-corner rect | |
| Browser / UI | Rect with 3-dot titlebar | |
| Decision | Diamond | Flowcharts only |
| Process / Step | Rounded rect | Standard box |
| External Service | Rect with cloud icon or dashed border | |
| Data / Artifact | Parallelogram | I/O in flowcharts |

## Arrow Semantics

Always assign arrow meaning, not just color:

| Flow Type | Color | Stroke | Dash | Meaning |
|-----------|-------|--------|------|---------|
| Primary data flow | blue `#2563eb` | 2px solid | none | Main request/response path |
| Control / trigger | orange `#ea580c` | 1.5px solid | none | One system triggering another |
| Memory read | green `#059669` | 1.5px solid | none | Retrieval from store |
| Memory write | green `#059669` | 1.5px | `5,3` | Write/store operation |
| Async / event | gray `#6b7280` | 1.5px | `4,2` | Non-blocking, event-driven |
| Embedding / transform | purple `#7c3aed` | 1px solid | none | Data transformation |
| Feedback / loop | purple `#7c3aed` | 1.5px curved | none | Iterative reasoning loop |

Always include a **legend** when 2+ arrow types are used.

## Layout Rules & Validation

**Spacing**:
- Same-layer nodes: 80px horizontal, 120px vertical between layers
- Canvas margins: 40px minimum, 60px between node edges
- Snap to 8px grid: horizontal 120px intervals, vertical 120px intervals

**Arrow Labels**:
- Give every label a background rect: `<rect fill="canvas_bg" opacity="0.95"/>` with 4px horizontal, 2px vertical padding, so the text stays readable where it sits over a line
- Place mid-arrow, ≤3 words, stagger by 15-20px when multiple arrows converge
- Maintain 10px safety distance from nodes

**Arrow Routing**:
- Prefer orthogonal (L-shaped) paths to minimize crossings
- Anchor arrows on component edges, not geometric centers
- Route around dense node clusters, use different y-offsets for parallel arrows
- Jump-over arcs (5px radius) for unavoidable crossings

**Line Overlap Prevention** (the most common bug in generated diagrams):
When two arrows have to cross, use jump-over arcs, because a plain crossing reads as a junction:
- Crossing horizontal arrows: add a small semicircle arc (radius 5px, stroke same color as arrow, fill none) that "jumps over" the other line
- SVG pattern for jump-over: use a white/matching-background arc on the lower layer, then draw the upper arc on top
- Multiple crossings: stagger arc radii (5px, 7px, 9px) so arcs don't overlap each other
- Never let two arrows' straight-line segments cross without a jump-over arc

**Validation Checklist** (run before finalizing):
1. **Arrow-Component Collision**: arrows do not pass through component interiors — route around them with orthogonal paths
2. **Text Overflow**: all text fits with 8px padding (estimate: `text.length × 7px ≤ shape_width - 16px`)
3. **Arrow-Text Alignment**: arrow endpoints connect to shape edges rather than floating, and every arrow label has a background rect
4. **Container Discipline**: Prefer arrows entering and leaving section containers through open gaps between components, not through inner component bodies

## SVG Technical Rules

- ViewBox: `0 0 960 600` default; `0 0 960 800` tall; `0 0 1200 600` wide
- Fonts: embed via `<style>font-family: ...</style>` — no external `@import` (breaks rsvg-convert)
- `<defs>`: arrow markers, gradients, filters, clip paths
- Text: minimum 12px, prefer 13-14px labels, 11px sub-labels, 16-18px titles
- All arrows: `<marker>` with `markerEnd`, sized `markerWidth="10" markerHeight="7"`
- Drop shadows: `<feDropShadow>` in `<filter>`, apply sparingly (key nodes only)
- Curved paths: use `M x1,y1 C cx1,cy1 cx2,cy2 x2,y2` cubic bezier for loops/feedback arrows
- Clip content: use `<clipPath>` if text might overflow a node box

## SVG Generation & Error Prevention

**Python List Method** — build the SVG line by line:
```python
python3 << 'EOF'
lines = []
lines.append('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 700">')
lines.append('  <defs>')
# ... each line separately
lines.append('</svg>')

with open('/path/to/output.svg', 'w') as f:
    f.write('\n'.join(lines))
print("SVG generated successfully")
EOF
```

**Why this method**: it prevents character truncation, typos, and syntax errors, since each line is independent and easy to verify.

**Recovery**: inspect the actual error and repair its cause. Change generation method when it addresses the cause; stop with evidence if the renderer or required input is unavailable. Avoid repeating unchanged failing commands.

**If using `generate-from-template.py`**:
- Prefer `source` / `target` node ids in arrow JSON so the generator can snap to node edges
- Keep `x1,y1,x2,y2` as hints or fallback coordinates, not the main routing primitive
- Let the generator choose orthogonal routes; avoid hardcoding center-to-center straight lines unless the path is guaranteed clear

**Common Syntax Errors to Avoid**:
- ❌ `yt-anchor` → ✅ `y="60" text-anchor="middle"`
- ❌ `x="390` (missing y) → ✅ `x="390" y="250"`
- ❌ `fill=#fff` → ✅ `fill="#ffffff"`
- ❌ `marker-end=` → ✅ `marker-end="url(#arrow)"`
- ❌ `L 29450` → ✅ `L 290,220`
- ❌ Missing `</svg>` at end
