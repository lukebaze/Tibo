# Best practices and common mistakes

Use this list to spot findings quickly and to avoid recommending things that no longer
work. Each line is checkable. Researched September 2026; items marked (recheck) depend
on provider behavior that changes without notice, so confirm them before shipping.

## What actually moves the needle

1. AI visibility comes mostly from ordinary work: server-rendered HTML, allowing the
   search and retrieval crawlers, and clean markup. OpenAI and Anthropic crawlers fetch
   pages but do not run JavaScript.
2. Markdown twins of pages (`.md` URL, `Accept: text/markdown`, `rel="alternate"`) are
   the most useful AX addition; coding agents already request them.
3. `llms.txt` is cheap to add but a May 2026 study of 137k domains found 97% of these
   files received no requests. Recommend it as low-cost hygiene, never as a ranking
   lever. `llms-full.txt` is a convention (Vercel, Mintlify, Fern), not part of the
   llmstxt.org spec.
4. Google removed FAQ rich results in May 2026 and HowTo in 2023. Do not propose them
   for search appearance; the markup is harmless but earns nothing.

## Landing and product pages

Do:
- Hero headline says what it is, for whom and the outcome; passes a five-second test.
- One verb-led primary CTA above the fold; secondary actions visibly subordinate.
- Show the real product (screenshot, demo, short loop) near the hero.
- Sections read Problem → Solution → How it works → Proof → Pricing/CTA → FAQ, each
  with an H2 that states a claim.
- Trust signals beside the decision point: named logos, attributable testimonials,
  security notes, transparent pricing.
- Core Web Vitals at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
- Brand recall: the same wordmark, signature color, type pairing and tagline across
  hero, favicon and social card.

Avoid:
- Clever, vague headlines ("Reimagine the future of work").
- Auto-rotating hero carousels that hide the main message.
- Several equal-weight CTAs competing in the hero.
- Stock-photo or anonymous testimonials.
- Hero image loaded as a CSS background or lazy-loaded, which delays LCP.
- Feature-bullet walls with no story or proof; "Contact sales" for self-serve prices.

## Motion

Do:
- 100–300 ms for UI transitions (up to ~500 ms for page-level); ease-out entering,
  ease-in exiting.
- Animate only `transform` and `opacity`; reserve space for injected content.
- Honor `prefers-reduced-motion: reduce` by removing parallax and large movement while
  keeping essential feedback (focus, spinners, fades).
- Pause/stop control for anything that moves automatically for more than 5 s.
- CSS scroll-driven animations behind `@supports` rather than scroll-event handlers.
- Same-document View Transitions are broadly supported; cross-document ones are
  progressive enhancement. Wrap both in a reduced-motion query.

Avoid:
- Content hidden at `opacity: 0` until a scroll-reveal script runs: blank for crawlers
  and when JS fails, and it delays LCP.
- Scroll-jacking or smooth-scroll libraries that override native scrolling.
- Per-frame layout reads and writes in scroll or resize handlers.
- Entrance animations over 500 ms that block interaction on every visit.
- Heavy autoplay video or Lottie heroes on mobile data.

## Responsive

Do:
- Mobile-first CSS with content-driven breakpoints; container queries for reused
  components; fluid type with `clamp()` and body text at least 16 px.
- Touch targets at least 24×24 CSS px (WCAG 2.2 AA), aiming for 44×44.
- `100svh`/`100dvh` instead of `100vh` for full-height mobile sections.
- Viewport meta `width=device-width, initial-scale=1` with zoom allowed.
- `env(safe-area-inset-*)` for fixed bars; `srcset`/`sizes` and explicit image
  dimensions or `aspect-ratio`.
- No horizontal scroll at 320 px width (WCAG reflow).

Avoid:
- Overflow from fixed widths, `100vw` (includes the scrollbar), long URLs, code or
  unwrapped tables.
- `user-scalable=no` or `maximum-scale=1`.
- Sticky headers taking more than ~15–20% of a phone screen or covering anchor targets
  (fix with `scroll-margin-top`).
- Hover-only menus or tooltips; tightly packed footer and nav links.
- Hiding desktop content on mobile: search indexes the mobile version.

## Technical SEO

Do:
- `robots.txt` with an absolute `Sitemap:` line; use `noindex` (not robots) to keep a
  page out of the index, and leave that page crawlable so `noindex` is seen.
- Sitemaps: absolute canonical URLs only, ≤ 50,000 URLs or 50 MB per file, truthful
  `lastmod`. Google ignores `priority` and `changefreq`.
- One absolute, self-referencing canonical per indexable page, consistent with the
  sitemap, hreflang and internal links, present in server HTML.
- JSON-LD for types Google still shows: Organization, WebSite, BreadcrumbList, Article,
  Product/Offer, Review, SoftwareApplication, Event, VideoObject, LocalBusiness.
  Markup must match visible content.
- Open Graph image as an absolute HTTPS JPG or PNG, 1200×630, with `og:image:alt`;
  `twitter:card=summary_large_image` (X falls back to OG tags).
- Unique title (~50–60 visible characters) and description per page; one H1.

