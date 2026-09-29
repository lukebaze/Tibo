---
name: ak-frontend-development
description: Build React/TypeScript frontends with modern patterns. Use for components, Suspense, lazy loading, useSuspenseQuery, MUI v7 styling, TanStack Router, performance optimization.
user-invocable: true
when_to_use: "Invoke for React/TypeScript frontend implementation."
category: engineering
keywords: [react, typescript, components, mui]
argument-hint: "[component or feature]"
metadata:
  author: agentkit
  version: "1.1.1"
---

# React and TypeScript implementation

Inspect package manifests, router/data libraries, component conventions, tsconfig aliases
and existing styling before editing. Preserve the project's stack; a Next.js/shadcn task
does not authorize installing MUI or TanStack Router. Use only APIs supported by its versions.

Keep typed props/data boundaries, semantic accessible controls, correct hooks/effect cleanup,
loading/error/empty states and responsive behavior. Select memoization/lazy loading from
actual cost and architecture. Follow existing exports, folders and aliases.

`references/stack-recipes.md` contains optional MUI/TanStack/alias examples for projects
that already use those conventions. They are examples, not universal scaffold requirements.
Use the topic resource matching the actual change. Check the component in its real router,
verify relevant build/types and interaction behavior, and report unverified runtime checks.

## Topic Guides

Load `references/topic-guides.md` for the per-topic summaries — component
patterns, data fetching, file organization, styling, routing, loading and error
states, performance, TypeScript, common patterns, and complete examples — each
naming the `resources/` file with the full guide. Pick the topic from the
Navigation Guide below, or read the summaries first when the topic is unclear.

---

## Navigation Guide

| Need to... | Read this resource |
|------------|-------------------|
| Create a component | [component-patterns.md](resources/component-patterns.md) |
| Fetch data | [data-fetching.md](resources/data-fetching.md) |
| Organize files/folders | [file-organization.md](resources/file-organization.md) |
| Style components | [styling-guide.md](resources/styling-guide.md) |
| Set up routing | [routing-guide.md](resources/routing-guide.md) |
| Handle loading/errors | [loading-and-error-states.md](resources/loading-and-error-states.md) |
| Optimize performance | [performance.md](resources/performance.md) |
| TypeScript types | [typescript-standards.md](resources/typescript-standards.md) |
| Forms/Auth/DataGrid | [common-patterns.md](resources/common-patterns.md) |
| See full examples | [complete-examples.md](resources/complete-examples.md) |

---
