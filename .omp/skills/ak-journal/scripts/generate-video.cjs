#!/usr/bin/env node
/**
 * generate-video.cjs — resolves local video file(s) for a journal's social
 * media attachment, either from user-provided path(s)/glob(s) or by
 * generating one via `multix` (AI video generation).
 *
 * CLI usage:
 *   node generate-video.cjs --video <path-or-glob>... [--json]
 *   node generate-video.cjs --video-ai <prompt> [--engine <name>]
 *     [--duration <seconds>] [--resolution <WxH>] [--journal-file <path>]
 *     [--project-root <path>] [--dry-run] [--json]
 *
 * Per AMENDMENTS.md V7 (Phase 8): only `--video <path>` and `--video-ai
 * <prompt>` are direct script inputs — there is no no-value "render locally"
 * branch. Local-engine orchestration (via the installed ak-hyperframes or
 * ak-remotion skill) is the calling agent's job; the agent passes the
 * resulting file back in via `--video <path>`.
 *
 * Engine selection (informational + part of the cache key — multix itself
 * doesn't take an "engine" argument, but the resolved value distinguishes
 * cache entries when a project's default local-render engine changes)
 * precedence: `--engine` CLI flag > `journal.video.engine` project config >
 * user config (both already merged by resolve-config.cjs) > auto-detect.
 * Auto-detect (AMENDMENTS.md G1) probes
 * `~/.claude/skills/ak-hyperframes/SKILL.md` presence — hyperframes if
 * found, else remotion. `MOCK_INSTALLED_SKILLS_ROOT` overrides the
 * `~/.claude/skills` root for tests.
 *
 * Cache key (kongming R6): sha256 of journal_body + engine + model +
 * TEMPLATE_VERSION + duration + resolution.
 *
 * `--dry-run` skips generation entirely (video generation is long-running).
 * Progress streams to stderr, line-buffered, while multix runs.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseArgs } = require('util');
const { spawn } = require('child_process');

const { resolveConfig } = require('./resolve-config.cjs');
const {
  resolveMediaPaths,
  hashFields,
  slugForJournalFile,
  cacheDirFor,
  readJournalBodyRaw,
  npxCommand,
  redactSecrets,
} = require('./media-utils.cjs');

const TEMPLATE_VERSION = '1';
const DEFAULT_VIDEO_MODEL = 'veo-3';
const DEFAULT_DURATION_SECONDS = 15;
const DEFAULT_RESOLUTION = '1080x1920';

function parseCliArgs(argv) {
  return parseArgs({
    args: argv,
    options: {
      video: { type: 'string', multiple: true, default: [] },
      'video-ai': { type: 'string' },
      engine: { type: 'string' },
      duration: { type: 'string' },
      resolution: { type: 'string' },
      'journal-file': { type: 'string' },
      'project-root': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
}

/** Root directory to probe for installed skills; overridable for tests. */
function installedSkillsRoot(env) {
  return env.MOCK_INSTALLED_SKILLS_ROOT || path.join(os.homedir(), '.claude', 'skills');
}

/** Engine precedence: CLI > resolved config (project > user, already merged) > auto-detect. */
function resolveEngine({ cliEngine, configuredEngine, env = process.env } = {}) {
  if (cliEngine) return cliEngine;
  if (configuredEngine && configuredEngine !== 'auto') return configuredEngine;
  const hyperframesSkillPath = path.join(installedSkillsRoot(env), 'ak-hyperframes', 'SKILL.md');
  return fs.existsSync(hyperframesSkillPath) ? 'hyperframes' : 'remotion';
}

/** sha256 cache key per AMENDMENTS.md R6. */
function buildCacheKey({ journalBody, videoAiPrompt, engine, model, duration, resolution }) {
  return hashFields([journalBody, videoAiPrompt, engine, model, TEMPLATE_VERSION, duration, resolution]);
}

/**
 * Invoke multix to generate an AI video, streaming stderr progress lines.
 * Test doubles:
 *   MOCK_MULTIX_OUTPUT=<path>  — short-circuits the spawn; copies that file to outputPath.
 *   MOCK_MULTIX_ARGV=1         — additionally writes the argv that would have
 *                                 been used to MOCK_MULTIX_ARGV_PATH (default
 *                                 <tmpdir>/multix-argv.json) for assertion.
 */
