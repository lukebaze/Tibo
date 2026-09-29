/**
 * Preset x theme palettes and per-family role tokens.
 * The preset palettes mirror the variable blocks in `assets/reader.css` so a
 * standalone SVG (no reader) resolves the same colours as the embedded reader.
 * Role tokens are generated here for both scopes (reader root and bare svg).
 */

export const PRESET_THEME_PALETTES = {
  'classic:light': {
    '--ak-bg': '#ffffff', '--ak-surface': '#f8fafc', '--ak-surface-border': '#e2e8f0',
    '--ak-text-primary': '#0f172a', '--ak-text-secondary': '#475569', '--ak-text-muted': '#94a3b8',
    '--ak-accent': '#2563eb', '--ak-accent-light': '#dbeafe',
    '--ak-node-bg': '#ffffff', '--ak-node-border': '#cbd5e1',
    '--ak-edge-stroke': '#64748b', '--ak-edge-active': '#2563eb',
    '--ak-badge-bg': '#f1f5f9', '--ak-font-sans': 'system-ui, -apple-system, sans-serif',
    '--ak-font-mono': 'ui-monospace, monospace',
  },
  'classic:dark': {
    '--ak-bg': '#090d16', '--ak-surface': '#0f172a', '--ak-surface-border': '#1e293b',
    '--ak-text-primary': '#f8fafc', '--ak-text-secondary': '#94a3b8', '--ak-text-muted': '#64748b',
    '--ak-accent': '#38bdf8', '--ak-accent-light': '#0369a1',
    '--ak-node-bg': '#0f172a', '--ak-node-border': '#334155',
    '--ak-edge-stroke': '#475569', '--ak-edge-active': '#38bdf8',
    '--ak-badge-bg': '#1e293b', '--ak-font-sans': 'system-ui, -apple-system, sans-serif',
    '--ak-font-mono': 'ui-monospace, monospace',
  },
  'signal-flow:light': {
    '--ak-bg': '#f0fdf4', '--ak-surface': '#dcfce7', '--ak-surface-border': '#86efac',
    '--ak-text-primary': '#14532d', '--ak-text-secondary': '#166534', '--ak-text-muted': '#4ade80',
    '--ak-accent': '#059669', '--ak-accent-light': '#d1fae5',
    '--ak-node-bg': '#ffffff', '--ak-node-border': '#10b981',
    '--ak-edge-stroke': '#059669', '--ak-edge-active': '#047857',
    '--ak-badge-bg': '#dcfce7', '--ak-font-sans': 'system-ui, -apple-system, sans-serif',
    '--ak-font-mono': 'ui-monospace, monospace',
  },
  'signal-flow:dark': {
    '--ak-bg': '#031c18', '--ak-surface': '#064e3b', '--ak-surface-border': '#047857',
    '--ak-text-primary': '#ecfdf5', '--ak-text-secondary': '#a7f3d0', '--ak-text-muted': '#34d399',
    '--ak-accent': '#34d399', '--ak-accent-light': '#065f46',
    '--ak-node-bg': '#064e3b', '--ak-node-border': '#10b981',
    '--ak-edge-stroke': '#34d399', '--ak-edge-active': '#6ee7b7',
    '--ak-badge-bg': '#064e3b', '--ak-font-sans': 'system-ui, -apple-system, sans-serif',
    '--ak-font-mono': 'ui-monospace, monospace',
  },
  'blueprint:light': {
    '--ak-bg': '#f0f9ff', '--ak-surface': '#e0f2fe', '--ak-surface-border': '#7dd3fc',
    '--ak-text-primary': '#0369a1', '--ak-text-secondary': '#0284c7', '--ak-text-muted': '#38bdf8',
    '--ak-accent': '#0284c7', '--ak-accent-light': '#bae6fd',
    '--ak-node-bg': '#ffffff', '--ak-node-border': '#0ea5e9',
    '--ak-edge-stroke': '#0284c7', '--ak-edge-active': '#0369a1',
    '--ak-badge-bg': '#e0f2fe', '--ak-font-sans': 'ui-monospace, monospace',
    '--ak-font-mono': 'ui-monospace, monospace',
  },
  'blueprint:dark': {
    '--ak-bg': '#081d33', '--ak-surface': '#0c2a4a', '--ak-surface-border': '#1e4976',
    '--ak-text-primary': '#e0f2fe', '--ak-text-secondary': '#bae6fd', '--ak-text-muted': '#38bdf8',
    '--ak-accent': '#38bdf8', '--ak-accent-light': '#0369a1',
    '--ak-node-bg': '#0c213a', '--ak-node-border': '#38bdf8',
    '--ak-edge-stroke': '#7dd3fc', '--ak-edge-active': '#38bdf8',
    '--ak-badge-bg': '#0c213a', '--ak-font-sans': 'ui-monospace, monospace',
    '--ak-font-mono': 'ui-monospace, monospace',
  },
  'editorial:light': {
    '--ak-bg': '#faf8f5', '--ak-surface': '#f3efe6', '--ak-surface-border': '#e2dacb',
    '--ak-text-primary': '#1c1917', '--ak-text-secondary': '#57534e', '--ak-text-muted': '#a8a29e',
    '--ak-accent': '#991b1b', '--ak-accent-light': '#fecaca',
    '--ak-node-bg': '#ffffff', '--ak-node-border': '#d6cfc4',
    '--ak-edge-stroke': '#78716c', '--ak-edge-active': '#991b1b',
    '--ak-badge-bg': '#f3efe6', '--ak-font-sans': 'system-ui, serif',
    '--ak-font-mono': 'ui-monospace, monospace',
  },
  'editorial:dark': {
    '--ak-bg': '#1c1917', '--ak-surface': '#292524', '--ak-surface-border': '#44403c',
    '--ak-text-primary': '#fafaf9', '--ak-text-secondary': '#d6d3d1', '--ak-text-muted': '#78716c',
    '--ak-accent': '#ef4444', '--ak-accent-light': '#7f1d1d',
    '--ak-node-bg': '#292524', '--ak-node-border': '#78716c',
    '--ak-edge-stroke': '#a8a29e', '--ak-edge-active': '#f87171',
    '--ak-badge-bg': '#292524', '--ak-font-sans': 'system-ui, serif',
    '--ak-font-mono': 'ui-monospace, monospace',
  },
};

