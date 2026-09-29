/**
 * Orthogonal edge router for layered scenes.
 * Nodes sit in rank columns. Forward edges leave the right side and enter the
 * left side of their target, turning inside the inter-column gap. Long edges
 * whose straight line would cross an unrelated node detour through a corridor
 * above or below the blocking band. Back edges loop through a corridor and
 * re-enter from the left, same-column edges use the right gap, and self loops
 * hug the node's right side. Ports are spread along the node side so several
 * routes never share one pixel, and every corner is rounded.
 */
import { textWidth, fmt } from './text-metrics.mjs';

const PORT_SPACING = 14;
const CHANNEL_SPACING = 12;
const CORRIDOR_PAD = 26;
const CORRIDOR_STEP = 12;
const CORNER = 10;
const LABEL_SIZE = 10.5;

function classify(a, b) {
  if (a.id === b.id) return 'self';
  if (a.rank < b.rank) return 'forward';
  if (a.rank > b.rank) return 'back';
  return 'same';
}

function spreadOffset(index, count, extent) {
  const spacing = Math.min(PORT_SPACING, Math.max(extent - 16, 0) / Math.max(count - 1, 1));
  return (index - (count - 1) / 2) * spacing;
}

/**
 * Assign per-node side offsets so parallel routes fan out in the order of
 * their far endpoint, which keeps most of them from crossing right at the port.
 */
