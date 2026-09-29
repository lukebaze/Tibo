# Published content, SEO and agent-readable exports

Read this when adding routes/exports or validating a published page.

## Published representations

Render useful crawlable HTML through the host's SSR/SSG/rendering facilities.
Provide semantic headings, accessible links, title/description, canonical URL,
social metadata, locale/hreflang where applicable and truthful structured data.
Use the same published revision for HTML and generated content representations.
Do not give crawlers different claims or invent structured data for rankings.

Deliver robots.txt, sitemap.xml, llms.txt, llms-full.txt and Markdown page URLs.
Reconcile existing routes/files instead of overwriting site policy. Define the
route mapping, trailing-slash behavior, query handling and extension collisions
for `*.md` URLs; return an appropriate Markdown content type. If content
negotiation is added, vary caches by representation as well as auth/locale.

Create Markdown from the page model and registered block serializers, preserving
meaningful text, links, images/alt text and tables. Define behavior for interactive
or nontext blocks and live bindings. Do not execute arbitrary MDX from page data.
Authorize private representations identically to the corresponding HTML page.

| Surface | Validation |
|---|---|
| robots.txt | Existing crawler policy preserved; not used as access control |
| sitemap.xml | Only canonical, published, eligible URLs; correct escaping and dates |
| llms.txt | Compact, useful index with resolvable links to public content/docs |
| llms-full.txt | Published public content only; deterministic regeneration and bounded delivery |
| Markdown routes | Correct route/content type, revision/locale parity and auth |

Keep draft, preview, tenant-private and admin data out of public exports, search
indexes and caches. For large sites, stream/cache or partition full exports with
discoverable links while retaining the requested full-export entrypoint. Never
silently truncate or read the full export into every agent request.

Update artifacts after successful publication; propagate rename/unpublish and
invalidation through HTML, Markdown, indexes and sitemaps. Test 404s, redirects,
Unicode slugs, locales, extension collisions and stale-cache behavior.

## Performance and GEO claims

Measure the existing baseline and agree concrete budgets for representative
public pages and editor interactions. Keep editor code out of public bundles;
inspect images, fonts, layout shifts, hydration, third-party scripts and slow data
bindings. Run available PageSpeed/Lighthouse checks, distinguish lab from field
data, and avoid guaranteeing a universal score.

Agent-readable exports improve discoverability for consumers that use them.
Do not promise rankings or citations from llms.txt, Markdown or a GEO score.
Content usefulness, provenance, freshness and accessible rendering remain part
of the quality bar. Check provider-specific claims against current primary docs.

- [Google AI guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Core Web Vitals](https://web.dev/articles/vitals)
