/**
 * Visual semantics for the ak:diagram compiler.
 * Every archetype role or kind maps onto a small set of visual families. A
 * family owns a colour token (`--ak-role-<family>-*`), a 16x16 stroke sigil and
 * a legend label, so the five archetypes share one consistent language.
 */

/** Sigil glyphs drawn in a 16x16 box with stroke only (no fill). */
const SIGILS = {
  client: 'M2 3h12v8H2zM6 14h4M8 11v3',
  service: 'M3 3h10v10H3zM6 6h4M6 8h4M6 10h2',
  data: 'M3 4c0-1.5 10-1.5 10 0v8c0 1.5-10 1.5-10 0zM3 4c0 1.5 10 1.5 10 0M3 8c0 1.5 10 1.5 10 0',
  queue: 'M2 5h3v6H2zM6.5 5h3v6h-3zM11 5h3v6h-3z',
  cache: 'M2 8l6-5 6 5-6 5zM8 3v10',
  gateway: 'M8 2v12M3 6l5-4 5 4M3 10l5 4 5-4',
  security: 'M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4zM5.5 8l2 2 3-3',
  external: 'M3 8a5 5 0 0 1 10 0 5 5 0 0 1-10 0zM3 8h10M8 3c-2 2-2 8 0 10M8 3c2 2 2 8 0 10',
  worker: 'M3 13l4-4M6 3l7 7-2 2-7-7zM10 4l2 2',
  start: 'M5 3l8 5-8 5z',
  success: 'M3 8l3 3 7-7',
  failure: 'M4 4l8 8M12 4l-8 8',
  waiting: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3l2 2',
  decision: 'M8 2l6 6-6 6-6-6z',
  process: 'M3 4h10M3 8h10M3 12h6',
  governance: 'M3 3h10v3H3zM3 8h10v5H3zM6 10h4',
  transform: 'M2 5h6l3 3-3 3H2zM10 8h4',
  filter: 'M2 3h12l-5 5v5l-2-1V8z',
};

/** Human labels for the legend. */
const FAMILY_LABELS = {
  client: 'Client',
  service: 'Service',
  data: 'Data store',
  queue: 'Queue',
  cache: 'Cache',
  gateway: 'Gateway',
  security: 'Auth / security',
  external: 'External',
  worker: 'Worker',
  start: 'Start',
  success: 'Success',
  failure: 'Failure',
  waiting: 'Waiting',
  decision: 'Decision',
  process: 'Process',
  governance: 'Governance',
  transform: 'Transform',
  filter: 'Filter',
};

/** Ordered family list so legends and CSS stay stable. */
const FAMILY_ORDER = Object.keys(SIGILS);

const ROLE_FAMILY = {
  architecture: {
    frontend: 'client', backend: 'service', database: 'data', cache: 'cache',
    queue: 'queue', storage: 'data', gateway: 'gateway', auth: 'security',
    external: 'external', worker: 'worker',
  },
  workflow: {
    start: 'start', action: 'process', decision: 'decision', wait: 'waiting',
    subprocess: 'service', 'terminal-success': 'success', 'terminal-failure': 'failure',
  },
  dataflow: {
    source: 'external', transform: 'transform', store: 'data', sink: 'queue',
    consumer: 'client', filter: 'filter', governance: 'governance',
  },
  lifecycle: {
    initial: 'start', active: 'process', waiting: 'waiting',
    'failure-recoverable': 'failure', 'failure-fatal': 'failure',
    'terminal-success': 'success', 'terminal-cancelled': 'failure',
  },
  sequence: {},
};

/** Resolve the visual family for a node of the given archetype. */
export function familyFor(type, roleOrKind) {
  const table = ROLE_FAMILY[type] || {};
  if (roleOrKind && table[roleOrKind]) return table[roleOrKind];
  if (type === 'sequence') {
    const guess = String(roleOrKind || '').toLowerCase();
    if (/user|client|browser|actor/.test(guess)) return 'client';
    if (/db|database|store|storage/.test(guess)) return 'data';
    if (/queue|bus|broker/.test(guess)) return 'queue';
    if (/external|third|vendor/.test(guess)) return 'external';
    if (/gateway|proxy|edge/.test(guess)) return 'gateway';
    if (/auth|security|iam/.test(guess)) return 'security';
    return 'service';
  }
  return 'service';
}

/** Card shape variant per family, so terminals and decisions read at a glance. */
export function shapeFor(family) {
  if (family === 'start' || family === 'success' || family === 'failure') return 'pill';
  if (family === 'decision') return 'notch';
  return 'card';
}

export function sigilPath(family) {
  return SIGILS[family] || SIGILS.service;
}

export function familyLabel(family) {
  return FAMILY_LABELS[family] || family;
}

/** Legend rows for the families present, in canonical order. */
export function legendFor(families) {
  const present = new Set(families);
  return FAMILY_ORDER.filter((f) => present.has(f)).map((family) => ({
    family,
    label: familyLabel(family),
  }));
}

/** Edge dash style by archetype kind; solid by default. */
export function edgeStyleFor(type, edge) {
  if (type === 'sequence') {
    if (edge.kind === 'return') return { dashed: true, open: true };
    if (edge.kind === 'async-signal') return { dashed: true, open: false };
    if (edge.kind === 'error') return { dashed: false, open: false, tone: 'failure' };
    return { dashed: false, open: false };
  }
  if (type === 'workflow' && edge.condition) return { dashed: false, open: false, tone: 'decision' };
  if (type === 'lifecycle' && /fail|error|timeout|reject/i.test(edge.event || '')) {
    return { dashed: true, open: false, tone: 'failure' };
  }
  return { dashed: false, open: false };
}

export { FAMILY_ORDER, FAMILY_LABELS };
