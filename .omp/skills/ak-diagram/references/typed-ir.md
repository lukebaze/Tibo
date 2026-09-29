# Typed JSON Intermediate Representation (IR) Guide

The `ak:diagram` skill compiles typed JSON IR into deterministic SVG and interactive, self-contained HTML readers without requiring a browser or external network access.

## IR Document Structure

Every typed diagram specification starts with a common envelope:

```json
{
  "schema_version": 1,
  "diagram_type": "architecture | workflow | sequence | dataflow | lifecycle",
  "meta": {
    "title": "System Overview",
    "subtitle": "Optional subtitle",
    "description": "Short description for a11y",
    "locale": "en",
    "visual_preset": "classic | signal-flow | blueprint | editorial",
    "theme": "light | dark",
    "animation": "none | trace",
    "views": [
      {
        "id": "chapter-1",
        "title": "Core Ingestion",
        "narrative": "How traffic enters the system",
        "focus_nodes": ["api-gateway", "auth-service"]
      }
    ]
  }
}
```

## The Five Archetypes

### 1. Architecture (`architecture`)
Visualizes components, boundaries, and directional connections.
```json
{
  "schema_version": 1,
  "diagram_type": "architecture",
  "meta": { "title": "Microservice Architecture" },
  "components": [
    { "id": "gw", "label": "API Gateway", "role": "gateway", "layer": 0 },
    { "id": "auth", "label": "Auth Service", "role": "auth", "layer": 1 },
    { "id": "db", "label": "PostgreSQL", "role": "database", "layer": 2 }
  ],
  "boundaries": [
    { "id": "vpc-main", "label": "Production VPC", "role": "vpc", "components": ["gw", "auth", "db"] }
  ],
  "connections": [
    { "from": "gw", "to": "auth", "label": "Validate Token", "kind": "sync" },
    { "from": "auth", "to": "db", "label": "Query Users", "kind": "sync" }
  ]
}
```

### 2. Workflow (`workflow`)
Visualizes steps, lanes, decisions, and outcomes.
```json
{
  "schema_version": 1,
  "diagram_type": "workflow",
  "meta": { "title": "Deployment Pipeline" },
  "lanes": [
    { "id": "ci", "label": "CI System", "role": "system" },
    { "id": "lead", "label": "Release Lead", "role": "approver" }
  ],
  "steps": [
    { "id": "build", "label": "Build Artifacts", "lane": "ci", "kind": "action" },
    { "id": "review", "label": "Approve Release", "lane": "lead", "kind": "decision" },
    { "id": "deploy", "label": "Deploy to Prod", "lane": "ci", "kind": "terminal-success" }
  ],
  "transitions": [
    { "from": "build", "to": "review", "label": "Ready" },
    { "from": "review", "to": "deploy", "label": "Approved", "kind": "branch-true" }
  ]
}
```

### 3. Sequence (`sequence`)
Visualizes ordered interactions between participants over time.
```json
{
  "schema_version": 1,
  "diagram_type": "sequence",
  "meta": { "title": "User Authentication" },
  "participants": [
    { "id": "client", "label": "Web Client", "role": "client" },
    { "id": "api", "label": "API Server", "role": "gateway" },
    { "id": "idp", "label": "OAuth Provider", "role": "external" }
  ],
  "messages": [
    { "from": "client", "to": "api", "label": "POST /login", "kind": "sync-call" },
    { "from": "api", "to": "idp", "label": "Verify Token", "kind": "sync-call" },
    { "from": "idp", "to": "api", "label": "Token Valid", "kind": "return" },
    { "from": "api", "to": "client", "label": "Set-Cookie", "kind": "return" }
  ]
}
```

### 4. Dataflow (`dataflow`)
Visualizes data pipelines, transformations, stores, and lineage.
```json
{
  "schema_version": 1,
  "diagram_type": "dataflow",
  "meta": { "title": "Analytics Pipeline" },
  "stages": [
    { "id": "ingest", "label": "Ingestion", "order": 0 },
    { "id": "process", "label": "Processing", "order": 1 },
    { "id": "store", "label": "Warehouse", "order": 2 }
  ],
  "nodes": [
    { "id": "events", "label": "Clickstream", "role": "source", "stage": "ingest" },
    { "id": "spark", "label": "ETL Job", "role": "transform", "stage": "process" },
    { "id": "lake", "label": "Data Lake", "role": "store", "stage": "store" }
  ],
  "flows": [
    { "from": "events", "to": "spark", "label": "Kafka Stream" },
    { "from": "spark", "to": "lake", "label": "Parquet Files" }
  ]
}
```

### 5. Lifecycle (`lifecycle`)
Visualizes state machines, status transitions, retries, and terminal outcomes.
```json
{
  "schema_version": 1,
  "diagram_type": "lifecycle",
  "meta": { "title": "Payment Lifecycle" },
  "states": [
    { "id": "created", "label": "Created", "kind": "initial" },
    { "id": "processing", "label": "Processing", "kind": "active" },
    { "id": "settled", "label": "Settled", "kind": "terminal-success" },
    { "id": "failed", "label": "Failed", "kind": "failure-recoverable" }
  ],
  "transitions": [
    { "from": "created", "to": "processing", "event": "Submit" },
    { "from": "processing", "to": "settled", "event": "Charge Success" },
    { "from": "processing", "to": "failed", "event": "Network Error", "kind": "retry" },
    { "from": "failed", "to": "processing", "event": "Retry Charge", "kind": "retry" }
  ]
}
```

## Layout semantics (what the compiler does with the IR)

Authors never supply coordinates. The compiler derives geometry from the fields above:

| Archetype | Column (rank) | Row / grouping | Frames |
|---|---|---|---|
| `architecture` | `layer` when given, else longest path from sources | barycenter ordering, boundary members kept adjacent | `boundaries` as dashed frames |
| `workflow` | longest path from `start` steps | `lane` (authored order); steps sharing a lane and rank stack vertically | `lanes` as full-width rows |
| `dataflow` | `stage.order` (nodes without a stage join a trailing `Processing` stage) | barycenter ordering | `stages` as column frames |
| `lifecycle` | longest path from `initial` states | barycenter ordering | none |
| `sequence` | participant order | message order, one row per message; `sync-call` opens an activation closed by the next `return` | none |

Edges leave the right side and enter the left side of nodes with ports spread by target position, turn inside the gap between columns, detour above or below the blocking band when a straight run would cross an unrelated node, and loop back through a corridor for cycles. Labels sit on the last horizontal run that fits them and are pushed apart when they would overlap.
