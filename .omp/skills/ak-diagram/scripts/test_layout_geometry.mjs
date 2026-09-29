#!/usr/bin/env node
/**
 * Geometry and motion contract tests for the layout engine.
 * For every fixture: nodes never overlap, routes and labels stay inside the
 * viewBox, no straight route segment crosses an unrelated node, frames contain
 * their members, and the emitted SVG carries finite motion hooks.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, layoutScene, validateIR } from './compiler/compile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../fixtures');
const fixtures = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('adversarial'));

function rectsOverlap(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

function segmentHitsRect(p, q, r) {
  const inset = 1;
  const x0 = r.x + inset; const x1 = r.x + r.w - inset;
  const y0 = r.y + inset; const y1 = r.y + r.h - inset;
  if (Math.abs(p.y - q.y) < 0.01) {
    const y = p.y;
    const lo = Math.min(p.x, q.x); const hi = Math.max(p.x, q.x);
    return y > y0 && y < y1 && hi > x0 && lo < x1;
  }
  if (Math.abs(p.x - q.x) < 0.01) {
    const x = p.x;
    const lo = Math.min(p.y, q.y); const hi = Math.max(p.y, q.y);
    return x > x0 && x < x1 && hi > y0 && lo < y1;
  }
  return false;
}

let checks = 0;
for (const file of fixtures) {
  const data = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf-8'));
  const type = validateIR(data);
  const scene = layoutScene(type, data);
  const vb = scene.viewBox;
  const inside = (x, y) => x >= vb.x - 0.5 && x <= vb.x + vb.w + 0.5 && y >= vb.y - 0.5 && y <= vb.y + vb.h + 0.5;

  for (let i = 0; i < scene.nodes.length; i += 1) {
    for (let j = i + 1; j < scene.nodes.length; j += 1) {
      if (rectsOverlap(scene.nodes[i], scene.nodes[j])) {
        throw new Error(`${file}: nodes ${scene.nodes[i].id} and ${scene.nodes[j].id} overlap`);
      }
    }
    if (!inside(scene.nodes[i].x, scene.nodes[i].y) || !inside(scene.nodes[i].x + scene.nodes[i].w, scene.nodes[i].y + scene.nodes[i].h)) {
      throw new Error(`${file}: node ${scene.nodes[i].id} leaves the viewBox`);
    }
  }
  for (const edge of scene.edges) {
    for (const p of edge.points) {
      if (!inside(p.x, p.y)) throw new Error(`${file}: edge ${edge.id} point (${p.x},${p.y}) leaves the viewBox`);
    }
    if (edge.labelBox) {
      const r = edge.labelBox.rect;
      if (!inside(r.x, r.y) || !inside(r.x + edge.labelBox.w, r.y + edge.labelBox.h)) {
        throw new Error(`${file}: label of edge ${edge.id} leaves the viewBox`);
      }
    }
    for (let i = 0; i < edge.points.length - 1; i += 1) {
      for (const node of scene.nodes) {
        if (node.id === edge.source || node.id === edge.target) continue;
        if (scene.kind === 'sequence') continue;
        if (segmentHitsRect(edge.points[i], edge.points[i + 1], node)) {
          throw new Error(`${file}: edge ${edge.id} segment ${i} crosses unrelated node ${node.id}`);
        }
      }
    }
  }
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  for (const frame of scene.frames) {
    const members = frame.kind === 'boundary'
      ? (data.boundaries.find((b) => b.id === frame.id).components || [])
      : frame.kind === 'lane'
        ? data.steps.filter((s) => s.lane === frame.id).map((s) => s.id)
        : data.nodes.filter((n) => n.stage === frame.id).map((n) => n.id);
    for (const id of members) {
      const n = byId.get(id);
      if (!n) continue;
      if (n.x < frame.x || n.y < frame.y || n.x + n.w > frame.x + frame.w || n.y + n.h > frame.y + frame.h) {
        throw new Error(`${file}: ${frame.kind} ${frame.id} does not contain ${id}`);
      }
    }
  }

  const svg = compile(data, { format: 'svg' });
  if (!svg.includes('data-motion="play"')) throw new Error(`${file}: svg lacks data-motion hook`);
  const steps = [...svg.matchAll(/--step:(\d+)/g)].map((m) => Number(m[1]));
  if (steps.length !== scene.nodes.length + scene.edges.length) throw new Error(`${file}: every node and edge must carry --step`);
  if (Math.max(...steps) > 40) throw new Error(`${file}: --step exceeds the finite motion budget`);
  if ((svg.match(/pathLength="100"/g) || []).length < scene.edges.length) throw new Error(`${file}: edge paths need pathLength for draw motion`);
  if (data.meta.animation === 'trace' && !svg.includes('ak-edge-flow')) throw new Error(`${file}: trace animation needs flow overlays`);
  if (!svg.includes('class="ak-legend"')) throw new Error(`${file}: legend missing`);
  if (!svg.includes('@keyframes ak-node-in')) throw new Error(`${file}: standalone svg must inline motion styles`);
  checks += 1;
  console.log(`✓ ${file}: ${scene.nodes.length} nodes, ${scene.edges.length} edges, viewBox ${Math.round(vb.w)}x${Math.round(vb.h)}`);
}

console.log(`\nALL LAYOUT GEOMETRY TESTS PASSED (${checks} fixtures)`);
