# Deployment Guide (MCP)

Use this recipe only for a selected remote deployment. Cloudflare Workers is a named preset; Docker or PaaS may fit the existing target better. Check installed SDK/runtime support and current provider documentation before applying example configuration.

## 1. Cloudflare Workers preset

Best for: Global edge deployment, instant scaling, low maintenance, and native OAuth 2.1 integration.

`wrangler.toml`:

```toml
name = "<tool>-mcp"
main = "dist/worker.js"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]

# Optional: Durable Objects for multi-step application state
[[durable_objects.bindings]]
name = "MCP_STATE"
class_name = "ApplicationStateDO"

[[migrations]]
tag = "v1"
new_classes = ["ApplicationStateDO"]

[vars]
MCP_TRANSPORT = "http"
```

### Architecture on Cloudflare
- **Stateless default:** Streamable HTTP (`POST /mcp`) executes directly inside standard Worker compute. Every request is self-contained.
- **Application state via Durable Objects:** When tools require continuity across calls (e.g. multi-step transactions or staged approvals), the server issues an explicit application handle (e.g. `handle_id: "app_123"`). Subsequent tool invocations pass this handle, and the Worker routes to `ApplicationStateDO.get(id)`. Follow the negotiated protocol transport lifecycle separately.
- **Secrets:** Inject secrets via `wrangler secret put API_KEY` or `wrangler secret put OAUTH_CLIENT_SECRET`. Never hardcode secrets in `wrangler.toml`.
- **Zero Trust & OAuth:** Pair with `workers-oauth-provider` and Cloudflare Access for enterprise SSO and RFC 9728 metadata (see `oauth-streamable-http.md`).
- **Code Mode:** For large tool catalogs, run `@cloudflare/codemode` with Dynamic Workers to allow LLMs to write sandboxed orchestration scripts, when measured workload evidence justifies the additional execution surface (see `code-mode.md`).

Deploy command: `wrangler deploy`.

## 2. Docker (Secondary / Self-Hosted)

Best for: Air-gapped environments, on-premise deployments, or custom binary dependencies.

`Dockerfile`:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm i --frozen-lockfile
COPY . .
RUN pnpm -C packages/mcp build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/packages/mcp/dist ./dist
COPY --from=build --chown=app:app /app/packages/mcp/package.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
USER app
EXPOSE 8080
ENV MCP_TRANSPORT=http PORT=8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/bin.js"]
```

Publish image to GHCR (`ghcr.io/<org>/<tool>-mcp`) from `.github/workflows/release.yml`.

## 3. PaaS (Fly.io, Railway, Render)

Any standard container or Node runtime hosting Streamable HTTP:
- **Fly.io**: `fly launch` with Dockerfile; set secrets with `fly secrets set`.
- **Railway**: Connect repo; set `MCP_TRANSPORT=http`; inject secrets via environment variables.
- **Render**: Web Service with Docker runtime; health check endpoint `/healthz`.

All targets: Bind `0.0.0.0`, listen on `process.env.PORT`, emit structured logs to stderr.

## Cross-cutting operational rules

- **TLS:** Terminated at edge (Cloudflare / PaaS proxy). Do not configure custom SSL/TLS certificates inside the application.
- **Health Checks:** Expose `GET /healthz` (200 OK) for container and edge liveness probes.
- **Rate Limiting:** Implement per-token or per-tenant rate limits in application middleware.
- **Observability:** Stream structured JSON logs to `stderr` or send traces via OpenTelemetry. Do not use deprecated in-band protocol logging notifications.

## Local development

```bash
pnpm -C packages/mcp dev                      # stdio mode (local agent testing)
pnpm -C packages/mcp dev -- --transport http  # Streamable HTTP on port 8080
```