function invokeMultixVideo({ prompt, model, duration, resolution, outputPath, env }) {
  return new Promise((resolve, reject) => {
    const argv = [
      '-y',
      'multix',
      'video',
      '--model',
      model,
      '--prompt',
      prompt,
      '--duration',
      String(duration),
      '--resolution',
      resolution,
      '--output',
      outputPath,
    ];

    if (env.MOCK_MULTIX_OUTPUT) {
      try {
        if (env.MOCK_MULTIX_ARGV === '1') {
          const argvPath = env.MOCK_MULTIX_ARGV_PATH || path.join(os.tmpdir(), 'multix-argv.json');
          fs.writeFileSync(argvPath, JSON.stringify(argv));
        }
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.copyFileSync(env.MOCK_MULTIX_OUTPUT, outputPath);
        resolve();
      } catch (error) {
        reject(error);
      }
      return;
    }

    const { command, args } = npxCommand(argv);
    const child = spawn(command, args, { env });
    let stderrBuf = '';
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      let newlineIdx = stderrBuf.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = stderrBuf.slice(0, newlineIdx);
        stderrBuf = stderrBuf.slice(newlineIdx + 1);
        if (line) process.stderr.write(`[generate-video] ${redactSecrets(line, env)}\n`);
        newlineIdx = stderrBuf.indexOf('\n');
      }
    });
    let stdoutBuf = '';
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const message = redactSecrets((stderrBuf + stdoutBuf).trim().slice(0, 300) || `exit ${code}`, env);
        reject(new Error(`multix video generation failed: ${message}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Resolve video(s) for social posting: direct path/glob passthrough, or
 * multix AI generation (cached). Async because real generation streams
 * progress and can run for minutes.
 * @returns {Promise<{paths: string[], engine?: string, cached?: boolean, dryRun?: boolean}>}
 */
async function generateVideos({
  videoArgs = [],
  videoAiPrompt,
  journalFile,
  projectRoot,
  cwd,
  dryRun = false,
  engine: cliEngine,
  duration,
  resolution,
  env = process.env,
} = {}) {
  const startDir = cwd || process.cwd();

  if (videoArgs.length > 0) {
    return { paths: resolveMediaPaths(videoArgs, startDir) };
  }

  if (!videoAiPrompt) {
    return { paths: [] };
  }

  const config = resolveConfig({ projectRoot, cwd: startDir });
  const model = (config.ai && config.ai.video_model) || DEFAULT_VIDEO_MODEL;
  const resolvedEngine = resolveEngine({
    cliEngine,
    configuredEngine: config.video && config.video.engine,
    env,
  });
  const dur = duration || DEFAULT_DURATION_SECONDS;
  const res = resolution || DEFAULT_RESOLUTION;
  const journalBody = journalFile && fs.existsSync(journalFile) ? readJournalBodyRaw(journalFile) : '';
  const slug = journalFile ? slugForJournalFile(journalFile) : 'ad-hoc';
  const cacheKey = buildCacheKey({
    journalBody,
    videoAiPrompt,
    engine: resolvedEngine,
    model,
    duration: dur,
    resolution: res,
  });
  const dir = cacheDirFor(config.projectRoot, slug);
  const outputPath = path.join(dir, `video-${cacheKey.slice(0, 16)}.mp4`);

  if (fs.existsSync(outputPath)) {
    return { paths: [outputPath], engine: resolvedEngine, cached: true };
  }

  if (dryRun) {
    return { paths: [outputPath], engine: resolvedEngine, dryRun: true };
  }

  fs.mkdirSync(dir, { recursive: true });
  await invokeMultixVideo({ prompt: videoAiPrompt, model, duration: dur, resolution: res, outputPath, env });
  return { paths: [outputPath], engine: resolvedEngine, cached: false };
}

async function main() {
  let values;
  try {
    ({ values } = parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`[generate-video] invalid arguments: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (values.help) {
    console.error(
      'Usage: node generate-video.cjs --video <path-or-glob>... | --video-ai <prompt> [--engine <name>] [--duration <seconds>] [--resolution <WxH>] [--journal-file <path>] [--project-root <path>] [--dry-run] [--json]'
    );
    return;
  }

  if (values.video.length === 0 && !values['video-ai']) {
    console.error('[generate-video] pass --video <path-or-glob> or --video-ai <prompt>');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await generateVideos({
      videoArgs: values.video,
      videoAiPrompt: values['video-ai'],
      engine: values.engine,
      duration: values.duration ? Number(values.duration) : undefined,
      resolution: values.resolution,
      journalFile: values['journal-file'] ? path.resolve(values['journal-file']) : undefined,
      projectRoot: values['project-root'],
      dryRun: values['dry-run'],
    });
    if (values.json) {
      console.log(JSON.stringify(result));
    } else {
      console.error(result.paths.join('\n'));
    }
  } catch (error) {
    console.error(`[generate-video] ${redactSecrets(error.message)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[generate-video] ${redactSecrets(error.message)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  TEMPLATE_VERSION,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_RESOLUTION,
  resolveEngine,
  buildCacheKey,
  generateVideos,
};
