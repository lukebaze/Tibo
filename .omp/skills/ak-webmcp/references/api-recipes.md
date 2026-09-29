## Quick examples

Imperative (see `imperative-api.md`):

```js
if ('modelContext' in document) {
  await document.modelContext.registerTool({
    name: 'search_products',
    description: 'Search the product catalog by keyword and optional category.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword.' },
        category: { type: 'string', description: 'Optional category filter.' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ query, category }) => JSON.stringify(await catalog.search(query, category)),
  });
}
```

Declarative (see `declarative-api.md`):

```html
<form toolname="create_support_request"
      tooldescription="Submit a request for customer support." action="/submit">
  <label for="detail">Detail</label>
  <input type="text" name="detail" id="detail"
         toolparamdescription="What the user needs help with.">
  <button type="submit">Submit</button>
</form>
```