Avoid:
- `Disallow` plus `noindex` on the same page.
- Retired rich-result types: FAQ, HowTo, Course Info, Estimated Salary, Learning Video,
  Special Announcement, Vehicle Listing, Practice Problem.
- Canonicals pointing at redirects, `noindex` or non-200 URLs; canonicals injected
  only by client JavaScript.
- Sitemaps listing redirects, 404s or non-canonical URLs; `lastmod` reset on every
  deploy.
- Changing an OG image without a new filename or a re-scrape in the platform debugger.
- A staging `Disallow: /` or `noindex` shipped to production.

## AI crawlers and GEO

| Token | Controls |
|---|---|
| OAI-SearchBot, Claude-SearchBot, PerplexityBot | Inclusion in AI search answers |
| ChatGPT-User, Claude-User, Perplexity-User | Fetches a user asked for (OpenAI and Perplexity say these may ignore robots.txt) |
| GPTBot, ClaudeBot, CCBot | Training corpora |
| Google-Extended, Applebot-Extended | Gemini / Apple AI training and grounding only; not Search, AI Overviews or Siri inclusion |

Google AI Overviews and AI Mode use Googlebot; control them with `nosnippet` or
`max-snippet`, not Google-Extended.

Do:
- Record an explicit per-bot policy. A common "cited but not trained" policy allows the
  search and user bots and optionally blocks the training tokens. The owner decides.
- Server-render or pre-render primary content, headings, links and JSON-LD.
- Markdown twins: `/page.md` (llmstxt.org also allows `index.html.md` for directory
  URLs), the same URL answering `Accept: text/markdown` with
  `text/markdown; charset=utf-8` and `Vary: Accept`, advertised by
  `<link rel="alternate" type="text/markdown">`, with a canonical link back to HTML.
- `llms.txt`: H1 name (the only required element), `>` summary, H2 sections of
  `[name](url): note` links pointing at the markdown twins, optional `## Optional`.
- Answer-ready content: a one- or two-sentence answer under question-style headings,
  definitions, comparison tables, dated facts and named authors.
- Verify with raw requests: fetch with a crawler user agent, fetch with
  `Accept: text/markdown`, and view the HTML without JavaScript.

Avoid:
- Blocking the search bots while wanting to be cited in AI answers.
- Believing that blocking Google-Extended removes a site from Search or AI Overviews.
- CDN or WAF bot rules silently blocking AI crawlers (some CDNs block them by default
  on new zones) (recheck).
- A client-rendered shell (`<div id="root"></div>`) as the only server HTML.
- `llms.txt` as a raw sitemap dump, linking HTML-only pages, or left stale.
- Markdown served without `Vary: Accept`, or twins whose facts drift from the HTML.
- Twins or llms files without `X-Robots-Tag: noindex`, or `.md` URLs listed in the
  sitemap, so they compete with the HTML page in search results.
- Cloaking: materially different content for bots than for people.

## Page actions: copy, share, open in AI

Prefill URLs are provider-owned and mostly undocumented (recheck each before shipping):

| Target | URL | Status |
|---|---|---|
| ChatGPT | `https://chatgpt.com/?hints=search&prompt=<encoded>` (`?q=` also seen) | Undocumented; used by maintained docs frameworks |
| Claude (web) | `https://claude.ai/new?q=<encoded>` | Undocumented for web; used by maintained docs frameworks |
| Claude Desktop | `claude://claude.ai/new?q=<encoded>` | Documented; prefills, user sends; ~14,000 character cap |
| Perplexity | `https://www.perplexity.ai/search?q=<encoded>` | Third-party evidence only |
| Gemini | none | No native prefill; copy the prompt and open the app, or offer Google AI Studio |

Do:
- Make "Copy page" (Markdown) the primary action and put "Open in …" in a menu,
  alongside "View as Markdown" and "Copy URL".
- Keep the prompt short with the absolute `.md` URL, for example
  "Read https://example.com/docs/setup.md, I want to ask questions about it."
- Start the clipboard write inside the click handler:
  `navigator.clipboard.write([new ClipboardItem({'text/plain': fetch(mdUrl).then((r) => r.text()).then((t) => new Blob([t], {type: 'text/plain'}))})])`,
  with a `writeText` fallback. The promise must resolve to a `Blob` or string, never a
  `Response`; Safari rejects writes after the gesture expires.
- `navigator.share({title, text, url})` only after feature detection (HTTPS and a user
  gesture required; desktop Firefox lacks it), falling back to Copy URL and intent
  links.
- Open external links with `target="_blank" rel="noopener noreferrer"`; encode with
  `encodeURIComponent` or `URLSearchParams`; announce results via an
  `aria-live="polite"` toast.

Avoid:
- The whole page body in `?q=` (URL limits and truncation).
- A relative `.md` URL in the prompt; the assistant cannot resolve it.
- A hard-coded Gemini `?q=` link that opens an empty chat.
- `clipboard.writeText` after `await fetch(...)`.
- Copying rendered text instead of Markdown, which drops code fences and tables.
- No fallback in non-secure contexts or iframes without clipboard permission.
- Treating provider URL parameters as stable; recheck them each review round.