/** Family stroke colours per theme; fills are derived with low alpha. */
export const ROLE_COLORS = {
  client: ['#0e7490', '#22d3ee'],
  service: ['#4f46e5', '#818cf8'],
  data: ['#b45309', '#fbbf24'],
  queue: ['#7c3aed', '#a78bfa'],
  cache: ['#c2410c', '#fb923c'],
  gateway: ['#0369a1', '#38bdf8'],
  security: ['#be123c', '#fb7185'],
  external: ['#475569', '#94a3b8'],
  worker: ['#0f766e', '#2dd4bf'],
  start: ['#047857', '#34d399'],
  success: ['#059669', '#34d399'],
  failure: ['#b91c1c', '#f87171'],
  waiting: ['#a16207', '#facc15'],
  decision: ['#a21caf', '#e879f9'],
  process: ['#1d4ed8', '#60a5fa'],
  governance: ['#6d28d9', '#c4b5fd'],
  transform: ['#4338ca', '#a5b4fc'],
  filter: ['#4d7c0f', '#a3e635'],
};

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** CSS declaring `--ak-role-<family>-stroke/fill` for light and dark scopes. */
export function roleTokenCss() {
  const light = [];
  const dark = [];
  for (const [family, [l, d]] of Object.entries(ROLE_COLORS)) {
    light.push(`--ak-role-${family}-stroke:${l};--ak-role-${family}-fill:${rgba(l, 0.1)};`);
    dark.push(`--ak-role-${family}-stroke:${d};--ak-role-${family}-fill:${rgba(d, 0.16)};`);
  }
  const perFamily = Object.keys(ROLE_COLORS).map((family) =>
    `.ak-node[data-family="${family}"]{--ak-node-stroke:var(--ak-role-${family}-stroke);--ak-node-fill:var(--ak-role-${family}-fill);}` +
    `.ak-legend-item[data-family="${family}"] .ak-legend-swatch{fill:var(--ak-role-${family}-fill);stroke:var(--ak-role-${family}-stroke);}`).join('\n');
  return [
    `.ak-diagram-root,svg.ak-diagram-svg{${light.join('')}}`,
    `.ak-diagram-root[data-theme="dark"],svg.ak-diagram-svg[data-theme="dark"]{${dark.join('')}}`,
    perFamily,
  ].join('\n');
}

/** Resolve a palette for a standalone svg `<style>` block. */
export function paletteCss(preset, theme, selector = 'svg') {
  const palette = PRESET_THEME_PALETTES[`${preset}:${theme}`] || PRESET_THEME_PALETTES['classic:light'];
  const body = Object.entries(palette).map(([k, v]) => `${k}:${v};`).join('');
  return `${selector}{${body}font-family:var(--ak-font-sans);}`;
}
