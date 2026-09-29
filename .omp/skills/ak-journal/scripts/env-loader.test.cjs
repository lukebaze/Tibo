const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadEnv, parseEnvContent, resolveEnv, resolveAllEnv } = require('./env-loader.cjs');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('parseEnvContent: parses simple key=value pairs', () => {
  const result = parseEnvContent('KEY=value\nOTHER=thing');
  assert.equal(result.KEY, 'value');
  assert.equal(result.OTHER, 'thing');
});

test('parseEnvContent: skips comments and blank lines', () => {
  const result = parseEnvContent('# comment\n\nKEY=value\n  # indented comment\nKEY2=value2');
  assert.deepEqual(result, { KEY: 'value', KEY2: 'value2' });
});

test('parseEnvContent: strips matching double and single quotes', () => {
  const result = parseEnvContent('DOUBLE="hello world"\nSINGLE=\'hello world\'');
  assert.equal(result.DOUBLE, 'hello world');
  assert.equal(result.SINGLE, 'hello world');
});

test('parseEnvContent: handles values containing extra equals signs', () => {
  const result = parseEnvContent('KEY=a=b=c');
  assert.equal(result.KEY, 'a=b=c');
});

test('parseEnvContent: expands \\n and \\t escapes only inside double quotes', () => {
  const result = parseEnvContent('DOUBLE="line1\\nline2"\nSINGLE=\'line1\\nline2\'');
  assert.equal(result.DOUBLE, 'line1\nline2');
  assert.equal(result.SINGLE, 'line1\\nline2');
});

test('parseEnvContent: non-string input returns empty object', () => {
  assert.deepEqual(parseEnvContent(undefined), {});
  assert.deepEqual(parseEnvContent(null), {});
});

test('loadEnv: missing files across the whole cascade returns empty object', () => {
  const projectRoot = makeTempDir('ak-journal-env-missing-');
  const homeDir = makeTempDir('ak-journal-env-missing-home-');
  const originalHome = process.env.HOME;
  try {
    process.env.HOME = homeDir;
    const result = loadEnv(projectRoot);
    assert.deepEqual(result, {});
  } finally {
    process.env.HOME = originalHome;
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('loadEnv: cascade precedence — project .agentkit/.env wins over user .agentkit/.env, .claude/.env layers, but process.env still wins via resolveEnv', () => {
  const projectRoot = makeTempDir('ak-journal-env-cascade-');
  const homeDir = makeTempDir('ak-journal-env-cascade-home-');
  const originalHome = process.env.HOME;
  try {
    process.env.HOME = homeDir;

    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.claude', '.env'), 'VAR=legacy-user\nONLY_LEGACY_USER=1\n');

    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.claude', '.env'), 'VAR=legacy-project\n');

    fs.mkdirSync(path.join(homeDir, '.agentkit'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.agentkit', '.env'), 'VAR=agentkit-user\n');

    fs.mkdirSync(path.join(projectRoot, '.agentkit'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.agentkit', '.env'), 'VAR=agentkit-project\n');

    const fileEnv = loadEnv(projectRoot);
    assert.equal(fileEnv.VAR, 'agentkit-project');
    assert.equal(fileEnv.ONLY_LEGACY_USER, '1');

    delete process.env.VAR;
    assert.equal(resolveEnv('VAR', projectRoot), 'agentkit-project');

    process.env.VAR = 'from-process-env';
    assert.equal(resolveEnv('VAR', projectRoot), 'from-process-env');
    delete process.env.VAR;
  } finally {
    process.env.HOME = originalHome;
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('resolveEnv: falls back to defaultValue when key is absent everywhere', () => {
  const projectRoot = makeTempDir('ak-journal-env-default-');
  const homeDir = makeTempDir('ak-journal-env-default-home-');
  const originalHome = process.env.HOME;
  try {
    process.env.HOME = homeDir;
    assert.equal(resolveEnv('NOPE_NOT_SET', projectRoot, 'fallback'), 'fallback');
    assert.equal(resolveEnv('NOPE_NOT_SET', projectRoot), undefined);
  } finally {
    process.env.HOME = originalHome;
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('resolveAllEnv: merges file cascade with process.env, process.env winning', () => {
  const projectRoot = makeTempDir('ak-journal-env-merge-');
  const homeDir = makeTempDir('ak-journal-env-merge-home-');
  const originalHome = process.env.HOME;
  try {
    process.env.HOME = homeDir;
    fs.mkdirSync(path.join(projectRoot, '.agentkit'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.agentkit', '.env'), 'FILE_ONLY=from-file\nOVERRIDDEN=from-file\n');
    process.env.OVERRIDDEN = 'from-process';

    const merged = resolveAllEnv(projectRoot);
    assert.equal(merged.FILE_ONLY, 'from-file');
    assert.equal(merged.OVERRIDDEN, 'from-process');
  } finally {
    delete process.env.OVERRIDDEN;
    process.env.HOME = originalHome;
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
