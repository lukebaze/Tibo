#!/usr/bin/env node
/**
 * Resolve the merged ak-journal configuration for a project.
 *
 * Precedence (highest → lowest):
 *   1. Project `.agentkit/journal.yaml` (`journal.*` fields at top level)
 *   2. Project `.agentkit/config.yaml` `journal.*` block
 *   3. User `~/.agentkit/config.yaml` `journal.*` block
 *   4. Built-in defaults
 *
 * (Per-channel overrides, e.g. a channel's own `language`, are resolved by
 * the caller — post-social.cjs — from the `channels` array this returns;
 * they are the highest-priority layer overall but are per-channel, not
 * global, so they are not merged here.)
 *
 * CLI usage:
 *   node resolve-config.cjs [--project-root <path>] [--json]
 *
 * See references/config-schema.md for the full schema and precedence table.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseArgs } = require('util');

const { parseYaml } = require('./mini-yaml-parser.cjs');

const DEFAULTS = Object.freeze({
  language: 'English',
  channels: [],
  writing_style: null,
  ai: Object.freeze({
    image_model: 'google/gemini-2.5-flash-image',
    video_model: 'veo-3',
  }),
  video: Object.freeze({ engine: 'auto' }),
  auto: true,
});

function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Walk up from `startDir` looking for `.agentkit/` or `.git/`; falls back to startDir. */
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(path.join(dir, '.agentkit')) || fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    if (dir === root) return path.resolve(startDir);
    dir = path.dirname(dir);
  }
}

function readYamlFile(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const parsed = parseYaml(fs.readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(`[resolve-config] failed to parse ${filePath}: ${error.message}`);
    }
  }
  return {};
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Deep-merge `override` onto `base`; arrays and scalars in override replace base wholesale. */
function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const overrideValue = override[key];
    if (isPlainObject(overrideValue) && isPlainObject(base[key])) {
      result[key] = deepMerge(base[key], overrideValue);
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue;
    }
  }
  return result;
}

/**
 * Discover `assets/writing-styles/*.md` in the project. Selection: explicit
 * `journal.writing_style` config value if set, else alphabetical first
 * filename (without extension). Returns null if no styles exist and none
 * configured — callers fall back to the built-in "professional-technical".
 */
function discoverWritingStyle(projectRoot, explicitStyle) {
  if (explicitStyle) return explicitStyle;

  const dir = path.join(projectRoot, 'assets', 'writing-styles');
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -3))
      .sort((a, b) => a.localeCompare(b));
    return files.length > 0 ? files[0] : null;
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(`[resolve-config] failed to read ${dir}: ${error.message}`);
    }
    return null;
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.projectRoot] explicit project root (skips discovery)
 * @param {string} [options.cwd] directory to start project-root discovery from
 * @returns {object} resolved config: {language, channels, writing_style, ai, video, auto, projectRoot}
 */
function resolveConfig(options = {}) {
  const startDir = options.cwd || process.cwd();
  const projectRoot = options.projectRoot ? path.resolve(startDir, options.projectRoot) : findProjectRoot(startDir);
  const homeDir = getHomeDir();

  const userConfig = readYamlFile(path.join(homeDir, '.agentkit', 'config.yaml'));
  const projectConfig = readYamlFile(path.join(projectRoot, '.agentkit', 'config.yaml'));
  const projectJournalYaml = readYamlFile(path.join(projectRoot, '.agentkit', 'journal.yaml'));

  const userJournal = isPlainObject(userConfig.journal) ? userConfig.journal : {};
  const projectJournal = isPlainObject(projectConfig.journal) ? projectConfig.journal : {};

  let merged = deepMerge(DEFAULTS, userJournal);
  merged = deepMerge(merged, projectJournal);
  merged = deepMerge(merged, projectJournalYaml);

  merged.writing_style = discoverWritingStyle(projectRoot, merged.writing_style);
  merged.channels = Array.isArray(merged.channels) ? merged.channels : [];

  return { ...merged, projectRoot };
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        'project-root': { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(`[resolve-config] invalid arguments: ${error.message}`);
    process.exit(1);
    return;
  }

  if (values.help) {
    console.error('Usage: node resolve-config.cjs [--project-root <path>] [--json]');
    process.exit(0);
    return;
  }

  const resolved = resolveConfig({ projectRoot: values['project-root'] });
  console.log(values.json ? JSON.stringify(resolved, null, 2) : JSON.stringify(resolved));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[resolve-config] error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { resolveConfig, findProjectRoot, discoverWritingStyle, deepMerge, DEFAULTS };
