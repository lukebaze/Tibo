# SEO / GEO / AX checklist

GEO (generative engine optimization) means answer engines and agents can fetch,
understand, quote and link the content. `scripts/check-discovery-surfaces.mjs` checks
the items marked (scan); inspect source for the rest. Generate every surface from the
same route and content source the site already uses, so they cannot drift. The
reasons, thresholds and traps behind each item are in
`best-practices-and-common-mistakes.md`.

Rank proposals by measured value: server-rendered content and crawler access first,
then markdown twins and metadata, then `llms.txt` and `llms-full.txt` as low-cost
hygiene.

## Crawl and index

- **Server-rendered content** (scan: warns on a near-empty HTML shell): primary text,
  headings, links, canonical and JSON-LD are present in the HTML before JavaScript.
- **`robots.txt`** (scan): served at the root, lists an absolute `Sitemap:`, does not
  block the whole site for `*`. The scan errors when a search or answer crawler
  (OAI-SearchBot, Claude-SearchBot, PerplexityBot) is blocked site-wide and reports
  the training-crawler policy as info. The per-bot policy is an owner decision:
  propose, never flip it silently. Also check CDN or WAF bot rules.
- **`sitemap.xml`** (scan): absolute canonical URLs only, truthful `lastmod`, a sitemap
  index when large; no redirects, `noindex`, private routes or `.md` twins.
- **Canonical** (scan): one absolute, self-referencing canonical per indexable page;
  the scan reports a canonical that points elsewhere as info to confirm intent.

## Machine-readable content

- **Markdown twins** (scan): every HTML page `/path` also serves `/path.md` (root:
  `/index.md` or `/index.html.md`) as `text/markdown`, containing the main content
  with title, canonical URL and last-updated date at the top. The page links it with
  `<link rel="alternate" type="text/markdown" href="/path.md">`. Optionally the same
  URL answers `Accept: text/markdown`; the scan then requires `Vary: Accept`. Twins,
  `llms.txt` and `llms-full.txt` send `X-Robots-Tag: noindex` (scan) so they never
  compete with the HTML page in search results; they stay crawlable.
  Typical implementations: a build step that writes `.md` beside each HTML file; a
  route or middleware rewrite of `*.md` to a handler that renders the page source to
  markdown; for docs sites, serving the source markdown directly.
- **`/llms.txt`** (scan): llmstxt.org shape: `# Name`, a `> one-line summary`, short
  context, then `## Section` lists of
  `- [Title](https://example.com/page.md): note` entries pointing at markdown twins.
- **`/llms-full.txt`** (scan): the full public documentation or content as one
  markdown file in reading order, regenerated at build time.

## Structured data and social

- **JSON-LD** (scan: present and parseable): `Organization` or `Person` and `WebSite`
  site-wide; per page as fitting `Article`/`BlogPosting`, `Product`,
  `SoftwareApplication`, `Event`, `VideoObject`, `BreadcrumbList`. Values match visible
  content. Do not propose FAQ or HowTo markup for search appearance.
- **Open Graph** (scan): `og:title`, `og:description`, `og:image` (absolute HTTPS
  JPG/PNG, 1200×630, fetchable, scan), `og:image:alt`, `og:url`, `og:type`,
  `og:site_name`.
- **X/Twitter** (scan): `twitter:card` = `summary_large_image`.
- **Social cards** carry the brand: logo, page title, one visual motif, generated per
  page (build time or an OG image route) rather than one static image.
- **Basics** (scan): `<html lang>`, unique `<title>`, meta description, viewport meta.

## Page actions for people and agents

Near the title of content pages (docs, articles, product pages), add a compact
action group:

- **Copy page** (primary): the page's markdown to the clipboard.
- **View as Markdown** and **Copy URL** (canonical).
- **Open in ChatGPT / Claude / Perplexity**: a short prompt containing the absolute
  `.md` URL. **Gemini** has no prefill link: copy the prompt, open the app, and say so
  in a toast. Current URL formats and their status are in the best-practices file;
  recheck them before shipping.
- **Share**: `navigator.share` when available; otherwise X, LinkedIn, Facebook and
  email intent links plus Copy URL.

Requirements: keyboard reachable, accessible names, `aria-live` success and failure
feedback, no layout shift, no third-party scripts, and only public page data leaves
the page.

## Verification

- The scan exits 0 against the running site, with `--site-origin <production origin>`
  when that site is a dev server or preview (without it the scan errors because only
  the home page can be sampled); any accepted warnings are listed in the
  report with a reason. The scan warns rather than errors when `llms.txt`,
  `llms-full.txt` or an unadvertised markdown twin is missing, so a site without docs
  can accept those gaps; an advertised twin that is broken is an error.
- A structured-data validator shows no errors on one page of each template type.
- A social-card preview renders the intended image and text for the home page and one
  content page.
- Each page action works by keyboard and mouse at the three viewports, including the
  clipboard in Safari when available.
