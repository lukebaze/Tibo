#!/usr/bin/env node
/**
 * media-utils.cjs — shared helpers for `generate-image.cjs`,
 * `generate-video.cjs`, and `post-social.cjs`'s media-attachment path.
 *
 * Kept dependency-free (no npm packages) to match the rest of ak-journal's
 * vendored scripts.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Expand a literal path, or a single-level basename glob (`dir/*.ext`), to absolute path(s). */
function expandGlob(pattern, cwd) {
  const abs = path.resolve(cwd, pattern);
  if (!/[*?[]/.test(pattern)) {
    return [abs];
  }
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const regexSource = `^${base
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')}$`;
  const regex = new RegExp(regexSource);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_error) {
    return [];
  }
  return entries
    .filter((name) => regex.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

/** Resolve one or more `--image`/`--video` values (literal paths and/or globs) to a deduped absolute-path array. */
function resolveMediaPaths(patterns, cwd) {
  const seen = new Set();
  const out = [];
  for (const pattern of patterns || []) {
    for (const resolved of expandGlob(pattern, cwd)) {
      if (!seen.has(resolved)) {
        seen.add(resolved);
        out.push(resolved);
      }
    }
  }
  return out;
}

/** Deterministic sha256 over an ordered list of cache-key fields (kongming R6). */
function hashFields(fields) {
  const hash = crypto.createHash('sha256');
  for (const field of fields) {
    hash.update(String(field === undefined || field === null ? '' : field));
    hash.update('\x00');
  }
  return hash.digest('hex');
}

/** Same convention as post-social.cjs's journalStateDir — media cache and posted-state share one dir per journal. */
function slugForJournalFile(journalFile) {
  return path.basename(journalFile).replace(/\.md$/i, '');
}

function cacheDirFor(projectRoot, slug) {
  return path.join(projectRoot, 'plans', 'reports', `journal-media-${slug}`);
}

/** Strip a leading YAML frontmatter block, mirroring post-social.cjs's readJournalBody. */
function readJournalBodyRaw(journalFile) {
  const raw = fs.readFileSync(journalFile, 'utf8');
  const frontmatterMatch = raw.match(/^---\n[\s\S]*?\n---\n?/);
  return (frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw).trim();
}

/** Path to npm's npx-cli.js next to the running Node binary, or null if absent. */
function resolveWindowsNpxEntry() {
  const candidate = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Resolve the {command, args} to run `npx <argv>` WITHOUT shell:true.
 * `argv` here routinely carries caller-supplied content (AI prompts, journal
 * bodies, file paths) — with shell:true, Node joins argv into one unescaped
 * shell command string, turning any shell metacharacter in that content into
 * a command-injection vector on Windows (cmd.exe). On win32 we bypass
 * npx.cmd entirely and invoke npm's JS entry point directly through the
 * current Node binary — a plain argv spawn, no shell involved. (Spawning
 * npx.cmd without shell:true also just fails outright: Node patched for
 * CVE-2024-27980 — all supported Node >=18.20.0/>=20.12.0/>=21.7.2 — throws
 * EINVAL for an unshelled .cmd spawn, so shell:true was never a safe
 * alternative here either.)
 */
function npxCommand(argv) {
  if (process.platform !== 'win32') {
    return { command: 'npx', args: argv };
  }
  const npxCliEntry = resolveWindowsNpxEntry();
  if (!npxCliEntry) {
    throw new Error(
      `could not locate npm's npx-cli.js next to the running Node binary (${process.execPath}) — reinstall Node or ensure npm ships alongside it.`
    );
  }
  return { command: process.execPath, args: [npxCliEntry, ...argv] };
}

const GENERIC_SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /sk_[A-Za-z0-9_-]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xoxb-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

/** Replace any occurrence of a sensitive env var's VALUE (key/token/secret/password) in `text`. */
function redactEnvSecrets(text, env) {
  let out = text;
  for (const [key, value] of Object.entries(env || {})) {
    if (!value || String(value).length < 6) continue;
    if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)) {
      out = out.split(value).join('[redacted]');
    }
  }
  return out;
}

/** Redact API keys / tokens from a log or error string before it is ever printed. Never echoes env values. */
function redactSecrets(text, env = process.env) {
  if (typeof text !== 'string') return text;
  let out = redactEnvSecrets(text, env);
  for (const pattern of GENERIC_SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }
  return out;
}

module.exports = {
  expandGlob,
  resolveMediaPaths,
  hashFields,
  slugForJournalFile,
  cacheDirFor,
  readJournalBodyRaw,
  npxCommand,
  redactSecrets,
};
