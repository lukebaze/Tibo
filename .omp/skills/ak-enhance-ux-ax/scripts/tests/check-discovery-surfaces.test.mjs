// Run: node --test scripts/tests/check-discovery-surfaces.test.mjs
// Serves fixture sites from a local HTTP server; no network access.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseRobots, blocksSite, markdownUrlsFor, variesOnAccept, safeUrl, serverTextLength, parseHead, parseArgs, scan } from '../check-discovery-surfaces.mjs';

// Keep in-process scans offline: production URLs in fixtures (e.g. an unmapped og:image)
// fail fast instead of reaching the network.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1:') ? realFetch(url, init) : Promise.reject(new Error(`offline test: ${url}`)));

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'check-discovery-surfaces.mjs');

function page(origin, path, title) {
  return `<!doctype html><html lang="en"><head><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="About ${title}">
<link rel="canonical" href="${origin}${path}">
<link rel="alternate" type="text/markdown" href="${path === '/' ? '/index.md' : path + '.md'}">
<meta property="og:title" content="${title}"><meta property="og:description" content="d">
<meta property="og:image" content="${origin}/og.png"><meta property="og:url" content="${origin}${path}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"${title}"}</script>
</head><body><h1>${title}</h1><p>${'Server-rendered copy that crawlers can read without JavaScript. '.repeat(5)}</p></body></html>`;
}

function goodRoutes(origin) {
  const text = (body, type = 'text/plain', headers) => ({ body, type, headers });
  const noindex = { 'x-robots-tag': 'noindex' };
  return {
    '/': text(page(origin, '/', 'Home'), 'text/html'),
    '/docs': (req) => (req.headers.accept === 'text/markdown'
      ? { body: '# Docs\n', type: 'text/markdown', headers: { vary: 'Accept' } }
      : { body: page(origin, '/docs', 'Docs'), type: 'text/html' }),
    '/robots.txt': text(`User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${origin}/sitemap.xml\n`),
    '/sitemap.xml': text(`<?xml version="1.0"?><urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/docs</loc></url></urlset>`, 'application/xml'),
    '/llms.txt': text(`# Demo\n\n> A demo site.\n\n## Docs\n\n- [Docs](${origin}/docs.md): guide\n`, 'text/plain', noindex),
    '/llms-full.txt': text('# Demo\n\n' + 'Full content. '.repeat(60)),
    '/index.md': text('# Home\n', 'text/markdown; charset=utf-8', noindex),
    '/docs.md': text('# Docs\n', 'text/markdown; charset=utf-8', noindex),
    '/og.png': text('png', 'image/png'),
  };
}

function badRoutes() {
  return {
    '/': (req) => (req.headers.accept === 'text/markdown'
      ? { body: '# Bare\n', type: 'text/markdown' }
      : { body: '<html><head><title>Bare</title></head><body><div id="root"></div></body></html>', type: 'text/html' }),
    '/robots.txt': { body: 'User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n', type: 'text/plain' },
  };
}

