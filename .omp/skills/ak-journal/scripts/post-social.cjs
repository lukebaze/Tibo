#!/usr/bin/env node
/**
 * post-social.cjs — dispatches a journal entry to configured social channels
 * via zernio-cli (github:mrgoonie/zernio-cli, pinned by commit SHA — see
 * references/zernio-integration.md for the bump procedure).
 *
 * CLI usage:
 *   node post-social.cjs --journal-file <path> [--channels <id1,id2>]
 *     [--channel-bodies <path-to-json>] [--dry-run] [--json]
 *     [--image <path-or-glob>]... [--image-ai <prompt>]
 *     [--video <path-or-glob>]... [--video-ai <prompt>] [--project-root <path>]
 *
 * Media (`--image`/`--image-ai`/`--video`/`--video-ai`, see
 * `references/media-flags.md`): resolved locally via `generate-image.cjs` /
 * `generate-video.cjs`, then uploaded once via `zernio media:upload` and
 * attached to every targeted channel's `posts:create` call with `--media
 * <url>`. If a channel's `posts:create` rejects the attached media
 * downstream (format/size unsupported for that platform), this script
 * retries that one channel text-only and marks it `MEDIA_UNSUPPORTED` in
 * the summary — other channels are unaffected.
 *
 * Layering (AMENDMENTS.md G5): this script NEVER translates or
 * tone-transforms text. It accepts already-localized, already-styled
 * per-channel bodies via `--channel-bodies` (JSON map: {channel_id: body}),
 * or falls back to the raw journal body for every channel. The calling
 * agent produces per-channel bodies.
 *
 * Retry contract (kongming R8): this summary (stdout JSON with --json) IS
 * the retry contract. A bare re-run also consults `posted.json` next to the
 * journal (see journalStateDir) and refuses to re-post any channel already
 * marked SUCCESS there, regardless of --channels filtering.
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { spawnSync } = require('child_process');

const { resolveAllEnv } = require('./env-loader.cjs');
const { resolveConfig } = require('./resolve-config.cjs');
const { splitThread, printTruncationWarning } = require('./split-thread.cjs');
const { generateImages } = require('./generate-image.cjs');
const { generateVideos } = require('./generate-video.cjs');
const { npxCommand, redactSecrets } = require('./media-utils.cjs');

// Pinned per AMENDMENTS.md G6 — never invoke zernio-cli unpinned (HEAD +
// ZERNIO_API_KEY in env is an account-takeover supply-chain risk).
// Bump procedure: references/zernio-integration.md.
const ZERNIO_SHA = '946ee2aa1f7e9c5abf2ccf5d30ae730ce40e621e';
const ZERNIO_PACKAGE = `github:mrgoonie/zernio-cli#${ZERNIO_SHA}`;
const THREAD_PLATFORMS = new Set(['x', 'threads']);
const RATE_LIMIT_PATTERN = /rate.?limit|\b429\b/i;
const RETRY_AFTER_PATTERN = /retry-after"?\s*[:=]\s*"?(\d+)/i;
// A channel's posts:create rejecting an attached medium downstream (format/size unsupported
// for that platform) — see Phase 8 risk assessment. Distinct from a rate limit.
const MEDIA_REJECT_PATTERN = /media.*(unsupported|rejected|invalid format|too large|not supported)/i;

function parseCliArgs(argv) {
  return parseArgs({
    args: argv,
    options: {
      'journal-file': { type: 'string' },
      channels: { type: 'string' },
      'channel-bodies': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      image: { type: 'string', multiple: true, default: [] },
      'image-ai': { type: 'string' },
      video: { type: 'string', multiple: true, default: [] },
      'video-ai': { type: 'string' },
      'project-root': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Strip a leading YAML frontmatter block (`---\n...\n---`) from the journal file, if present. */
function readJournalBody(journalFile) {
  const raw = fs.readFileSync(journalFile, 'utf8');
  const frontmatterMatch = raw.match(/^---\n[\s\S]*?\n---\n?/);
  return (frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw).trim();
}

