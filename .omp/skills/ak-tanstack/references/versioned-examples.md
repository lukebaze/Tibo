# TanStack illustrative examples

These examples describe patterns, not a current API guarantee. Resolve installed
package versions/types and matching official documentation before applying them;
do not scaffold Start for a Form-only change or add AI to unrelated work.

## Quick Start — TanStack Start

```bash
npm create @tanstack/start@latest    # create project
npm run dev                          # dev server :3000
npm run build                        # production build
```

### Project Structure
```
src/
├── routes/
│   ├── __root.tsx          # root layout (required)
│   ├── index.tsx           # /
│   └── posts.$postId.tsx   # /posts/:postId
├── router.tsx              # createRouter config
├── routeTree.gen.ts        # AUTO-GENERATED — never edit
└── start.ts                # global middleware
app.config.ts               # Nitro/Start config
```

### Server Function
```ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const getUser = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => db.user.findUnique({ where: { id: data.id } }))
```

### Route with Loader
```ts
export const Route = createFileRoute('/posts/$postId')({
  loader: ({ params }) => getPost({ data: { id: params.postId } }),
  component: PostComponent,
})
function PostComponent() {
  const post = Route.useLoaderData()
  return <div>{post.title}</div>
}
```

### Middleware
```ts
import { createMiddleware } from '@tanstack/react-start'
export const authMiddleware = createMiddleware()
  .server(async ({ next, context }) => {
    const session = await getSession(context.request)
    return next({ context: { user: session.user } })
  })
```

## TanStack Form

Headless, type-safe form library. Detailed API: `references/tanstack-form.md`

```tsx
import { useForm } from '@tanstack/react-form'
import { zodValidator } from '@tanstack/zod-form-adapter'

const form = useForm({
  defaultValues: { email: '', age: 0 },
  validatorAdapter: zodValidator,
  onSubmit: async ({ value }) => { await saveUser(value) },
})

// JSX: <form.Field name="email" validators={{ onChange: z.string().email() }}>
//   {(f) => <input value={f.state.value} onChange={e => f.handleChange(e.target.value)} />}
// </form.Field>
```

Key patterns: sync/async validators, `onBlurAsyncDebounceMs`, `form.Subscribe` for submit state, `createServerValidate` for SSR.

## TanStack AI (Alpha)

AI streaming + chat hooks. Detailed API: `references/tanstack-ai.md`

```tsx
// Client
import { useChat } from '@tanstack/react-ai'
const { messages, sendMessage } = useChat({
  connection: fetchServerSentEvents('/api/chat'),
})

// Server (TanStack Start)
import { chat, toStreamResponse } from '@tanstack/ai'
import { openaiAdapter } from '@tanstack/ai-openai'
export const chatRoute = createAPIFileRoute('/api/chat')({
  POST: async ({ request }) => {
    const stream = chat({ adapter: openaiAdapter, messages, model: 'gpt-4o' })
    return toStreamResponse(stream)
  },
})
```

Supports: OpenAI, Anthropic, Google Gemini, Ollama. Features: structured output (Zod), isomorphic tools, multimodal.

## TanStack Start vs Others

| | TanStack Start | Next.js | Remix |
|--|--|--|--|
| Philosophy | Client-first, opt-in SSR | Server-first | Web-standards |
| Type Safety | Full end-to-end inference | Partial | Partial |
| RSC | Planned (not yet) | First-class | No |
| Deploy | Nitro (anywhere) | Vercel-optimized | Adapter-based |
