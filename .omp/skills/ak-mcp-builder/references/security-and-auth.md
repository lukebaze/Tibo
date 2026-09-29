# Security and authorization

Applies to every MCP server; authorization applies to HTTP servers. stdio servers take
credentials from environment variables and never implement OAuth. Spec sources:
https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization and
https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices

## Threat checklist

| Risk | Required behavior |
|---|---|
| Token passthrough | Never forward the client's MCP token to an upstream API. Validate it, then call upstream with the server's own credentials or a token obtained for that upstream (token exchange / separate OAuth). |
| Wrong audience | Accept only tokens issued for this server (RFC 8707 `resource` / JWT `aud`). Reject tokens minted for other resources. |
| Missing or bad token | `401` with `WWW-Authenticate: Bearer resource_metadata="..."`. |
| Missing scope | `403` with `error="insufficient_scope"` and the complete scope set the operation needs, so the client can step up once. |
| Token leakage | Tokens only in the `Authorization` header, never in query strings, logs, tool results, or error text. |
| DNS rebinding | Validate `Origin` (respond `403` to foreign origins) and `Host`; bind local servers to `127.0.0.1`, not `0.0.0.0`. |
| Confused deputy (proxy servers) | When proxying a third-party API that has a static OAuth client ID, obtain per-user consent before forwarding to the third-party authorization server; validate redirect URIs exactly; bind `state` to the user session. |
| SSRF | Tools that fetch URLs: allowlist schemes and hosts, block private, loopback, and link-local ranges after DNS resolution, cap redirects and response size. |
| Session or state hijack | Never treat a session ID, `requestState`, or pagination cursor as authentication. Re-check authorization on every request; sign (and if sensitive, encrypt) state that round-trips through the client. |
| Secrets through the model | Never elicit passwords, API keys, or payment data via form elicitation. Use URL-mode elicitation to a page the server controls. |
| Prompt injection via data | Upstream content is untrusted. Keep destructive tools annotated, require confirmation, and avoid echoing raw upstream instructions into descriptions. |
| Local server compromise | stdio servers run with user privileges: minimize filesystem and command access, validate paths against allowed roots, never run shell strings built from arguments. |

## Authorization model (HTTP)

- The MCP server is an OAuth 2.1 **resource server**. A separate authorization server (AS)
  issues tokens. Embedding an AS in the MCP server is discouraged.
- Publish RFC 9728 Protected Resource Metadata at
  `/.well-known/oauth-protected-resource<path>` listing `authorization_servers` and a
  minimal `scopes_supported`.
- Clients discover the AS through that metadata, register via Client ID Metadata Documents
  (CIMD; Dynamic Client Registration is deprecated), and request tokens with the
  `resource` parameter set to the server URL.
- Scope design: start with a minimal read scope; require write or admin scopes per tool
  through a scope challenge instead of demanding every scope up front.

## TypeScript (`@modelcontextprotocol/server` v2)

Verified: metadata `200`, missing or invalid token `401`, token without `users:write`
calling the tool `403` with `scope="users:read users:write"`, full scopes `200`.

```typescript
import { createServer } from "node:http";
import * as z from "zod/v4";
import {
  McpServer, OAuthError, OAuthErrorCode, createMcpHandler,
  getOAuthProtectedResourceMetadataUrl, oauthMetadataResponse,
  requireBearerAuth, requireScopes, type AuthInfo, type OAuthTokenVerifier
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";

const RESOURCE = new URL("https://mcp.example.com/mcp");
const ISSUER = "https://auth.example.com";

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token): Promise<AuthInfo> {
    const claims = await verifyJwt(token, RESOURCE.href); // signature, issuer, expiry, audience
    if (!claims) throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or expired token");
    // expiresAt is required: tokens without it are rejected.
    return { token, clientId: claims.sub, scopes: claims.scope.split(" "), expiresAt: claims.exp, resource: RESOURCE };
  }
};

const asResponse = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(10_000) });
if (!asResponse.ok) throw new Error(`authorization server metadata: HTTP ${asResponse.status}`);
const oauthMetadata = await asResponse.json();
const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(RESOURCE);
const gate = requireBearerAuth({ verifier, requiredScopes: ["users:read"], resourceMetadataUrl });

function buildServer() {
  const server = new McpServer({ name: "example-mcp-server", version: "1.0.0" });
  server.registerTool(
    "example_deactivate_user",
    {
      description: "Deactivate one user.",
      inputSchema: z.object({ user_id: z.string() }),
      annotations: { destructiveHint: true },
      scopeChallenge: requireScopes("users:read", "users:write") // 403 step-up for this tool only
    },
    // Scope demo only: a real handler confirms and calls upstream as in typescript-server.md.
    async ({ user_id }, ctx) => {
      const caller = ctx.http?.authInfo?.clientId;
      return { content: [{ type: "text", text: `User ${user_id} deactivated by ${caller}.` }] };
    }
  );
  return server;
}

const handler = createMcpHandler(buildServer);

async function fetchHandler(request: Request): Promise<Response> {
  const metadata = oauthMetadataResponse(request, {
    oauthMetadata,
    resourceServerUrl: RESOURCE,
    scopesSupported: ["users:read", "users:write"]
  });
  if (metadata) return metadata;
  const auth = await gate(request);
  if (auth instanceof Response) return auth; // 401/403 with WWW-Authenticate
  return handler.fetch(request, { authInfo: auth });
}

createServer(toNodeHandler({ fetch: fetchHandler })).listen(3000, "127.0.0.1");
```

`verifyJwt` stands for the project's JWT or introspection library; JWT `aud` may be a string
or a list, so check membership rather than equality. Always add Host/Origin validation as in
`typescript-server.md`, with an explicit allowlist for non-loopback hosts.
`requireScopes` also works on `registerResource` via `scopeChallenge`. Express users can
use `mcpAuthMetadataRouter` and the Express `requireBearerAuth` adapter instead.

## Python (`mcp` v2)

`MCPServer(token_verifier=..., auth=AuthSettings(...))`; see the example in
`python-server.md`. The SDK serves the metadata, returns `401`/`403` with the challenge,
and exposes the caller through `get_access_token()`. Return `None` from `verify_token`
for invalid tokens, fill `expires_at` and `resource`, and set
`validate_token_resource=True` when the AS binds tokens to the requested resource.
The SDK enforces only `required_scopes` at the HTTP layer; it has no per-tool step-up
challenge. Check extra per-tool scopes inside the tool with `get_access_token()` and raise
`ToolError` naming the missing scope (the client sees a tool error, not a `403`).

## Upstream credentials

- stdio: read keys from environment variables (`EXAMPLE_API_KEY`); fail fast with a clear
  message when missing; never log them.
- HTTP multi-user: map the authenticated caller to their own upstream credential (token
  exchange, per-user OAuth grant stored server-side, or a scoped service account). Never
  share one privileged upstream key across callers unless every caller is allowed
  everything that key can do.
- Redact secrets from tool errors: log details to stderr and return an actionable,
  secret-free message.

## Review before shipping

- [ ] No token passthrough; audience validated; `expiresAt`/`expires_at` set.
- [ ] 401 and 403 responses carry `resource_metadata`; 403 lists the full scope set.
- [ ] Origin and Host validated; local servers bound to `127.0.0.1`.
- [ ] Destructive tools annotated and confirmed; no secrets requested via form elicitation.
- [ ] URL-fetching tools block private networks; file tools confine paths.
- [ ] Logs and tool results contain no tokens, keys, or personal data beyond need.