/** Read the `--channel-bodies` JSON map ({channel_id: body}); empty map if not provided. */
function readChannelBodies(channelBodiesPath) {
  if (!channelBodiesPath) return {};
  const raw = fs.readFileSync(channelBodiesPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`--channel-bodies must be a JSON object mapping channel id to body: ${channelBodiesPath}`);
  }
  return parsed;
}

/** Deterministic slug for the posted-state directory: journal filenames are date-prefixed already. */
function journalStateSlug(journalFile) {
  return path.basename(journalFile).replace(/\.md$/i, '');
}

function journalStateDir(projectRoot, journalFile) {
  return path.join(projectRoot, 'plans', 'reports', `journal-media-${journalStateSlug(journalFile)}`);
}

function readPostedState(statePath) {
  try {
    if (fs.existsSync(statePath)) {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(`[post-social] failed to read posted-state ${statePath}: ${error.message}`);
    }
  }
  return {};
}

function writePostedState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

/** Validates the channel fields buildZernioArgv/postToChannel depend on. Returns an error string, or null when valid. */
function validateChannelShape(channel) {
  if (!channel || typeof channel !== 'object') return 'channel is not an object';
  if (!channel.id || typeof channel.id !== 'string') return 'channel.id is missing or not a string';
  if (!channel.platform || typeof channel.platform !== 'string') return 'channel.platform is missing or not a string';
  if (!channel.account_id || typeof channel.account_id !== 'string') {
    return 'channel.account_id is missing or not a string';
  }
  return null;
}

function buildZernioArgv({ body, channel, threadPosts, mediaUrls = [] }) {
  const argv = ['-y', ZERNIO_PACKAGE, 'posts:create', '--text', body, '--accounts', channel.account_id];
  if (threadPosts && threadPosts.length > 1) {
    argv.push('--threadJson', JSON.stringify(threadPosts));
  }
  for (const url of mediaUrls) {
    argv.push('--media', url);
  }
  return argv;
}

/**
 * Test-only short-circuit for zernio-cli invocations (posts:create AND
 * media:upload) — activated by `MOCK_ZERNIO_CLI=1` so tests never hit the
 * network or spawn real npx. `MOCK_ZERNIO_MEDIA_REJECT_ACCOUNTS` is a
 * comma-separated list of `--accounts` ids whose posts:create call rejects
 * an attached medium (simulates a platform-side format/size rejection).
 * `MOCK_ZERNIO_UPLOAD_REJECT=1` simulates a media:upload failure.
 */
function mockZernioResponse(argv, env) {
  if (argv.includes('media:upload')) {
    if (env.MOCK_ZERNIO_UPLOAD_REJECT === '1') {
      return { status: 1, stdout: '', stderr: 'error: media upload rejected', signal: null };
    }
    const filePath = argv[argv.indexOf('media:upload') + 1];
    return {
      status: 0,
      stdout: JSON.stringify({ data: { url: `https://mock.zernio.local/media/${path.basename(filePath)}` } }),
      stderr: '',
      signal: null,
    };
  }

  const accountIdx = argv.indexOf('--accounts');
  const accountId = accountIdx !== -1 ? argv[accountIdx + 1] : null;
  const hasMedia = argv.includes('--media');
  const rejectAccounts = (env.MOCK_ZERNIO_MEDIA_REJECT_ACCOUNTS || '').split(',').filter(Boolean);
  if (hasMedia && accountId && rejectAccounts.includes(accountId)) {
    return { status: 1, stdout: '', stderr: 'error: media format unsupported for this account/platform', signal: null };
  }
  return {
    status: 0,
    stdout: JSON.stringify({ data: { url: `https://mock.zernio.local/posts/${accountId || 'unknown'}` } }),
    stderr: '',
    signal: null,
  };
}

// Env vars a child process needs to resolve/run `npx` itself, independent of
// any project secrets. Harmless if unset on the current OS.
const CHILD_ENV_PASSTHROUGH_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'SystemDrive',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'NODE_PATH',
];

