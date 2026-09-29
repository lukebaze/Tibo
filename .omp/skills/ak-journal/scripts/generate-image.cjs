#!/usr/bin/env node
/**
 * generate-image.cjs — resolves local image file(s) for a journal's social
 * media attachment, either from user-provided path(s)/glob(s) or by
 * generating one via `multix` (AI image generation).
 *
 * CLI usage:
 *   node generate-image.cjs --image <path-or-glob>... [--json]
 *   node generate-image.cjs --image-ai <prompt> [--journal-file <path>]
 *     [--project-root <path>] [--dry-run] [--json]
 *
 * Per AMENDMENTS.md V7 (Phase 7): only `--image <path>` and `--image-ai
 * <prompt>` are direct script inputs — there is no no-value "generate a
 * template image" branch here. That orchestration (via ak-design /
 * ak-frontend-design) is the calling agent's job; the agent passes the
 * resulting file back in via `--image <path>`.
 *
 * Cache key (kongming R6): sha256 of journal_body + writing_style +
 * language + model + TEMPLATE_VERSION. Bump TEMPLATE_VERSION whenever the
 * generation prompt/template shape changes, to invalidate stale cache
 * entries deterministically.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseArgs } = require('util');
const { spawnSync } = require('child_process');

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
const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

function parseCliArgs(argv) {
  return parseArgs({
    args: argv,
    options: {
      image: { type: 'string', multiple: true, default: [] },
      'image-ai': { type: 'string' },
      'journal-file': { type: 'string' },
      'project-root': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
}

/** sha256 cache key per AMENDMENTS.md R6. */
function buildCacheKey({ journalBody, imageAiPrompt, writingStyle, language, model }) {
  return hashFields([journalBody, imageAiPrompt, writingStyle, language, model, TEMPLATE_VERSION]);
}

/**
 * Invoke multix to generate an AI image. Test doubles:
 *   MOCK_MULTIX_OUTPUT=<path>  — short-circuits the spawn; copies that file to outputPath.
 *   MOCK_MULTIX_ARGV=1         — additionally writes the argv that would have
 *                                 been used to MOCK_MULTIX_ARGV_PATH (default
 *                                 <tmpdir>/multix-argv.json) for assertion.
 */
function invokeMultixImage({ prompt, model, outputPath, env }) {
  if (env.MOCK_MULTIX_OUTPUT) {
    const argv = ['-y', 'multix', 'image', '--model', model, '--prompt', prompt, '--output', outputPath];
    if (env.MOCK_MULTIX_ARGV === '1') {
      const argvPath = env.MOCK_MULTIX_ARGV_PATH || path.join(os.tmpdir(), 'multix-argv.json');
      fs.writeFileSync(argvPath, JSON.stringify(argv));
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(env.MOCK_MULTIX_OUTPUT, outputPath);
    return;
  }

  const argv = ['-y', 'multix', 'image', '--model', model, '--prompt', prompt, '--output', outputPath];
  const { command, args } = npxCommand(argv);
  const result = spawnSync(command, args, { encoding: 'utf8', env });
  if (result.status !== 0) {
    const message = redactSecrets((result.stderr || result.stdout || 'unknown error').trim(), env);
    throw new Error(`multix image generation failed: ${message}`);
  }
}

/**
 * Resolve image(s) for social posting: direct path/glob passthrough, or
 * multix AI generation (cached).
 * @returns {{paths: string[], cached?: boolean, dryRun?: boolean}}
 */
function generateImages({
  imageArgs = [],
  imageAiPrompt,
  journalFile,
  projectRoot,
  cwd,
  dryRun = false,
  env = process.env,
} = {}) {
  const startDir = cwd || process.cwd();

  if (imageArgs.length > 0) {
    return { paths: resolveMediaPaths(imageArgs, startDir) };
  }

  if (!imageAiPrompt) {
    return { paths: [] };
  }

  const config = resolveConfig({ projectRoot, cwd: startDir });
  const model = (config.ai && config.ai.image_model) || DEFAULT_IMAGE_MODEL;
  const journalBody = journalFile && fs.existsSync(journalFile) ? readJournalBodyRaw(journalFile) : '';
  const slug = journalFile ? slugForJournalFile(journalFile) : 'ad-hoc';
  const cacheKey = buildCacheKey({
    journalBody,
    imageAiPrompt,
    writingStyle: config.writing_style,
    language: config.language,
    model,
  });
  const dir = cacheDirFor(config.projectRoot, slug);
  const outputPath = path.join(dir, `image-${cacheKey.slice(0, 16)}.png`);

  if (fs.existsSync(outputPath)) {
    return { paths: [outputPath], cached: true };
  }

  if (dryRun) {
    return { paths: [outputPath], dryRun: true };
  }

  fs.mkdirSync(dir, { recursive: true });
  invokeMultixImage({ prompt: imageAiPrompt, model, outputPath, env });
  return { paths: [outputPath], cached: false };
}

function main() {
  let values;
  try {
    ({ values } = parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`[generate-image] invalid arguments: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (values.help) {
    console.error(
      'Usage: node generate-image.cjs --image <path-or-glob>... | --image-ai <prompt> [--journal-file <path>] [--project-root <path>] [--dry-run] [--json]'
    );
    return;
  }

  if (values.image.length === 0 && !values['image-ai']) {
    console.error('[generate-image] pass --image <path-or-glob> or --image-ai <prompt>');
    process.exitCode = 1;
    return;
  }

  try {
    const result = generateImages({
      imageArgs: values.image,
      imageAiPrompt: values['image-ai'],
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
    console.error(`[generate-image] ${redactSecrets(error.message)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  TEMPLATE_VERSION,
  DEFAULT_IMAGE_MODEL,
  buildCacheKey,
  generateImages,
};
