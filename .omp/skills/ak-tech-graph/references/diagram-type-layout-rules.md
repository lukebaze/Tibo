# Diagram Types & Layout Rules

## Architecture Diagram
Nodes = services/components. Group into **horizontal layers** (top→bottom or left→right).
- Typical layers: Client → Gateway/LB → Services → Data/Storage
- Use `<rect>` dashed containers to group related services in the same layer
- Arrow direction follows data/request flow
- ViewBox: `0 0 960 600` standard, `0 0 960 800` for tall stacks

## Data Flow Diagram
Emphasizes **what data moves where**. Focus on data transformation.
- Label every arrow with the data type (e.g., "embeddings", "query", "context")
- Use wider arrows (`stroke-width: 2.5`) for primary data paths
- Dashed arrows for control/trigger flows
- Color arrows by data category (not just Agent/RAG — use semantics)

## Flowchart / Process Flow
Sequential decision/process steps.
- Top-to-bottom preferred; left-to-right for wide flows
- Diamond shapes for decisions, rounded rects for processes, parallelograms for I/O
- Keep node labels short (≤3 words); put detail in sub-labels
- Align nodes on a grid: x positions snap to 120px intervals, y to 80px

## Agent Architecture Diagram
Shows how an AI agent reasons, uses tools, and manages memory.
Key conceptual layers to always consider:
- **Input layer**: User, query, trigger
- **Agent core**: LLM, reasoning loop, planner
- **Memory layer**: Short-term (context window), Long-term (vector/graph DB), Episodic
- **Tool layer**: Tool calls, APIs, search, code execution
- **Output layer**: Response, action, side-effects
Use cyclic arrows (loop arcs) to show iterative reasoning. Separate memory types visually.

## Memory Architecture Diagram (Mem0, MemGPT-style)
Specialized agent diagram focused on memory operations.
- Show memory **write path** and **read path** separately (different arrow colors)
- Memory tiers: Working Memory → Short-term → Long-term → External Store
- Label memory operations: `store()`, `retrieve()`, `forget()`, `consolidate()`
- Use stacked rects or layered cylinders for storage tiers

## Sequence Diagram
Time-ordered message exchanges between participants.
- Participants as vertical **lifelines** (top labels + vertical dashed lines)
- Messages as horizontal arrows between lifelines, top-to-bottom time order
- Activation boxes (thin filled rects on lifeline) show active processing
- Group with `<rect>` loop/alt frames with label in top-left corner
- ViewBox height = 80 + (num_messages × 50)

## Comparison / Feature Matrix
Side-by-side comparison of approaches, systems, or components.
- Column headers = systems, row headers = attributes
- Row height: 40px; column width: min 120px; header row height: 50px
- Checked cell: tinted background (e.g. `#dcfce7`) + `✓` checkmark; unsupported: `#f9fafb` fill
- Alternating row fills (`#f9fafb` / `#ffffff`) for readability
- Max readable columns: 5; beyond that, split into two diagrams

## Timeline / Gantt
Horizontal time axis showing durations, phases, and milestones.
- X-axis = time (weeks/months/quarters); Y-axis = items/tasks/phases
- Bars: rounded rects, colored by category, labeled inside or beside
- Milestone markers: diamond or filled circle at specific x position with label above
- ViewBox: `0 0 960 400` typical; wider for many time periods: `0 0 1200 400`

## Mind Map / Concept Map
Radial layout from central concept.
- Central node at `cx=480, cy=280`
- First-level branches: evenly distributed around center (360/N degrees)
- Second-level branches: branch off first-level at 30-45° offset
- Use curved `<path>` with cubic bezier for branches, not straight lines

## Class Diagram (UML)
Static structure showing classes, attributes, methods, and relationships.
- **Class box**: 3-compartment rect (name / attributes / methods), min width 160px
  - Top compartment: class name, bold, centered (abstract = *italic*)
  - Middle: attributes with visibility (`+` public, `-` private, `#` protected)
  - Bottom: method signatures, same visibility notation