/**
 * zernio-cli is a third-party, npx-fetched, SHA-pinned dependency (see
 * ZERNIO_SHA above) — it has no business seeing unrelated project secrets.
 * Scope its env to ZERNIO_* config plus the minimum `npx` needs to resolve
 * and run at all.
 *
 * Windows env objects built by hand (as `env` here is, via resolveAllEnv)
 * commonly carry `Path` rather than `PATH` — unlike the OS-level
 * `process.env` proxy, plain objects compare keys case-sensitively. Match
 * case-insensitively on win32 so the passthrough list still finds it.
 */
function scopeEnvForChild(fullEnv) {
  const scoped = {};
  if (process.platform === 'win32') {
    const passthroughUpper = new Set(CHILD_ENV_PASSTHROUGH_KEYS.map((k) => k.toUpperCase()));
    for (const [key, value] of Object.entries(fullEnv)) {
      if (passthroughUpper.has(key.toUpperCase()) || key.startsWith('ZERNIO_')) {
        scoped[key] = value;
      }
    }
    return scoped;
  }
  for (const key of CHILD_ENV_PASSTHROUGH_KEYS) {
    if (fullEnv[key] !== undefined) scoped[key] = fullEnv[key];
  }
  for (const [key, value] of Object.entries(fullEnv)) {
    if (key.startsWith('ZERNIO_')) scoped[key] = value;
  }
  return scoped;
}

// Windows spawn of npx (CVE-2024-27980, no shell:true — argv carries raw
// journal body / thread JSON) is handled by media-utils.cjs's npxCommand;
// see its doc comment for the full rationale.
function runZernio(argv, env) {
  if (env.MOCK_ZERNIO_CLI === '1') {
    return mockZernioResponse(argv, env);
  }
  const scopedEnv = scopeEnvForChild(env);
  let command, args;
  try {
    ({ command, args } = npxCommand(argv));
  } catch (error) {
    return { status: 1, stdout: '', stderr: `[post-social] ${error.message}` };
  }
  return spawnSync(command, args, { encoding: 'utf8', env: scopedEnv });
}

/** Upload each local media file once (shared across all targeted channels); best-effort — a failed upload is skipped, not fatal. */
function uploadMediaFiles(paths, env) {
  const urls = [];
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) {
      console.error(`[post-social] warning: media file not found, skipping: ${filePath}`);
      continue;
    }
    const argv = ['-y', ZERNIO_PACKAGE, 'media:upload', filePath, '--json'];
    const result = runZernio(argv, env);
    if (result.status !== 0) {
      console.error(
        `[post-social] warning: media upload failed for ${path.basename(filePath)}, continuing without it: ${redactSecrets((result.stderr || result.stdout || 'unknown error').trim(), env)}`
      );
      continue;
    }
    const url = extractPostUrl(result.stdout);
    if (!url) {
      console.error(`[post-social] warning: media:upload returned no URL for ${path.basename(filePath)}, skipping`);
      continue;
    }
    urls.push(url);
  }
  return urls;
}

function extractPostUrl(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    const url = (parsed && parsed.data && parsed.data.url) || (parsed && parsed.url);
    if (url) return url;
  } catch (_error) {
    // stdout wasn't JSON — fall through to a plain URL scan.
  }
  const match = stdout.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

