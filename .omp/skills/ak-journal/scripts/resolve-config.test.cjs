const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { resolveConfig, DEFAULTS } = require('./resolve-config.cjs');
const { parseYaml } = require('./mini-yaml-parser.cjs');

function makeProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-journal-resolve-config-'));
  fs.mkdirSync(path.join(projectRoot, '.agentkit'), { recursive: true });
  return projectRoot;
}

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ak-journal-resolve-config-home-'));
}

function withHome(homeDir, fn) {
  const original = process.env.HOME;
  process.env.HOME = homeDir;
  try {
    return fn();
  } finally {
    process.env.HOME = original;
  }
}

function cleanup(...dirs) {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

test('resolveConfig: no config files anywhere returns built-in defaults', () => {
  const projectRoot = makeProject();
  const homeDir = makeHome();
  try {
    withHome(homeDir, () => {
      const resolved = resolveConfig({ projectRoot });
      assert.equal(resolved.language, DEFAULTS.language);
      assert.deepEqual(resolved.channels, []);
      assert.equal(resolved.writing_style, null);
      assert.deepEqual(resolved.ai, { image_model: 'google/gemini-2.5-flash-image', video_model: 'veo-3' });
      assert.deepEqual(resolved.video, { engine: 'auto' });
      assert.equal(resolved.auto, true);
    });
  } finally {
    cleanup(projectRoot, homeDir);
  }
});

test('resolveConfig: user ~/.agentkit/config.yaml journal.language overrides default', () => {
  const projectRoot = makeProject();
  const homeDir = makeHome();
  try {
    fs.mkdirSync(path.join(homeDir, '.agentkit'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.agentkit', 'config.yaml'),
      'journal:\n  language: Vietnamese\n'
    );
    withHome(homeDir, () => {
      const resolved = resolveConfig({ projectRoot });
      assert.equal(resolved.language, 'Vietnamese');
    });
  } finally {
    cleanup(projectRoot, homeDir);
  }
});

test('resolveConfig: project .agentkit/journal.yaml wins over project config.yaml and user config.yaml', () => {
  const projectRoot = makeProject();
  const homeDir = makeHome();
  try {
    fs.mkdirSync(path.join(homeDir, '.agentkit'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.agentkit', 'config.yaml'), 'journal:\n  language: Vietnamese\n');
    fs.writeFileSync(path.join(projectRoot, '.agentkit', 'config.yaml'), 'journal:\n  language: French\n');
    fs.writeFileSync(path.join(projectRoot, '.agentkit', 'journal.yaml'), 'language: Japanese\n');

    withHome(homeDir, () => {
      const resolved = resolveConfig({ projectRoot });
      assert.equal(resolved.language, 'Japanese');
    });
  } finally {
    cleanup(projectRoot, homeDir);
  }
});

test('resolveConfig: project .agentkit/journal.yaml channels array-of-maps parses correctly', () => {
  const projectRoot = makeProject();
  const homeDir = makeHome();
  try {
    fs.writeFileSync(
      path.join(projectRoot, '.agentkit', 'journal.yaml'),
      [
        'channels:',
        '  - id: x_main',
        '    platform: x',
        '    account_id: acc_123',
        '    build_in_public: true',
        '  - id: threads_main',
        '    platform: threads',
        '    account_id: acc_456',
        '    language: Vietnamese',
        '',
      ].join('\n')
    );

    withHome(homeDir, () => {
      const resolved = resolveConfig({ projectRoot });
      assert.equal(resolved.channels.length, 2);
      assert.deepEqual(resolved.channels[0], {
        id: 'x_main',
        platform: 'x',
        account_id: 'acc_123',
        build_in_public: true,
      });
      assert.equal(resolved.channels[1].language, 'Vietnamese');
    });
  } finally {
    cleanup(projectRoot, homeDir);
  }
});

test('resolveConfig: writing-style discovery picks alphabetical first when multiple files exist', () => {
  const projectRoot = makeProject();
  const homeDir = makeHome();
  try {
    const stylesDir = path.join(projectRoot, 'assets', 'writing-styles');
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.writeFileSync(path.join(stylesDir, 'zesty.md'), '# zesty');
    fs.writeFileSync(path.join(stylesDir, 'casual.md'), '# casual');
    fs.writeFileSync(path.join(stylesDir, 'professional-technical.md'), '# pro');

    withHome(homeDir, () => {
      const resolved = resolveConfig({ projectRoot });
      assert.equal(resolved.writing_style, 'casual');
    });
  } finally {
    cleanup(projectRoot, homeDir);
  }
});

test('resolveConfig: explicit journal.writing_style overrides alphabetical discovery', () => {
  const projectRoot = makeProject();
  const homeDir = makeHome();
  try {
    const stylesDir = path.join(projectRoot, 'assets', 'writing-styles');
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.writeFileSync(path.join(stylesDir, 'zesty.md'), '# zesty');
    fs.writeFileSync(path.join(stylesDir, 'casual.md'), '# casual');
    fs.writeFileSync(path.join(projectRoot, '.agentkit', 'journal.yaml'), 'writing_style: zesty\n');

    withHome(homeDir, () => {
      const resolved = resolveConfig({ projectRoot });
      assert.equal(resolved.writing_style, 'zesty');
    });
  } finally {
    cleanup(projectRoot, homeDir);
  }
});

test('resolveConfig: absent assets/writing-styles dir resolves writing_style to null', () => {
  const projectRoot = makeProject();
  const homeDir = makeHome();
  try {
    withHome(homeDir, () => {
      const resolved = resolveConfig({ projectRoot });
      assert.equal(resolved.writing_style, null);
    });
  } finally {
    cleanup(projectRoot, homeDir);
  }
});

test('mini-yaml-parser: nested maps, comments, quoted/unquoted strings', () => {
  const parsed = parseYaml(
    [
      '# top-level comment',
      'journal:',
      '  language: "Vietnamese" # inline comment',
      "  writing_style: 'casual style'",
      '  auto: false',
      '  ai:',
      '    image_model: google/gemini-2.5-flash-image',
      '    video_model: veo-3',
      '',
    ].join('\n')
  );

  assert.deepEqual(parsed, {
    journal: {
      language: 'Vietnamese',
      writing_style: 'casual style',
      auto: false,
      ai: {
        image_model: 'google/gemini-2.5-flash-image',
        video_model: 'veo-3',
      },
    },
  });
});

test('mini-yaml-parser: flow-style array-of-maps and empty input', () => {
  const parsed = parseYaml('channels: [{id: x_main, platform: x}, {id: li_main, platform: linkedin}]\n');
  assert.deepEqual(parsed.channels, [
    { id: 'x_main', platform: 'x' },
    { id: 'li_main', platform: 'linkedin' },
  ]);
  assert.deepEqual(parseYaml(''), {});
  assert.deepEqual(parseYaml('# only a comment\n'), {});
});

test('resolveConfig: --json CLI output is valid parseable JSON with resolved fields', () => {
  const projectRoot = makeProject();
  const homeDir = makeHome();
  fs.writeFileSync(path.join(projectRoot, '.agentkit', 'journal.yaml'), 'language: Spanish\n');
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'resolve-config.cjs'), '--project-root', projectRoot, '--json'],
      { encoding: 'utf8', env: { ...process.env, HOME: homeDir } }
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.language, 'Spanish');
    assert.equal(parsed.projectRoot, projectRoot);
  } finally {
    cleanup(projectRoot, homeDir);
  }
});

test('resolveConfig: CLI without --json still prints valid compact JSON', () => {
  const projectRoot = makeProject();
  const homeDir = makeHome();
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'resolve-config.cjs'), '--project-root', projectRoot],
      { encoding: 'utf8', env: { ...process.env, HOME: homeDir } }
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.language, 'English');
  } finally {
    cleanup(projectRoot, homeDir);
  }
});
