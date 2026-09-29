# TypeScript server (SDK v2)

Verified against `@modelcontextprotocol/server` 2.1.0, `@modelcontextprotocol/node` 2.1.0,
zod 4.6, TypeScript 7.0 (strict), Node 24, and MCP Inspector 2.8.0. Check the installed
version before copying: `npm ls @modelcontextprotocol/server`.
Docs: https://ts.sdk.modelcontextprotocol.io/v2/

## Packages

| Package | Use |
|---|---|
| `@modelcontextprotocol/server` | `McpServer`, `createMcpHandler`, MRTR and auth helpers |
| `@modelcontextprotocol/server/stdio` | `serveStdio` |
| `@modelcontextprotocol/node` | `toNodeHandler`, `localhostHostValidation`, `localhostOriginValidation` |
| `@modelcontextprotocol/express` / `hono` / `fastify` | Framework adapters; `createMcpExpressApp` and siblings arm Host/Origin checks on localhost binds |
| `@modelcontextprotocol/client` | Tests and harnesses |

Requirements: Node ≥ 20, ESM, `zod` ^4.2 imported as `import * as z from "zod/v4"`.
Zod v3 and raw-shape `inputSchema` objects are not supported; pass `z.object(...)`.
`@modelcontextprotocol/sdk` (v1) is maintenance-only; migrate with the codemod described in
`protocol-2026-07-28.md`.

## Project setup

`package.json` essentials:

```json
{
  "name": "example-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "bin": { "example-mcp-server": "build/index.js" },
  "scripts": { "build": "tsc", "start": "node build/index.js" },
  "engines": { "node": ">=20" },
  "dependencies": { "@modelcontextprotocol/node": "^2.1.0", "@modelcontextprotocol/server": "^2.1.0", "zod": "^4.2.0" },
  "devDependencies": { "@types/node": "^24.0.0", "typescript": "^7.0.0" }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "Node16", "moduleResolution": "Node16", "outDir": "./build",
    "rootDir": "./src", "strict": true, "skipLibCheck": true, "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

TypeScript ≥ 6 does not auto-include `@types/*`; keep `"types": ["node"]`.

## Complete example (`src/index.ts`)

One factory builds the server. `serveStdio` calls it for the connection; `createMcpHandler`
calls it **per HTTP request**, so never keep per-client state in module variables. The
example shows structured output, bounded pages, actionable tool errors, confirmation through
elicitation (a model-supplied `confirm` counts only for clients that cannot prompt), and
localhost-safe HTTP.

```typescript
#!/usr/bin/env node
import { createServer } from "node:http";
import {
  acceptedContent,
  CLIENT_CAPABILITIES_META_KEY,
  createMcpHandler,
  inputRequired, inputResponse,
  McpServer,
  type CallToolResult,
  type ClientCapabilities,
  type InputRequiredResult
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

const API_BASE_URL = process.env.EXAMPLE_API_URL ?? "https://api.example.com/v1";
const CHARACTER_LIMIT = 25_000;

// ---- shared helpers -------------------------------------------------------

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.EXAMPLE_API_KEY}`, Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return (await response.json()) as T;
}

class ApiError extends Error {
  constructor(readonly status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

function toolError(error: unknown): CallToolResult {
  let text = "Error: unexpected failure. Retry once, then report the problem.";
  if (error instanceof ApiError) {
    text =
      error.status === 404 ? "Error: not found. Check the ID with example_search_users." :
      error.status === 403 ? "Error: permission denied for this account." :
      error.status === 429 ? "Error: rate limited. Wait before retrying." :
      `Error: upstream API failed with status ${error.status}.`;
  } else if (error instanceof Error && error.name === "TimeoutError") {
    text = "Error: upstream API timed out. Retry with a smaller limit.";
  }
  console.error(error); // details stay in server logs (stderr)
  return { content: [{ type: "text", text }], isError: true };
}

// 2026-era requests carry capabilities per request; 2025-era sessions report them at initialize.
function clientCanElicit(server: McpServer, envelope: unknown): boolean {
  const perRequest = (envelope as Record<string, ClientCapabilities | undefined> | undefined)?.[CLIENT_CAPABILITIES_META_KEY];
  return Boolean((perRequest ?? server.server.getClientCapabilities())?.elicitation);
}

// ---- schemas --------------------------------------------------------------

const User = z.object({ id: z.string(), name: z.string(), email: z.string() });
const SearchUsersOutput = z.object({
  users: z.array(User),
  total: z.number().int(),
  has_more: z.boolean(),
  next_offset: z.number().int().optional()
});
const Confirm = z.object({ confirm: z.boolean().meta({ title: "Deactivate this user?" }) });

// ---- server factory -------------------------------------------------------

function buildServer(): McpServer {
  const server = new McpServer({ name: "example-mcp-server", version: "1.0.0" });

  server.registerTool(
    "example_search_users",
    {
      title: "Search users",
      description:
        "Search users by name or email substring. Returns one page of matches with pagination fields. " +
        "Use example_deactivate_user to change a user.",
      inputSchema: z
        .object({
          query: z.string().min(2).max(200).describe("Name or email substring, e.g. 'ana'"),
          limit: z.number().int().min(1).max(50).default(20),
          offset: z.number().int().min(0).default(0)
        })
        .strict(),
      outputSchema: SearchUsersOutput,
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ query, limit, offset }) => {
      try {
        const data = await apiRequest<{ users: z.infer<typeof User>[]; total: number }>(
          `users?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`
        );
        let users = data.users;
        const page = () => {
          const more = offset + users.length < data.total;
          return { users, total: data.total, has_more: more, ...(more ? { next_offset: offset + users.length } : {}) };
        };
        // Keep the response bounded by shrinking the page, never by cutting JSON mid-object.
        while (users.length > 1 && JSON.stringify(page()).length > CHARACTER_LIMIT) {
          users = users.slice(0, Math.floor(users.length / 2));
        }
        const output = page();
        return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "example_deactivate_user",
    {
      title: "Deactivate user",
      description:
        "Deactivate one user. The server asks the user to confirm when the client supports it; " +
        "otherwise set confirm only after the user has explicitly approved this deactivation.",
      inputSchema: z.object({ user_id: z.string().min(1), confirm: z.boolean().optional() }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ user_id, confirm }, ctx): Promise<CallToolResult | InputRequiredResult> => {
      let confirmed: boolean;
      if (clientCanElicit(server, ctx.mcpReq.envelope)) {
        // The client can ask the human, so a model-supplied `confirm` is ignored.
        const reply = inputResponse(ctx.mcpReq.inputResponses, "confirm");
        if (reply.kind === "elicit" && reply.action !== "accept") {
          return { content: [{ type: "text", text: `User ${user_id} left active (${reply.action}).` }] };
        }
        const answer = acceptedContent(ctx.mcpReq.inputResponses, "confirm", Confirm);
        if (answer === undefined) {
          const ask = inputRequired.elicit({ message: `Deactivate user ${user_id}?`, requestedSchema: Confirm });
          return inputRequired({ inputRequests: { confirm: ask } });
        }
        confirmed = answer.confirm;
      } else if (confirm === undefined) {
        const text = `Ask the user to approve deactivating ${user_id}, then call again with confirm=true.`;
        return { content: [{ type: "text", text }], isError: true };
      } else {
        confirmed = confirm; // the model's claim; the host's approval policy for destructive tools is the human gate
      }
      if (!confirmed) return { content: [{ type: "text", text: `User ${user_id} left active.` }] };
      try {
        await apiRequest(`users/${encodeURIComponent(user_id)}/deactivate`, { method: "POST" });
        return { content: [{ type: "text", text: `User ${user_id} deactivated.` }] };
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

// ---- transports -----------------------------------------------------------

if (!process.env.EXAMPLE_API_KEY) {
  console.error("EXAMPLE_API_KEY is required");
  process.exit(1);
}

if (process.env.MCP_TRANSPORT === "http") {
  const handler = createMcpHandler(buildServer);
  const node = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const port = Number(process.env.PORT ?? 3000);
  createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    void node(req, res);
  }).listen(port, "127.0.0.1", () => console.error(`example-mcp-server on http://127.0.0.1:${port}/mcp`));
  process.on("SIGINT", () => void handler.close().then(() => process.exit(0)));
} else {
  const handle = serveStdio(buildServer);
  console.error("example-mcp-server running on stdio");
  process.on("SIGINT", () => void handle.close());
}
```

Run `npm run build`, then `node build/index.js` (stdio) or `MCP_TRANSPORT=http` (port 3000, `/mcp`).

## Rules the SDK enforces or expects

- **Input validation**: arguments are validated against `inputSchema`; failures become an
  `isError` tool result. Handlers receive parsed, defaulted values.
- **Structured output**: with `outputSchema`, `structuredContent` is validated. Also return a
  text block with the same JSON. Error results skip output validation.
- **Errors**: tool handlers return `isError: true` or throw (thrown errors become tool
  errors). Resource, prompt, and completion callbacks throw `ProtocolError` or
  `ResourceNotFoundError` (`-32602`).
- **MRTR**: `inputRequired({ inputRequests: { key: inputRequired.elicit({ message,
  requestedSchema }) } })`; read answers with `acceptedContent(ctx.mcpReq.inputResponses,
  key, schema)`. It also returns `undefined` on decline/cancel, so check
  `inputResponse(...)` first or the tool re-asks until the client gives up. Only flat
  primitive fields convert. For multi-round flows, sign `requestState` with
  `createRequestStateCodec({ key, ttlSeconds })` and pass
  `{ requestState: { verify: codec.verify } }` as the second `McpServer` argument; the
  state is signed, not encrypted. Elicit only when the client declares `elicitation`
  (`clientCanElicit` in the example); otherwise fall back to an explicit argument.
- **Removed APIs**: `ctx.mcpReq.elicitInput` and `requestSampling` throw on 2026-era
  requests; `server.tool()`, `.prompt()`, `.resource()` are gone. Use `registerTool`,
  `registerPrompt`, `registerResource`.
- **Logging**: stdio servers write only protocol messages to stdout; use `console.error`.

## Resources and prompts

```typescript
import { ResourceTemplate, ResourceNotFoundError } from "@modelcontextprotocol/server";

server.registerResource("user-profile", new ResourceTemplate("example://users/{id}", { list: undefined }),
  { description: "One user profile as JSON", mimeType: "application/json" }, async (uri, { id }) => {
    const user = await findUser(String(id));
    if (!user) throw new ResourceNotFoundError(uri.href);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(user) }] };
  });

server.registerPrompt("triage-user",
  { description: "Review a user's recent activity", argsSchema: z.object({ user_id: z.string() }) },
  async ({ user_id }) => ({ messages: [{ role: "user", content: { type: "text", text: `Review activity for ${user_id}.` } }] }));
```

`registerResource` always takes a metadata object (pass `{}` if empty). Resources are
addressable data the host attaches; tools are what the model calls.

## HTTP deployment notes

- `createMcpHandler(factory, { legacy: "stateless" | "reject", responseMode: "json" | "sse" })`
  returns `{ fetch, close, notify }`. `fetch` fits web-standard runtimes (Workers, Deno,
  Bun); `toNodeHandler` mounts it on `node:http`. The factory receives
  `{ era, authInfo, requestInfo }` when it needs per-caller registration.
- The bare handler validates neither Host nor Origin. Always wrap it: the localhost
  validators as in the example, `hostHeaderValidation`/`originValidation` with an explicit
  allowlist for remote hosts, or `createMcpExpressApp({ host, allowedHosts })` and its
  Hono/Fastify siblings. Bind local servers to `127.0.0.1`. Bodies above 4 MiB get `413`.
- Authorization, scopes, and token validation: `security-and-auth.md`.
