#!/usr/bin/env node
// Scan a running site's discovery surfaces for people, search engines and AI agents:
// robots.txt, sitemap.xml, llms.txt, llms-full.txt, per-URL .md variants, and the
// head metadata of sampled pages (title, description, canonical, Open Graph, Twitter,
// JSON-LD, lang, viewport). Standard library only: needs Node >= 18 (global fetch).
//
// Usage: node check-discovery-surfaces.mjs <base-url> [--site-origin <url>] [--sample 10] [--json]
//        [--timeout 10000]
// --site-origin: the production origin that sitemap and canonical URLs use. Pass it when
// scanning a dev server or preview so those URLs are mapped onto <base-url> and sampled.
// Exit codes: 0 no errors found, 1 errors found, 2 could not run.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Search and answer crawlers decide whether a site can be cited in AI answers; blocking
// them is an error. Training and user-fetch tokens are an owner policy, reported as info.
const AI_SEARCH_AGENTS = ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'];
const AI_OTHER_AGENTS = ['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'GPTBot', 'ClaudeBot', 'CCBot',
  'Google-Extended', 'Applebot-Extended'];
const MIN_SERVER_TEXT = 200;

export function parseArgs(argv) {
  const opts = { base: null, siteOrigin: null, sample: 10, json: false, timeout: 10000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sample') opts.sample = Number(argv[++i]);
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--json') opts.json = true;
    else if (a === '--site-origin') opts.siteOrigin = argv[++i] ?? '';
    else if (!opts.base) opts.base = a;
  }
  if (!opts.base) throw new Error('missing <base-url>');
  if (!Number.isInteger(opts.sample) || opts.sample < 0) throw new Error('--sample must be a non-negative integer');
  if (!Number.isInteger(opts.timeout) || opts.timeout <= 0) throw new Error('--timeout must be a positive integer (ms)');
  const url = new URL(opts.base);
  if (!/^https?:$/.test(url.protocol)) throw new Error('base URL must be http or https');
  opts.base = url.origin;
  if (opts.siteOrigin !== null) {
    const site = safeUrl(opts.siteOrigin);
    if (!site || !/^https?:$/.test(site.protocol)) throw new Error('--site-origin must be an http or https URL');
    opts.siteOrigin = site.origin;
  }
  return opts;
}

// Group robots.txt lines into user-agent records: [{agents: [...], disallow: [...], allow: [...]}].
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'sitemap') { sitemaps.push(value); continue; }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], disallow: [], allow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow' && value) current.disallow.push(value);
    if (key === 'allow' && value) current.allow.push(value);
  }
  return { groups, sitemaps };
}

// True when the rules for the agent disallow the whole site. Per RFC 9309, all groups
// naming the agent are merged; the `*` groups apply only when none names it.
export function blocksSite(robots, agent) {
  const name = agent.toLowerCase();
  let groups = robots.groups.filter((g) => g.agents.includes(name));
  if (!groups.length) groups = robots.groups.filter((g) => g.agents.includes('*'));
  const root = (rules) => rules.some((r) => r === '/' || r === '/*');
  return root(groups.flatMap((g) => g.disallow)) && !root(groups.flatMap((g) => g.allow));
}

// Parse a URL without throwing; malformed input from a site becomes a finding, not a crash.
export function safeUrl(value, base) {
  try { return new URL(value, base); } catch { return null; }
}

export function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
}

// Candidate markdown-twin URLs in preference order. llmstxt.org appends .md to the URL
// (`/about.html` → `/about.html.md`) and uses index.html.md for directory URLs; the
// stripped forms are common alternatives.
export function markdownUrlsFor(pageUrl) {
  const u = new URL(pageUrl);
  const path = u.pathname.replace(/\/$/, '');
  let paths;
  if (path === '') paths = ['/index.html.md', '/index.md'];
  else if (u.pathname.endsWith('/')) paths = [path + '/index.html.md', path + '.md'];
  else if (/\.html?$/.test(path)) paths = [path + '.md', path.replace(/\.html?$/, '') + '.md'];
  else paths = [path + '.md'];
  return paths.map((p) => new URL(p, u.origin).href);
}

// True when a Vary header lists Accept (or *) as one of its comma-separated fields.
export function variesOnAccept(vary) {
  return vary.split(',').map((v) => v.trim().toLowerCase()).some((v) => v === 'accept' || v === '*');
}

// Visible text length of server HTML, ignoring scripts, styles and markup.
export function serverTextLength(html) {
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];
  return body.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().length;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