async function serve(routesFor) {
  let routes = {};
  const server = createServer((req, res) => {
    const route = routes[new URL(req.url, 'http://x').pathname];
    const r = typeof route === 'function' ? route(req) : route;
    if (!r) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<html>not found</html>'); return; }
    res.writeHead(200, { 'content-type': r.type, ...(r.headers || {}) });
    res.end(r.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  routes = routesFor(origin);
  return { origin, close: () => new Promise((resolve) => server.close(resolve)) };
}

const good = await serve(goodRoutes);
const bad = await serve(badRoutes);
// A dev server whose sitemap, canonical and alternate links use the production origin.
const prod = await serve((origin) => ({ ...goodRoutes('https://example.com'), '/robots.txt': { body: `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`, type: 'text/plain' } }));
// A site whose robots Sitemap line points at a sitemap hosted on another origin.
let splitOrigin = '';
const cdn = await serve(() => ({ '/sitemap.xml': () => ({ body: `<urlset><url><loc>${splitOrigin}/</loc></url><url><loc>${splitOrigin}/docs</loc></url></urlset>`, type: 'application/xml' }) }));
const split = await serve((origin) => {
  splitOrigin = origin;
  const { '/sitemap.xml': _, ...routes } = goodRoutes(origin);
  return { ...routes, '/robots.txt': { body: `User-agent: *\nAllow: /\nSitemap: ${cdn.origin}/sitemap.xml\n`, type: 'text/plain' } };
});
after(async () => { await Promise.all([good, bad, prod, cdn, split].map((s) => s.close())); });

test('complete site has no errors and reports blocked AI crawlers', async () => {
  const result = await scan({ base: good.origin, sample: 10, timeout: 5000 });
  assert.deepEqual(result.findings.filter((f) => f.severity !== 'info'), []);
  assert.equal(result.pagesInSitemap, 2);
  const ai = result.findings.find((f) => f.check === 'ai-crawlers');
  assert.match(ai.message, /GPTBot/);
  assert.equal(ai.severity, 'info');
});

test('bare site reports the missing surfaces as errors', async () => {
  const result = await scan({ base: bad.origin, sample: 3, timeout: 5000 });
  const checks = new Set(result.findings.filter((f) => f.severity === 'error').map((f) => f.check));
  for (const c of ['robots', 'ai-crawlers', 'content-negotiation', 'sitemap', 'meta-description', 'viewport', 'open-graph']) {
    assert.ok(checks.has(c), `expected an error for ${c}; got ${[...checks].join(', ')}`);
  }
  // Optional surfaces are gaps, not failures, so a site without docs can still reach DONE.
  const warns = new Set(result.findings.filter((f) => f.severity === 'warn').map((f) => f.check));
  for (const c of ['llms-txt', 'llms-full-txt', 'markdown-variant']) assert.ok(warns.has(c) && !checks.has(c), `expected only a warning for ${c}`);
  assert.ok(result.findings.some((f) => f.check === 'server-render' && f.severity === 'warn'), 'expected a server-render warning for the empty shell');
});

test('dev-server scan needs --site-origin to sample production sitemap URLs', async () => {
  const plain = await scan({ base: prod.origin, sample: 10, timeout: 5000 });
  assert.equal(plain.pagesChecked, 1);
  assert.ok(plain.findings.some((f) => f.check === 'sitemap' && f.severity === 'error' && /--site-origin/.test(f.message)));
  const mapped = await scan({ base: prod.origin, siteOrigin: 'https://example.com', sample: 10, timeout: 5000 });
  assert.equal(mapped.pagesChecked, 2);
  assert.deepEqual(mapped.findings.filter((f) => f.severity === 'error'), []);
  assert.ok(!mapped.findings.some((f) => f.check === 'canonical'), 'mapped canonical should be self-referencing');
});

test('robots Sitemap on another origin is still read', async () => {
  const result = await scan({ base: split.origin, sample: 10, timeout: 5000 });
  assert.deepEqual(result.findings.filter((f) => f.check === 'sitemap' && f.severity !== 'info'), []);
  assert.equal(result.pagesChecked, 2);
});

// The fixture servers live in this process, so the CLI must run without blocking it.
function run(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 30000);
    child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
}

test('CLI exit codes: 0 clean, 1 errors, 2 bad usage', async () => {
  assert.equal(await run(good.origin), 0);
  assert.equal(await run(bad.origin, '--json'), 1);
  assert.equal(await run(), 2);
  assert.equal(await run('ftp://example.com'), 2);
});

test('CLI runs when invoked through a directory symlink or junction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-link-'));
  const link = join(dir, 'scripts');
  try {
    symlinkSync(join(here, '..'), link, process.platform === 'win32' ? 'junction' : 'dir');
    const child = spawn(process.execPath, [join(link, 'check-discovery-surfaces.mjs'), bad.origin], { stdio: 'ignore' });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('robots groups, markdown URLs, head parsing and args', () => {
  const robots = parseRobots('User-agent: a\nUser-agent: b\nDisallow: /\n# c\nUser-agent: *\nDisallow: /private\nSitemap: https://x/s.xml');
  assert.equal(blocksSite(robots, 'B'), true);
  assert.equal(blocksSite(robots, 'other'), false);
  assert.equal(blocksSite(parseRobots('User-agent: *\nDisallow: /*'), 'x'), true);
  assert.equal(blocksSite(parseRobots('User-agent: x\nAllow: /a\n\nUser-agent: x\nDisallow: /'), 'x'), true);
  assert.equal(variesOnAccept('Accept-Encoding'), false);
  assert.equal(variesOnAccept('accept-encoding, Accept'), true);
  assert.equal(variesOnAccept('*'), true);
  assert.equal(safeUrl('http://[bad'), null);
  assert.deepEqual(robots.sitemaps, ['https://x/s.xml']);
  assert.deepEqual(markdownUrlsFor('https://x.dev/'), ['https://x.dev/index.html.md', 'https://x.dev/index.md']);
  assert.deepEqual(markdownUrlsFor('https://x.dev/docs/intro/?a=1'), ['https://x.dev/docs/intro/index.html.md', 'https://x.dev/docs/intro.md']);
  assert.deepEqual(markdownUrlsFor('https://x.dev/about.html'), ['https://x.dev/about.html.md', 'https://x.dev/about.md']);
  assert.deepEqual(markdownUrlsFor('https://x.dev/docs'), ['https://x.dev/docs.md']);
  assert.equal(serverTextLength('<body><div id="root"></div><script>var a = 1;</script></body>'), 0);
  const head = parseHead(`<html lang='vi'><meta content="c" name="description"><script type="application/ld+json">{bad</script>`);
  assert.equal(head.lang, 'vi');
  assert.equal(head.meta.description, 'c');
  assert.deepEqual(head.jsonLd, [false]);
  assert.equal(parseArgs(['https://x.dev/path', '--sample', '3']).base, 'https://x.dev');
  assert.throws(() => parseArgs(['https://x.dev', '--sample', '-1']));
  assert.equal(parseArgs(['http://localhost:3000', '--site-origin', 'https://x.dev/a']).siteOrigin, 'https://x.dev');
  assert.throws(() => parseArgs(['http://localhost:3000', '--site-origin', 'x.dev']));
});
