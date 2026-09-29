# WebMCP API Reference (single source of truth)

This file owns the entire WebMCP API surface. Other references link here and do
not restate signatures. WebMCP is a **pre-Candidate-Recommendation draft** under
active change — verify against the provenance block before relying on any member.

## Provenance (verify before trusting)

| Source | Version / date |
| --- | --- |
| Spec `webmachinelearning/webmcp` `index.bs` | CG-DRAFT, `main` (Bikeshed build 2026-08-21) |
| Chrome overview / imperative / secure-tools | last updated 2026-08-07 / 2026-09-01 / 2026-09-01 |
| Chrome declarative / best-practices / evals | last updated 2026-05-18 / 2026-05-18 / 2026-05-28 |
| Milestones | Chrome 149 origin trial; `navigator.modelContext` deprecated in Chromium 150; Chrome 153 changes unregister semantics |

Stability tiers used below: **[Spec]** normative in `index.bs`; **[Chrome]**
shipped/documented by Chrome, may diverge from spec; **[Proposed]** open issue,
not reliably shipped — verify in a live browser before documenting as fact.

## WebMCP vs Anthropic MCP (read this first)

WebMCP is **not** an MCP server. A WebMCP page can be thought of *as if* it were
an MCP server whose tools run in client-side script, but they are different
things with different runtimes, transports, and audiences.

| | WebMCP | Anthropic MCP |
| --- | --- | --- |
| Runs | In the browser, client-side JS | Server-side (stdio / HTTP) |
| Tool logic | Page `execute` callback | Backend server handler |
| Context | Live page state, user session | Server/service state |
| Audience | Site owner making a page agent-actionable | Author of a reusable tool server |
| Sandbox | Browser origin + permissions | Process/host controls |

- Building an in-browser page tool via `document.modelContext` → this skill.
- Building a stdio/HTTP MCP server → `ak:mcp-builder`.
- Executing existing MCP tools → the runtime's native MCP tools and tool search.
  Exposing code as an MCP surface → `ak:agentize`.

## Availability [Spec] [Chrome]

- Entry point: `document.modelContext`.
- `navigator.modelContext` is **deprecated (Chromium 150)** — use `document.modelContext`; do not emit the old name.
- Requires a **secure context** (HTTPS). The `file:` scheme is treated as
  potentially trustworthy and is additionally **exempt from the origin-isolation
  check** (spec `index.bs`), so WebMCP can run from `file:` documents.
- Requires an **origin-isolated** document (origin-agent-cluster). Enabling
  `document.domain` (e.g. `Origin-Agent-Cluster: ?0`) **silently disables**
  WebMCP at registration.
- Chrome **origin trial** from Chrome 149. Local dev flag:
  `chrome://flags/#enable-webmcp-testing` → Enabled → relaunch.
- Chrome-first. Edge likely (Microsoft co-authors the spec). Firefox and WebKit
  participate in the CG with no shipping commitment. Always feature-detect:
  `if (!('modelContext' in document)) return;`

## Interface — `document.modelContext` [Spec]

```webidl
[Exposed=Window, SecureContext]
interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool,
      optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(
      optional ModelContextGetToolOptions options = {});
  Promise<DOMString> executeTool(RegisteredTool tool,
      optional object inputObject = {},
      optional ModelContextExecuteToolOptions options = {});
  attribute EventHandler ontoolchange;
};
```

There is **no `unregisterTool` method.** Unregistration is done *only* by passing
an `AbortSignal` in `registerTool` options and calling `abort()`.

### executeTool argument shape — spec vs Chrome (divergence)

- **[Spec]** `executeTool(tool, inputObject, options)` takes a JavaScript
  **object**: `executeTool(tool, { a: 10 })`. Resolves to a **stringified**
  result.
- **[Chrome]** the imperative-api docs pass a **JSON string**:
  `executeTool(tool, '{"text":"Buy milk"}')`. Returns the stringified result, or
  `null` when the tool triggered a navigation.

Verify which your target build expects; feature/version-gate if you must support
both.

**Result divergence.** Per spec the fulfilled value is JSON-**serialized**, so a
returned string arrives **quoted** (`"Added: milk"`); Chrome's docs show it
unquoted (`Added: milk`). Do not depend on either; return a self-describing
value.

### execute return contract [Spec]

The `execute` result is JSON-serialized (spec "imperative execute steps", via
"serialize a JavaScript value to a JSON string") and delivered to the caller.
Two failure modes are easy to hit and both collapse to an opaque `UnknownError`
at the caller, destroying your message:

- **Rejection.** If `execute` throws or rejects, the spec only *optionally
  reports the reason to the console* — the caller's `executeTool` promise
  rejects with `UnknownError`. So **do not `throw new Error('SKU not found')`**;
  instead **resolve** with an error string (e.g. `return 'error: SKU not
  found';`) so the agent can read and self-correct.
- **Returning `undefined`.** A handler with no `return` fails serialization →
  same opaque error. Always return a serializable value (string for navigations
  is fine; return an empty string, not nothing).

## Dictionaries [Spec]

