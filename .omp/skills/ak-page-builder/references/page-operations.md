# Page operations and concurrency

Read this when building the service or making content changes through its tools.

## One operation boundary

Put validation, identity, authorization, tenant scoping, revision checks and
persistence in a shared service boundary. Editor, API, CLI, MCP and WebMCP use it;
client-side validation improves feedback but never replaces server validation.
For different languages, share machine-readable contracts and call the service
instead of copying business logic into every transport.

Expose semantic operations for capability discovery, block search/description,
page read/create, batched changes, validation/diff, preview, publication, job
status and rollback. Name them according to the host's conventions. These are
operation responsibilities, not prescribed protocol methods or existing commands.

Address nodes by stable IDs and slots, not visual coordinates or array positions.
Support inserting, moving, removing and duplicating nodes, setting props,
binding data, resizing widgets and changing page metadata. Return generated IDs explicitly.

Expose supported sizes/constraints through block discovery. A resize operation
targets a stable node and requested semantic size, with the same revision,
authorization and idempotency rules as other changes. Validate registry support
and parent geometry; report requested/effective size, fallback reason and any
affected sibling layout. Preserve content and bindings. Use the shared sizing
resolver and predictable reflow policy from [widget-sizing.md](widget-sizing.md);
reject unsupported requests with allowed alternatives instead of silently
coercing them. Editor handles and API/CLI/MCP/WebMCP call this same operation.

Illustrative mutation payload; adapt it to the implemented API:

```json
{
  "pageId": "pricing",
  "baseRevision": 12,
  "idempotencyKey": "edit-request-123",
  "operations": [
    {"op": "setProps", "nodeId": "hero", "props": {"title": "Team plans"}},
    {"op": "move", "nodeId": "faq", "afterNodeId": "pricing-table"}
  ]
}
```

Validate a batch before mutation and commit atomically within the page store.
Tie idempotency records to principal, tenant, operation and payload hash; reusing
a key with a different payload is an error. Persist successful receipts so a
retry after a lost response returns the same revision rather than repeating work.

Use optimistic concurrency. On a stale revision, return a structured conflict,
current revision and a bounded diff. Re-read and reconcile the user's intended
changes; do not blindly retry with the new revision or overwrite another editor.
Make undo/redo revision-aware so it cannot erase another user's intervening work.

## Agent and human feedback

Return operation ID, page/revision IDs, changed-node summary and warnings. Allow
expanded documents/diffs on demand. Errors identify a stable code, field or node,
retryability and a useful recovery action without leaking private content.

Use asynchronous job handles for build/deploy work. Expose progress, cancellation
where supported and terminal results. Distinguish queued, running, failed and
published states. Idempotency covers job creation as well as final publication.

Apply existing authorization to every interface, including preview reads and
Markdown. Scope read, draft edit and publish independently. Honor the user's
authorization for routine reversible operations; do not add per-operation
confirmation dialogs. Destructive overwrites require the host's scoped recovery
and approval policy. Never infer publish authorization solely from draft access.

## Verify

Exercise a valid mixed batch, malformed props, invalid slot, same-key retry,
different-payload key reuse, stale revision, unauthorized tenant and lost-response
recovery, unsupported sizes and concurrent resize/edit. Compare outcomes through
each implemented transport. A service unit
test alone does not prove CLI/MCP authentication or serialization parity.
