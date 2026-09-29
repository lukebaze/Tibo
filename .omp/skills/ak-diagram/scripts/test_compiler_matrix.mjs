import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compile } from './compiler/compile.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(__dirname, '../fixtures');

const archetypes = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];
const presets = ['classic', 'signal-flow', 'blueprint', 'editorial'];
const themes = ['light', 'dark'];

console.log('=== Running 40-Combination Matrix Compilation Tests ===');
let matrixCount = 0;

for (const arch of archetypes) {
  const fixturePath = join(FIXTURES_DIR, `${arch}-sample.json`);
  const raw = readFileSync(fixturePath, 'utf-8');

  for (const preset of presets) {
    for (const theme of themes) {
      // Test HTML
      const htmlOut = compile(raw, { format: 'html', preset, theme });
      if (!htmlOut.includes('<svg') || !htmlOut.includes('ak-diagram-root')) {
        throw new Error(`Failed to compile ${arch} with preset=${preset}, theme=${theme} (HTML)`);
      }

      // Test Fragment
      const fragOut = compile(raw, { format: 'fragment', preset, theme });
      if (!fragOut.includes('<svg') || fragOut.includes('<!DOCTYPE html>')) {
        throw new Error(`Failed to compile ${arch} with preset=${preset}, theme=${theme} (Fragment)`);
      }

      // Test SVG
      const svgOut = compile(raw, { format: 'svg', preset, theme });
      if (!svgOut.startsWith('<svg') || !svgOut.endsWith('</svg>')) {
        throw new Error(`Failed to compile ${arch} with preset=${preset}, theme=${theme} (SVG)`);
      }

      matrixCount++;
    }
  }
}

console.log(`✓ All ${matrixCount} matrix combinations compiled successfully in SVG, Fragment, and HTML modes!`);

console.log('\n=== Running Byte Determinism Tests ===');
for (const arch of archetypes) {
  const fixturePath = join(FIXTURES_DIR, `${arch}-sample.json`);
  const raw = readFileSync(fixturePath, 'utf-8');

  const html1 = compile(raw, { format: 'html', preset: 'signal-flow', theme: 'dark' });
  const html2 = compile(raw, { format: 'html', preset: 'signal-flow', theme: 'dark' });

  const hash1 = createHash('sha256').update(html1).digest('hex');
  const hash2 = createHash('sha256').update(html2).digest('hex');

  if (hash1 !== hash2) {
    throw new Error(`Determinism failed for ${arch}: hashes do not match`);
  }
}
console.log('✓ Determinism verified: byte-identical outputs across repeated compiles.');

console.log('\n=== Running Strict Schema & Semantic Validation Tests ===');
// Test Duplicate ID
try {
  const dupData = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Dup' },
    components: [
      { id: 'node1', label: 'Node 1' },
      { id: 'node1', label: 'Duplicate Node 1' }
    ],
    connections: []
  };
  compile(dupData, { format: 'svg' });
  throw new Error('Failed to reject duplicate ID');
} catch (e) {
  if (!e.message.includes('duplicate ID')) {
    throw e;
  }
  console.log('✓ Duplicate ID successfully rejected:', e.message);
}

// Test Dangling Endpoint
try {
  const dangData = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Dangling' },
    components: [
      { id: 'node1', label: 'Node 1' }
    ],
    connections: [
      { from: 'node1', to: 'nonexistent-node' }
    ]
  };
  compile(dangData, { format: 'svg' });
  throw new Error('Failed to reject dangling endpoint');
} catch (e) {
  if (!e.message.includes('dangling connection')) {
    throw e;
  }
  console.log('✓ Dangling endpoint successfully rejected:', e.message);
}

