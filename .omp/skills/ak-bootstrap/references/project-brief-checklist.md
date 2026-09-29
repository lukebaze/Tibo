# Project Brief Checklist

Use this during the opening brainstorm gate for every bootstrap. It is a
coverage check for the brainstorm contract, not a questionnaire: take every
answer the brief, the existing repositories, and live state already give, then
close the remaining gaps the way the opening gate's flags say (decide and
record an assumption by default, interview through `ak:advise` under `--ask`).

Always apply the core sections. Then identify the project's surfaces (a
project can have several, for example a web app with an API and an MCP server)
and apply only the matching surface sections.

The items below are topics to cover, not default deliverables. Carry every
item the brief, its sources or the user requires into the brainstorm contract
as a requirement with an observable acceptance check; do not add an item only
because it is listed here. Deliver the full requested scope; `--yagni` is the
only opt-in to cutting it.

## Core: every project

### Outcome and audience

- Who uses it, through which surfaces, and the one outcome that proves it works.
- Product family or ecosystem it belongs to, with the source repositories to
  read for accurate names, descriptions and integration points.

### Existing project, redesign or migration

- Name the old project, repositories and live endpoints, then inventory them
  before designing: assets, public interfaces, data, users, URLs or commands.
- Write an explicit keep list and rebuild list. Anything on neither list is a
  gap to close under the gate's rules.
- Preserve public contracts (URLs, API routes, CLI commands and flags, tool
  names, package names) or plan redirects, deprecations and migrations.
- Plan the cutover: the old version keeps serving until the new one is
  verified in its live target; record how traffic, DNS, routes or package
  channels move and how to roll back.

### Sources of truth

- Read linked sources: specs, decks, design documents, changelogs, diagrams.
- Do not invent history, people, metrics, quotes, customers, partners,
  features or benchmarks. Mark anything unverifiable as a placeholder in the
  contract rather than fabricating it.

### Repository, environments and delivery

- Repository: owner and name, visibility, default branch, protected branches,
  as stated in the brief. Route to `ak:github`.
- Environments and channels: map each branch to an environment or release
  channel (for example a staging branch to a staging target, the production
  branch to production; beta and stable package channels).
- Hosting, registries and stores the brief names; route to `ak:deploy` or
  `ak:devops`.
- CI: build, test, and deploy or publish per environment branch.
- Secrets: read from the environment or secret store the brief names; check
  presence without printing values; never commit them. Put CI secrets in the
  CI secret store.

### Collaborator and contract files

- Files the brief asks for (for example `AGENTS.md` for collaborator guidance,
  `REVIEW.md` for review criteria, `DESIGN.md` for a design system) are
  deliverables, not optional docs.
- User documentation for the chosen surfaces: install, configure, use.

### Legal and licensing

- License for published code or packages; terms, privacy and data-rights
  information when the project collects user data; store or registry policy
  requirements for the distribution channel.
- Mark generated legal text as needing owner review.

### Definition of done

Record the brief's definition of done verbatim. When it names a live target
(production, a store, a registry), done means released there and verified in
that target, with no known defects against the contract. The
verify-and-improve loop lives in `references/shared-phases.md`.

## Surface: website or web app

- Brand and art direction: personality words, tone, narrative sources,
  mascot or logo motion (respect reduced motion). Route visual work to
  `ak:frontend-design`.
- Page inventory the brief or real sources require (for example home,
  features with recent releases, use cases, architecture and security,
  integrations, deployment options, a changelog from repository releases by
  channel, partners, blog, docs, about, legal pages).
- Locales (default and additional, routing, switcher, `hreflang`), theme
  (system, light, dark, no flash), responsive targets (desktop, tablet,
  mobile).
- Discoverability: `sitemap.xml`, `robots.txt`, canonical URLs, structured
  data, Open Graph and social cards; `llms.txt`, `llms-full.txt` and Markdown
  twins (`<url>.md`) when requested (route to `ak:llms`); page actions such
  as copy as Markdown, open in an AI assistant, share.
- Brand short links (for example `/discord`) as server-side redirects, when
  the brief asks for them.
- Cookie consent, when the site sets non-essential cookies, defaults to
  declining them.
- Page builder with predefined blocks and layouts, when the brief asks for
  one: `ak:page-builder`.
- Frameworks: `ak:web-frameworks`.

## Surface: mobile app

- Platforms and minimum OS versions, native or cross-platform stack; route
  to `ak:mobile-development`.
- Target devices and orientations, offline behavior, push notifications,
  deep links, permissions and their rationale strings.
- Store listing assets, privacy disclosures, signing and provisioning, beta
  track (for example TestFlight or an internal testing track).

## Surface: CLI

- Command tree, flags, exit codes, machine-readable output (for example
  `--json`), non-interactive and CI behavior, config and credential
  locations.
- Supported operating systems and shells; install channels (package
  managers, release binaries, install script); self-update policy.
- Route agent-facing CLI design to `ak:agentize`.

## Surface: API or backend service

- Protocol (REST, GraphQL, gRPC, WebSocket), resource model, versioning,
  pagination and error shape; route to `ak:backend-development`.
- Authentication and authorization (`ak:better-auth` when it fits), rate
  limits, idempotency, audit logging.
- Data stores, schema and migrations with backups (`ak:databases`); payments
  when required (`ak:payment-integration`).
- Published API reference (for example OpenAPI) and health endpoint.

## Surface: MCP server

- Tools, resources and prompts with their names, input schemas and error
  behavior; route to `ak:mcp-builder`.
- Transport (stdio, streamable HTTP), authentication, the clients it must
  work with, and how users install or connect it.

## Surface: WebMCP

- Which page actions become agent tools, their schemas, and how they respect
  the signed-in user's permissions; route to `ak:webmcp`.

## Surface: library or SDK

- Public API, supported language and runtime versions, semver policy,
  package registry and name, generated reference docs, examples.

## Cross-surface: admin and agent access

- Admin access: take allowlisted administrator identities from the brief into
  configuration, not source; enforce authorization server-side; scope and
  revoke admin-created API keys.
- Agent access (API, CLI, MCP, WebMCP) that lets agents update content or
  data: authenticate and authorize it like any other client.
- Integrations the brief defers (for example a support chat that connects
  over WebSocket later): build the real seam and a disabled or clearly
  labeled state; do not ship a fake backend.

## Authorization boundary

A brief that explicitly requests an outward-facing action (creating a public
repository, protecting a branch, deploying, publishing a package or store
build, moving DNS or routes) authorizes that action for the stated target
only. Anything beyond it, such as deleting the old deployment, still needs its
own confirmation.
