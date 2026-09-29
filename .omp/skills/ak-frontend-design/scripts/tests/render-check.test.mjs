// Run: node --test scripts/tests/render-check.test.mjs
// Needs Node 22+ and a local Chrome, Edge or Chromium; skips otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'render-check.mjs');

function run(fixture, viewports) {
  const out = mkdtempSync(join(tmpdir(), 'render-check-test-'));
  const res = spawnSync(process.execPath, [script, join(here, 'fixtures', fixture), '--out', out, '--viewports', viewports], { encoding: 'utf8', timeout: 90000 });
  const reportPath = join(out, 'render-report.json');
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  const shots = report ? report.map((r) => existsSync(r.screenshot)) : [];
  rmSync(out, { recursive: true, force: true });
  return { res, report, shots };
}

const probe = run('clean.html', '1440x900');
const skip = probe.res.status === 2 ? `render-check cannot run here: ${probe.res.stderr.trim()}` : false;

test('clean page reports no errors and writes a screenshot', { skip }, () => {
  assert.equal(probe.res.status, 0, probe.res.stdout + probe.res.stderr);
  assert.deepEqual(probe.report[0].findings.filter((f) => f.severity === 'error'), []);
  assert.deepEqual(probe.shots, [true]);
});

test('seeded defects are reported by type', { skip }, () => {
  const { res, report } = run('defects.html', '1440x900,375x812');
  assert.equal(res.status, 1, res.stdout + res.stderr);
  const types = (vp) => new Set(report.find((r) => r.viewport === vp).findings.map((f) => f.type));
  const desktop = types('1440x900');
  for (const t of ['main-narrow', 'empty-grid-item', 'low-contrast', 'touching-text', 'closed-dialog-visible', 'runtime-error']) {
    assert.ok(desktop.has(t), `desktop should report ${t}; got ${[...desktop].join(', ')}`);
  }
  const mobile = types('375x812');
  for (const t of ['horizontal-overflow', 'small-touch-target']) {
    assert.ok(mobile.has(t), `mobile should report ${t}; got ${[...mobile].join(', ')}`);
  }
});
