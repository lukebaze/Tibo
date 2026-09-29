/**
 * Layered graph utilities for the ak:diagram compiler.
 * Ranks nodes along the main flow direction, breaks cycles by marking back
 * edges, and orders each layer with barycenter sweeps to reduce crossings.
 * Every step uses deterministic tie-breaks (authored order) so identical IR
 * always yields identical geometry.
 */

/**
 * Depth-first search in authored order. Returns the set of edge indexes that
 * close a cycle; those edges are ignored while ranking and drawn as returns.
 */
export function findBackEdges(ids, edges) {
  const adjacency = new Map(ids.map((id) => [id, []]));
  edges.forEach((edge, index) => {
    if (adjacency.has(edge.from) && adjacency.has(edge.to) && edge.from !== edge.to) {
      adjacency.get(edge.from).push({ to: edge.to, index });
    }
  });
  const state = new Map();
  const back = new Set();
  const visit = (id) => {
    state.set(id, 1);
    for (const { to, index } of adjacency.get(id)) {
      const seen = state.get(to) || 0;
      if (seen === 1) back.add(index);
      else if (seen === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);
  return back;
}

/**
 * Longest-path ranking over forward edges. `fixed` pins a rank for a node
 * (for example an authored layer or stage); other nodes take the longest
 * predecessor chain. Ranks are compacted so there are no empty columns.
 */
export function assignRanks(ids, edges, backEdges, fixed = new Map()) {
  const preds = new Map(ids.map((id) => [id, []]));
  edges.forEach((edge, index) => {
    if (backEdges.has(index) || edge.from === edge.to) return;
    if (preds.has(edge.to) && preds.has(edge.from)) preds.get(edge.to).push(edge.from);
  });
  const rank = new Map();
  const visiting = new Set();
  const resolve = (id) => {
    if (rank.has(id)) return rank.get(id);
    if (fixed.has(id)) {
      rank.set(id, fixed.get(id));
      return fixed.get(id);
    }
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let value = 0;
    for (const pred of preds.get(id)) value = Math.max(value, resolve(pred) + 1);
    visiting.delete(id);
    rank.set(id, value);
    return value;
  };
  ids.forEach(resolve);
  const distinct = [...new Set(rank.values())].sort((a, b) => a - b);
  const compact = new Map(distinct.map((value, index) => [value, index]));
  for (const [id, value] of rank) rank.set(id, compact.get(value));
  return rank;
}

/** Group node ids into layers ordered by rank, keeping authored order inside. */
export function buildLayers(ids, rank) {
  const count = ids.length ? Math.max(...ids.map((id) => rank.get(id))) + 1 : 0;
  const layers = Array.from({ length: count }, () => []);
  for (const id of ids) layers[rank.get(id)].push(id);
  return layers;
}

/**
 * Barycenter ordering. Each sweep sorts a layer by the mean normalised
 * position of its neighbours in the previous (down sweep) or next (up sweep)
 * layers. `cohesion` maps node id -> group key; members of a group are kept
 * adjacent so boundary frames never split.
 */
export function orderLayers(layers, edges, rank, options = {}) {
  const sweeps = options.sweeps ?? 4;
  const cohesion = options.cohesion || new Map();
  const preds = new Map();
  const succs = new Map();
  for (const layer of layers) for (const id of layer) { preds.set(id, []); succs.set(id, []); }
  for (const edge of edges) {
    if (!preds.has(edge.from) || !preds.has(edge.to) || edge.from === edge.to) continue;
    if (rank.get(edge.from) < rank.get(edge.to)) {
      preds.get(edge.to).push(edge.from);
      succs.get(edge.from).push(edge.to);
    } else if (rank.get(edge.from) > rank.get(edge.to)) {
      preds.get(edge.from).push(edge.to);
      succs.get(edge.to).push(edge.from);
    }
  }
  const position = new Map();
  const refresh = () => {
    for (const layer of layers) {
      const denom = Math.max(layer.length - 1, 1);
      layer.forEach((id, index) => position.set(id, layer.length === 1 ? 0.5 : index / denom));
    }
  };
  refresh();
  const sortLayer = (layer, neighbours) => {
    const bary = new Map();
    layer.forEach((id, index) => {
      const list = neighbours.get(id);
      const own = position.get(id);
      const value = list.length
        ? list.reduce((sum, other) => sum + position.get(other), 0) / list.length
        : own;
      bary.set(id, { value, index });
    });
    const groupValue = new Map();
    for (const id of layer) {
      const key = cohesion.get(id) || `__${id}`;
      const entry = groupValue.get(key) || { sum: 0, count: 0, first: bary.get(id).index };
      entry.sum += bary.get(id).value;
      entry.count += 1;
      groupValue.set(key, entry);
    }
    layer.sort((a, b) => {
      const ga = groupValue.get(cohesion.get(a) || `__${a}`);
      const gb = groupValue.get(cohesion.get(b) || `__${b}`);
      const ma = ga.sum / ga.count;
      const mb = gb.sum / gb.count;
      if (ma !== mb) return ma - mb;
      if (ga.first !== gb.first) return ga.first - gb.first;
      const va = bary.get(a);
      const vb = bary.get(b);
      if (va.value !== vb.value) return va.value - vb.value;
      return va.index - vb.index;
    });
  };
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    if (sweep % 2 === 0) {
      for (let i = 1; i < layers.length; i += 1) { sortLayer(layers[i], preds); refresh(); }
    } else {
      for (let i = layers.length - 2; i >= 0; i -= 1) { sortLayer(layers[i], succs); refresh(); }
    }
  }
  return layers;
}

/** Count crossings between adjacent layers (used by tests and tuning). */
export function countCrossings(layers, edges, rank) {
  const index = new Map();
  layers.forEach((layer) => layer.forEach((id, i) => index.set(id, i)));
  let crossings = 0;
  const spans = edges
    .filter((e) => index.has(e.from) && index.has(e.to) && Math.abs(rank.get(e.from) - rank.get(e.to)) === 1)
    .map((e) => (rank.get(e.from) < rank.get(e.to)
      ? { layer: rank.get(e.from), a: index.get(e.from), b: index.get(e.to) }
      : { layer: rank.get(e.to), a: index.get(e.to), b: index.get(e.from) }));
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const p = spans[i];
      const q = spans[j];
      if (p.layer !== q.layer) continue;
      if ((p.a - q.a) * (p.b - q.b) < 0) crossings += 1;
    }
  }
  return crossings;
}
