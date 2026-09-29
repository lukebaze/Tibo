const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { TEMPLATE_VERSION, buildCacheKey, generateImages } = require('./generate-image.cjs');
const { npxCommand } = require('./media-utils.cjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeProject() {
  const projectRoot = makeTmpDir('ak-journal-generate-image-project-');
  fs.mkdirSync(path.join(projectRoot, '.agentkit'), { recursive: true });
  return projectRoot;
}

function writeMockSource(dir, name = 'mock-source.png') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'fake-png-bytes');
  return file;
}

test('generate-image: --image <path> returns [absolute_path]', () => {
  const fixturesDir = makeTmpDir('ak-journal-generate-image-fixtures-');
  try {
    const imgPath = path.join(fixturesDir, 'img.png');
    fs.writeFileSync(imgPath, 'fake-bytes');

    const result = generateImages({ imageArgs: [imgPath], cwd: fixturesDir });
    assert.deepEqual(result.paths, [imgPath]);
  } finally {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-image: --image <glob> returns array of resolved paths', () => {
  const fixturesDir = makeTmpDir('ak-journal-generate-image-fixtures-');
  try {
    fs.writeFileSync(path.join(fixturesDir, 'a.png'), 'a');
    fs.writeFileSync(path.join(fixturesDir, 'b.png'), 'b');
    fs.writeFileSync(path.join(fixturesDir, 'c.txt'), 'c');

    const result = generateImages({ imageArgs: [path.join(fixturesDir, '*.png')], cwd: fixturesDir });
    assert.equal(result.paths.length, 2);
    assert.ok(result.paths.every((p) => p.endsWith('.png')));
  } finally {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-image: --image-ai with mocked multix returns generated path and writes the file', () => {
  const projectRoot = makeProject();
  const fixturesDir = makeTmpDir('ak-journal-generate-image-fixtures-');
  try {
    const mockOutput = writeMockSource(fixturesDir);
    const result = generateImages({
      imageAiPrompt: 'a test prompt',
      projectRoot,
      cwd: projectRoot,
      env: { ...process.env, MOCK_MULTIX_OUTPUT: mockOutput },
    });
    assert.equal(result.paths.length, 1);
    assert.ok(fs.existsSync(result.paths[0]));
    assert.equal(fs.readFileSync(result.paths[0], 'utf8'), 'fake-png-bytes');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-image: model resolution — journal.ai.image_model flows into multix argv', () => {
  const projectRoot = makeProject();
  const fixturesDir = makeTmpDir('ak-journal-generate-image-fixtures-');
  try {
    fs.writeFileSync(path.join(projectRoot, '.agentkit', 'config.yaml'), 'journal:\n  ai:\n    image_model: custom-model\n');
    const mockOutput = writeMockSource(fixturesDir);
    const argvPath = path.join(fixturesDir, 'multix-argv.json');

    generateImages({
      imageAiPrompt: 'a test prompt',
      projectRoot,
      cwd: projectRoot,
      env: { ...process.env, MOCK_MULTIX_OUTPUT: mockOutput, MOCK_MULTIX_ARGV: '1', MOCK_MULTIX_ARGV_PATH: argvPath },
    });

    const argv = JSON.parse(fs.readFileSync(argvPath, 'utf8'));
    const modelIdx = argv.indexOf('--model');
    assert.equal(argv[modelIdx + 1], 'custom-model');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-image: cache hit — same journal body + model returns same path without re-invoking multix', () => {
  const projectRoot = makeProject();
  const fixturesDir = makeTmpDir('ak-journal-generate-image-fixtures-');
  try {
    const journalFile = path.join(fixturesDir, '2026-08-07-test.md');
    fs.writeFileSync(journalFile, '---\ntitle: t\n---\nSame body.\n');
    const mockOutput = writeMockSource(fixturesDir);
    const env = { ...process.env, MOCK_MULTIX_OUTPUT: mockOutput };

    const first = generateImages({ imageAiPrompt: 'p', journalFile, projectRoot, cwd: projectRoot, env });
    assert.equal(first.cached, false);

    // Delete the mock source: if a second call re-invoked multix, copyFileSync would throw ENOENT.
    fs.rmSync(mockOutput);
    const second = generateImages({ imageAiPrompt: 'p', journalFile, projectRoot, cwd: projectRoot, env });
    assert.equal(second.paths[0], first.paths[0]);
    assert.equal(second.cached, true);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-image: cache miss — changing only the journal body changes the cache key/path', () => {
  const projectRoot = makeProject();
  const fixturesDir = makeTmpDir('ak-journal-generate-image-fixtures-');
  try {
    const journalFileA = path.join(fixturesDir, '2026-08-07-a.md');
    const journalFileB = path.join(fixturesDir, '2026-08-07-b.md');
    fs.writeFileSync(journalFileA, '---\ntitle: t\n---\nBody A.\n');
    fs.writeFileSync(journalFileB, '---\ntitle: t\n---\nBody B (different).\n');

    const keyA = buildCacheKey({ journalBody: 'Body A.', writingStyle: null, language: 'English', model: 'm' });
    const keyB = buildCacheKey({ journalBody: 'Body B (different).', writingStyle: null, language: 'English', model: 'm' });
    assert.notEqual(keyA, keyB);
    assert.ok(TEMPLATE_VERSION);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-image: buildCacheKey — different --image-ai prompts for the same journal body produce different keys', () => {
  const keyA = buildCacheKey({ journalBody: 'Body.', imageAiPrompt: 'a sunset', writingStyle: null, language: 'English', model: 'm' });
  const keyB = buildCacheKey({ journalBody: 'Body.', imageAiPrompt: 'a sunrise', writingStyle: null, language: 'English', model: 'm' });
  assert.notEqual(keyA, keyB);
});

test('generate-image: --dry-run does not invoke multix and reports the planned path', () => {
  const projectRoot = makeProject();
  const fixturesDir = makeTmpDir('ak-journal-generate-image-fixtures-');
  try {
    const mockOutput = writeMockSource(fixturesDir);
    const result = generateImages({
      imageAiPrompt: 'p',
      projectRoot,
      cwd: projectRoot,
      dryRun: true,
      env: { ...process.env, MOCK_MULTIX_OUTPUT: mockOutput },
    });
    assert.equal(result.dryRun, true);
    assert.equal(fs.existsSync(result.paths[0]), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-image: platform guard — npxCommand never requests a shell, on any platform', () => {
  const { command, args } = npxCommand(['-y', 'multix', 'image', '--prompt', 'a & echo pwned']);
  assert.ok(command === 'npx' || command === process.execPath);
  assert.ok(Array.isArray(args));
  assert.ok(args.includes('a & echo pwned'));
});