function assignPorts(entries, nodeMap) {
  const groups = new Map();
  for (const entry of entries) {
    for (const end of ['from', 'to']) {
      const key = `${entry[end].node}|${entry[end].side}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ entry, end });
    }
  }
  for (const [key, members] of groups) {
    const [nodeId, side] = key.split('|');
    const node = nodeMap.get(nodeId);
    const vertical = side === 'left' || side === 'right';
    members.sort((p, q) => {
      const pa = p.entry[p.end === 'from' ? 'to' : 'from'];
      const qa = q.entry[q.end === 'from' ? 'to' : 'from'];
      const pn = nodeMap.get(pa.node);
      const qn = nodeMap.get(qa.node);
      const pv = vertical ? pn.y + pn.h / 2 : pn.x + pn.w / 2;
      const qv = vertical ? qn.y + qn.h / 2 : qn.x + qn.w / 2;
      if (pv !== qv) return pv - qv;
      return p.entry.id < q.entry.id ? -1 : 1;
    });
    members.forEach((member, index) => {
      const offset = spreadOffset(index, members.length, vertical ? node.h : node.w);
      member.entry[member.end].offset = offset;
    });
  }
}

function portPoint(node, side, offset) {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  if (side === 'right') return { x: node.x + node.w, y: cy + offset };
  if (side === 'left') return { x: node.x, y: cy + offset };
  if (side === 'top') return { x: cx + offset, y: node.y };
  return { x: cx + offset, y: node.y + node.h };
}

/** Nodes in ranks strictly between two ranks that block a horizontal at y. */
function blockedAt(y, lo, hi, nodes) {
  return nodes.some((n) => n.rank > lo && n.rank < hi && y >= n.y - 8 && y <= n.y + n.h + 8);
}

function bandOf(nodes, lo, hi) {
  const band = nodes.filter((n) => n.rank >= lo && n.rank <= hi);
  if (!band.length) return null;
  return {
    top: Math.min(...band.map((n) => n.y)),
    bottom: Math.max(...band.map((n) => n.y + n.h)),
  };
}

/** Build the point list with gap placeholders, before channel x is known. */
function planRoute(entry, nodeMap, nodes, corridorSlots) {
  const a = nodeMap.get(entry.from.node);
  const b = nodeMap.get(entry.to.node);
  const start = portPoint(a, entry.from.side, entry.from.offset);
  const end = portPoint(b, entry.to.side, entry.to.offset);
  const gap = (rank) => ({ gap: rank });
  const corridorFor = (lo, hi, preferY) => {
    const band = bandOf(nodes, lo, hi);
    const key = `${lo}:${hi}`;
    const slot = corridorSlots.get(key) || 0;
    corridorSlots.set(key, slot + 1);
    const top = band.top - CORRIDOR_PAD - slot * CORRIDOR_STEP;
    const bottom = band.bottom + CORRIDOR_PAD + slot * CORRIDOR_STEP;
    return Math.abs(preferY - top) < Math.abs(preferY - bottom) ? top : bottom;
  };
  if (entry.kind === 'self') {
    const loop = a.x + a.w + 22;
    return [start, { x: loop, y: start.y }, { x: loop, y: end.y }, end];
  }
  if (entry.kind === 'forward') {
    if (b.rank === a.rank + 1) {
      if (Math.abs(start.y - end.y) < 1) return [start, end];
      return [start, { ...gap(a.rank), y: start.y }, { ...gap(a.rank), y: end.y }, end];
    }
    if (!blockedAt(start.y, a.rank, b.rank, nodes)) {
      if (Math.abs(start.y - end.y) < 1) return [start, end];
      return [start, { ...gap(b.rank - 1), y: start.y }, { ...gap(b.rank - 1), y: end.y }, end];
    }
    const y = corridorFor(a.rank + 1, b.rank - 1, (start.y + end.y) / 2);
    return [
      start,
      { ...gap(a.rank), y: start.y },
      { ...gap(a.rank), y },
      { ...gap(b.rank - 1), y },
      { ...gap(b.rank - 1), y: end.y },
      end,
    ];
  }
  if (entry.kind === 'back') {
    const y = corridorFor(b.rank, a.rank, (start.y + end.y) / 2);
    return [
      start,
      { ...gap(a.rank), y: start.y },
      { ...gap(a.rank), y },
      { ...gap(b.rank - 1), y },
      { ...gap(b.rank - 1), y: end.y },
      end,
    ];
  }
  // same rank: vertical neighbours connect directly, others loop via the gap
  if (entry.from.side !== 'right') return [start, end];
  return [start, { ...gap(a.rank), y: start.y }, { ...gap(a.rank), y: end.y }, end];
}

/** Decide which node sides an edge uses. */
function sidesFor(kind, a, b, nodes) {
  if (kind === 'forward') return ['right', 'left'];
  if (kind === 'back') return ['right', 'left'];
  if (kind === 'self') return ['right', 'right'];
  const between = nodes.some((n) => n.rank === a.rank && n.id !== a.id && n.id !== b.id
    && n.y + n.h > Math.min(a.y, b.y) && n.y < Math.max(a.y + a.h, b.y + b.h));
  if (!between) return a.y < b.y ? ['bottom', 'top'] : ['top', 'bottom'];
  return ['right', 'right'];
}

/** Replace gap placeholders with spread channel x positions. */
function assignChannels(entries, gaps) {
  const usage = new Map();
  for (const entry of entries) {
    for (let i = 0; i < entry.plan.length; i += 1) {
      const p = entry.plan[i];
      if (p.gap === undefined) continue;
      const next = entry.plan[i + 1];
      if (!next || next.gap !== p.gap) continue;
      const key = p.gap;
      if (!usage.has(key)) usage.set(key, []);
      usage.get(key).push({ entry, index: i, y0: Math.min(p.y, next.y), y1: Math.max(p.y, next.y) });
      i += 1;
    }
  }
  for (const [gapIndex, list] of usage) {
    const gap = gaps.get(gapIndex);
    list.sort((p, q) => {
      const pm = p.entry.plan[p.index].y;
      const qm = q.entry.plan[q.index].y;
      if (pm !== qm) return pm - qm;
      return p.entry.id < q.entry.id ? -1 : 1;
    });
    const spacing = Math.min(CHANNEL_SPACING, Math.max(gap.w - 20, 0) / Math.max(list.length - 1, 1));
    list.forEach((item, k) => {
      const x = gap.x + gap.w / 2 + (k - (list.length - 1) / 2) * spacing;
      item.entry.plan[item.index].x = x;
      item.entry.plan[item.index + 1].x = x;
    });
  }
  for (const entry of entries) {
    entry.points = entry.plan.map((p) => {
      if (p.gap !== undefined && p.x === undefined) {
        const gap = gaps.get(p.gap);
        return { x: gap.x + gap.w / 2, y: p.y };
      }
      return { x: p.x, y: p.y };
    });
  }
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  // remove collinear middles
  const trimmed = [];
  for (let i = 0; i < out.length; i += 1) {
    const prev = trimmed[trimmed.length - 1];
    const next = out[i + 1];
    if (prev && next) {
      const sameX = Math.abs(prev.x - out[i].x) < 0.01 && Math.abs(out[i].x - next.x) < 0.01;
      const sameY = Math.abs(prev.y - out[i].y) < 0.01 && Math.abs(out[i].y - next.y) < 0.01;
      if (sameX || sameY) continue;
    }
    trimmed.push(out[i]);
  }
  return trimmed;
}

/** SVG path with rounded corners. */
export function pathFromPoints(points) {
  if (points.length < 2) return '';
  let d = `M${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(CORNER, inLen / 2, outLen / 2);
    if (r < 1) {
      d += ` L${fmt(cur.x)} ${fmt(cur.y)}`;
      continue;
    }
    const ux = (cur.x - prev.x) / inLen;
    const uy = (cur.y - prev.y) / inLen;
    const vx = (next.x - cur.x) / outLen;
    const vy = (next.y - cur.y) / outLen;
    d += ` L${fmt(cur.x - ux * r)} ${fmt(cur.y - uy * r)}`;
    d += ` Q${fmt(cur.x)} ${fmt(cur.y)} ${fmt(cur.x + vx * r)} ${fmt(cur.y + vy * r)}`;
  }
  const last = points[points.length - 1];
  d += ` L${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

/**
 * Pick the label anchor. Prefer the last horizontal segment when the label
 * fits on it (labels then sit near their target, which separates fan-outs),
 * otherwise the longest horizontal segment, otherwise the longest segment.
 */
export function labelAnchor(points, label) {
  if (!label) return null;
  const w = textWidth(label, LABEL_SIZE, 500) + 14;
  const h = 18;
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p = points[i];
    const q = points[i + 1];
    const horizontal = Math.abs(p.y - q.y) < 0.01;
    segments.push({ p, q, horizontal, len: Math.hypot(q.x - p.x, q.y - p.y) });
  }
  const horizontals = segments.filter((s) => s.horizontal);
  let best = null;
  const lastH = horizontals[horizontals.length - 1];
  if (lastH && lastH.len >= w + 12) best = lastH;
  if (!best) {
    for (const s of segments) {
      const score = s.len + (s.horizontal ? 1000 : 0);
      if (!best || score > best.score) best = { ...s, score };
    }
  }
  const mx = (best.p.x + best.q.x) / 2;
  const my = (best.p.y + best.q.y) / 2;
  if (best.horizontal) return { x: mx, y: my - 12, w, h, anchor: 'middle', rect: { x: mx - w / 2, y: my - 21 } };
  return { x: mx + 8 + w / 2, y: my, w, h, anchor: 'middle', rect: { x: mx + 8, y: my - h / 2 } };
}

/** Push overlapping label boxes apart vertically, in deterministic order. */
function separateLabels(edges) {
  const placed = [];
  const overlaps = (a, b) => a.rect.x < b.rect.x + b.w + 4 && a.rect.x + a.w + 4 > b.rect.x
    && a.rect.y < b.rect.y + b.h + 2 && a.rect.y + a.h + 2 > b.rect.y;
  for (const edge of edges) {
    const box = edge.labelBox;
    if (!box) continue;
    for (let attempt = 0; attempt < 6 && placed.some((other) => overlaps(box, other)); attempt += 1) {
      box.rect.y += box.h + 4;
      box.y += box.h + 4;
    }
    placed.push(box);
  }
}

/**
 * Route every edge of a layered scene.
 * `scene.nodes` need x, y, w, h, rank. `scene.columns` lists rank columns
 * `{x, w}`; gaps are derived between them, plus a virtual gap on each side.
 */
export function routeEdges(scene) {
  const nodeMap = new Map(scene.nodes.map((n) => [n.id, n]));
  const columns = scene.columns;
  const gaps = new Map();
  for (let i = 0; i < columns.length - 1; i += 1) {
    const left = columns[i].x + columns[i].w;
    gaps.set(i, { x: left, w: columns[i + 1].x - left });
  }
  const first = columns[0];
  const last = columns[columns.length - 1];
  gaps.set(-1, { x: first.x - 44, w: 32 });
  gaps.set(columns.length - 1, { x: last.x + last.w + 12, w: 32 });

  const entries = scene.edges.map((edge) => {
    const a = nodeMap.get(edge.from);
    const b = nodeMap.get(edge.to);
    const kind = classify(a, b);
    const [fromSide, toSide] = sidesFor(kind, a, b, scene.nodes);
    return {
      ...edge,
      kind,
      from: { node: a.id, side: fromSide, offset: 0 },
      to: { node: b.id, side: toSide, offset: 0 },
    };
  });
  assignPorts(entries, nodeMap);
  const corridorSlots = new Map();
  for (const entry of entries) entry.plan = planRoute(entry, nodeMap, scene.nodes, corridorSlots);
  assignChannels(entries, gaps);
  const routed = entries.map((entry) => {
    const points = dedupe(entry.points);
    const anchor = labelAnchor(points, entry.label);
    const { plan, from, to, ...rest } = entry;
    return {
      ...rest,
      source: from.node,
      target: to.node,
      points,
      path: pathFromPoints(points),
      labelBox: anchor,
      route: points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' '),
    };
  });
  separateLabels(routed);
  return routed;
}
