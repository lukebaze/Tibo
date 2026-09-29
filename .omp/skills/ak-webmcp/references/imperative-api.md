# WebMCP Imperative API

The imperative API registers tools with JavaScript. Use it for any action that
is not a plain form submission: state changes, navigation, multi-step flows,
custom widgets (React modals, Vue drawers, steppers), or data retrieval.

Entry point: `document.modelContext`.

> `navigator.modelContext` is **deprecated (Chromium 150)**. Always use
> `document.modelContext`. The API requires a secure context (HTTPS) and an
> origin-isolated document.

## registerTool(tool, options?)

Registers a single tool. Returns a `Promise` that **rejects** (it does not
synchronously throw) with `InvalidStateError` if a tool with the same `name`
already exists, `name`/`description` is empty, or `name` violates the
charset/length rule. A non-serializable `inputSchema` rejects with `TypeError`
(not `InvalidStateError`). See the error taxonomy in `api-reference.md`.

```js
await document.modelContext.registerTool({
  name: 'toggle_layer',                              // 1..128 chars, [A-Za-z0-9_.-]
  title: 'Toggle pizza layer',                       // optional, human-readable
  description: 'Control pizza layers (sauce, cheese). Use add, remove, or toggle.',
  inputSchema: {                                     // JSON Schema object
    type: 'object',
    properties: {
      layer: { type: 'string', enum: ['sauce-layer', 'cheese-layer'] },
      action: { type: 'string', enum: ['add', 'remove', 'toggle'] },
    },
    required: ['layer'],
  },
  annotations: {                                     // optional safety hints
    readOnlyHint: false,
    untrustedContentHint: false,
    consequentialHint: false,
  },
  execute: async ({ layer, action }, { signal }) => { // args, then context
    await toggleLayer(layer, action);
    return `Performed ${action || 'toggle'} on layer: ${layer}`;
  },
});
```

### Tool definition fields

- `name` (string, required): unique key. 1–128 chars; only ASCII alphanumeric,
  `_`, `-`, `.`. Keep it ≤30 chars for agent budgets.
- `title` (string, optional): display title for UI. If omitted the browser may
  pick its own label.
- `description` (string, required): what the tool does and when to use it.
- `inputSchema` (object, required): a JSON Schema `object`. Declares parameter
  types, `enum`s, `required`, and per-property `description`s.
- `annotations` (object, optional): safety hints, see below.
- `execute` (async function, required): the handler. Receives parsed
  `args` as the first argument and a context object `{ signal }` as the second.
  Its return value is JSON-serialized and sent back to the agent as tool output.
  Always return a serializable value: on success a concise string; on failure
  **resolve** with an error string (do **not** `throw` — a rejection reaches the
  caller only as an opaque `UnknownError`). Never return `undefined`; for a
  navigation return an empty string. See the execute return contract in
  `api-reference.md`.

### Annotations (safety hints)

All default to `false`. They do not enforce behavior by themselves; agents and
the browser use them to decide confirmations and data handling.

- `readOnlyHint`: tool only reads, no state change (e.g. search, status lookup).
  Lets agents call it freely without confirmation.
- `untrustedContentHint`: output contains user-generated or externally sourced
  content (reviews, comments, scraped data). Signals the agent to sanitize or
  delimit the payload to mitigate indirect prompt injection.
- `consequentialHint`: execution causes significant/irreversible real-world
  effects (purchase, transfer, delete). Lets the browser/agent force a user
  confirmation before running.

## Unregistering

Pass an `AbortController` signal in `options`, then `abort()`:

```js
const controller = new AbortController();
await document.modelContext.registerTool(addTodoTool, { signal: controller.signal });
// later:
controller.abort(); // unregisters the tool
```

As of **Chrome 153**, unregistering does not cancel in-flight executions, so you
can safely tear down tools on component unmount without breaking a running call.

## Handling cancellation inside execute

`execute`'s second argument exposes an `AbortSignal` named `signal`. Forward it
to long-running work (`fetch`, streams) so cancellation propagates:

```js
execute: async ({ url, priority }, { signal }) => {
  const response = await fetch(url, { priority, signal });
  const stream = response.body.pipeThrough(new TextDecoderStream());
  for await (const chunk of stream) {
    document.querySelector('pre').textContent += chunk;
  }
  return 'Success';
},
```

## Discovering tools — getTools(options?)

Returns an alphabetically ordered list of tools the calling document may access.

```js
const tools = await document.modelContext.getTools();
// each entry: { name, title, description, inputSchema, annotations, origin, window }

// include cross-origin tools that exposed themselves to this origin:
const all = await document.modelContext.getTools({ fromOrigins: ['https://partner.org'] });
```

By default only same-origin tools are returned. Cross-origin tools appear only
when (1) their origin is listed in `fromOrigins` and (2) the tool exposed itself
to your origin via `exposedTo`. `fromOrigins` accepts secure origins only.

## Executing a tool — executeTool(tool, inputObject, options?)

Manually invoke a discovered tool. Returns the stringified tool result, or
`null` when the tool triggered a navigation.

> **Spec vs Chrome divergence.** The spec takes a JavaScript **object**
> (`executeTool(tool, { text: 'Buy milk' })`); Chrome's imperative-api docs pass
> a JSON **string** (`executeTool(tool, '{"text":"Buy milk"}')`). Verify which
> your build expects — see `api-reference.md`. Examples below use the Chrome form.

```js
const [tool] = await document.modelContext.getTools();
const result = await document.modelContext.executeTool(tool, '{"text":"Buy milk"}');

// cancellable:
const controller = new AbortController();
document.modelContext.executeTool(tool, '{"text":"Buy milk"}', { signal: controller.signal });
controller.abort();
```

This is what a page-hosted chat/agent uses to run tools it discovered, including
tools inside iframes.

## Events

Listen for `toolchange` on `document.modelContext` to react when the available
tool set changes (e.g. re-render an in-page tool list):

```js
document.modelContext.addEventListener('toolchange', () => {
  // tools changed — refresh UI
});
```

## Cross-origin iframes

Two independent gates apply.

### Permissions Policy `tools`

Tool registration is disabled by default in cross-origin iframes. The `tools`
Permissions Policy defaults to `self`. Delegate it explicitly:

```html
<iframe src="https://example.com" allow="tools"></iframe>
```

### Origin exposure — exposedTo

Tools are invisible to cross-origin documents unless you list their origins in
`exposedTo` (secure origins only). This applies both when your page embeds
another and when another embeds you.

```js
// https://partner.org
await document.modelContext.registerTool(
  { name: 'my_shared_tool', description: 'Shared across origins', /* ... */ },
  { exposedTo: ['https://trusted.com', 'https://example.com'] },
);
```

Only expose tools to origins you trust — see `security.md`.

## Registration strategy

- Prefer **static registration** at page load for the default case.
- For single-page apps, register a tool when the view it belongs to mounts and
  unregister on unmount. Never expose a tool the user cannot currently see — it
  is a bad experience and a subtle abuse vector.
- Keep each tool a single function; avoid overlapping tools (see
  `best-practices.md`).
