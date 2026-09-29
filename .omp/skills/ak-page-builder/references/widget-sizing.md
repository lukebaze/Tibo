# Resizable widgets and adaptive presentation

Read this when adapting existing components, designing layouts, or changing a
block's size through the editor or agent interfaces.

## Size families

Design composable blocks to support small, medium and large presentations where
their content permits. Inspect existing variants before adding wrappers or
presentations. Declare supported sizes per block; a component with intrinsic
constraints may support fewer sizes, with an explicit reason and useful fallback.
Do not force identical behavior or duplicate components just to fill a size roster.

Treat size as a semantic layout/presentation contract. Small can show a concise
summary, medium a richer overview, and large detailed content or interactions.
For example, one product widget can show image/title/price at small, add a summary
at medium, and show its full comparison/details at large. Reuse the same content
and binding identity across these presentations; resizing must not delete fields,
reset user input, create another node or change a query without an explicit rule.

Keep content, visual variant, requested size and effective presentation distinct.
A color/style variant is not a size. A mobile viewport is not automatically a
small widget: select presentation using the available container dimensions and
the block's size contract, including narrow slots inside wide desktop pages.

## Registry and persisted model

Extend the host's existing layout schema rather than inventing a second one.
For each resizable block, expose:

| Field responsibility | Contract |
|---|---|
| Supported sizes and default | Stable semantic IDs such as small/medium/large |
| Size geometry | Grid spans or container constraints, minimum/maximum extents and aspect ratio when relevant |
| Presentation mapping | Content priority and interactions available in each size |
| Resize behavior | Allowed axes, snap points, permitted parent slots and reflow/collision policy |
| Responsive resolution | Deterministic fit/fallback rules and any explicit breakpoint overrides |
| Migration | Default for older nodes and recovery when a size is renamed or removed |

Persist the requested semantic size and supported layout constraints/overrides.
Derive effective presentation from the resolved container; do not autosave a new
requested size simply because a viewport changed. Keep derived dimensions out of
canonical content unless the project explicitly supports freeform sizing.

Prefer discrete snap sizes for the widget experience. Freeform width/height is
an extension when requested or already supported; it still needs bounds and
deterministic presentation thresholds. Do not scale the entire component with a
CSS transform or crop its content to simulate a smaller presentation.

Choose and document what happens if a requested size cannot fit: reflow within
the allowed parent, use a declared effective fallback while retaining the request,
or reject the placement. Surface the result to humans and agents. If no supported
size fits, keep a recoverable diagnostic rather than silently corrupting layout.
Do not move locked siblings, overflow a slot or change reading order implicitly.

## Rendering and content integrity

Use the same resolver in preview and public rendering. Account for height as well
as width where the contract requires it, including minimum readable text sizes,
localization, zoom, and data-loading/error states. Avoid resize/measurement loops
and hydration jumps: give server rendering a documented deterministic initial
layout, reconcile container measurements without changing stored content, and
test boundary widths/heights. Avoid mounting all presentations with duplicated
DOM IDs, hidden focus targets, data requests or form side effects.

Keep essential actions available or provide a clear route to the fuller view.
Presentation-dependent omission is not deletion or an authorization boundary.
Ensure Markdown retains the canonical meaningful published content under the
same access policy, and never fabricate SEO claims from hidden presentations.

## Operator handover

Changing supported sizes or resize behavior changes the operating contract.
After verifying the interfaces, activate the installed `ak-skill-creator` to
refresh the project operator skill using [operator-skill.md](operator-skill.md).
Include size discovery, actual resize recipes, requested/effective-size feedback,
fit errors and conflict troubleshooting. In a design-only task, put this required
handover in the implementation plan without claiming creator execution.

## Evidence

Verify small -> medium -> large -> small preserves node ID, props, bindings,
unsaved field values and retained nested content. Exercise identical blocks in
different-width containers on the same viewport, incompatible parent slots,
unsupported size requests, sibling reflow, zoom and long translated text.
Check editor/preview/public parity, save/reload, migration, undo/redo, cancelled
gestures and stale-revision resize conflicts. Record actual device/runtime
coverage; a written size specification is not proof of a working resize control.
