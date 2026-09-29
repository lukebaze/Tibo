# WebMCP Framework Integration

WebMCP is a plain browser API, so it works with any framework. The key concern
in component frameworks is **lifecycle**: register a tool when its view mounts,
unregister when it unmounts, so you never expose a tool the user cannot see.

## Vanilla JS / SPA

Tie registration to view transitions. Keep an `AbortController` per view:

```js
function mountCartView() {
  const controller = new AbortController();
  document.modelContext.registerTool({
    name: 'add_to_cart',
    description: 'Add a product to the cart by SKU and quantity.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        quantity: { type: 'number' },
      },
      required: ['sku'],
    },
    execute: async ({ sku, quantity = 1 }) => {
      await api.addToCart(sku, quantity);
      return `Added ${quantity} x ${sku} to cart.`;
    },
  }, { signal: controller.signal });
  return () => controller.abort(); // call on view teardown
}
```

## React — `usewebmcp`

React has support via the [`usewebmcp`](https://www.npmjs.com/package/usewebmcp)
package (v5.x). `useWebMCP(config, deps?)` registers a tool on mount and
unregisters on unmount, and returns `{ state, execute, reset }`. It depends on
`@mcp-b/webmcp-polyfill`, but the polyfill is not automatic — outside a
native/origin-trial build you must **initialize** `@mcp-b/webmcp-polyfill` (or
`@mcp-b/global`) before any tool registers, so `document.modelContext` exists.

Contract that differs from the native API
([reference](https://docs.mcp-b.ai/packages/usewebmcp/reference)):

- `config.execute(input)` is **single-argument** — no second `{ signal }` (the
  native `document.modelContext` callback receives `(input, { signal })`).
- there is **no `title`** field on the hook config.
- put `as const` on an inline `inputSchema` so input types are inferred.
- `enabled: false` skips registration; still call the hook unconditionally
  (Rules of Hooks).
- **Re-registration trigger footgun:** only `name`, `description`, and `deps`
  changes re-register the tool. Changing `inputSchema` or `annotations` alone
  does **not** — put a revision value in `deps` when that metadata must change.
- `outputSchema` is an MCP-B helper for output typing/inference; the current
  WebMCP draft does **not** define it.

```tsx
import { useWebMCP } from 'usewebmcp';

function FlightSearch() {
  const { state } = useWebMCP({
    name: 'search_flights',
    description: 'Search flights between two airports on a date.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Origin airport code, e.g. SFO' },
        to: { type: 'string', description: 'Destination airport code, e.g. JFK' },
        date: { type: 'string', description: 'Departure date, natural language ok' },
      },
      required: ['from', 'to', 'date'],
    } as const,
    annotations: { readOnlyHint: true },
    execute: async ({ from, to, date }) => {
      const results = await searchFlights({ from, to, date });
      return JSON.stringify(results);
    },
  });
  return state.isExecuting ? <Spinner /> : <FlightResultsUI />;
}
```

The hook unregisters automatically on unmount. See `assets/react-example.tsx`
for a fuller component.

## Angular

Angular has [experimental support](https://angular.dev/ai/webmcp). Register
tools tied to the dependency-injection lifecycle, and convert Signal Forms into
WebMCP tools. Follow the framework's own lifecycle so tools track component
visibility.

## Cross-framework guidance

- Register on mount, unregister on unmount (Chrome 153+ keeps in-flight
  executions alive when you unregister — safe teardown).
- Keep `execute` handlers pure with respect to the component: call your existing
  services/actions rather than duplicating logic.
- Update reactive state inside `execute` so the UI reflects agent actions, which
  the agent then reads to plan next steps (see `best-practices.md`).
- Do not register a tool in a component that is not currently rendered.
