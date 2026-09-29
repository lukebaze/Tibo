# Drafts, previews and publication

Read this when adding preview/publish behavior or operating those workflows.

Keep saved draft revisions separate from the published revision. Reuse the
production renderer for both, with explicit draft data selection. Validate
structure, required content, routes and bindings before creating a preview.

## Preview

Create links bound to a page and immutable revision. For private previews, use
scoped access or expiring, revocable credentials; do not log bearer links or
expose them through public discovery. Enforce tenant access and a private cache
policy. Keep preview responses out of public sitemap and LLM exports. Set
appropriate noindex headers/metadata, but never rely on robots rules as auth.

Record renderer/build identity and relevant registry versions with the preview.
Declare which data bindings are live and which are snapshotted. If a binding's
live data can change, explain that revision pinning does not freeze that data.
Preview changes that require a new build against that build, not the old renderer.

## Publish

Publish the authorized, validated revision, with a concurrency check on both the
draft and expected live state as appropriate. For dynamic delivery, promote the
revision atomically. For built delivery, stage and verify the artifact before
switching live routing. Keep the prior live version on validation/build failure.

Return a job handle while publishing. A successful queue request is not a live
page. Bind the result to the exact page revision, build/artifact, route and
deployment identity; verify the live response before marking publication done.
Retry cache invalidation or dependent exports explicitly without republishing a
different draft. Record partial states and recovery instructions.

Keep revision history, referenced assets and compatible renderers long enough to
support the promised rollback window. Rollback creates an auditable restoration
of a compatible version; reverting JSON alone may not restore old rendering.
Protect against concurrent publishers and do not delete assets still referenced
by retained revisions. Reuse existing redirects when a published slug changes.

## Evidence

Verify preview isolation, token expiry/revocation, cached access after revocation,
revision mismatch, failing build, repeated publish request and rollback. Compare
preview and published content for the same revision under the documented binding
policy. Check the old live page survives publication failure and public exports
contain only successful published revisions.
