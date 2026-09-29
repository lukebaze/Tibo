# Tool design

A server is good when a model with no other context can finish realistic tasks using only
its tool list. Design each tool from the user task backward.

## Naming

- Tool names: 1–128 characters from `[A-Za-z0-9_.-]`. Use `snake_case` with a service
  prefix and a verb: `github_create_issue`, `slack_search_messages`. The prefix keeps names
  unique when a host loads several servers.
- Server names: Python `{service}_mcp`, TypeScript package `{service}-mcp-server`.
- Add a human `title` for display; keep `name` stable once published.

## Descriptions

Write the description for the model that must choose between your tools:

- First line: what the tool does and the result it returns.
- When to use it and when to use a sibling tool instead.
- Non-obvious parameter semantics, units, formats, and limits.
- The error messages it can return and what the caller should do next.

Keep descriptions accurate and short enough that the full tool list stays cheap to load.
Do not put instructions for the host or other servers in a description.

## Input schemas

- Use the SDK schema layer (Zod v4 in TypeScript, type hints + Pydantic `Field` in Python).
  The SDK emits JSON Schema 2020-12 and validates arguments before your handler runs.
- Constrain every field: lengths, ranges, enums/`Literal`, patterns, defaults.
- Describe each field; include an example value when the format is not obvious.
- Reject unknown keys (`.strict()` in Zod; Pydantic models forbid extras with
  `model_config = ConfigDict(extra="forbid")`) when silent drops would hide caller mistakes.
- A no-argument tool still needs an object schema: `{"type":"object","additionalProperties":false}`.
- Never mirror secrets or personal data into headers with `x-mcp-header`.

## Output

Return what the next step needs, bounded:

- **Structured output**: declare an `outputSchema` (TypeScript) or a typed return annotation
  (Python: `BaseModel`, `TypedDict`, dataclass). Return `structuredContent` matching it and
  also a text block with the serialized JSON for clients that ignore structured content. The
  Python SDK fills the text block automatically; in TypeScript return both yourself.
- Offer `response_format: "markdown" | "json"` only when humans read results directly and
  structured output alone is not enough; do not add it by reflex.
- Prefer human-readable values next to IDs (names, ISO-8601 timestamps with timezone).
- Return `resource_link` content for large or binary artifacts instead of inlining them.

### Pagination

- Accept `limit` (default 20–50, enforced maximum) and `offset` or an opaque `cursor`.
- Return `total` when cheap, `has_more`, and `next_offset`/`next_cursor`.
- Never load every page into memory to answer one page.

### Size limits

- Set a module constant such as `CHARACTER_LIMIT = 25_000` and truncate predictably.
- Shrink the page rather than cutting JSON, and signal the rest through `has_more` /
  `next_offset`; for free text, say what was dropped and how to narrow the query.

## Errors

Two different audiences:

| Failure | Return | Seen by |
|---|---|---|
| Bad arguments, not found, permission denied upstream, rate limit, business rule | Tool result with `isError: true` and an actionable message | The model, which can retry or change course |
| Unknown tool, malformed request, unsupported protocol version | JSON-RPC protocol error | Host code only |

- Input-validation failures are tool errors (the SDKs do this for you).
- Messages should name the problem and the next step: "No product named 'x'. Use
  shop_search_products to find valid names."
- Do not leak stack traces, internal hosts, tokens, or SQL. Log details to stderr.
- In Python raise `ToolError` for model-visible failures; unhandled exceptions become a
  sanitized "Error executing tool <name>". In TypeScript return `isError: true` or throw;
  the SDK converts thrown errors to tool errors.

## Annotations

Annotations are hints for the host UI and approval policy, not enforcement. Spec defaults
when omitted: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`,
`openWorldHint: true`. Set them explicitly and truthfully:

| Tool kind | readOnly | destructive | idempotent | openWorld |
|---|---|---|---|---|
| Search/list/get against an external API | true | – | – | true |
| Create a record | false | false | false | true |
| Update/upsert with the same result on retry | false | false | true | true |
| Delete or overwrite | false | true | true/false | true |
| Pure local computation | true | – | – | false |

Enforce authorization in code regardless of annotations.

## Interactive input (MRTR)

When a tool genuinely needs a user decision (confirm a destructive action, choose between
ambiguous matches), return an `input_required` result through the SDK helper instead of
guessing. The client re-sends the same call with the answers.

- Form elicitation takes a flat object of primitive fields. Never ask for passwords, API
  keys, tokens, or payment data through form elicitation; use URL-mode elicitation to send
  the user to your own HTTPS page for credentials or OAuth.
- Treat returned answers and `requestState` as untrusted input; validate them again.
- Clients that do not support elicitation cannot answer. Fall back to a clear tool error
  explaining what is needed, then accept an explicit argument (for example `confirm: true`).
  That argument is only the model's claim that the user agreed: ignore it when the client can
  elicit, and rely on the host's approval policy for destructive tools as the human gate.
- Do not use sampling or roots in new designs; both are deprecated.

## State between calls

Servers are stateless per request. For multi-step workflows, return an opaque handle
(cryptographically random, bound server-side to the verified user, with an expiry) and take
it as an argument on the next call. Store the state server-side, not in the handle.

## Tool surface

- Start with the tools the requested workflow needs; add more only when a task requires them.
- Prefer workflow-shaped tools (`calendar_schedule_event` that checks availability and
  creates) over one-to-one endpoint wrappers when the model would always chain the same calls.
- Keep `tools/list` deterministic in order and identical for identical auth.
- Notify list changes through the SDK only when registrations actually change.
