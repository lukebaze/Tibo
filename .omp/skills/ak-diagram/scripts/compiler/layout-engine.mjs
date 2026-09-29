/**
 * Layout engine for the ak:diagram compiler.
 * Turns validated IR into a scene: sized nodes placed in rank columns (or
 * swimlane cells), frames for boundaries / lanes / stages, routed edges, a
 * legend and motion steps. Sequence diagrams use their own lifeline layout.
 */
import { textWidth, clamp } from './text-metrics.mjs';
import { familyFor, shapeFor, familyLabel, legendFor, edgeStyleFor } from './semantics.mjs';
import { findBackEdges, assignRanks, buildLayers, orderLayers } from './layered-graph.mjs';
import { routeEdges } from './edge-router.mjs';

const MARGIN_X = 40;
const MARGIN_Y = 36;
const HEADER_H = 56;
const LEGEND_H = 34;
const GAP_X = 92;
const GAP_Y = 30;
const NODE_H = 54;
const PILL_H = 42;
const LABEL_SIZE = 13;
const SUB_SIZE = 10.5;
const MAX_STEP = 40;

function nodeWidth(label, sublabel) {
  const main = textWidth(label, LABEL_SIZE, 600) + 16 + 14 + 26;
  const sub = textWidth(sublabel, SUB_SIZE, 500) + 16 + 14 + 26;
  return clamp(Math.max(main, sub), 150, 250);
}

function makeNode(type, raw, roleKey) {
  const family = familyFor(type, roleKey);
  const shape = shapeFor(family);
  const sublabel = familyLabel(family);
  return {
    id: raw.id,
    label: raw.label,
    role: roleKey || '',
    desc: raw.description || '',
    family,
    shape,
    sublabel,
    w: nodeWidth(raw.label, sublabel),
    h: shape === 'pill' ? PILL_H : NODE_H,
  };
}

function makeEdges(type, list, fromKey, toKey, labelKey) {
  return list.map((raw, index) => {
    const style = edgeStyleFor(type, raw);
    const label = raw[labelKey] || raw.label || raw.condition || '';
    return {
      id: raw.id || `e${index}`,
      from: raw[fromKey],
      to: raw[toKey],
      label,
      dashed: !!style.dashed,
      open: !!style.open,
      tone: style.tone || '',
      protocol: raw.protocol || raw.schema_type || '',
    };
  });
}

/** Column x positions from per-rank widths. */
function placeColumns(layers, nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let x = MARGIN_X;
  return layers.map((layer) => {
    const w = Math.max(...layer.map((id) => byId.get(id).w));
    const column = { x, w };
    x += w + GAP_X;
    return column;
  });
}

/** Stack a column's nodes vertically, centred on the tallest column. */
function stackColumns(layers, nodes, columns, top) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const heights = layers.map((layer) => layer.reduce((sum, id) => sum + byId.get(id).h, 0) + GAP_Y * (layer.length - 1));
  const tallest = Math.max(...heights);
  layers.forEach((layer, rank) => {
    let y = top + (tallest - heights[rank]) / 2;
    for (const id of layer) {
      const node = byId.get(id);
      node.x = columns[rank].x;
      node.w = columns[rank].w;
      node.y = y;
      node.rank = rank;
      y += node.h + GAP_Y;
    }
  });
  return tallest;
}

function finishScene(type, scene, contentBottom) {
  const routed = routeEdges(scene);
  let minX = 0;
  let minY = 0;
  let maxX = scene.nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0) + MARGIN_X;
  let maxY = contentBottom;
  for (const frame of scene.frames) {
    minX = Math.min(minX, frame.x - 8);
    maxX = Math.max(maxX, frame.x + frame.w + MARGIN_X);
    maxY = Math.max(maxY, frame.y + frame.h);
  }
  for (const edge of routed) {
    for (const p of edge.points) {
      minX = Math.min(minX, p.x - 16);
      maxX = Math.max(maxX, p.x + 16);
      minY = Math.min(minY, p.y - 16);
      maxY = Math.max(maxY, p.y + 16);
    }
    if (edge.labelBox) {
      minX = Math.min(minX, edge.labelBox.rect.x - 8);
      maxX = Math.max(maxX, edge.labelBox.rect.x + edge.labelBox.w + 8);
      minY = Math.min(minY, edge.labelBox.rect.y - 8);
      maxY = Math.max(maxY, edge.labelBox.rect.y + edge.labelBox.h + 8);
    }
  }
  const legendY = maxY + 12;
  const height = legendY + LEGEND_H + MARGIN_Y / 2 - minY;
  const rankOf = new Map(scene.nodes.map((n) => [n.id, n.rank]));
  for (const node of scene.nodes) node.step = Math.min(node.rank, MAX_STEP);
  for (const edge of routed) edge.step = Math.min(rankOf.get(edge.source) + 1, MAX_STEP);
  return {
    kind: 'layered',
    type,
    viewBox: { x: minX, y: minY, w: maxX - minX, h: height },
    nodes: scene.nodes,
    frames: scene.frames,
    edges: routed,
    legend: legendFor(scene.nodes.map((n) => n.family)),
    legendY,
    header: scene.header,
  };
}

