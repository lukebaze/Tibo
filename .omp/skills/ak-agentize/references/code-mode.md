# Code Mode

Agents write code that calls MCP tools through generated TypeScript APIs, executed in a sandbox. Only the final result returns to the model — not intermediate payloads or full tool schemas.

Introduced by Cloudflare (September 2025) to fix tool bloat: classic MCP injects every tool schema into context, which can consume hundreds of thousands of tokens before work starts.

**Sources:** [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode-mcp/), [Agents SDK codemode](https://developers.cloudflare.com/agents/tools/codemode/how-it-works/)

## How it works

1. **Schemas → generated API** — Tool schemas become typed TypeScript method stubs. The agent sees a minimal meta-surface (often `search` / `execute`) plus clean API signatures, not verbose JSON schemas.
2. **Agent writes code** — Typically an async TypeScript function that chains list → filter → transform locally.
3. **Sandboxed execution** — Code runs in an isolate or microVM (no host FS, CPU/memory limits, egress allowlists). Credentials are injected via a network proxy, never as env vars the code can print.
4. **Final result only** — Intermediate rows stay inside the sandbox; the LLM receives the compact return value.

```ts
const result = await (async () => {
  const users = await api.users.list({ limit: 100, status: "active" });
  const filtered = users.filter((u) => u.created > "2025-01-01");
  return { count: filtered.length, users: filtered };
})();
```

**Sources:** [MCP spec](https://modelcontextprotocol.io/specification/2026-07-28), [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/)

## When to use vs classic tool calls

| Factor | Classic tool calls | Code Mode |
| --- | --- | --- |
| Tool count | < 5 tools | Many tools / 3+ servers |
| Task shape | 1–2 steps | Multi-step chains (4+) |
| Intermediate results | Small | Large result sets, local filtering |
| Context pressure | Acceptable | High (schemas dominate context) |
| Latency | Prefer single round-trips | Tolerate code-exec overhead |
| Setup | Minimal | Needs sandbox infrastructure |

### Published token-savings figures

| Scale | Reported savings | Source |
| --- | --- | --- |
| Large (~500 APIs) | ~14× fewer tokens (~93%) | [WorkOS on Cloudflare](https://workos.com/blog/cloudflare-code-mode-cuts-token-usage-by-81) |
| Across scales | ~58–99% depending on tool count | [Dev.to benchmarks](https://dev.to/anthonymax/how-to-cut-mcp-token-costs-save-up-to-92-at-scale-with-code-mode-3fco) |
| Stripe-style workflows | ~2.4× more efficient than raw MCP | [CLI vs MCP vs Code Mode](https://portofcontext.com/blog/cli-vs-mcp-vs-code-mode) |
| Medium (50–100 tools) | ~65–80% reduction | Same benchmarks |

Skip Code Mode when the task is 1–2 calls, human approval is required between steps, or the toolset is small and stable.

## Deployment recipes

### Cloudflare Workers / isolates

Agents SDK `codemode` + Dynamic Worker Loaders. V8 isolates on the edge; millisecond cold start; JS/TS/Wasm only.

```bash
npm install @cloudflare/codemode wrangler zod
```

**Tradeoffs:** Fastest to ship, global scale, experimental API (breaking changes expected). No arbitrary binaries.

**Sources:** [codemode API](https://developers.cloudflare.com/agents/tools/codemode/api-reference/), [cloudflare/agents](https://github.com/cloudflare/agents)

### Self-hosted VPS

Run Anthropic `@anthropic-ai/sandbox-runtime` (Seatbelt / bubblewrap) or Deno Sandbox on a VPS beside the MCP server. Good for local/dev and small fleets.

**Tradeoffs:** Process-level isolation is weaker than microVMs; keep runtime ≥0.0.16 (CVE-2025-66479). Ops burden is yours.

**Sources:** [anthropic-ai/sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime), [Deno Sandbox](https://docs.deno.com/sandbox/)

### Docker / Kubernetes with gVisor or Firecracker

Package the Code Mode executor in Docker; on Kubernetes prefer `RuntimeClass` with gVisor or Kata/Firecracker microVMs.

| Option | Isolation | Overhead |
| --- | --- | --- |
| gVisor | Userspace syscall intercept | ~10–30% |
| Firecracker / Kata | Hardware microVM | Higher resources, strongest boundary |

**Tradeoffs:** Full language support and air-gapped friendly; highest ops cost.

**Sources:** [gVisor](https://gvisor.dev/), [K8s agent sandbox](https://kubernetes.io/blog/2026/03/20/running-agents-on-kubernetes-with-agent-sandbox/)

## Security checklist

- [ ] Never run agent code on the host without a sandbox layer
- [ ] Prefer microVMs (Firecracker/Kata) for sensitive workloads; keep runtimes patched
- [ ] No secrets in sandbox env vars — proxy-injected credentials only
- [ ] Default-deny egress; allowlist required domains at the sandbox/VM boundary
- [ ] Audit tool invocations and outbound calls; short-lived scoped tokens
- [ ] Human approval for destructive / exfil-risk actions

**Sources:** [MCP security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices), [Deno sandbox security](https://docs.deno.com/sandbox/security/)

## Available SDKs

| SDK | Package | Notes |
| --- | --- | --- |
| Cloudflare Agents | `@cloudflare/codemode` | `createCodeTool`, `DynamicWorkerExecutor`; experimental |
| Anthropic | `@anthropic-ai/sandbox-runtime` | Local/VPS process sandbox; research preview |
| Deno | `@deno/sandbox` | Firecracker microVMs; proxy secret injection |

## Related

- `mcp-transports.md` — Streamable HTTP / stdio wiring
- `deployment-guide.md` — Cloudflare Workers / Docker targets
- `oauth-streamable-http.md` — OAuth for remote HTTP MCP
