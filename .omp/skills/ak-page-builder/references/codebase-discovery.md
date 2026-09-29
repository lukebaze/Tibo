# Discover the host project

Read this for initial integration or when the host stack changes. For ordinary
content edits, use the existing operator skill and live capability catalog.

## Inspect the actual owner

Find repository instructions, package/workspace manifests, app entry points,
routes, existing page builders/CMS, component exports, stories, tests, design
tokens, authentication, persistence, media storage and deployment configuration.
Scope inspection to the selected application and its dependencies. In a monorepo,
infer the application from the request and routes; ask only if ownership remains
ambiguous. Record source paths for conclusions instead of guessing from filenames.

Produce a compact integration map in the project's configured plan/report area:

| Evidence | Decision to settle |
|---|---|
| Framework, router, SSR/SSG/CSR and hydration | Renderer, route ownership and content delivery |
| Components, stories, tokens, layouts | Reusable blocks, variants and missing wrappers |
| Props, slots, providers, server dependencies | Serializable contract and adapter boundaries |
| CMS/database/auth/assets | Existing owners to extend, identity and tenant boundaries |
| Build, deploy, cache and domains | Draft preview, publication and invalidation |
| Existing CLI/API/MCP and docs | Operations to reuse and missing interfaces |

Mark each capability as verified, needs implementation, or blocked with a reason.
Resolve dependencies from manifests and installed versions. Read current official
documentation for APIs that affect the chosen integration; do not infer support
from an example for another framework or runtime.

## Choose the smallest complete integration

- Extend the existing builder or CMS when it can meet the accepted contract.
  Keep one authoritative page store; do not introduce a parallel content database.
- Reuse the host's components, tokens, router, auth and storage. Wrap components
  when necessary; avoid rewriting them or introducing a second styling system.
- Evaluate an existing editor before building one. Puck is a candidate for React
  component composition; GrapesJS is a candidate for HTML-oriented templates.
  Neither choice establishes compatibility with an unread codebase.
- Keep framework rendering separate from page operations and transport adapters.
  Reuse an editor data model if it meets revision, identity, migration and
  round-trip requirements; otherwise document the required conversion boundary.
- For unsupported stacks, implement and verify the required adapter in the
  project. Preserve the full requested outcome and report genuine blockers;
  do not silently substitute a static HTML demo or claim universal support.

Before choosing an editor, exercise a representative real component with its
providers, nested content and server dependencies. Verify render/edit/serialize/
reload before scaling registration to the remaining components.

Keep code-generation ownership explicit. On reruns, compare owned output and
preserve user edits. Use scoped merges or migrations; snapshot before destructive
changes. Never reset runtime homes or replace an application's configuration tree.

## Official starting points

- [Puck](https://puckeditor.com/docs): component configuration and editor integration.
- [GrapesJS](https://grapesjs.com/docs/): HTML-oriented editor framework.

Resolve framework-specific guidance from the installed skill catalog only when
the selected implementation needs it.