function headerFor(meta) {
  return { title: meta.title || '', subtitle: meta.subtitle || '', h: HEADER_H };
}

/* ------------------------------------------------------------------ */

export function layoutArchitecture(data) {
  const nodes = data.components.map((c) => makeNode('architecture', c, c.role));
  const ids = nodes.map((n) => n.id);
  const edges = makeEdges('architecture', data.connections, 'from', 'to', 'label');
  const fixed = new Map();
  for (const c of data.components) if (typeof c.layer === 'number') fixed.set(c.id, c.layer);
  const back = findBackEdges(ids, edges);
  const rank = assignRanks(ids, edges, back, fixed);
  const cohesion = new Map();
  for (const boundary of data.boundaries || []) {
    for (const member of boundary.components || []) if (!cohesion.has(member)) cohesion.set(member, boundary.id);
  }
  const layers = orderLayers(buildLayers(ids, rank), edges, rank, { cohesion });
  const columns = placeColumns(layers, nodes);
  const top = MARGIN_Y + HEADER_H + ((data.boundaries || []).length ? 30 : 0);
  const tallest = stackColumns(layers, nodes, columns, top);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const frames = (data.boundaries || []).map((boundary) => {
    const members = (boundary.components || []).map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) return null;
    const x = Math.min(...members.map((n) => n.x)) - 16;
    const y = Math.min(...members.map((n) => n.y)) - 30;
    const right = Math.max(...members.map((n) => n.x + n.w)) + 16;
    const bottom = Math.max(...members.map((n) => n.y + n.h)) + 14;
    return { kind: 'boundary', id: boundary.id, label: boundary.label, role: boundary.role || '', x, y, w: right - x, h: bottom - y };
  }).filter(Boolean);
  return finishScene('architecture', { nodes, edges, columns, frames, header: headerFor(data.meta) }, top + tallest + MARGIN_Y);
}

