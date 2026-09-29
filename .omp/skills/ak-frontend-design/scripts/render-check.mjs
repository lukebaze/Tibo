#!/usr/bin/env node
// Render a page at several viewports, save full-page screenshots, and report layout
// defects as text so the result can be judged even without image input.
// Standard library only: needs Node >= 22 (global WebSocket) and a local Chrome, Edge
// or Chromium (set CHROME_PATH to override discovery).
//
// Usage: node render-check.mjs <file.html|url> [--out dir] [--viewports 375x812,768x1024,1440x900]
// Exit codes: 0 no errors found, 1 errors found, 2 could not run.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_VIEWPORTS = '375x812,768x1024,1440x900';
const MAX_SHOT_HEIGHT = 16000;

function parseArgs(argv) {
  const opts = { target: null, out: 'render-check', viewports: DEFAULT_VIEWPORTS };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--viewports') opts.viewports = argv[++i];
    else if (!opts.target) opts.target = argv[i];
  }
  return opts;
}

function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    join(pf, 'Google/Chrome/Application/chrome.exe'),
    join(pf86, 'Google/Chrome/Application/chrome.exe'),
    join(local, 'Google/Chrome/Application/chrome.exe'),
    join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    try {
      const p = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (p) return p;
    } catch { /* not installed */ }
  }
  return null;
}