export function parseHead(html) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (key && content !== null && !(key in meta)) meta[key] = content.trim();
  }
  const links = (html.match(/<link\b[^>]*>/gi) || []).map((t) => ({ rel: (attr(t, 'rel') || '').toLowerCase(), type: (attr(t, 'type') || '').toLowerCase(), href: attr(t, 'href') }));
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
  const htmlTag = (html.match(/<html\b[^>]*>/i) || [''])[0];
  const jsonLd = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => {
    try { JSON.parse(m[1]); return true; } catch { return false; }
  });
  return {
    title, meta, jsonLd,
    lang: attr(htmlTag, 'lang'),
    canonical: links.find((l) => l.rel.split(/\s+/).includes('canonical'))?.href || null,
    markdownAlternate: links.find((l) => l.rel.split(/\s+/).includes('alternate') && /markdown/.test(l.type))?.href || null,
  };
}

export function checkPage(url, head) {
  const f = [];
  const add = (severity, check, message) => f.push({ severity, check, url, message });
  if (!head.title) add('error', 'title', 'missing <title>');
  if (!head.meta.description) add('error', 'meta-description', 'missing meta description');
  if (!head.meta.viewport) add('error', 'viewport', 'missing viewport meta');
  if (!head.lang) add('warn', 'lang', 'missing <html lang>');
  if (!head.canonical) add('warn', 'canonical', 'missing canonical link');
  else if (!/^https?:\/\//i.test(head.canonical)) add('warn', 'canonical', `canonical is not absolute: ${head.canonical}`);
  for (const key of ['og:title', 'og:description', 'og:image', 'og:url']) {
    if (!head.meta[key]) add(key === 'og:image' ? 'error' : 'warn', 'open-graph', `missing ${key}`);
  }
  if (head.meta['og:image'] && !/^https?:\/\//i.test(head.meta['og:image'])) add('error', 'open-graph', `og:image must be an absolute URL: ${head.meta['og:image']}`);
  if (head.meta['og:image'] && !head.meta['og:image:alt']) add('info', 'open-graph', 'missing og:image:alt');
  if (!head.meta['twitter:card']) add('warn', 'twitter-card', 'missing twitter:card');
  if (head.jsonLd.length === 0) add('warn', 'json-ld', 'no JSON-LD structured data');
  head.jsonLd.forEach((ok, i) => { if (!ok) add('error', 'json-ld', `JSON-LD block ${i + 1} is not valid JSON`); });
  if (!head.markdownAlternate) add('info', 'markdown-alternate', 'no <link rel="alternate" type="text/markdown">');
  return f;
}

async function get(url, timeout, headers = {}) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'ak-enhance-ux-ax/1.0 (+discovery-surface check)', ...headers } });
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const vary = (res.headers.get('vary') || '').toLowerCase();
    const robotsTag = (res.headers.get('x-robots-tag') || '').toLowerCase();
    const body = await res.text();
    return { ok: res.ok, status: res.status, type, vary, robotsTag, body, finalUrl: res.url };
  } catch (err) {
    return { ok: false, status: 0, type: '', body: '', error: err.message };
  }
}

const looksHtml = (r) => r.type.includes('text/html') || /^\s*<(!doctype|html)/i.test(r.body);

