const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'verify-prereqs.mjs');

function runScript(args, envOverrides = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AK_HYPERFRAMES_TEST_MODE: '1', MOCK_FFPROBE_PRESENT: '1', ...envOverrides },
  });
}

test('verify-prereqs: MOCK_FFMPEG_PRESENT is ignored without AK_HYPERFRAMES_TEST_MODE=1', () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, MOCK_FFMPEG_PRESENT: '1', MOCK_NODE_VERSION: '18.0.0' },
  });
  // Real system state decides here, not the mock — proves a stray
  // MOCK_FFMPEG_PRESENT in a real shell can't fake a READY result.
  assert.doesNotMatch(result.stdout, /\(mocked\)/);
});

test('verify-prereqs: Node >= 22 + FFmpeg + FFprobe present -> exit 0, stdout contains READY', () => {
  const result = runScript([], { MOCK_FFMPEG_PRESENT: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /READY/);
});

test('verify-prereqs: Node < 22 via MOCK_NODE_VERSION -> non-zero exit, stderr mentions Node 22', () => {
  const result = runScript([], { MOCK_NODE_VERSION: '18.0.0', MOCK_FFMPEG_PRESENT: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node 22/);
});

test('verify-prereqs: FFmpeg missing via MOCK_FFMPEG_PRESENT=0 -> non-zero exit, stderr mentions FFmpeg', () => {
  const result = runScript([], { MOCK_FFMPEG_PRESENT: '0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FFmpeg/);
});

test('verify-prereqs: FFprobe missing via MOCK_FFPROBE_PRESENT=0 -> non-zero exit, stderr mentions FFprobe', () => {
  const result = runScript([], { MOCK_FFMPEG_PRESENT: '1', MOCK_FFPROBE_PRESENT: '0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FFprobe/);
});

test('verify-prereqs: --json mode produces valid JSON on stdout when all checks pass', () => {
  const result = runScript(['--json'], { MOCK_FFMPEG_PRESENT: '1' });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ready, true);
  assert.ok(Array.isArray(parsed.checks));
  assert.ok(parsed.checks.every((c) => typeof c.name === 'string' && typeof c.ok === 'boolean'));
});

test('verify-prereqs: --json mode produces valid JSON on stdout when a check fails', () => {
  const result = runScript(['--json'], { MOCK_FFMPEG_PRESENT: '0' });
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ready, false);
  const ffmpegCheck = parsed.checks.find((c) => c.name === 'ffmpeg');
  assert.equal(ffmpegCheck.ok, false);
  assert.match(result.stderr, /FFmpeg/);
});
