/**
 * SVG emitter for laid-out scenes.
 * Emits frames, routed edges, role cards with sigils, a legend and the motion
 * hooks (`data-animate`, `--step`). The `.ak-node` / `.ak-edge` attribute order
 * is a consumer contract read by the reader and its tests: keep it stable.
 */
import { textWidth, truncateToWidth, fmt } from './text-metrics.mjs';
import { sigilPath } from './semantics.mjs';

export function escapeXml(unsafe) {
  return String(unsafe ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const GRID = 24;

function renderHeader(scene) {
  const { title, subtitle } = scene.header;
  if (!title && !subtitle) return '';
  const x = scene.viewBox.x + 40;
  const y = scene.viewBox.y + 34;
  let out = '<g class="ak-header">';
  if (title) out += `<text class="ak-title" x="${fmt(x)}" y="${fmt(y)}">${escapeXml(title)}</text>`;
  if (subtitle) out += `<text class="ak-subtitle" x="${fmt(x)}" y="${fmt(y + 18)}">${escapeXml(subtitle)}</text>`;
  return out + '</g>';
}

function renderFrame(frame) {
  const cls = `ak-${frame.kind}`;
  const idAttr = `data-${frame.kind}-id="${escapeXml(frame.id)}"`;
  const rect = `<rect class="ak-frame ak-frame-${frame.kind}" x="${fmt(frame.x)}" y="${fmt(frame.y)}" width="${fmt(frame.w)}" height="${fmt(frame.h)}" rx="12"/>`;
  const labelX = frame.kind === 'stage' ? frame.x + frame.w / 2 : frame.x + 14;
  const anchor = frame.kind === 'stage' ? ' text-anchor="middle"' : '';
  let label = `<text class="ak-frame-label" x="${fmt(labelX)}" y="${fmt(frame.y + 21)}"${anchor}>${escapeXml(frame.label)}</text>`;
  if (frame.role && frame.kind !== 'stage') {
    const labelW = textWidth(frame.label.toUpperCase(), 10.5, 700) + frame.label.length * 0.84;
    label += `<text class="ak-frame-role" x="${fmt(frame.x + 14 + labelW + 14)}" y="${fmt(frame.y + 21)}">${escapeXml(frame.role)}</text>`;
  }
  return `<g class="${cls}" ${idAttr} data-animate="frame">${rect}${label}</g>`;
}

function renderEdge(edge, markerId, openMarkerId, trace) {
  const marker = edge.open ? openMarkerId : markerId;
  const dashed = edge.dashed ? ' ak-edge-dashed' : '';
  let out = `<g class="ak-edge" data-from="${escapeXml(edge.source)}" data-to="${escapeXml(edge.target)}" data-edge-id="${escapeXml(edge.id)}" data-kind="${escapeXml(edge.kind || 'forward')}"${edge.tone ? ` data-tone="${escapeXml(edge.tone)}"` : ''} data-animate="edge" data-route="${edge.route}" style="--step:${edge.step}">`;
  out += `<path class="ak-edge-path${dashed}" d="${edge.path}" pathLength="100" marker-end="url(#${marker})"/>`;
  if (trace) out += `<path class="ak-edge-flow" d="${edge.path}" pathLength="100"/>`;
  if (edge.labelBox) {
    const box = edge.labelBox;
    out += `<g class="ak-edge-label"><rect class="ak-edge-label-mask" x="${fmt(box.rect.x)}" y="${fmt(box.rect.y)}" width="${fmt(box.w)}" height="${fmt(box.h)}" rx="9"/>`;
    out += `<text x="${fmt(box.x)}" y="${fmt(box.rect.y + 12.5)}" text-anchor="${box.anchor}">${escapeXml(edge.label)}</text></g>`;
  }
  return out + '</g>';
}

function renderNode(node) {
  const cy = node.y + node.h / 2;
  const rx = node.shape === 'pill' ? node.h / 2 : node.shape === 'notch' ? 4 : 10;
  const textX = node.x + 40;
  const innerW = node.w - 40 - 12;
  const label = truncateToWidth(node.label, innerW, 13, 600);
  const sub = truncateToWidth(node.sublabel, innerW, 9.5, 600);
  let out = `<g class="ak-node" data-node-id="${escapeXml(node.id)}" data-label="${escapeXml(node.label)}" data-role="${escapeXml(node.role)}" data-desc="${escapeXml(node.desc)}" data-family="${node.family}" data-shape="${node.shape}" tabindex="0" data-animate="node" style="--step:${node.step}">`;
  out += `<rect class="ak-node-mask" x="${fmt(node.x)}" y="${fmt(node.y)}" width="${fmt(node.w)}" height="${fmt(node.h)}" rx="${fmt(rx)}"/>`;
  out += `<rect class="ak-node-card" x="${fmt(node.x)}" y="${fmt(node.y)}" width="${fmt(node.w)}" height="${fmt(node.h)}" rx="${fmt(rx)}"/>`;
  if (node.shape === 'card') {
    out += `<rect class="ak-node-accent" x="${fmt(node.x + 1)}" y="${fmt(node.y + 10)}" width="3" height="${fmt(node.h - 20)}" rx="1.5"/>`;
  }
  out += `<g class="ak-sigil" transform="translate(${fmt(node.x + 14)} ${fmt(cy - 8)})"><path d="${sigilPath(node.family)}"/></g>`;
  if (node.shape === 'pill') {
    out += `<text class="ak-node-label" x="${fmt(textX)}" y="${fmt(cy + 4.5)}">${escapeXml(label)}</text>`;
  } else {
    out += `<text class="ak-node-label" x="${fmt(textX)}" y="${fmt(cy - 2)}">${escapeXml(label)}</text>`;
    out += `<text class="ak-node-sub" x="${fmt(textX)}" y="${fmt(cy + 13)}">${escapeXml(sub)}</text>`;
  }
  return out + '</g>';
}

function renderLegend(scene) {
  if (!scene.legend.length) return { svg: '', width: 0 };
  let x = scene.viewBox.x + 40;
  const y = scene.legendY + 12;
  let out = `<g class="ak-legend">`;
  for (const item of scene.legend) {
    out += `<g class="ak-legend-item" data-family="${item.family}"><rect class="ak-legend-swatch" x="${fmt(x)}" y="${fmt(y - 6)}" width="12" height="12" rx="3"/>`;
    out += `<text x="${fmt(x + 18)}" y="${fmt(y + 4)}">${escapeXml(item.label)}</text></g>`;
    x += 18 + textWidth(item.label, 10.5, 500) + 22;
  }
  return { svg: out + '</g>', width: x - scene.viewBox.x + 20 };
}

function renderSequenceExtras(scene) {
  let out = '';
  for (const line of scene.lifelines) {
    out += `<line class="ak-lifeline" data-participant="${escapeXml(line.id)}" x1="${fmt(line.x)}" y1="${fmt(line.y0)}" x2="${fmt(line.x)}" y2="${fmt(line.y1)}"/>`;
  }
  for (const bar of scene.activations) {
    out += `<rect class="ak-activation" x="${fmt(bar.x)}" y="${fmt(bar.y0)}" width="10" height="${fmt(Math.max(bar.y1 - bar.y0, 8))}" rx="2"/>`;
  }
  return out;
}

/**
 * Render a scene to an `<svg>` string.
 * `options.styleBlock` is inlined for standalone SVGs; the reader fragment
 * carries its CSS outside the svg instead.
 */
export function renderScene(scene, options) {
  const { meta, preset, theme, instanceId, animation, styleBlock } = options;
  const legend = renderLegend(scene);
  const vb = scene.viewBox;
  const width = Math.max(vb.w, legend.width);
  const markerId = `ak-arrowhead-${instanceId}`;
  const openMarkerId = `ak-arrowhead-open-${instanceId}`;
  const gridId = `ak-grid-${instanceId}`;
  const trace = animation === 'trace';

  let svg = `<svg class="ak-diagram-svg" viewBox="${fmt(vb.x)} ${fmt(vb.y)} ${fmt(width)} ${fmt(vb.h)}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(meta.title)}" data-diagram-type="${scene.type}" data-preset="${escapeXml(preset)}" data-theme="${escapeXml(theme)}" data-animation="${escapeXml(animation)}" data-motion="play">`;
  svg += `<title>${escapeXml(meta.title)}</title>`;
  if (meta.description) svg += `<desc>${escapeXml(meta.description)}</desc>`;
  svg += '<defs>';
  if (styleBlock) svg += `<style>${styleBlock}</style>`;
  svg += `<marker id="${markerId}" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path class="ak-arrowhead" d="M0 0L9 3.5L0 7z"/></marker>`;
  svg += `<marker id="${openMarkerId}" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path class="ak-arrowhead-open" d="M0 0L8 3.5L0 7"/></marker>`;
  svg += `<pattern id="${gridId}" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse"><circle class="ak-grid-dot" cx="1" cy="1" r="1"/></pattern>`;
  svg += '</defs>';
  svg += `<rect class="ak-canvas" x="${fmt(vb.x)}" y="${fmt(vb.y)}" width="${fmt(width)}" height="${fmt(vb.h)}"/>`;
  svg += `<rect class="ak-canvas-grid" x="${fmt(vb.x)}" y="${fmt(vb.y)}" width="${fmt(width)}" height="${fmt(vb.h)}" fill="url(#${gridId})"/>`;
  svg += renderHeader(scene);
  for (const frame of scene.frames) svg += renderFrame(frame);
  if (scene.kind === 'sequence') svg += renderSequenceExtras(scene);
  for (const edge of scene.edges) svg += renderEdge(edge, markerId, openMarkerId, trace);
  for (const node of scene.nodes) svg += renderNode(node);
  svg += legend.svg;
  return svg + '</svg>';
}