- **Relationships**:
  - Inheritance (extends): solid line + hollow triangle arrowhead, child → parent
  - Implementation (interface): dashed line + hollow triangle, class → interface
  - Association: solid line + open arrowhead, label with multiplicity (1, 0..*, 1..*)
  - Aggregation: solid line + hollow diamond on container side
  - Composition: solid line + filled diamond on container side
  - Dependency: dashed line + open arrowhead
- **Interface**: `<<interface>>` stereotype above name, or circle/lollipop notation
- **Enum**: compartment rect with `<<enumeration>>` stereotype, values in bottom
- Layout: parent classes top, children below; interfaces to the left/right of implementors
- ViewBox: `0 0 960 600` standard; `0 0 960 800` for deep hierarchies

## Use Case Diagram (UML)
System functionality from user perspective.
- **Actor**: stick figure (circle head + body line) placed outside system boundary
  - Label below figure, 13-14px
  - Primary actors on left, secondary/supporting on right
- **Use case**: ellipse with label centered inside, min 140×60px
  - Keep names verb phrases: "Create Order", "Process Payment"
- **System boundary**: large rect with dashed border + system name in top-left
- **Relationships**:
  - Include: dashed arrow `<<include>>` from base to included use case
  - Extend: dashed arrow `<<extend>>` from extension to base use case
  - Generalization: solid line + hollow triangle (specialized → general)
- Layout: system boundary centered, actors outside, use cases inside
- ViewBox: `0 0 960 600` standard

## State Machine Diagram (UML)
Lifecycle states and transitions of an entity.
- **State**: rounded rect with state name, min 120×50px
  - Internal activities: small text `entry/ action`, `exit/ action`, `do/ activity`
  - **Initial state**: filled black circle (r=8), one outgoing arrow
  - **Final state**: filled circle (r=8) inside hollow circle (r=12)
  - **Choice**: small hollow diamond, guard labels on outgoing arrows `[condition]`
- **Transition**: arrow with optional label `event [guard] / action`
  - Guard conditions in square brackets
  - Actions after `/`
- **Composite/nested state**: larger rect containing sub-states, with name tab
- **Fork/join**: thick horizontal or vertical black bar (synchronization)
- Layout: initial state top-left, final state bottom-right, flow top-to-bottom
- ViewBox: `0 0 960 600` standard

## ER Diagram (Entity-Relationship)
Database schema and data relationships.
- **Entity**: rect with entity name in header (bold), attributes below
  - Primary key attribute: underlined
  - Foreign key: italic or marked with (FK)
  - Min width: 160px; attribute font-size: 12px
- **Relationship**: diamond shape on connecting line
  - Label inside diamond: "has", "belongs to", "enrolls in"
  - Cardinality labels near entity: `1`, `N`, `0..1`, `0..*`, `1..*`
- **Weak entity**: double-bordered rect with double diamond relationship
- **Associative entity**: diamond + rect hybrid (rect with diamond inside)
- Line style: solid for identifying relationships, dashed for non-identifying
- Layout: entities in 2-3 rows, relationships between related entities
- ViewBox: `0 0 960 600` standard; wider `0 0 1200 600` for many entities

## Network Topology
Physical or logical network infrastructure.
- **Devices**: icon-like rects or rounded rects
  - Router: circle with cross arrows
  - Switch: rect with arrow grid
  - Server: stacked rect (rack icon)
  - Firewall: brick-pattern rect or shield shape
  - Load Balancer: horizontal split rect with arrows
  - Cloud: cloud path (overlapping arcs)
- **Connections**: lines between device centers
  - Ethernet/wired: solid line, label bandwidth
  - Wireless: dashed line with WiFi symbol
  - VPN: dashed line with lock icon
- **Subnets/Zones**: dashed rect containers with zone label (DMZ, Internal, External)
- **Labels**: device hostname + IP below, 12-13px
- Layout: tiered top-to-bottom (Internet → Edge → Core → Access → Endpoints)
- ViewBox: `0 0 960 600` standard
