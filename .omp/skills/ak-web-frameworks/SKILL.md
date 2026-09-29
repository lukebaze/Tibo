---
name: ak-web-frameworks
description: Build with Next.js (App Router, RSC, SSR, ISR), Turborepo monorepos. Use for React apps, server rendering, build optimization, caching, shared dependencies, and SEO/GEO surfaces (sitemap, robots, llms.txt, .md page variants, social cards, JSON-LD, copy/share/open-in-AI actions).
user-invocable: true
when_to_use: "Invoke for Next.js, RSC, SSR, ISR, Turborepo, caching, or Next.js SEO/GEO implementation."
category: engineering
keywords: [nextjs, turborepo, ssr, isr, rsc, seo, llms-txt, open-graph]
license: MIT
argument-hint: "[framework] [feature]"
metadata:
  author: agentkit
  version: "1.2.0"
---

# Web Frameworks Skill Group

Comprehensive guide for building modern full-stack web applications using Next.js, Turborepo, and RemixIcon.

## Overview

This skill group combines three powerful tools for web development:

**Next.js** - React framework with SSR, SSG, RSC, and optimization features
**Turborepo** - High-performance monorepo build system for JavaScript/TypeScript
**RemixIcon** - Icon library with 3,100+ outlined and filled style icons

## When to Use This Skill Group

- Building new full-stack web applications with modern React
- Setting up monorepos with multiple apps and shared packages
- Implementing server-side rendering and static generation
- Optimizing build performance with intelligent caching
- Creating consistent UI with professional iconography
- Managing workspace dependencies across multiple projects
- Deploying production-ready applications with proper optimization

## Select the existing framework

Read manifests and framework/workspace configuration. Route Next.js rendering/data changes to the relevant Next.js reference, or workspace/build changes to the Turborepo reference. Load `references/setup-recipes.md` only for new setup. Preserve the selected framework and icon library; RemixIcon is an optional integration, not a prerequisite.

## Reference Navigation

**Next.js References:**
- [App Router Architecture](./references/nextjs-app-router.md) - Routing, layouts, pages, parallel routes
- [Server Components](./references/nextjs-server-components.md) - RSC patterns, client vs server, streaming
- [Data Fetching](./references/nextjs-data-fetching.md) - fetch API, caching, revalidation, loading states
- [Optimization](./references/nextjs-optimization.md) - Images, fonts, scripts, bundle analysis, PPR
- [SEO and GEO Surfaces](./references/nextjs-seo-geo.md) - sitemap.xml, robots.txt, llms.txt, llms-full.txt, `.md` page variants, canonical/social metadata, OG images, JSON-LD, Copy/Open-in-AI/Share actions

**Turborepo References:**
- [Setup & Configuration](./references/turborepo-setup.md) - Installation, workspace config, package structure
- [Task Pipelines](./references/turborepo-pipelines.md) - Dependencies, parallel execution, task ordering
- [Caching Strategies](./references/turborepo-caching.md) - Local cache, remote cache, cache invalidation

**RemixIcon References:**
- [Integration Guide](./references/remix-icon-integration.md) - Installation, usage, customization, accessibility

## Common Patterns & Workflows

Load `references/common-patterns.md` for the worked end-to-end patterns:
full-stack monorepo layout with `turbo.json`, shared component library,
optimized data fetching, and the monorepo CI/CD pipeline.

## Utility Scripts

Python utilities in `scripts/` directory:

**nextjs_init.py** - Initialize Next.js project with best practices
**turborepo_migrate.py** - Convert existing monorepo to Turborepo

Usage examples:
```bash
# Initialize new Next.js app with TypeScript and recommended setup
python scripts/nextjs_init.py --name my-app --typescript --app-router

# Migrate existing monorepo to Turborepo with dry-run
python scripts/turborepo_migrate.py --path ./my-monorepo --dry-run

# Run tests
cd scripts/tests
pytest
```

## Best Practices

**Next.js:**
- Default to Server Components, use Client Components only when needed
- Implement proper loading and error states
- Use Image component for automatic optimization
- Ship SEO/GEO surfaces from one content source (`references/nextjs-seo-geo.md`)
- Leverage caching strategies (force-cache, revalidate, no-store)
- Track stable Next.js security releases separately from canary framework drift. Production apps should stay on a patched stable release line and avoid canary-only pins unless testing a specific upstream issue.

**Turborepo:**
- Structure monorepo with clear separation (apps/, packages/)
- Define task dependencies correctly (^build for topological)
- Configure outputs for proper caching
- Enable remote caching for team collaboration
- Use filters to run tasks on changed packages only

**RemixIcon:**
- Use line style for minimal interfaces, fill for emphasis
- Maintain 24x24 grid alignment for crisp rendering
- Provide aria-labels for accessibility
- Use currentColor for flexible theming
- Prefer webfonts for multiple icons, SVG for single icons

## Resources

- Next.js: https://nextjs.org/docs/llms.txt
- Turborepo: https://turbo.build/repo/docs
- RemixIcon: https://remixicon.com

## Implementation Checklist

Building with this stack:

- [ ] Create project structure (single app or monorepo)
- [ ] Configure TypeScript and ESLint
- [ ] Set up Next.js with App Router
- [ ] Configure Turborepo pipeline (if monorepo)
- [ ] Preserve the existing icon system; configure RemixIcon only when selected
- [ ] Implement routing and layouts
- [ ] Add loading and error states
- [ ] Configure image and font optimization
- [ ] Set up data fetching patterns
- [ ] Configure caching strategies
- [ ] Add API routes as needed
- [ ] Add SEO/GEO surfaces for public content (sitemap, robots, llms.txt, `.md` variants, metadata, social cards, page actions)
- [ ] Implement shared component library (if monorepo)
- [ ] Configure remote caching (if monorepo)
- [ ] Set up CI/CD pipeline
- [ ] Configure deployment platform
