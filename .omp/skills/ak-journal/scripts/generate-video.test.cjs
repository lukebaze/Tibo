const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { TEMPLATE_VERSION, resolveEngine, buildCacheKey, generateVideos } = require('./generate-video.cjs');
const { npxCommand } = require('./media-utils.cjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeProject() {
  const projectRoot = makeTmpDir('ak-journal-generate-video-project-');
  fs.mkdirSync(path.join(projectRoot, '.agentkit'), { recursive: true });
  return projectRoot;
}

function makeSkillsRootWithHyperframes() {
  const root = makeTmpDir('ak-journal-generate-video-skills-');
  fs.mkdirSync(path.join(root, 'ak-hyperframes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ak-hyperframes', 'SKILL.md'), '# ak-hyperframes\n');
  return root;
}

function writeMockSource(dir, name = 'mock-source.mp4') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'fake-mp4-bytes');
  return file;
}

test('generate-video: --video <path> returns array of resolved paths', async () => {
  const fixturesDir = makeTmpDir('ak-journal-generate-video-fixtures-');
  try {
    const vidPath = path.join(fixturesDir, 'clip.mp4');
    fs.writeFileSync(vidPath, 'fake-bytes');

    const result = await generateVideos({ videoArgs: [vidPath], cwd: fixturesDir });
    assert.deepEqual(result.paths, [vidPath]);
  } finally {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-video: engine auto-detect picks hyperframes when its SKILL.md is present', () => {
  const skillsRoot = makeSkillsRootWithHyperframes();
  try {
    const engine = resolveEngine({ configuredEngine: 'auto', env: { MOCK_INSTALLED_SKILLS_ROOT: skillsRoot } });
    assert.equal(engine, 'hyperframes');
  } finally {
    fs.rmSync(skillsRoot, { recursive: true, force: true });
  }
});

test('generate-video: engine auto-detect falls back to remotion when hyperframes is absent', () => {
  const skillsRoot = makeTmpDir('ak-journal-generate-video-skills-empty-');
  try {
    const engine = resolveEngine({ configuredEngine: 'auto', env: { MOCK_INSTALLED_SKILLS_ROOT: skillsRoot } });
    assert.equal(engine, 'remotion');
  } finally {
    fs.rmSync(skillsRoot, { recursive: true, force: true });
  }
});

test('generate-video: --engine CLI flag overrides auto-detect', () => {
  const skillsRoot = makeSkillsRootWithHyperframes();
  try {
    const engine = resolveEngine({
      cliEngine: 'remotion',
      configuredEngine: 'auto',
      env: { MOCK_INSTALLED_SKILLS_ROOT: skillsRoot },
    });
    assert.equal(engine, 'remotion');
  } finally {
    fs.rmSync(skillsRoot, { recursive: true, force: true });
  }
});

test('generate-video: --video-ai with mocked multix — model resolution from journal.ai.video_model', async () => {
  const projectRoot = makeProject();
  const fixturesDir = makeTmpDir('ak-journal-generate-video-fixtures-');
  try {
    fs.writeFileSync(path.join(projectRoot, '.agentkit', 'config.yaml'), 'journal:\n  ai:\n    video_model: veo-3\n');
    const mockOutput = writeMockSource(fixturesDir);
    const argvPath = path.join(fixturesDir, 'multix-argv.json');

    const result = await generateVideos({
      videoAiPrompt: 'a test prompt',
      projectRoot,
      cwd: projectRoot,
      env: {
        ...process.env,
        MOCK_MULTIX_OUTPUT: mockOutput,
        MOCK_MULTIX_ARGV: '1',
        MOCK_MULTIX_ARGV_PATH: argvPath,
        MOCK_INSTALLED_SKILLS_ROOT: makeTmpDir('ak-journal-generate-video-skills-none-'),
      },
    });

    assert.ok(fs.existsSync(result.paths[0]));
    const argv = JSON.parse(fs.readFileSync(argvPath, 'utf8'));
    const modelIdx = argv.indexOf('--model');
    assert.equal(argv[modelIdx + 1], 'veo-3');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-video: cache hit — same key returns cached path without regeneration', async () => {
  const projectRoot = makeProject();
  const fixturesDir = makeTmpDir('ak-journal-generate-video-fixtures-');
  try {
    const journalFile = path.join(fixturesDir, '2026-08-07-test.md');
    fs.writeFileSync(journalFile, '---\ntitle: t\n---\nSame body.\n');
    const mockOutput = writeMockSource(fixturesDir);
    const env = { ...process.env, MOCK_MULTIX_OUTPUT: mockOutput, MOCK_INSTALLED_SKILLS_ROOT: makeTmpDir('ak-journal-generate-video-skills-x-') };

    const first = await generateVideos({ videoAiPrompt: 'p', journalFile, projectRoot, cwd: projectRoot, env });
    assert.equal(first.cached, false);

    fs.rmSync(mockOutput);
    const second = await generateVideos({ videoAiPrompt: 'p', journalFile, projectRoot, cwd: projectRoot, env });
    assert.equal(second.paths[0], first.paths[0]);
    assert.equal(second.cached, true);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-video: cache key changes when journal body changes (all else equal)', () => {
  const keyA = buildCacheKey({ journalBody: 'A', engine: 'remotion', model: 'veo-3', duration: 15, resolution: '1080x1920' });
  const keyB = buildCacheKey({ journalBody: 'B', engine: 'remotion', model: 'veo-3', duration: 15, resolution: '1080x1920' });
  assert.notEqual(keyA, keyB);
  assert.ok(TEMPLATE_VERSION);
});

test('generate-video: buildCacheKey — different --video-ai prompts for the same journal body produce different keys', () => {
  const keyA = buildCacheKey({
    journalBody: 'A',
    videoAiPrompt: 'drone shot over a city',
    engine: 'remotion',
    model: 'veo-3',
    duration: 15,
    resolution: '1080x1920',
  });
  const keyB = buildCacheKey({
    journalBody: 'A',
    videoAiPrompt: 'time-lapse of clouds',
    engine: 'remotion',
    model: 'veo-3',
    duration: 15,
    resolution: '1080x1920',
  });
  assert.notEqual(keyA, keyB);
});

test('generate-video: --dry-run skips generation entirely (no file written, mock untouched)', async () => {
  const projectRoot = makeProject();
  const fixturesDir = makeTmpDir('ak-journal-generate-video-fixtures-');
  try {
    const mockOutput = writeMockSource(fixturesDir);
    const result = await generateVideos({
      videoAiPrompt: 'p',
      projectRoot,
      cwd: projectRoot,
      dryRun: true,
      env: { ...process.env, MOCK_MULTIX_OUTPUT: mockOutput, MOCK_INSTALLED_SKILLS_ROOT: makeTmpDir('ak-journal-generate-video-skills-dry-') },
    });
    assert.equal(result.dryRun, true);
    assert.equal(fs.existsSync(result.paths[0]), false);
    assert.ok(fs.existsSync(mockOutput), 'mock source should be untouched — generation must not run');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});

test('generate-video: platform guard — npxCommand never requests a shell, on any platform', () => {
  const { command, args } = npxCommand(['-y', 'multix', 'video', '--prompt', 'a & echo pwned']);
  assert.ok(command === 'npx' || command === process.execPath);
  assert.ok(Array.isArray(args));
  assert.ok(args.includes('a & echo pwned'));
});
