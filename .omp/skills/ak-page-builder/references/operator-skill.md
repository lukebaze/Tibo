# Create the project's operator skill

Read this after the builder's interfaces are verified, or when their contracts
change. The output teaches agents to operate this particular builder without
reconstructing its architecture or reading the entire repository each time.

## Activate the creator

Resolve `ak-skill-creator` from the runtime's live installed-skill catalog and read
its complete instructions. Activate its create or update workflow for a
project-scoped operator skill. This activation is required; merely writing a
generic README or recommending the creator does not satisfy the deliverable.
If it is unavailable, search the actual project/install sources, report the
missing capability, and leave this deliverable explicitly incomplete while
finishing independent builder work. Do not silently claim equivalent completion.

Give the creator the project name, target app, intended agent audiences, actual
runtime discovery location, allowed operations, authorization boundaries, and
verified command/API/MCP documentation. Reuse an existing operator skill when it
owns this builder. Otherwise choose a distinct project-specific name, such as
`storefront-page-operator`; avoid a name/description that activates the builder
construction workflow during routine content editing.

Resolve the runtime's project skill location and namespace from its actual
conventions. Do not install globally, modify runtime homes or assume one path
works across all runtimes. Preserve hand-authored content during updates.

## Inputs and content

Supply observed evidence rather than anticipated interfaces:

- Executable CLI help, actual API base URL discovery, OpenAPI, MCP tool/resource
  descriptions and WebMCP capability checks.
- Auth setup using secure credential references; scopes, tenant selection,
  environment selection and production/draft distinctions.
- Tested normal workflow: discover blocks, read a page, change props/layout,
  bind data, validate, create/share preview, publish, inspect live state, rollback.
- Best practices for token-efficient discovery, stable node IDs, batching,
  concurrency, idempotency, bounded jobs and choosing the right interface.
- Widget size discovery and resize recipes through actual API/CLI/MCP tools:
  supported small/medium/large presentations, requested versus effective size,
  container-fit errors, preserved content and undo/conflict recovery. Refresh
  these recipes when sizing contracts change, using the installed creator.
- Troubleshooting grounded in observed failures: diagnosis, safe retry versus
  reconcile, verification after recovery and escalation when permissions lack.
- Links to authoritative schemas and docs, compatibility/version information,
  and a precise completion condition for each workflow.

Keep the entry skill short. Load operation recipes, API/CLI/MCP details and
troubleshooting on demand. Examples must run against the implemented builder;
identify environment-dependent values clearly and do not invent a universal
`ak page` command or unsupported tool. Avoid embedding full schemas or the
entire component catalog when an agent can discover them on demand.

The operator skill invokes existing tools for content changes. Route missing
blocks or renderer/contract changes back to `ak-page-builder` when installed,
or describe the needed development work. Do not recursively recreate either
skill on every page edit.

## Verify and refresh

Run the creator's structural validators and consumer evaluation. Give a fresh
agent the operator skill and a disposable project environment, then require real
artifacts for create/edit/reorder/preview and an authorized publish/rollback.
Include a stale revision, a recoverable transport failure and a forbidden action.
Compare with no skill or the previous operator version under matched conditions.
Never run mutation probes against production or real maintainer configuration.

Retain effective model/runtime, contract snapshot, commands/tool traces, output
artifacts and untested surfaces. A tool-call plan is not proof of execution.
If the runner or credentials are missing, report the uncovered cases precisely.

Refresh the operator skill when commands, schemas, scopes, transport behavior,
preview/publish semantics or recovery procedures change. Bump its version under
the creator's rules and rerun affected examples. No content-only edit should
trigger regeneration unless it changes operating guidance.
