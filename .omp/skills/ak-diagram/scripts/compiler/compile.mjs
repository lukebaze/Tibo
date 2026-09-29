#!/usr/bin/env node

/**
 * AgentKit Diagram Deterministic Compiler (Node 18+ ESM)
 * Compiles typed JSON IR into deterministic SVG, trusted embeddable fragments,
 * and self-contained HTML readers. Validation, layout, routing and rendering
 * live in sibling modules; this file owns option parsing and assembly.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateIR } from './validate-ir.mjs';
import { layoutScene } from './layout-engine.mjs';
import { renderScene, escapeXml } from './render-svg.mjs';
import { paletteCss, roleTokenCss } from './palettes.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '../..');

const VALID_FORMATS = ['svg', 'fragment', 'html'];
const VALID_PRESETS = ['classic', 'signal-flow', 'blueprint', 'editorial'];
const VALID_THEMES = ['light', 'dark'];

function serializeJsonForScript(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function parseArgs(args) {
  const options = { input: null, format: 'html', out: null, preset: null, theme: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = i + 1 < args.length ? args[i + 1] : null;
    if (arg === '--input' && next !== null) options.input = args[++i];
    else if (arg === '--format' && next !== null) options.format = args[++i];
    else if (arg === '--out' && next !== null) options.out = args[++i];
    else if (arg === '--preset' && next !== null) options.preset = args[++i];
    else if (arg === '--theme' && next !== null) options.theme = args[++i];
  }
  if (!VALID_FORMATS.includes(options.format)) {
    throw new Error(`Invalid --format "${options.format}". Must be one of ${VALID_FORMATS.join(', ')}`);
  }
  if (options.preset && !VALID_PRESETS.includes(options.preset)) {
    throw new Error(`Invalid --preset "${options.preset}". Must be one of ${VALID_PRESETS.join(', ')}`);
  }
  if (options.theme && !VALID_THEMES.includes(options.theme)) {
    throw new Error(`Invalid --theme "${options.theme}". Must be one of ${VALID_THEMES.join(', ')}`);
  }
  return options;
}

let assetCache = null;
function loadAssets() {
  if (!assetCache) {
    assetCache = {
      readerCss: readFileSync(join(ROOT_DIR, 'assets/reader.css'), 'utf-8'),
      coreCss: readFileSync(join(ROOT_DIR, 'assets/diagram-core.css'), 'utf-8'),
      readerJs: readFileSync(join(ROOT_DIR, 'assets/reader.js'), 'utf-8'),
    };
  }
  return assetCache;
}

function toolbar(data, theme) {
  const meta = data.meta;
  const subtitleHtml = meta.subtitle ? `<span class="ak-diagram-subtitle"> - ${escapeXml(meta.subtitle)}</span>` : '';
  const hasViews = meta.views && meta.views.length > 0;
  const chapterControl = hasViews ? `<div class="ak-chapter-controls">
    <button type="button" class="ak-diagram-btn ak-btn-prev-chapter" title="Previous Chapter ([)">&#8249;</button>
    <span class="ak-chapter-label">1/${meta.views.length}</span>
    <button type="button" class="ak-diagram-btn ak-btn-next-chapter" title="Next Chapter (])">&#8250;</button>
  </div>` : '';
  return `<div class="ak-diagram-toolbar">
      <h4 class="ak-diagram-title"><span>&#128202;</span> ${escapeXml(meta.title)}${subtitleHtml}</h4>
      <div class="ak-diagram-controls">
        <input type="text" class="ak-diagram-search-input" placeholder="Search (/) ..." aria-label="Search diagram nodes and descriptions" />
        <button type="button" class="ak-diagram-btn ak-btn-reach-down" title="Downstream Reach">&#8595; Reach</button>
        <button type="button" class="ak-diagram-btn ak-btn-reach-up" title="Upstream Reach">&#8593; Reach</button>
        <button type="button" class="ak-diagram-btn ak-btn-route" title="Route Inspection (R)">&#128205; Route</button>
        <button type="button" class="ak-diagram-btn ak-btn-lens" title="Role Lens (L)">&#128269; Lens</button>
        ${chapterControl}
        <button type="button" class="ak-diagram-btn ak-btn-motion" title="Replay motion (M)">&#9654; Replay</button>
        <button type="button" class="ak-diagram-btn ak-btn-theme" title="Toggle Light/Dark">${theme === 'dark' ? '&#9728;&#65039;' : '&#127769;'}</button>
        <button type="button" class="ak-diagram-btn ak-btn-present" title="Presentation Stage (F)">&#9974;</button>
        <button type="button" class="ak-diagram-btn ak-btn-share" title="Export 1200x630 Share Card">&#128228; Card</button>
      </div>
    </div>`;
}

/**
 * Compile IR (object or JSON string) to `svg`, `fragment` or `html`.
 * Output is byte-deterministic for identical input and options.
 */
function compile(rawJson, options = {}) {
  const data = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const type = validateIR(data);
  const meta = data.meta || {};
  const preset = options.preset || meta.visual_preset || 'classic';
  const theme = options.theme || meta.theme || 'light';
  const animation = meta.animation || 'none';
  const instanceId = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 8);
  const assets = loadAssets();
  const scene = layoutScene(type, data);
  const standalone = options.format === 'svg';
  const styleBlock = standalone
    ? `${paletteCss(preset, theme, 'svg')}\n${roleTokenCss()}\n${assets.coreCss}`
    : '';
  const svg = renderScene(scene, { meta, preset, theme, instanceId, animation, styleBlock });
  if (standalone) return svg;

  const fragment = `<div class="ak-diagram-root" data-instance-id="${instanceId}" data-preset="${escapeXml(preset)}" data-theme="${escapeXml(theme)}" data-animation="${escapeXml(animation)}">
    <style>${assets.readerCss}\n${roleTokenCss()}\n${assets.coreCss}</style>
    ${toolbar(data, theme)}
    <div class="ak-diagram-viewport">
      ${svg}
    </div>
    <script type="application/json" class="ak-diagram-data">${serializeJsonForScript(data)}</script>
    <script>${assets.readerJs}</script>
  </div>`;
  if (options.format === 'fragment') return fragment;

  return `<!DOCTYPE html>
<html lang="${escapeXml(meta.locale || 'en')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(meta.title)}</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: ${theme === 'dark' ? '#05070c' : '#f1f5f9'};
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  ${fragment}
</body>
</html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.input) {
      console.error('Usage: node compile.mjs --input <diagram.json> [--format svg|fragment|html] [--out <output_path>] [--preset <preset>] [--theme <light|dark>]');
      process.exit(1);
    }
    const raw = readFileSync(options.input, 'utf-8');
    const output = compile(raw, options);
    if (options.out) {
      mkdirSync(dirname(resolve(options.out)), { recursive: true });
      writeFileSync(options.out, output, 'utf-8');
      console.log(`Successfully compiled to ${options.out}`);
    } else {
      process.stdout.write(output);
    }
  } catch (err) {
    console.error(`Compilation Error: ${err.message}`);
    process.exit(1);
  }
}

export { compile, validateIR, layoutScene };
