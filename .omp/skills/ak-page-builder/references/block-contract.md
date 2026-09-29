# Register reusable blocks

Read this when integrating components or changing their configurable contract.

## Registry

Distinguish primitives (buttons/inputs), blocks (hero/pricing), layouts
(grid/section/shell), and templates (page compositions). Prefer meaningful blocks
for agent discovery. Register existing building blocks; create missing blocks from
the project's primitives when the requested page needs them.

For every exposed block, define:

| Contract | Required behavior |
|---|---|
| Stable type and version | Survive file moves; identify breaking prop changes |
| Purpose and examples | Explain suitable uses and valid combinations |
| Props schema | Validate types, required fields, enums, bounds and defaults |
| Slots | Name insertion regions; constrain child types and cardinality |
| Variants and tokens | Use existing design choices and responsive conventions |
| Widget sizing | Supported small/medium/large presentations, geometry, fit rules and resize constraints |
| Editor fields | Map serializable props to accessible controls and help |
| Render requirements | Declare providers, server/client boundaries and dependencies |
| Bindings and actions | Reference authorized registered data sources/actions |
| Markdown serializer | Preserve meaningful published content and links |
| Migration | Upgrade older stored instances without silent field loss |

Derive candidates from actual exports and stories, then verify their behavior.
Static prop extraction cannot establish business rules, callback semantics,
provider requirements or safe serialization of framework nodes.

Apply [widget-sizing.md](widget-sizing.md) when adapting existing components:
design useful presentations for each supported size, preserve shared content,
and expose sizing constraints to both the editor and agents.

Store data, not executable code, in a page document. Convert callbacks to
registered action references, children to slots, media to asset references, and
dynamic content to typed binding references. Resolve authorization on the server;
an editor's hidden field is not a security boundary. Avoid arbitrary script,
SQL, import-path or URL-fetch execution supplied by page content.

Give binding resolvers bounded results, timeout/cancellation behavior, tenant
scope, loading/empty/error states, cache policy and explicit live-versus-snapshot
semantics. Keep credentials in the server's secret facilities.

## Page document

Use the host's existing model if it can represent page identity, schema version,
route, locale, SEO metadata, immutable revisions and a tree of stable node IDs.
Each node references a registered block type/version, validated props and slots.
Persist references rather than compiled component source. Keep one authoritative
document; editor state and indexes are derived views.

Validate duplicate IDs, unknown types, invalid slots, cycles, excessive nesting,
oversized payloads, broken asset references and route/locale collisions. Use
budgets appropriate to the host instead of pretending every tree is small.

When a component changes, compare its registered contract with stored instances.
Run migrations against copies, report affected pages, and retain recoverable
originals. A missing block remains visible as an editor diagnostic with its data
intact; do not publish an invisible replacement for missing content.

## Evidence

Check at least one representative block with nested content and a data binding:
render, edit props, move, serialize, reload and render again. Verify existing
component tests still pass and the saved model has not lost unsupported fields.
Exercise a breaking prop migration and an unregistered block failure.