export function layoutWorkflow(data) {
  const nodes = data.steps.map((s) => makeNode('workflow', s, s.kind));
  const ids = nodes.map((n) => n.id);
  const edges = makeEdges('workflow', data.transitions, 'from', 'to', 'label');
  const back = findBackEdges(ids, edges);
  const rank = assignRanks(ids, edges, back);
  const layers = buildLayers(ids, rank);
  const columns = placeColumns(layers, nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const laneOf = new Map(data.steps.map((s) => [s.id, s.lane]));
  const lanes = [...data.lanes];
  if (data.steps.some((s) => !lanes.some((l) => l.id === s.lane))) lanes.push({ id: '__unassigned', label: 'Unassigned', role: '' });
  const laneHeader = 34;
  let y = MARGIN_Y + HEADER_H;
  const laneLeft = MARGIN_X - 22;
  const laneRight = columns[columns.length - 1].x + columns[columns.length - 1].w + 22;
  const frames = lanes.map((lane) => {
    const cells = new Map();
    for (const id of ids) {
      const laneId = lanes.some((l) => l.id === laneOf.get(id)) ? laneOf.get(id) : '__unassigned';
      if (laneId !== lane.id) continue;
      const r = rank.get(id);
      if (!cells.has(r)) cells.set(r, []);
      cells.get(r).push(id);
    }
    const stackHeights = [...cells.values()].map((cell) => cell.reduce((s, id) => s + byId.get(id).h, 0) + GAP_Y * (cell.length - 1));
    const inner = Math.max(NODE_H, ...stackHeights);
    const h = laneHeader + inner + 22;
    for (const [r, cell] of cells) {
      const stackH = cell.reduce((s, id) => s + byId.get(id).h, 0) + GAP_Y * (cell.length - 1);
      let cy = y + laneHeader + (inner - stackH) / 2;
      for (const id of cell) {
        const node = byId.get(id);
        node.x = columns[r].x;
        node.w = columns[r].w;
        node.y = cy;
        node.rank = r;
        cy += node.h + GAP_Y;
      }
    }
    const frame = { kind: 'lane', id: lane.id, label: lane.label, role: lane.role || '', x: laneLeft, y, w: laneRight - laneLeft, h };
    y += h + 10;
    return frame;
  });
  return finishScene('workflow', { nodes, edges, columns, frames, header: headerFor(data.meta) }, y + MARGIN_Y / 2);
}

export function layoutDataflow(data) {
  const stages = [...data.stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const stageIndex = new Map(stages.map((s, i) => [s.id, i]));
  if (data.nodes.some((n) => !stageIndex.has(n.stage))) {
    stages.push({ id: '__processing', label: 'Processing', order: stages.length });
    stageIndex.set('__processing', stages.length - 1);
  }
  const nodes = data.nodes.map((n) => makeNode('dataflow', n, n.role));
  const ids = nodes.map((n) => n.id);
  const edges = makeEdges('dataflow', data.flows, 'from', 'to', 'label');
  const fixed = new Map(data.nodes.map((n) => [n.id, stageIndex.get(n.stage) ?? stageIndex.get('__processing')]));
  const back = findBackEdges(ids, edges);
  const rank = assignRanks(ids, edges, back, fixed);
  // keep every stage column even when it is empty so frames line up with authoring
  const layers = stages.map(() => []);
  for (const id of ids) layers[fixed.get(id)].push(id);
  for (const id of ids) rank.set(id, fixed.get(id));
  orderLayers(layers, edges, rank);
  const widths = layers.map((layer) => (layer.length ? Math.max(...layer.map((id) => nodes.find((n) => n.id === id).w)) : 150));
  let x = MARGIN_X + 12;
  const columns = widths.map((w) => { const c = { x, w }; x += w + GAP_X; return c; });
  const top = MARGIN_Y + HEADER_H + 34;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const heights = layers.map((layer) => layer.reduce((s, id) => s + byId.get(id).h, 0) + GAP_Y * Math.max(layer.length - 1, 0));
  const tallest = Math.max(...heights, NODE_H);
  layers.forEach((layer, r) => {
    let y = top + (tallest - heights[r]) / 2;
    for (const id of layer) {
      const node = byId.get(id);
      node.x = columns[r].x; node.w = columns[r].w; node.y = y; node.rank = r;
      y += node.h + GAP_Y;
    }
  });
  const frames = stages.map((stage, i) => ({
    kind: 'stage', id: stage.id, label: stage.label, role: '',
    x: columns[i].x - 20, y: top - 38, w: columns[i].w + 40, h: tallest + 56,
  }));
  return finishScene('dataflow', { nodes, edges, columns, frames, header: headerFor(data.meta) }, top + tallest + MARGIN_Y);
}

export function layoutLifecycle(data) {
  const nodes = data.states.map((s) => makeNode('lifecycle', s, s.kind));
  const ids = nodes.map((n) => n.id);
  const edges = makeEdges('lifecycle', data.transitions, 'from', 'to', 'event');
  const fixed = new Map();
  for (const s of data.states) if (s.kind === 'initial') fixed.set(s.id, 0);
  const back = findBackEdges(ids, edges);
  const rank = assignRanks(ids, edges, back, fixed);
  const layers = orderLayers(buildLayers(ids, rank), edges, rank);
  const columns = placeColumns(layers, nodes);
  const top = MARGIN_Y + HEADER_H;
  const tallest = stackColumns(layers, nodes, columns, top);
  return finishScene('lifecycle', { nodes, edges, columns, frames: [], header: headerFor(data.meta) }, top + tallest + MARGIN_Y);
}

/* ------------------------------------------------------------------ */

const SEQ_GAP = 64;
const SEQ_ROW = 46;
const SEQ_TOP_PAD = 24;

export function layoutSequence(data) {
  const nodes = data.participants.map((p, i) => {
    const node = makeNode('sequence', p, p.role);
    node.h = 46;
    node.rank = i;
    return node;
  });
  let x = MARGIN_X;
  const top = MARGIN_Y + HEADER_H;
  for (const node of nodes) { node.x = x; node.y = top; x += node.w + SEQ_GAP; }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cx = (id) => byId.get(id).x + byId.get(id).w / 2;
  const firstY = top + 46 + SEQ_TOP_PAD;
  const active = new Map();
  const activations = [];
  const messages = data.messages.map((m, i) => {
    const y = firstY + i * SEQ_ROW + (m.kind === 'self-call' ? 0 : 0);
    const style = edgeStyleFor('sequence', m);
    const from = cx(m.from);
    const to = cx(m.to);
    if (m.kind === 'sync-call' && m.from !== m.to) {
      const depth = (active.get(m.to) || []).length;
      const bar = { participant: m.to, y0: y, y1: null, depth };
      activations.push(bar);
      if (!active.has(m.to)) active.set(m.to, []);
      active.get(m.to).push(bar);
    }
    if (m.kind === 'return' && active.has(m.from) && active.get(m.from).length) {
      const bar = active.get(m.from).pop();
      bar.y1 = y;
    }
    const activeDepth = (id) => (active.get(id) || []).length;
    const dir = to >= from ? 1 : -1;
    const x0 = from + (activeDepth(m.from) ? dir * 4 : 0);
    const x1 = to - (activeDepth(m.to) ? dir * 4 : 0);
    let points;
    if (m.kind === 'self-call' || m.from === m.to) {
      points = [{ x: from + 4, y: y - 6 }, { x: from + 40, y: y - 6 }, { x: from + 40, y: y + 14 }, { x: from + 4, y: y + 14 }];
    } else {
      points = [{ x: x0, y }, { x: x1, y }];
    }
    const labelW = textWidth(m.label, 10.5, 500) + 14;
    const mid = m.kind === 'self-call' || m.from === m.to ? from + 48 + labelW / 2 : (x0 + x1) / 2;
    return {
      id: m.id || `m${i}`,
      source: m.from,
      target: m.to,
      label: m.label,
      kind: m.kind,
      dashed: !!style.dashed,
      open: !!style.open,
      tone: style.tone || '',
      points,
      labelBox: m.label ? { x: mid, y: y - 10, w: labelW, h: 18, anchor: 'middle', rect: { x: mid - labelW / 2, y: y - 19 } } : null,
      step: Math.min(i + 1, MAX_STEP),
    };
  });
  const lastY = firstY + Math.max(data.messages.length - 1, 0) * SEQ_ROW;
  const lifelineEnd = lastY + SEQ_ROW;
  for (const bar of activations) if (bar.y1 === null) bar.y1 = lifelineEnd - 12;
  const legendY = lifelineEnd + 20;
  const width = nodes.length ? nodes[nodes.length - 1].x + nodes[nodes.length - 1].w + MARGIN_X : 400;
  for (const node of nodes) node.step = 0;
  return {
    kind: 'sequence',
    type: 'sequence',
    viewBox: { x: 0, y: 0, w: width, h: legendY + LEGEND_H + MARGIN_Y / 2 },
    nodes,
    frames: [],
    edges: messages.map((m) => ({ ...m, path: m.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '), route: m.points.map((p) => `${p.x},${p.y}`).join(' ') })),
    lifelines: nodes.map((n) => ({ id: n.id, x: n.x + n.w / 2, y0: n.y + n.h, y1: lifelineEnd })),
    activations: activations.map((bar) => ({ ...bar, x: cx(bar.participant) - 5 + bar.depth * 4 })),
    legend: legendFor(nodes.map((n) => n.family)),
    legendY,
    header: headerFor(data.meta),
  };
}

export function layoutScene(type, data) {
  switch (type) {
    case 'architecture': return layoutArchitecture(data);
    case 'workflow': return layoutWorkflow(data);
    case 'dataflow': return layoutDataflow(data);
    case 'lifecycle': return layoutLifecycle(data);
    case 'sequence': return layoutSequence(data);
    default: throw new Error(`Unsupported diagram type: ${type}`);
  }
}