export async function scan({ base, siteOrigin = null, sample, timeout }) {
  const findings = [];
  const add = (severity, check, url, message) => findings.push({ severity, check, url, message });

  const probe = await get(base + '/', timeout);
  if (probe.status === 0) throw new Error(`cannot reach ${base}: ${probe.error}`);
  // Scan the origin the site actually serves from, e.g. after a bare-domain → www redirect.
  const origin = safeUrl(probe.finalUrl || base)?.origin || base;
  if (origin !== base) add('info', 'redirect', base, `base redirects to ${origin}; scanning that origin`);
  const home = origin + '/';
  // Map production URLs onto the scanned origin so a dev or preview scan samples real pages.
  const onScanned = (u) => (siteOrigin && siteOrigin !== origin && u.origin === siteOrigin ? new URL(u.pathname + u.search, origin) : u);

  // robots.txt
  let sitemapUrls = [];
  const robotsRes = await get(origin + '/robots.txt', timeout);
  if (!robotsRes.ok || looksHtml(robotsRes)) add('error', 'robots', origin + '/robots.txt', `robots.txt not served as text (status ${robotsRes.status})`);
  else {
    const robots = parseRobots(robotsRes.body);
    for (const s of robots.sitemaps) {
      if (!/^https?:\/\//i.test(s)) add('warn', 'robots', origin + '/robots.txt', `Sitemap: line is not an absolute URL: ${s}`);
      const raw = safeUrl(s, origin);
      const u = raw && onScanned(raw);
      if (!u) add('error', 'robots', origin + '/robots.txt', `Sitemap: line is not a valid URL: ${s}`);
      // A sitemap on another host (CDN, bucket, bare domain) is valid; still read it.
      else {
        if (u.origin !== origin) add('info', 'robots', origin + '/robots.txt', `Sitemap: ${s} is on another origin`);
        sitemapUrls.push(u.href);
      }
    }
    if (blocksSite(robots, '*')) add('error', 'robots', origin + '/robots.txt', 'robots.txt disallows the whole site for all crawlers');
    if (!robots.sitemaps.length) add('warn', 'robots', origin + '/robots.txt', 'robots.txt has no Sitemap: line');
    const blockedSearch = AI_SEARCH_AGENTS.filter((a) => blocksSite(robots, a));
    if (blockedSearch.length) add('error', 'ai-crawlers', origin + '/robots.txt', `blocks AI search crawlers, so AI answers cannot cite the site: ${blockedSearch.join(', ')}`);
    const blockedOther = AI_OTHER_AGENTS.filter((a) => blocksSite(robots, a));
    add('info', 'ai-crawlers', origin + '/robots.txt', blockedOther.length ? `blocks training/user-fetch tokens: ${blockedOther.join(', ')}` : 'no training or user-fetch AI token is blocked site-wide');
  }

  // sitemap.xml (one level of sitemap index)
  if (!sitemapUrls.length) sitemapUrls = [origin + '/sitemap.xml'];
  const locs = [];
  let sitemapFailed = false;
  for (const sm of sitemapUrls.slice(0, 5)) {
    const r = await get(sm, timeout);
    if (!r.ok || !/<(urlset|sitemapindex)\b/i.test(r.body)) { add('error', 'sitemap', sm, `sitemap missing or not XML (status ${r.status})`); sitemapFailed = true; continue; }
    if (/<sitemapindex\b/i.test(r.body)) {
      for (const child of extractLocs(r.body).slice(0, 5)) {
        const rawChild = safeUrl(child, sm);
        const childUrl = rawChild && onScanned(rawChild);
        if (!childUrl) { add('error', 'sitemap', child, 'child sitemap URL is not valid'); continue; }
        const c = await get(childUrl.href, timeout);
        if (c.ok) locs.push(...extractLocs(c.body));
        else { add('error', 'sitemap', childUrl.href, `child sitemap failed (status ${c.status})`); sitemapFailed = true; }
      }
    } else locs.push(...extractLocs(r.body));
  }
  if (!sitemapFailed && locs.length === 0) add('error', 'sitemap', sitemapUrls[0], 'sitemap lists no URLs');
  const pages = new Set();
  let offOrigin = 0;
  for (const loc of locs) {
    const abs = /^https?:\/\//i.test(loc) ? safeUrl(loc) : null;
    const u = abs && onScanned(abs);
    if (!u) { add('error', 'sitemap', loc, 'sitemap URL is not an absolute, valid URL'); continue; }
    if (/\.md$/i.test(u.pathname)) add('warn', 'sitemap', loc, 'sitemap lists a markdown twin; list only canonical HTML URLs');
    if (u.origin !== origin) { add('warn', 'sitemap', loc, `sitemap URL is on a different origin than ${origin}; not sampled`); offOrigin++; }
    else pages.add(u.href);
  }
  // Without sampled pages, every per-page check below covers only the home page.
  if (offOrigin && !pages.size) add('error', 'sitemap', sitemapUrls[0], `no sitemap URL is on ${origin}, so only the home page was checked; pass --site-origin <production origin> or scan a production-like preview`);

  // llms.txt and llms-full.txt: low-cost hygiene, so absence is a warning, not an error.
  const llms = await get(origin + '/llms.txt', timeout);
  if (!llms.ok || looksHtml(llms)) add('warn', 'llms-txt', origin + '/llms.txt', `llms.txt missing (status ${llms.status})`);
  else {
    if (!/^\s*# \S/.test(llms.body)) add('error', 'llms-txt', origin + '/llms.txt', 'llms.txt must start with a "# Name" heading');
    if (!/^>\s*\S/m.test(llms.body)) add('warn', 'llms-txt', origin + '/llms.txt', 'llms.txt has no "> summary" blockquote');
    if (!/\]\((https?:\/\/|\/)[^)]+\)/.test(llms.body)) add('warn', 'llms-txt', origin + '/llms.txt', 'llms.txt has no markdown links');
    if (!llms.robotsTag.includes('noindex')) add('info', 'llms-txt', origin + '/llms.txt', 'llms.txt lacks X-Robots-Tag: noindex');
  }
  const full = await get(origin + '/llms-full.txt', timeout);
  if (!full.ok || looksHtml(full)) add('warn', 'llms-full-txt', origin + '/llms-full.txt', `llms-full.txt missing (status ${full.status}); expected when the site has docs or long-form content`);
  else if (full.body.trim().length < 500) add('warn', 'llms-full-txt', origin + '/llms-full.txt', 'llms-full.txt is under 500 characters');

  // Sampled same-origin pages: head metadata, server rendering and markdown twins
  const others = [...pages].filter((p) => p !== home).slice(0, Math.max(0, sample - 1));
  const sampled = [home, ...others];
  const ogImages = new Set();
  for (const url of sampled) {
    const r = url === home ? probe : await get(url, timeout);
    if (!r.ok) { add('error', 'page', url, `page failed (status ${r.status})`); continue; }
    const head = parseHead(r.body);
    findings.push(...checkPage(url, head));
    const rawCanonical = head.canonical && safeUrl(head.canonical, url);
    const canonical = rawCanonical && onScanned(rawCanonical);
    if (head.canonical && !canonical) add('error', 'canonical', url, `canonical is not a valid URL: ${head.canonical}`);
    else if (canonical && canonical.href.replace(/\/$/, '') !== url.replace(/\/$/, '')) add('info', 'canonical', url, `canonical points elsewhere: ${canonical.href}`);
    if (serverTextLength(r.body) < MIN_SERVER_TEXT) add('warn', 'server-render', url, `server HTML has under ${MIN_SERVER_TEXT} characters of text; crawlers that skip JavaScript see an empty page`);
    const og = /^https?:\/\//i.test(head.meta['og:image'] || '') && safeUrl(head.meta['og:image']);
    if (og) ogImages.add(onScanned(og).href);

    // An advertised twin that is broken is an error; a missing, unadvertised one is a gap.
    let candidates;
    if (head.markdownAlternate) {
      const rawAlt = safeUrl(head.markdownAlternate, url);
      const alt = rawAlt && onScanned(rawAlt);
      if (!alt) { add('error', 'markdown-variant', url, `rel=alternate markdown href is not a valid URL: ${head.markdownAlternate}`); candidates = []; }
      else candidates = [alt.href];
    } else candidates = markdownUrlsFor(url);
    let md = null;
    let mdUrl = candidates[0];
    for (const c of candidates) {
      const res = await get(c, timeout);
      if (res.ok && !looksHtml(res)) { md = res; mdUrl = c; break; }
      if (!md) md = res;
    }
    const missing = head.markdownAlternate ? 'error' : 'warn';
    if (!md) { /* invalid advertised href already reported */ }
    else if (!md.ok) add(missing, 'markdown-variant', mdUrl, `markdown twin missing (tried ${candidates.join(', ')}; status ${md.status})`);
    else if (looksHtml(md)) add(missing, 'markdown-variant', mdUrl, 'markdown twin returns HTML');
    else {
      if (!/text\/(markdown|plain|x-markdown)/.test(md.type)) add('warn', 'markdown-variant', mdUrl, `unexpected content-type: ${md.type || 'none'}`);
      if (!md.robotsTag.includes('noindex')) add('warn', 'markdown-variant', mdUrl, 'markdown twin lacks X-Robots-Tag: noindex, so it can compete with the HTML page in search');
    }

    const negotiated = await get(url, timeout, { accept: 'text/markdown' });
    if (negotiated.ok && /text\/(markdown|x-markdown)/.test(negotiated.type)) {
      if (!variesOnAccept(negotiated.vary)) add('error', 'content-negotiation', url, 'serves markdown for Accept: text/markdown without Vary: Accept, so caches can mix variants');
    } else add('info', 'content-negotiation', url, 'no markdown for Accept: text/markdown (optional)');
  }
  for (const img of ogImages) {
    const r = await get(img, timeout);
    if (!r.ok || !r.type.startsWith('image/')) add('error', 'open-graph', img, `og:image not fetchable as an image (status ${r.status}, ${r.type || 'no type'})`);
  }

  return { base: origin, pagesInSitemap: pages.size, pagesChecked: sampled.length, findings };
}

