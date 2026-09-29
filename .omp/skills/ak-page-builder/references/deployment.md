# Deploy MCP with Cloudflare first

Read this when preparing the requested deployment. Deployment authorization and
credential availability are separate from generating a deployable project.
Proceed under existing authorization; do not add repeated approval gates.

## Boundary

Prefer Cloudflare Workers for the remote MCP entrypoint. Keep the host application,
renderer and page service where they already run unless the user requests a move.
A Worker can call the existing service with scoped identity; it cannot directly
read a user's local project filesystem. Local-only projects need an explicitly
configured, authorized bridge or a reachable deployed API before remote use.

Resolve current Cloudflare MCP APIs and supported SDK versions from official
docs. Use Streamable HTTP for remote MCP and stdio for a local process adapter.
Do not start from a legacy transport example without checking its current status.
Keep credentials in the platform secret facility and verify auth/discovery with
the intended clients. Forward principal/tenant identity without confused-deputy
access or arbitrary upstream URL selection.

Reuse existing storage. Add D1, R2, Durable Objects or queues only for a concrete
persistence, asset, coordination or job requirement; MCP alone does not require
all of them. Check Worker limits, streaming/cancellation, network access and
dependency compatibility. Run application builds on compatible build infrastructure
instead of assuming a Worker can execute the project's package manager.

## Portable delivery

Keep page operations and storage/render/publish adapters independent of the
Cloudflare request entrypoint. Retain local development and automated deployment
configuration with documented secret names and environment selection.

Cloudflare is the initial deployment target. Add Vercel, Railway, TOSE.sh and
self-host adapters later when requested, verifying their actual runtime/storage/
streaming/auth contracts. Do not advertise an untested platform as supported.
Avoid forcing an npm monorepo or TypeScript backend onto a non-JavaScript host;
a small remote gateway may call the host's existing service.

## Verify and hand over

Validate configuration and local transport behavior, deploy to the authorized
test environment, then check TLS, discovery, tools/list, authenticated calls,
tenant denial, reconnect, job status and a disposable draft/preview workflow.
Verify publication only within the authorized environment. Record deployment URL,
artifact/config identity, observed client compatibility and rollback procedure.
Missing credentials leave live deployment unverified, not successfully shipped.

Track any development servers you start, reuse the project's port where possible
and stop owned processes when finished. Never abandon servers by cycling ports.
Feed verified endpoints and recovery commands into the generated operator skill.

- [Cloudflare MCP transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/)
- [Cloudflare remote MCP guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
