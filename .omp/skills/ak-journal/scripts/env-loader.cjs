#!/usr/bin/env node
/**
 * Environment Variable Loader for the ak-journal skill.
 *
 * Vendored (not shared) — this skill installs standalone and cannot import
 * across the source `kits/` tree once installed, so it carries its own copy
 * of the env-cascade loader. Mirrors the ak-seo skill's env-loader.cjs
 * pattern (see references/env-cascade.md for rationale).
 *
 * Cascade (highest → lowest priority):
 *   1. process.env                  (already-set values always win)
 *   2. <cwd>/.agentkit/.env         (project-scoped, preferred)
 *   3. ~/.agentkit/.env             (user-scoped, preferred)
 *   4. <cwd>/.claude/.env           (legacy project-scoped)
 *   5. ~/.claude/.env               (legacy user-scoped)
 *
 * Usage:
 *   const { loadEnv, parseEnvContent } = require('./env-loader.cjs');
 *   const env = loadEnv(process.cwd());
 *   const apiKey = env.ZERNIO_API_KEY;
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Parse .env-formatted text into a plain key/value object.
 * Supports: comments (#...), blank lines, unquoted values, single- and
 * double-quoted values, `KEY=value=with=equals`, and `\n`/`\t` escapes
 * inside double-quoted values only (matches ak-seo's env-loader.cjs).
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseEnvContent(content) {
  const env = {};
  if (typeof content !== 'string') return env;

  const lines = content.split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) continue;

    const rawValue = trimmed.slice(eqIndex + 1).trim();
    let value = rawValue;

    const isDoubleQuoted = rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length >= 2;
    const isSingleQuoted = rawValue.startsWith("'") && rawValue.endsWith("'") && rawValue.length >= 2;

    if (isDoubleQuoted || isSingleQuoted) {
      value = rawValue.slice(1, -1);
    }

    if (isDoubleQuoted) {
      value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }

    env[key] = value;
  }

  return env;
}

/**
 * Safely read + parse an .env file. Never throws.
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
function readEnvFile(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return parseEnvContent(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(`[ak-journal env-loader] could not read ${filePath}: ${error.message}`);
    }
  }
  return {};
}

function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/**
 * Load the merged env cascade for a given project directory. Does NOT
 * mutate process.env — callers read from the returned object, falling back
 * to process.env themselves (or use {@link resolveEnv}).
 *
 * @param {string} [cwd] project root to resolve `.agentkit/.env` /
 *   `.claude/.env` from. Defaults to process.cwd().
 * @returns {Record<string, string>} merged file-sourced env (process.env
 *   NOT included — see resolveEnv for the process.env-aware accessor)
 */
function loadEnv(cwd) {
  const projectRoot = cwd || process.cwd();
  const homeDir = getHomeDir();

  // Lowest priority first; later entries override earlier ones.
  const layers = [
    readEnvFile(path.join(homeDir, '.claude', '.env')), // 5. legacy user
    readEnvFile(path.join(projectRoot, '.claude', '.env')), // 4. legacy project
    readEnvFile(path.join(homeDir, '.agentkit', '.env')), // 3. user
    readEnvFile(path.join(projectRoot, '.agentkit', '.env')), // 2. project
  ];

  let merged = {};
  for (const layer of layers) {
    merged = { ...merged, ...layer };
  }
  return merged;
}

/**
 * Resolve a single env var honoring the full cascade, process.env highest.
 * @param {string} key
 * @param {string} [cwd]
 * @param {string} [defaultValue]
 * @returns {string | undefined}
 */
function resolveEnv(key, cwd, defaultValue) {
  if (process.env[key] !== undefined) return process.env[key];
  const fileEnv = loadEnv(cwd);
  return fileEnv[key] !== undefined ? fileEnv[key] : defaultValue;
}

/**
 * Merge the cascade with process.env (process.env wins) into one object.
 * Convenience for callers that want a single lookup table.
 * @param {string} [cwd]
 * @returns {Record<string, string>}
 */
function resolveAllEnv(cwd) {
  return { ...loadEnv(cwd), ...process.env };
}

module.exports = {
  loadEnv,
  parseEnvContent,
  resolveEnv,
  resolveAllEnv,
};