```webidl
dictionary ModelContextTool {
  required DOMString name;          // 1..128 chars; [A-Za-z0-9_.-] only
  USVString title;                  // optional, human-readable UI label
  required DOMString description;
  object inputSchema;               // JSON Schema object
  required ToolExecuteCallback execute;
  ToolAnnotations annotations;
};

dictionary ToolAnnotations {        // all default false
  boolean readOnlyHint = false;
  boolean untrustedContentHint = false;
  boolean consequentialHint = false;
};

callback ToolExecuteCallback =
  Promise<any> (object inputObject, ToolExecuteCallbackOptions options);

dictionary ModelContextRegisterToolOptions {
  sequence<USVString> exposedTo;    // secure origins allowed cross-origin
  AbortSignal signal;               // abort() unregisters the tool
};

dictionary ModelContextGetToolOptions {
  sequence<USVString> fromOrigins;  // cross-origin discovery allowlist
};

dictionary ModelContextExecuteToolOptions {
  AbortSignal signal;               // cancel a pending execution
};

dictionary RegisteredTool {         // returned by getTools()
  required DOMString name;
  DOMString title;
  required DOMString description;
  object inputSchema;               // parsed JSON Schema (undefined if none)
  required Window window;           // registering document's window
  required USVString origin;        // registering origin (meaningful cross-origin)
  ToolAnnotations annotations;
};
```

`execute`'s second argument is `{ signal }` (a `ToolExecuteCallbackOptions` with
an `AbortSignal`). Forward it to long-running work.

## Error taxonomy [Spec]

`registerTool` rejects with:

- `SecurityError` — the document is not origin-keyed (origin isolation missing;
  `file:` documents are exempt), or an `exposedTo` origin is not potentially
  trustworthy.
- `NotAllowedError` — the `tools` Permissions Policy denied registration
  (e.g. cross-origin iframe without `allow="tools"`).
- `InvalidStateError` — duplicate tool name, empty `name` or `description`, name
  violates the charset/length rule, or the document is not fully active.
- `TypeError` — `inputSchema` cannot be `JSON.stringify`'d (e.g. circular refs).
  (Note: this is a `TypeError`, not `InvalidStateError`.)

`getTools` rejects with `SecurityError` for a non-trustworthy `fromOrigins`
entry.

`executeTool` rejects with:

- `NotSupportedError` — the tool's origin is opaque or unparseable.
- `UnknownError` — the general rejection for the remaining paths: target not in
  the tool map, cross-traversable/origin mismatch, tool not exposed to the
  caller, and **any `execute` rejection** (the reason is only optionally logged
  to the console — see the execute return contract above). The spec notes more
  granular errors are future work.

**Duplicate names are a common SPA bug** (re-mount without unregister); the
bundled validator flags duplicates statically.

## Declarative API — HTML form attributes [Chrome]

See `declarative-api.md` for full detail.

| Attribute | On | Meaning |
| --- | --- | --- |
| `toolname` | `<form>` | Tool identifier (required to register) |
| `tooldescription` | `<form>` | Tool description (required to register) |
| `toolparamdescription` | field | Per-parameter description override |
| `toolautosubmit` | `<form>` | Agent invocation submits + navigates |

- `SubmitEvent.agentInvoked` (boolean) and `SubmitEvent.respondWith(Promise)`
  (call after `preventDefault()`).
- CSS while active: `:tool-form-active` (form), `:tool-submit-active` (submit
  button).

## Events

- `toolchange` on `document.modelContext` — **[Spec]** tool set changed.
- `toolactivated` / `toolcancel` — **[Proposed]** Chrome's declarative docs
  document these window events (with a `toolName` attribute); they are not yet
  specified — tracked in spec Issue #146, where the imperative form is noted
  with the US spelling `toolcanceled`. Treat as unstable; verify before use.

## Security gates

- Permissions Policy `tools` (default `self`); delegate with `allow="tools"` on
  a cross-origin iframe.
- `exposedTo` (register) + `fromOrigins` (getTools) form a **two-key lock**: the
  registrant must expose to the caller's origin *and* the caller must list the
  registrant's origin. Secure origins only. See `security.md`.

## Character budgets [Chrome recommendation, not spec-enforced]

| Item | Limit |
| --- | --- |
| Tool description | 500 chars |
| Parameter description | 150 chars |
| Tool name / parameter name | 30 chars |
| Individual tool output | 1.5K chars |

The charset/length rule for `name` (1–128, `[A-Za-z0-9_.-]`) **is** spec-enforced
(`InvalidStateError` otherwise). The budgets above are Chrome guardrail-avoidance
recommendations. The validator treats charset as an error and budgets as
warnings.

## Glossary

- **Agent**: autonomous LLM-based assistant acting for the user.
- **Browser's agent**: agent built into or hosted by the browser (incl. extensions).
- **Tool**: named JS function with a description and JSON Schema an agent invokes.
- **Origin isolation**: origin-agent-cluster isolation required by WebMCP;
  disabled when `document.domain` is enabled.
- **Indirect prompt injection**: malicious instructions smuggled through content
  a tool returns or a field an agent reads.

## Links

- Explainer & spec repo: https://github.com/webmachinelearning/webmcp
- Draft spec: https://webmachinelearning.github.io/webmcp/
- Chrome docs hub: https://developer.chrome.com/docs/ai/webmcp
- Imperative: https://developer.chrome.com/docs/ai/webmcp/imperative-api
- Declarative: https://developer.chrome.com/docs/ai/webmcp/declarative-api
- Security: https://developer.chrome.com/docs/ai/webmcp/secure-tools
- Best practices: https://developer.chrome.com/docs/ai/webmcp/best-practices
- Evals: https://developer.chrome.com/docs/ai/webmcp/evals
- Demos (pizza-maker, french-bistro, react-flightsearch, page-agent):
  https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/demos
- Model Context Tool Inspector extension:
  https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd
- React `usewebmcp`: https://www.npmjs.com/package/usewebmcp
- TypeScript types `webmcp-types`: https://www.npmjs.com/package/webmcp-types
- Chrome Status: https://chromestatus.com/feature/5117755740913664
