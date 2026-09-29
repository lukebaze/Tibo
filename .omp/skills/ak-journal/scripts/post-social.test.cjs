const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'post-social.cjs');

/**
 * Fake `npx` test double: this exercises the real live-post path (runZernio)
 * without a network call. Reads the same argv shape post-social.cjs sends
 * (`--text <body>`), and:
 *  - fails when the body contains the literal marker FORCE_FAIL (used to
 *    test the failure/partial-success path)
 *  - if ZERNIO_TEST_ENV_DUMP is set (deliberately ZERNIO_-prefixed so it
 *    survives runZernio's env scoping and actually reaches this script),
 *    writes its own process.env to that path as JSON (used to assert
 *    env-scoping)
 *  - otherwise succeeds, printing a JSON payload with a fake post URL, which
 *    also proves argv survived a real spawnSync round-trip (no shell
 *    re-joining/re-splitting corruption) even when the body contains shell
 *    metacharacters.
 */
function makeFakeNpxDir() {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-journal-fake-npx-'));
  const scriptPath = path.join(binDir, 'npx');
  fs.writeFileSync(
    scriptPath,
    [
      '#!/usr/bin/env node',
      'const fs = require("fs");',
      'const args = process.argv.slice(2);',
      'const textIdx = args.indexOf("--text");',
      'const text = textIdx !== -1 ? args[textIdx + 1] : "";',
      'if (process.env.FAKE_NPX_ARGV_DUMP) fs.writeFileSync(process.env.FAKE_NPX_ARGV_DUMP, JSON.stringify(args));',
      'if (process.env.ZERNIO_TEST_ENV_DUMP) fs.writeFileSync(process.env.ZERNIO_TEST_ENV_DUMP, JSON.stringify(process.env));',
      'if (text.includes("FORCE_FAIL")) { process.stderr.write("mock failure\\n"); process.exit(1); }',
      'process.stdout.write(JSON.stringify({ data: { url: "https://example.com/post/123" } }));',
      'process.exit(0);',
      '',
    ].join('\n')
  );
  fs.chmodSync(scriptPath, 0o755);
  return binDir;
}

function makeProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-journal-post-social-'));
  fs.mkdirSync(path.join(projectRoot, '.agentkit'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'plans', 'journals'), { recursive: true });
  return projectRoot;
}

function writeJournalYaml(projectRoot, channelsYaml) {
  fs.writeFileSync(path.join(projectRoot, '.agentkit', 'journal.yaml'), channelsYaml);
}

function writeJournalFile(projectRoot, body) {
  const journalFile = path.join(projectRoot, 'plans', 'journals', '2026-08-07-test-entry.md');
  fs.writeFileSync(journalFile, `---\ntitle: Test entry\n---\n${body}\n`);
  return journalFile;
}

