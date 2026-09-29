# Next.js SEO and GEO Surfaces

Ship search and AI discoverability from one content source in the App Router:
`sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt`, a `.md` variant for
every page, canonical and social metadata, per-page social cards, JSON-LD, and
Copy/Open-in-AI/Share page actions. Examples target Next.js 15+ (async page
and route `params`; image routes receive a Promise from Next.js 16 and a plain
object on 15). Adapt names to the project's content layer and routes.

## 1. One content source

Every surface below reads the same list, so HTML, Markdown, sitemap, and
`llms*.txt` cannot drift.

```ts
// lib/site.ts
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://example.com'
export const SITE_NAME = 'Example'

export type Page = {
  slug: string[]            // [] for the home page
  title: string
  description: string
  markdown: string          // body without frontmatter; MDX components resolved to Markdown
  updatedAt: string         // ISO date from content, not build time
  section?: string
}

export async function getPages(): Promise<Page[]> { /* project content layer */ }
export async function getPage(slug: string[] = []) {
  return (await getPages()).find((p) => p.slug.join('/') === slug.join('/'))
}

export const pageUrl = (p: Pick<Page, 'slug'>) =>
  p.slug.length ? `${SITE_URL}/${p.slug.join('/')}` : `${SITE_URL}/`
// llmstxt.org: append .md; a URL ending in "/" appends index.html.md
export const markdownUrl = (p: Pick<Page, 'slug'>) =>
  p.slug.length ? `${pageUrl(p)}.md` : `${SITE_URL}/index.html.md`
```

Set `metadataBase: new URL(SITE_URL)` in the root layout `metadata` so relative
image and canonical URLs resolve to absolute ones.

## 2. sitemap.xml and robots.txt

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next'
import { getPages, pageUrl } from '@/lib/site'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await getPages()).map((p) => ({ url: pageUrl(p), lastModified: p.updatedAt }))
}
```

List canonical HTML URLs only; never `.md` variants. Above 50,000 URLs use
`generateSitemaps` to split into an index.

```ts
// app/robots.ts
import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
```

Blocking or allowing AI crawlers (GPTBot, OAI-SearchBot, ClaudeBot,
Claude-SearchBot, PerplexityBot, Google-Extended) is the site owner's decision;
add per-agent rules only when requested. Preview deployments should return
`disallow: '/'`.

## 3. llms.txt and llms-full.txt

```ts
// app/llms.txt/route.ts
import { getPages, markdownUrl, SITE_NAME } from '@/lib/site'

export const dynamic = 'force-static'
const HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' }

export async function GET() {
  const pages = await getPages()
  const sections = new Map<string, string[]>()
  for (const p of pages) {
    const key = p.section ?? 'Docs'
    sections.set(key, [...(sections.get(key) ?? []), `- [${p.title}](${markdownUrl(p)})${p.description ? `: ${p.description}` : ''}`])
  }
  const body = [`# ${SITE_NAME}`, '', `> One-sentence summary of the site.`, '',
    ...[...sections].flatMap(([name, links]) => [`## ${name}`, '', ...links, ''])].join('\n')
  return new Response(body, { headers: HEADERS })
}
```

```ts
// app/llms-full.txt/route.ts
import { getPages, pageUrl, SITE_NAME } from '@/lib/site'

export const dynamic = 'force-static'

export async function GET() {
  const pages = await getPages()
  const body = [`# ${SITE_NAME}`, '',
    ...pages.flatMap((p) => [`## ${p.title}`, '', `Source: ${pageUrl(p)}`, '', p.markdown.trim(), ''])].join('\n')
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  })
}
```

Keep `## Optional` last in `llms.txt` for skippable pages. Exclude drafts and
private routes in `getPages()`, not in each route.

## 4. `.md` variant for every page

Route handlers cannot own a `.md` suffix directly, so rewrite it to an internal
catch-all handler:

```ts
// next.config.ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  async rewrites() {
    return [
      { source: '/index.html.md', destination: '/md' },
      { source: '/:path*.md', destination: '/md/:path*' },
    ]
  },
}
export default config
```

```ts
// app/md/[[...slug]]/route.ts
import { getPage, getPages, pageUrl } from '@/lib/site'

export const dynamic = 'force-static'
export async function generateStaticParams() {
  return (await getPages()).map((p) => ({ slug: p.slug }))
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const page = await getPage((await params).slug ?? [])
  if (!page) return new Response('Not found', { status: 404 })
  const body = `# ${page.title}\n\nSource: ${pageUrl(page)}\n\n${page.markdown.trim()}\n`
  return new Response(body, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  })
}
```

With `trailingSlash: true`, page URLs end in `/` and their variants are
`/guide/index.html.md`; add
`{ source: '/:path+/index.html.md', destination: '/md/:path+' }` before the
general rule and build `pageUrl` with the trailing slash. Check that the rewrite
does not shadow real files ending in `.md` under `public/`, and that `/md/...`
is not linked anywhere. Serving Markdown on the HTML URL for `Accept: text/markdown` is optional; do it in `middleware.ts`
(`proxy.ts` in Next.js 16) with `NextResponse.rewrite` and `Vary: Accept`.

## 5. Metadata, canonical, and Markdown alternate

```tsx
// app/docs/[...slug]/page.tsx
import type { Metadata } from 'next'
import { getPage, markdownUrl, pageUrl, SITE_NAME } from '@/lib/site'