/** Post one channel; honors Retry-After once on a detected rate-limit, then marks RATE_LIMITED. */
function postToChannel({ channel, body, isDryRun, env, mediaUrls = [] }) {
  const shapeError = validateChannelShape(channel);
  if (shapeError) {
    return { channelId: (channel && channel.id) || '(unknown)', status: 'INVALID_CHANNEL', argv: null, url: null, error: shapeError };
  }

  const usesThread = THREAD_PLATFORMS.has(channel.platform);
  let threadPosts = null;
  if (usesThread) {
    const threadResult = splitThread(body, { platform: channel.platform });
    printTruncationWarning(threadResult);
    threadPosts = threadResult.posts;
  }

  const argv = buildZernioArgv({ body, channel, threadPosts, mediaUrls });

  if (isDryRun) {
    return { channelId: channel.id, status: 'DRY_RUN', argv, url: null, error: null };
  }

  let result = runZernio(argv, env);
  let combinedOutput = `${result.stdout || ''}${result.stderr || ''}`;

  // Media accepted at upload time but rejected downstream by this channel's platform
  // (format/size unsupported) — fall back to a text-only post for this channel only.
  if (result.status !== 0 && mediaUrls.length > 0 && MEDIA_REJECT_PATTERN.test(combinedOutput)) {
    const mediaError = (result.stderr || result.stdout || '').trim();
    const textOnlyArgv = buildZernioArgv({ body, channel, threadPosts, mediaUrls: [] });
    const textOnlyResult = runZernio(textOnlyArgv, env);
    if (textOnlyResult.status === 0) {
      return {
        channelId: channel.id,
        status: 'MEDIA_UNSUPPORTED',
        argv: textOnlyArgv,
        url: extractPostUrl(textOnlyResult.stdout),
        error: mediaError,
      };
    }
    result = textOnlyResult;
    combinedOutput = `${result.stdout || ''}${result.stderr || ''}`;
  }

  if (result.status !== 0 && RATE_LIMIT_PATTERN.test(combinedOutput)) {
    const retryAfterMatch = combinedOutput.match(RETRY_AFTER_PATTERN);
    const retryAfterSeconds = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) : 1;
    sleepSync(Math.min(retryAfterSeconds, 30) * 1000);
    result = runZernio(argv, env);
    if (result.status !== 0) {
      return { channelId: channel.id, status: 'RATE_LIMITED', argv, url: null, error: (result.stderr || result.stdout || '').trim() };
    }
  }

  if (result.status !== 0) {
    return { channelId: channel.id, status: 'FAILED', argv, url: null, error: (result.stderr || result.stdout || '').trim() };
  }

  return { channelId: channel.id, status: 'SUCCESS', argv, url: extractPostUrl(result.stdout), error: null };
}

function printSummaryTable(results, statePath) {
  console.error('channel\tstatus\turl\terror');
  for (const r of results) {
    console.error([r.channelId, r.status, r.url || '', r.error ? r.error.slice(0, 160).replace(/\s+/g, ' ') : ''].join('\t'));
  }
  console.error(`posted-state: ${statePath}`);
}

