# Typed IR constraints and reader controls

Consult for the selected archetype; compiler validation remains required.

## Schema Cheat Sheet & Valid Enums

### 1. Architecture (`diagram_type: "architecture"`)
- `components[]` (1–250): `role`: `frontend` | `backend` | `database` | `cache` | `queue` | `storage` | `gateway` | `auth` | `external` | `worker` (default `backend`). `layer`: integer 0–10.
- `boundaries[]`: `role`: `cloud` | `vpc` | `cluster` | `trust-boundary` | `private-network` | `external-zone`.
- `connections[]` ($\le 1000$): `kind`: `sync` | `async` | `stream` | `fallback` | `bi-directional`.

### 2. Workflow (`diagram_type: "workflow"`)
- `lanes[]`: `role`: `user` | `frontend` | `orchestrator` | `worker` | `approver` | `system`.
- `steps[]` (1–250): `kind`: `start` | `action` | `decision` | `wait` | `subprocess` | `terminal-success` | `terminal-failure`.
- `transitions[]` ($\le 1000$): `kind`: `normal` | `branch-true` | `branch-false` | `retry` | `exception`.

### 3. Sequence (`diagram_type: "sequence"`)
- `participants[]` (2–50): `role`: `client` | `service` | `database` | `gateway` | `external` | `queue`.
- `messages[]` (1–500): `kind`: `sync-call` | `async-signal` | `return` | `self-call` | `error` (`return` and `async-signal` render dashed, `return` with an open arrowhead, `error` in the failure tone; `sync-call` opens an activation bar closed by the next `return`).

### 4. Dataflow (`diagram_type: "dataflow"`)
- `stages[]`: `id`, `label`, `order` (integer).
- `nodes[]` (1–250): `role`: `source` | `transform` | `store` | `sink` | `consumer` | `filter` | `governance`. `classification`: `public` | `internal` | `confidential` | `pii` | `restricted`.
- `flows[]` ($\le 1000$): `from`, `to`, `label`.

### 5. Lifecycle (`diagram_type: "lifecycle"`)
- `states[]` (1–250): `kind`: `initial` | `active` | `waiting` | `failure-recoverable` | `failure-fatal` | `terminal-success` | `terminal-cancelled`.
- `transitions[]` ($\le 1000$): `kind`: `normal` | `retry` | `timeout` | `cancel` | `fail`.

## Grounded Reader Shortcuts

Interactive HTML readers include built-in client-side capabilities operating on authored topology:
- **Search (`/`)**: Case-folded label and ID search with highlight.
- **Node Focus (Click)**: Isolates component and direct edges.
- **Shortest Route (`R`)**: Highlights BFS shortest path between two selected nodes.
- **Role Lens (`L`)**: Filters nodes by semantic role (`gateway`, `database`, etc.).
- **Presentation Stage (`F`)**: Toggles distraction-free full-window view (`Esc` to exit).
- **Guided Stories (`[` / `]`)**: Advances through authored `meta.views` chapters.
- **Theme Toggle (`☀️/🌙`)**: Switches between light and dark palette without geometry shift.
- **Replay Motion (`M`)**: Re-arms the finite entrance and trace pass.