type Props = { params: Promise<{ slug: string[] }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPage(['docs', ...(await params).slug])
  if (!page) return {}
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: pageUrl(page), types: { 'text/markdown': markdownUrl(page) } },
    openGraph: { type: 'article', url: pageUrl(page), siteName: SITE_NAME,
      title: page.title, description: page.description, modifiedTime: page.updatedAt },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description },
  }
}
```

A co-located `opengraph-image.tsx` emits `og:image` with its size, type, and alt
automatically, and X reads `og:image` when `twitter:image` is absent; do not
also hardcode `images`. Keep titles and descriptions unique per page.

## 6. Per-page social card

```tsx
// app/docs/[...slug]/opengraph-image.tsx
import { ImageResponse } from 'next/og'
import { getPage, SITE_NAME } from '@/lib/site'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = `${SITE_NAME} documentation page`

export default async function Image({ params }: { params: Promise<{ slug: string[] }> }) {
  const page = await getPage(['docs', ...(await params).slug])
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', padding: 72, background: '#0b0b0f', color: '#fff' }}>
        <div style={{ fontSize: 28, opacity: 0.7 }}>{page?.section ?? SITE_NAME}</div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{page?.title ?? SITE_NAME}</div>
        <div style={{ fontSize: 28 }}>{SITE_NAME}</div>
      </div>
    ),
    size,
  )
}
```

Use the project's brand colours and fonts (load font data and pass `fonts`).
`ImageResponse` supports flexbox and a CSS subset only; keep layouts simple and
test long titles.

## 7. JSON-LD

```tsx
function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}

// in the page component
<JsonLd data={{
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline: page.title,
  description: page.description,
  dateModified: page.updatedAt,
  url: pageUrl(page),
  publisher: { '@type': 'Organization', name: SITE_NAME },
}} />
```

Add `Organization` and `WebSite` once in the root layout and `BreadcrumbList`
on nested pages. Only mark up content that is visible on the page.

## 8. Page actions: Copy, Open in AI, Share

```tsx
// components/page-actions.tsx
'use client'
import { useState } from 'react'

type Props = { title: string; url: string; markdownUrl: string }

const prompt = (md: string) => `Read ${md} and help me with questions about it.`
const AI_LINKS = [
  { label: 'Open in ChatGPT', href: (md: string) => `https://chatgpt.com/?${new URLSearchParams({ hints: 'search', prompt: prompt(md) })}` },
  { label: 'Open in Claude', href: (md: string) => `https://claude.ai/new?${new URLSearchParams({ q: prompt(md) })}` },
]

export function PageActions({ title, url, markdownUrl }: Props) {
  const [status, setStatus] = useState('')
  const [fallback, setFallback] = useState('') // shown for manual copy when the Clipboard API fails
  const copy = async (text: string | Promise<string>, done: string) => {
    let value = markdownUrl
    try {
      value = await text
      await navigator.clipboard.writeText(value)
      setFallback('')
      setStatus(done)
    } catch {
      setFallback(value)
      setStatus('Copy failed. Select the text below and copy it manually.')
    }
  }
  const markdown = () => fetch(markdownUrl).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.text()
  })
  const share = async () => {
    if (!navigator.share) return copy(url, 'Link copied')
    try {
      await navigator.share({ title, url })
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') await copy(url, 'Link copied')
    }
  }
  const openGemini = () => {
    // open synchronously inside the click so popup blockers allow it
    window.open('https://gemini.google.com/app', '_blank', 'noopener,noreferrer')
    void copy(prompt(markdownUrl), 'Prompt copied. Paste it into Gemini.')
  }

  return (
    <div role="group" aria-label="Page actions">
      <button type="button" onClick={() => copy(markdown(), 'Markdown copied')}>Copy as Markdown</button>
      <button type="button" onClick={() => copy(url, 'Link copied')}>Copy URL</button>
      {AI_LINKS.map((l) => (
        <a key={l.label} href={l.href(markdownUrl)} target="_blank" rel="noopener noreferrer">{l.label}</a>
      ))}
      <button type="button" onClick={openGemini}>Open in Gemini</button>
      <button type="button" onClick={share}>Share</button>
      <span aria-live="polite">{status}</span>
      {fallback && (
        <textarea readOnly value={fallback} aria-label="Text to copy" onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  )
}
```

- Render it in the page with `url={pageUrl(page)}` and `markdownUrl={markdownUrl(page)}`,
  both canonical; never pass `location.href` with tracking parameters.
- Safari may reject `clipboard.writeText` after an awaited fetch (the textarea
  fallback then appears); for a one-click copy there, write a `ClipboardItem`
  with a `Promise<Blob>` instead.
- Gemini has no documented prefill parameter, so the button copies the prompt
  and opens Gemini. ChatGPT and Claude prefill through the query string. Provider
  URL formats change; re-check them when editing this component.
- Where `navigator.share` is missing, an optional menu can add X
  (`https://x.com/intent/post?url=`), LinkedIn
  (`https://www.linkedin.com/sharing/share-offsite/?url=`), and email links.
- Style with the project's design system and icon set; keep visible labels or
  `aria-label`s and focus states.

## Verify

Run against `next build && next start` (static routes only exist after build):

```bash
curl -s  localhost:3000/robots.txt
curl -s  localhost:3000/sitemap.xml | head
curl -s  localhost:3000/llms.txt | head
curl -sI localhost:3000/docs/intro.md      # 200, text/markdown, X-Robots-Tag: noindex
curl -s  localhost:3000/docs/intro | grep -E 'rel="(canonical|alternate)"|og:image|ld\+json'
curl -sI localhost:3000/docs/intro/opengraph-image
```

Then click each page action in a browser on desktop and mobile widths. For the
full audit contract, use the marketing kit's `ak:seo geo` checklist when that
kit is installed.