async function main() {
  let values;
  try {
    ({ values } = parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`[post-social] invalid arguments: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (values.help) {
    console.error(
      'Usage: node post-social.cjs --journal-file <path> [--channels <ids>] [--channel-bodies <path>] [--dry-run] [--json] [--image <path-or-glob>]... [--image-ai <prompt>] [--video <path-or-glob>]... [--video-ai <prompt>]'
    );
    return;
  }

  if (!values['journal-file']) {
    console.error('[post-social] --journal-file is required');
    process.exitCode = 1;
    return;
  }

  const journalFile = path.resolve(values['journal-file']);
  if (!fs.existsSync(journalFile)) {
    console.error(`[post-social] journal file not found: ${journalFile}`);
    process.exitCode = 1;
    return;
  }

  const isDryRun = Boolean(values['dry-run']) || process.env.POST_SOCIAL_DRY_RUN === '1';

  const config = resolveConfig({ projectRoot: values['project-root'], cwd: path.dirname(journalFile) });
  const env = { ...resolveAllEnv(config.projectRoot), ZERNIO_CLI_LOAD_ENV: '1' };

  if (!env.ZERNIO_API_KEY) {
    console.error(
      '[post-social] ZERNIO_API_KEY is not set. Set it via .agentkit/.env, ~/.agentkit/.env, process.env, or run `zernio auth:login` (see references/zernio-integration.md).'
    );
    process.exitCode = 1;
    return;
  }

  let targetChannels = config.channels;
  if (values.channels) {
    const groups = isPlainObject(config.groups) ? config.groups : {};
    const requestedTokens = values.channels
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    // Each token is either a literal channel id, or a named `groups.<name>`
    // (e.g. `groups.build_in_public: [x_main, threads_main]` in
    // journal.yaml) that expands to its member channel ids.
    const requestedIds = new Set();
    for (const token of requestedTokens) {
      if (Array.isArray(groups[token])) {
        for (const id of groups[token]) requestedIds.add(id);
        continue;
      }
      requestedIds.add(token);
    }

    for (const id of requestedIds) {
      if (!targetChannels.some((c) => c.id === id)) {
        console.error(`[post-social] warning: unknown channel id "${id}" — not found in resolved config, skipping`);
      }
    }
    targetChannels = targetChannels.filter((c) => requestedIds.has(c.id));
  }

  if (targetChannels.length === 0) {
    console.error('[post-social] no channels to post to — check .agentkit/journal.yaml `channels:` and any --channels filter');
    process.exitCode = 1;
    return;
  }

  let channelBodies;
  try {
    channelBodies = readChannelBodies(values['channel-bodies']);
  } catch (error) {
    console.error(`[post-social] ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const journalBody = readJournalBody(journalFile);
  const statePath = path.join(journalStateDir(config.projectRoot, journalFile), 'posted.json');
  const postedState = readPostedState(statePath);

  // Resolve local media file(s): direct --image/--video path(s)/glob(s), or AI generation
  // (cached) via --image-ai/--video-ai. A generation failure is a warning, not fatal — the
  // run continues text-only rather than losing an otherwise-successful post.
  const localMediaPaths = [];
  try {
    const images = generateImages({
      imageArgs: values.image,
      imageAiPrompt: values['image-ai'],
      journalFile,
      projectRoot: config.projectRoot,
      dryRun: isDryRun,
      env,
    });
    localMediaPaths.push(...images.paths);
  } catch (error) {
    console.error(`[post-social] warning: image generation failed, continuing without it: ${redactSecrets(error.message, env)}`);
  }
  try {
    const videos = await generateVideos({
      videoArgs: values.video,
      videoAiPrompt: values['video-ai'],
      journalFile,
      projectRoot: config.projectRoot,
      dryRun: isDryRun,
      env,
    });
    localMediaPaths.push(...videos.paths);
  } catch (error) {
    console.error(`[post-social] warning: video generation failed, continuing without it: ${redactSecrets(error.message, env)}`);
  }

  // Dry-run: never invoke media:upload — print a mocked URL per file so the argv preview
  // reflects the shape of a live run.
  const mediaUrls = isDryRun
    ? localMediaPaths.map((p) => `https://dry-run.mock/media/${path.basename(p)}`)
    : uploadMediaFiles(localMediaPaths, env);

  const results = [];
  // `nextState` is flushed to disk after every channel (not just at the end
  // of the loop) so a crash or Ctrl-C mid-run doesn't lose already-recorded
  // SUCCESS entries — a later re-run must still see them and refuse to
  // double-post.
  const nextState = { ...postedState };
  for (const channel of targetChannels) {
    if (postedState[channel.id] === 'SUCCESS') {
      console.error(
        `warning: channel "${channel.id}" was already posted successfully in a previous run; refusing to re-post (see ${statePath})`
      );
      results.push({
        channelId: channel.id,
        status: 'SKIPPED_ALREADY_POSTED',
        argv: null,
        url: postedState[`${channel.id}_url`] || null,
        error: null,
      });
      continue;
    }

    const body = Object.prototype.hasOwnProperty.call(channelBodies, channel.id) ? channelBodies[channel.id] : journalBody;
    const result = postToChannel({ channel, body, isDryRun, env, mediaUrls });
    results.push(result);

    if (!isDryRun && (result.status === 'SUCCESS' || result.status === 'MEDIA_UNSUPPORTED')) {
      nextState[result.channelId] = 'SUCCESS';
      if (result.url) nextState[`${result.channelId}_url`] = result.url;
      writePostedState(statePath, nextState);
    }
  }

  printSummaryTable(results, statePath);

  if (values.json) {
    console.log(JSON.stringify({ results, dryRun: isDryRun, statePath }, null, 2));
  }

  const attempted = results.filter((r) => r.status !== 'SKIPPED_ALREADY_POSTED');
  const anySuccess = results.some((r) => r.status === 'SUCCESS' || r.status === 'MEDIA_UNSUPPORTED' || r.status === 'DRY_RUN');
  process.exitCode = !anySuccess && attempted.length > 0 ? 1 : 0;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[post-social] ${redactSecrets(error.message)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildZernioArgv,
  extractPostUrl,
  readJournalBody,
  readChannelBodies,
  journalStateSlug,
  journalStateDir,
  ZERNIO_PACKAGE,
  ZERNIO_SHA,
};