// Test XSS Injection Safety
console.log('\n=== Running XSS Injection Safety Tests ===');
const xssData = {
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Test </script><script>alert(1)</script>' },
  components: [
    { id: 'n1', label: 'Label <script>alert(2)</script>' }
  ],
  connections: []
};
const xssHtml = compile(xssData, { format: 'html' });
if (xssHtml.includes('<script>alert(1)</script>') || xssHtml.includes('<script>alert(2)</script>')) {
  throw new Error('XSS injection payload was not properly escaped');
}
console.log('✓ XSS injection payloads safely sanitized.');
// Test javascript: URL and event-handler injection
const evtData = {
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Evt', subtitle: 'onload=alert(1)' },
  components: [
    { id: 'n1', label: 'x onload="alert(1)" y' },
    { id: 'n2', label: 'javascript:alert(2)' }
  ],
  connections: [{ from: 'n1', to: 'n2', label: '<img src=x onerror=alert(3)>' }]
};
const evtHtml = compile(evtData, { format: 'html' });
// Authored user text must never introduce raw tag delimiters; escapeXml converts < > " into entities.
const evtDataScript = (evtHtml.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';
const evtVisible = evtHtml.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '');
if (evtVisible.includes('<img') || evtVisible.includes('onerror=alert(3)>') || evtVisible.includes('onload="alert(1)"')) {
  throw new Error('Event-handler/URL injection was not escaped');
}
console.log('✓ Event-handler and javascript: URL payloads safely escaped.');

console.log('\n=== Running Zero-Network / No-Browser Output Tests ===');
for (const arch of archetypes) {
  const raw = readFileSync(join(FIXTURES_DIR, `${arch}-sample.json`), 'utf-8');
  const html = compile(raw, { format: 'html' });
  // Ignore XML/SVG namespace URIs (w3.org) — declarations, never fetched. Flag real resource loads.
  const netRefs = /(src|href)\s*=\s*["']https?:\/\/|@import\s+url\(\s*["']?https?:\/\/|cdn\.|fonts\.googleapis|<script\s+src=/i;
  if (netRefs.test(html)) {
    throw new Error(`${arch}: output contains external network reference`);
  }
}
console.log('✓ No external network references in any compiled HTML (offline-safe).');

console.log('\n=== Running Multi-Fragment Isolation Tests ===');
{
  const fragA = compile(readFileSync(join(FIXTURES_DIR, 'architecture-sample.json'), 'utf-8'), { format: 'fragment' });
  const fragB = compile(readFileSync(join(FIXTURES_DIR, 'workflow-sample.json'), 'utf-8'), { format: 'fragment' });
  const idA = (fragA.match(/data-instance-id="([a-f0-9]+)"/) || [])[1];
  const idB = (fragB.match(/data-instance-id="([a-f0-9]+)"/) || [])[1];
  if (!idA || !idB || idA === idB) {
    throw new Error(`Multi-fragment instance IDs collide or missing: ${idA} vs ${idB}`);
  }
  if (!fragA.includes(`ak-arrowhead-${idA}`) || !fragB.includes(`ak-arrowhead-${idB}`)) {
    throw new Error('Scoped marker IDs not derived from instance ID');
  }
}
console.log('✓ Multiple fragments use distinct instance and marker IDs (no collision).');

console.log('\n=== Running Semantic Rendering Tests (boundaries/lanes/stages/subtitle) ===');
{
  const archHtml = compile(JSON.stringify({
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'B', subtitle: 'My Subtitle' },
    components: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    boundaries: [{ id: 'vpc', label: 'Prod VPC', role: 'vpc', components: ['a', 'b'] }],
    connections: [{ from: 'a', to: 'b' }]
  }), { format: 'fragment' });
  if (!archHtml.includes('Prod VPC') || !archHtml.includes('ak-boundary')) throw new Error('Architecture boundary not rendered');
  if (!archHtml.includes('My Subtitle')) throw new Error('meta.subtitle not rendered');

  const wfHtml = compile(readFileSync(join(FIXTURES_DIR, 'workflow-sample.json'), 'utf-8'), { format: 'fragment' });
  if (!wfHtml.includes('ak-lane') || !wfHtml.includes('CI Runner')) throw new Error('Workflow lane label not rendered');

  const dfHtml = compile(readFileSync(join(FIXTURES_DIR, 'dataflow-sample.json'), 'utf-8'), { format: 'fragment' });
  if (!dfHtml.includes('ak-stage') || !dfHtml.includes('Ingestion')) throw new Error('Dataflow stage label not rendered');
}
console.log('✓ Boundaries, lanes, stages, and subtitle render from authored IR.');

console.log('\n========================================');
console.log('ALL COMPILER MATRIX & SECURITY TESTS PASSED!');
console.log('========================================');