export function formatText(result) {
  const lines = [`Discovery surfaces for ${result.base}: ${result.pagesInSitemap} URL(s) in sitemap, ${result.pagesChecked} page(s) checked`];
  for (const sev of ['error', 'warn', 'info']) {
    const items = result.findings.filter((f) => f.severity === sev);
    if (!items.length) continue;
    lines.push('', `${sev.toUpperCase()} (${items.length})`);
    for (const f of items) lines.push(`- [${f.check}] ${f.url}: ${f.message}`);
  }
  return lines.join('\n');
}

// Set exitCode instead of calling process.exit: exiting while fetch keep-alive sockets
// are still open crashes Node on Windows.
async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (err) {
    console.error(`${err.message}\nUsage: node check-discovery-surfaces.mjs <base-url> [--site-origin <url>] [--sample 10] [--json] [--timeout 10000]`);
    process.exitCode = 2;
    return;
  }
  try {
    const result = await scan(opts);
    console.log(opts.json ? JSON.stringify(result, null, 2) : formatText(result));
    process.exitCode = result.findings.some((f) => f.severity === 'error') ? 1 : 0;
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}

// Compare real paths so a symlinked or junctioned skill directory still runs main.
function invokedDirectly() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (process.argv[1] && invokedDirectly()) main();