function launch(browserPath, profileDir) {
  const proc = spawn(browserPath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((ok, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('browser did not expose a DevTools endpoint within 20s')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); ok({ proc, wsUrl: m[1] }); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); fail(new Error(`browser exited early (code ${code})`)); });
  });
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = nextId++;
    pending.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return new Promise((ok, fail) => {
    ws.onopen = () => ok({ send, on: (fn) => listeners.push(fn), close: () => ws.close() });
    ws.onerror = () => fail(new Error('could not connect to the browser'));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs inside the page. Returns { outline, findings }.
function pageChecks() {
  const vw = window.innerWidth;
  const findings = [];
  const add = (severity, type, el, message) => findings.push({ severity, type, target: el ? describe(el) : '', message });
  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return text ? `${s} "${text}"` : s;
  }
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw; // off-canvas drawers do not count
  };
  const all = [...document.body.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName));
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  // Canvas converts any CSS color (oklch, color-mix, named) to sRGB.
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  function rgba(color) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  }
  const lum = ([r, g, b]) => {
    const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  function backgroundOf(el) {
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return null; // gradient or image: unknown
      const c = rgba(cs.backgroundColor);
      if (c[3] >= 0.5) return c;
    }
    return rgba(getComputedStyle(document.documentElement).backgroundColor)[3] ? rgba(getComputedStyle(document.documentElement).backgroundColor) : [255, 255, 255, 1];
  }

  // 1. Horizontal overflow.
  const overflow = document.documentElement.scrollWidth - vw;
  if (overflow > 1) {
    const culprits = all.filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 1)
      .filter((el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= vw + 1).slice(0, 5);
    add('error', 'horizontal-overflow', null, `page is ${overflow}px wider than the viewport; widest offenders: ${culprits.map(describe).join('; ') || 'unknown'}`);
  }

  // 2. Main content squeezed (typical symptom of a broken app shell or stray grid item).
  const main = document.querySelector('main, [role="main"]');
  if (main && visible(main) && vw >= 1024) {
    const w = main.getBoundingClientRect().width;
    if (w < vw * 0.5) add('error', 'main-narrow', main, `main content is ${Math.round(w)}px wide (${Math.round((w / vw) * 100)}% of the viewport)`);
  }

  // 3. Empty in-flow children occupying grid tracks and shifting their siblings.
  for (const grid of all.filter((el) => ['grid', 'inline-grid'].includes(getComputedStyle(el).display))) {
    for (const child of grid.children) {
      const cs = getComputedStyle(child);
      if (cs.display === 'none' || ['absolute', 'fixed'].includes(cs.position)) continue;
      const media = 'img,svg,canvas,video,iframe,input,button,select,textarea,picture';
      if (child.textContent.trim() || child.matches(media) || child.querySelector(media)) continue;
      if (cs.backgroundImage !== 'none' || rgba(cs.backgroundColor)[3] > 0 || parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth) > 0) continue;
      if (['::before', '::after'].some((p) => getComputedStyle(child, p).content !== 'none')) continue;
      // Narrow decorative cells (timeline rails, icon slots) are fine; a stray item in a major track is not.
      if (child.getBoundingClientRect().width < grid.getBoundingClientRect().width * 0.25) continue;
      add('warn', 'empty-grid-item', child, `empty element takes a track in ${describe(grid)}; later children shift to the wrong column/row (position overlays fixed/absolute at every breakpoint, or move them out of the grid)`);
    }
  }

  // 4. Text contrast.
  const lowContrast = [];
  for (const el of all) {
    if (!ownText(el) || !visible(el) || !/\p{L}|\p{N}/u.test(el.innerText)) continue; // skip separators and icons
    const cs = getComputedStyle(el);
    const bg = backgroundOf(el);
    if (!bg) continue;
    const fg = rgba(cs.color);
    const blended = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const [l1, l2] = [lum(blended), lum(bg)].sort((a, b) => b - a);
    const ratio = (l1 + 0.05) / (l2 + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) lowContrast.push({ el, ratio });
  }
  lowContrast.sort((a, b) => a.ratio - b.ratio).slice(0, 8)
    .forEach(({ el, ratio }) => add(ratio < 2 ? 'error' : 'warn', 'low-contrast', el, `text contrast ${ratio.toFixed(2)}:1`));

  // 5. Adjacent text elements touching on the same line (missing gap or whitespace).
  // Measures the glyph boxes, so padding inside table cells or buttons counts as space.
  const textRect = (el, last) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    return last ? rects[rects.length - 1] : rects[0];
  };
  let touching = 0;
  for (const el of all) {
    const next = el.nextElementSibling;
    if (!next || touching >= 6 || !visible(el) || !visible(next)) continue;
    if (!/\p{L}|\p{N}/u.test(el.innerText || '') || !/\p{L}|\p{N}/u.test(next.innerText || '')) continue;
    let between = el.nextSibling, space = false;
    while (between && between !== next) { if (between.nodeType === 3 && /\s/.test(between.textContent)) space = true; between = between.nextSibling; }
    if (space) continue;
    const a = textRect(el, true), b = textRect(next, false);
    if (!a || !b) continue;
    const sameLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) * 0.5;
    const gap = b.left - a.right;
    if (sameLine && gap >= -1 && gap < 2 && a.height < 80) { touching++; add('warn', 'touching-text', el, `runs into the next element ${describe(next)} with a ${gap.toFixed(1)}px gap`); }
  }

  // 6. Clipped text.
  let clipped = 0;
  for (const el of all) {
    if (clipped >= 6 || !ownText(el) || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const clipX = ['hidden', 'clip'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis';
    const clipY = ['hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && cs.webkitLineClamp === 'none';
    if (clipX || clipY) { clipped++; add('warn', 'clipped-text', el, 'text is cut off by overflow without an ellipsis or line clamp'); }
  }

  // 7. Dialogs and overlays showing when they should be closed.
  for (const d of document.querySelectorAll('dialog:not([open])')) if (visible(d)) add('error', 'closed-dialog-visible', d, 'a closed <dialog> is rendered; never set display on dialog without [open]');
  for (const d of document.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
    if (d.tagName !== 'DIALOG' && visible(d) && getComputedStyle(d).pointerEvents !== 'none') add('warn', 'dialog-visible-on-load', d, 'a dialog is visible on first load; confirm this is intended');
  }

  // 8. Touch targets on small screens.
  if (vw < 768) {
    const small = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role="button"], [role="tab"]')]
      .filter((el) => visible(el) && !el.closest('p, li p, td p'))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 40 || r.width < 40; });
    if (small.length) add('warn', 'small-touch-target', null, `${small.length} controls smaller than 44px; e.g. ${small.slice(0, 4).map(describe).join('; ')}`);
  }

  // 9. Broken images and fonts.
  for (const img of document.images) if (img.complete && img.naturalWidth === 0 && visible(img)) add('error', 'broken-image', img, `image failed to load: ${img.currentSrc || img.src}`);
  for (const f of document.fonts) if (f.status === 'error') add('warn', 'font-failed', null, `font failed to load: ${f.family} ${f.weight}`);

  // Outline of the large boxes, so layout can be reasoned about as text.
  const outline = all.filter((el) => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    let depth = 0; for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) depth++;
    return depth <= 3 && r.width * r.height > vw * window.innerHeight * 0.04;
  }).slice(0, 30).map((el) => {
    const r = el.getBoundingClientRect();
    let depth = 0; for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) depth++;
    return `${'  '.repeat(depth)}${describe(el).slice(0, 60)} @ x${Math.round(r.left)} y${Math.round(r.top + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  });
  return { outline, findings, height: document.documentElement.scrollHeight };
}

async function checkViewport(cdp, sessionId, url, width, height, outDir) {
  const errors = [];
  const onEvent = (msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description?.split('\n')[0] || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text + (msg.params.entry.url ? ` (${msg.params.entry.url})` : ''));
  };
  cdp.on(onEvent);
  const s = (m, p) => cdp.send(m, p, sessionId);
  // mobile: false keeps the layout width fixed; mobile emulation would zoom out to fit and hide overflow.
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  let loaded;
  const loadedP = new Promise((r) => { loaded = r; });
  cdp.on((msg) => { if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') loaded(); });
  await s('Page.navigate', { url });
  await Promise.race([loadedP, sleep(30000)]);
  await s('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
  // Scroll through once so scroll-triggered reveals run, then return to the top.
  await s('Runtime.evaluate', {
    awaitPromise: true,
    expression: `(async () => { const h = document.documentElement.scrollHeight;
      for (let y = 0; y < h; y += Math.round(innerHeight / 2)) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
      scrollTo(0, 0); await new Promise(r => setTimeout(r, 700)); })()`,
  });
  const { result } = await s('Runtime.evaluate', { expression: `(${pageChecks.toString()})()`, returnByValue: true });
  const report = result.value;
  const shotHeight = Math.min(report.height, MAX_SHOT_HEIGHT);
  const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: shotHeight, scale: 1 } });
  const file = join(outDir, `${width}x${height}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  for (const e of [...new Set(errors)].slice(0, 5)) report.findings.unshift({ severity: 'error', type: 'runtime-error', target: '', message: e });
  return { viewport: `${width}x${height}`, screenshot: file, ...report };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.target) { console.error('usage: node render-check.mjs <file.html|url> [--out dir] [--viewports 375x812,768x1024,1440x900]'); process.exit(2); }
  if (typeof WebSocket === 'undefined') { console.error('render-check needs Node 22 or newer (global WebSocket).'); process.exit(2); }
  const browserPath = findBrowser();
  if (!browserPath) { console.error('No Chrome, Edge or Chromium found. Install one or set CHROME_PATH.'); process.exit(2); }
  const url = /^[a-z]+:\/\//i.test(opts.target) ? opts.target : pathToFileURL(resolve(opts.target)).href;
  const outDir = resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  const viewports = opts.viewports.split(',').map((v) => v.split('x').map(Number));

  const profile = mkdtempSync(join(tmpdir(), 'render-check-'));
  let proc;
  const results = [];
  try {
    const launched = await launch(browserPath, profile);
    proc = launched.proc;
    const cdp = await connect(launched.wsUrl);
    for (const [w, h] of viewports) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      for (const d of ['Page.enable', 'Runtime.enable', 'Log.enable']) await cdp.send(d, {}, sessionId);
      results.push(await checkViewport(cdp, sessionId, url, w, h, outDir));
      await cdp.send('Target.closeTarget', { targetId });
    }
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  } catch (e) {
    console.error(`render-check failed: ${e.message}`);
    process.exitCode = 2;
  } finally {
    if (proc && proc.exitCode === null) proc.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* browser may still hold files */ }
  }
  if (!results.length) return;

  writeFileSync(join(outDir, 'render-report.json'), JSON.stringify(results, null, 2));
  let errors = 0, warns = 0;
  console.log(`render-check: ${url}`);
  for (const r of results) {
    console.log(`\n[${r.viewport}] page height ${r.height}px, screenshot ${r.screenshot}`);
    console.log('  outline:');
    for (const line of r.outline) console.log('    ' + line);
    if (!r.findings.length) console.log('  no findings');
    for (const f of r.findings) {
      f.severity === 'error' ? errors++ : warns++;
      console.log(`  ${f.severity.toUpperCase().padEnd(5)} ${f.type}: ${f.target ? f.target + ' - ' : ''}${f.message}`);
    }
  }
  console.log(`\nSummary: ${errors} errors, ${warns} warnings. Fix errors first, re-run, then review the screenshots.`);
  if (errors && process.exitCode !== 2) process.exitCode = 1;
}

main();