function runCli(args, { env = {}, cwd } = {}) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-journal-post-social-home-'));
  try {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, HOME: homeDir, ZERNIO_API_KEY: 'test-zernio-key', ...env },
    });
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function cleanup(...dirs) {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

test('post-social: dry-run with 1 channel prints its zernio argv (via --dry-run) and exits 0', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(
      projectRoot,
      'channels:\n  - id: x_main\n    platform: x\n    account_id: acc_x_123\n'
    );
    const journalFile = writeJournalFile(projectRoot, 'Short update body.');

    const result = runCli(['--journal-file', journalFile, '--dry-run', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].status, 'DRY_RUN');
    assert.ok(parsed.results[0].argv.includes('posts:create'));
    assert.ok(parsed.results[0].argv.some((a) => a.includes('github:mrgoonie/zernio-cli#')));
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: dry-run with 2 channels prints 2 argvs, honoring POST_SOCIAL_DRY_RUN=1 env', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(
      projectRoot,
      [
        'channels:',
        '  - id: x_main',
        '    platform: x',
        '    account_id: acc_x_123',
        '  - id: li_main',
        '    platform: linkedin',
        '    account_id: acc_li_456',
        '',
      ].join('\n')
    );
    const journalFile = writeJournalFile(projectRoot, 'Short update body for two channels.');

    const result = runCli(['--journal-file', journalFile, '--json'], { env: { POST_SOCIAL_DRY_RUN: '1' } });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.results.length, 2);
    assert.ok(parsed.results.every((r) => r.status === 'DRY_RUN'));
    assert.deepEqual(
      parsed.results.map((r) => r.channelId).sort(),
      ['li_main', 'x_main']
    );
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: X channel with a long body produces --threadJson with at most 6 parts', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(projectRoot, 'channels:\n  - id: x_main\n    platform: x\n    account_id: acc_x_123\n');
    const longBody = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}: ${'word '.repeat(40)}`).join('\n\n');
    const journalFile = writeJournalFile(projectRoot, longBody);

    const result = runCli(['--journal-file', journalFile, '--dry-run', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    const argv = parsed.results[0].argv;
    const threadIdx = argv.indexOf('--threadJson');
    assert.ok(threadIdx !== -1, 'expected --threadJson in argv for a long X body');
    const threadPosts = JSON.parse(argv[threadIdx + 1]);
    assert.ok(threadPosts.length > 1 && threadPosts.length <= 6);
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: missing ZERNIO_API_KEY produces a clear error and exits 1 without invoking the CLI', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(projectRoot, 'channels:\n  - id: x_main\n    platform: x\n    account_id: acc_x_123\n');
    const journalFile = writeJournalFile(projectRoot, 'Body.');

    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-journal-post-social-nohome-'));
    try {
      const result = spawnSync(process.execPath, [SCRIPT, '--journal-file', journalFile, '--dry-run'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: homeDir, ZERNIO_API_KEY: '' },
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /ZERNIO_API_KEY/);
      assert.equal(result.stdout, '');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: --channel-bodies pre-formatted map is used verbatim per channel (no translation)', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(
      projectRoot,
      ['channels:', '  - id: x_main', '    platform: x', '    account_id: acc_x_123', ''].join('\n')
    );
    const journalFile = writeJournalFile(projectRoot, 'Fallback body (should not be used).');
    const bodiesPath = path.join(projectRoot, 'channel-bodies.json');
    fs.writeFileSync(bodiesPath, JSON.stringify({ x_main: 'Pre-formatted X body.' }));

    const result = runCli(['--journal-file', journalFile, '--channel-bodies', bodiesPath, '--dry-run', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    const argv = parsed.results[0].argv;
    const textIdx = argv.indexOf('--text');
    assert.equal(argv[textIdx + 1], 'Pre-formatted X body.');
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: --json output is valid JSON with results, dryRun, statePath', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(projectRoot, 'channels:\n  - id: x_main\n    platform: x\n    account_id: acc_x_123\n');
    const journalFile = writeJournalFile(projectRoot, 'Body.');

    const result = runCli(['--journal-file', journalFile, '--dry-run', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed.results));
    assert.equal(typeof parsed.dryRun, 'boolean');
    assert.equal(typeof parsed.statePath, 'string');
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: posted-state file refuses bare re-run for an already-posted channel', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(
      projectRoot,
      [
        'channels:',
        '  - id: x_main',
        '    platform: x',
        '    account_id: acc_x_123',
        '  - id: li_main',
        '    platform: linkedin',
        '    account_id: acc_li_456',
        '',
      ].join('\n')
    );
    const journalFile = writeJournalFile(projectRoot, 'Body.');
    const stateDir = path.join(
      projectRoot,
      'plans',
      'reports',
      `journal-media-${path.basename(journalFile).replace(/\.md$/, '')}`
    );
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'posted.json'),
      JSON.stringify({ x_main: 'SUCCESS', x_main_url: 'https://x.com/example/status/1' })
    );

    // Bare re-run: no --channels filter, POST_SOCIAL_DRY_RUN=1 so li_main "posts" successfully.
    const result = runCli(['--journal-file', journalFile, '--json'], { env: { POST_SOCIAL_DRY_RUN: '1' } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /already posted successfully.*refusing to re-post/s);

    const parsed = JSON.parse(result.stdout);
    const xResult = parsed.results.find((r) => r.channelId === 'x_main');
    const liResult = parsed.results.find((r) => r.channelId === 'li_main');
    assert.equal(xResult.status, 'SKIPPED_ALREADY_POSTED');
    assert.equal(xResult.url, 'https://x.com/example/status/1');
    assert.equal(liResult.status, 'DRY_RUN');
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: dry-run with --image <fixture> produces --media in the argv preview (mocked URL)', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(projectRoot, 'channels:\n  - id: x_main\n    platform: x\n    account_id: acc_x_123\n');
    const journalFile = writeJournalFile(projectRoot, 'Body with an image.');
    const imagePath = path.join(projectRoot, 'fixture.png');
    fs.writeFileSync(imagePath, 'fake-png-bytes');

    const result = runCli(['--journal-file', journalFile, '--image', imagePath, '--dry-run', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    const argv = parsed.results[0].argv;
    const mediaIdx = argv.indexOf('--media');
    assert.ok(mediaIdx !== -1, 'expected --media in argv for a dry-run with --image');
    assert.match(argv[mediaIdx + 1], /fixture\.png/);
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: a channel whose posts:create rejects the attached video falls back to text-only (MEDIA_UNSUPPORTED); other channels still post', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(
      projectRoot,
      [
        'channels:',
        '  - id: x_main',
        '    platform: x',
        '    account_id: acc_x_reject',
        '  - id: li_main',
        '    platform: linkedin',
        '    account_id: acc_li_ok',
        '',
      ].join('\n')
    );
    const journalFile = writeJournalFile(projectRoot, 'Body with a video.');
    const videoPath = path.join(projectRoot, 'fixture.mp4');
    fs.writeFileSync(videoPath, 'fake-mp4-bytes');

    const result = runCli(['--journal-file', journalFile, '--video', videoPath, '--json'], {
      env: { MOCK_ZERNIO_CLI: '1', MOCK_ZERNIO_MEDIA_REJECT_ACCOUNTS: 'acc_x_reject' },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    const xResult = parsed.results.find((r) => r.channelId === 'x_main');
    const liResult = parsed.results.find((r) => r.channelId === 'li_main');
    assert.equal(xResult.status, 'MEDIA_UNSUPPORTED');
    assert.ok(xResult.url, 'expected a URL from the text-only fallback post');
    assert.equal(liResult.status, 'SUCCESS');
    assert.ok(liResult.argv.includes('--media'));
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: --channels resolves a named `groups.*` entry from journal.yaml to its member channel ids', () => {
  const projectRoot = makeProject();
  try {
    writeJournalYaml(
      projectRoot,
      [
        'channels:',
        '  - id: x_main',
        '    platform: x',
        '    account_id: acc_x_123',
        '  - id: threads_main',
        '    platform: threads',
        '    account_id: acc_threads_456',
        '  - id: li_main',
        '    platform: linkedin',
        '    account_id: acc_li_789',
        '',
        'groups:',
        '  build_in_public: [x_main, threads_main]',
        '',
      ].join('\n')
    );
    const journalFile = writeJournalFile(projectRoot, 'Body.');

    const result = runCli(['--journal-file', journalFile, '--channels', 'build_in_public', '--json'], {
      env: { POST_SOCIAL_DRY_RUN: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(
      parsed.results.map((r) => r.channelId).sort(),
      ['threads_main', 'x_main']
    );
  } finally {
    cleanup(projectRoot);
  }
});

test('post-social: live path — a real spawnSync round-trip through a fake npx succeeds and returns the post URL', () => {
  const projectRoot = makeProject();
  const binDir = makeFakeNpxDir();
  try {
    writeJournalYaml(projectRoot, 'channels:\n  - id: x_main\n    platform: x\n    account_id: acc_x_123\n');
    // Body carries shell metacharacters that would corrupt an unescaped
    // shell:true re-join — proves argv reached the child intact.
    const journalFile = writeJournalFile(projectRoot, 'Ship it & done; echo "quoted" | tee /tmp/pwned > /dev/null');

    const result = runCli(['--journal-file', journalFile, '--json'], {
      env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.results[0].status, 'SUCCESS');
    assert.equal(parsed.results[0].url, 'https://example.com/post/123');

    const statePath = path.join(
      projectRoot,
      'plans',
      'reports',
      `journal-media-${path.basename(journalFile).replace(/\.md$/, '')}`,
      'posted.json'
    );
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(state.x_main, 'SUCCESS');
  } finally {
    cleanup(projectRoot, binDir);
  }
});

test('post-social: live path — a mid-run failure still flushes the earlier SUCCESS to posted.json', () => {
  const projectRoot = makeProject();
  const binDir = makeFakeNpxDir();
  try {
    writeJournalYaml(
      projectRoot,
      [
        'channels:',
        '  - id: x_main',
        '    platform: x',
        '    account_id: acc_x_123',
        '  - id: li_main',
        '    platform: linkedin',
        '    account_id: acc_li_456',
        '',
      ].join('\n')
    );
    const journalFile = writeJournalFile(projectRoot, 'Body.');
    const bodiesPath = path.join(projectRoot, 'channel-bodies.json');
    // x_main posts normally; li_main's body triggers the fake CLI's failure path.
    fs.writeFileSync(bodiesPath, JSON.stringify({ x_main: 'ok body', li_main: 'FORCE_FAIL body' }));

    const result = runCli(['--journal-file', journalFile, '--channel-bodies', bodiesPath, '--json'], {
      env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr); // one SUCCESS is enough to exit 0
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.results.find((r) => r.channelId === 'x_main').status, 'SUCCESS');
    assert.equal(parsed.results.find((r) => r.channelId === 'li_main').status, 'FAILED');

    const statePath = path.join(
      projectRoot,
      'plans',
      'reports',
      `journal-media-${path.basename(journalFile).replace(/\.md$/, '')}`,
      'posted.json'
    );
    // Flushed per-channel, not only at the end of the run — the failed
    // channel's neighbor SUCCESS must already be durable on disk.
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(state.x_main, 'SUCCESS');
    assert.equal(state.li_main, undefined);
  } finally {
    cleanup(projectRoot, binDir);
  }
});

test('post-social: child process env is scoped to ZERNIO_* + passthrough keys — unrelated secrets do not leak', () => {
  const projectRoot = makeProject();
  const binDir = makeFakeNpxDir();
  const envDumpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-journal-envdump-')), 'env.json');
  try {
    writeJournalYaml(projectRoot, 'channels:\n  - id: x_main\n    platform: x\n    account_id: acc_x_123\n');
    const journalFile = writeJournalFile(projectRoot, 'Body.');

    const result = runCli(['--journal-file', journalFile, '--json'], {
      env: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        ZERNIO_TEST_ENV_DUMP: envDumpPath,
        DECOY_UNRELATED_SECRET: 'should-not-reach-child',
      },
    });
    assert.equal(result.status, 0, result.stderr);

    const childEnv = JSON.parse(fs.readFileSync(envDumpPath, 'utf8'));
    assert.equal(childEnv.ZERNIO_API_KEY, 'test-zernio-key');
    assert.equal(childEnv.DECOY_UNRELATED_SECRET, undefined);
  } finally {
    cleanup(projectRoot, binDir, path.dirname(envDumpPath));
  }
});

test('post-social: a channel missing account_id is reported INVALID_CHANNEL without invoking the CLI', () => {
  const projectRoot = makeProject();
  const binDir = makeFakeNpxDir();
  const argvDumpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-journal-argvdump-')), 'argv.json');
  try {
    writeJournalYaml(projectRoot, 'channels:\n  - id: x_main\n    platform: x\n');
    const journalFile = writeJournalFile(projectRoot, 'Body.');

    const result = runCli(['--journal-file', journalFile, '--json'], {
      env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}`, FAKE_NPX_ARGV_DUMP: argvDumpPath },
    });
    assert.equal(result.status, 1, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.results[0].status, 'INVALID_CHANNEL');
    assert.match(parsed.results[0].error, /account_id/);
    assert.equal(fs.existsSync(argvDumpPath), false, 'fake npx must never have been invoked');
  } finally {
    cleanup(projectRoot, binDir, path.dirname(argvDumpPath));
  }
});
