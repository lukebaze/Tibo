#!/usr/bin/env node
/**
 * Resolve the persisted `worktree.root` AgentKit config value for ak:worktree.
 *
 * Precedence (highest → lowest), matching `getWorktreeRoot()` in
 * `worktree.cjs`:
 *   1. Project `.agentkit/config.yaml` `worktree.root`
 *   2. User AgentKit home `config.yaml` `worktree.root` (`$AGENTKIT_HOME` when
 *      set, otherwise `<os-home>/.agentkit`)
 * (The explicit `--worktree-root` flag outranks both of these and the
 * `WORKTREE_ROOT` env var ranks below both; `worktree.cjs` checks the flag
 * before calling here and falls back to the env var only when this module
 * returns no result.)
 *
 * SECURITY: project scope never honors an absolute/rooted value — a
 * project's `.agentkit/config.yaml` is committed and can arrive from an
 * untrusted cloned repo. A rooted value there is skipped with a warning
 * (never a hard error) and resolution falls through to user config. User
 * scope is the operator's own trusted file, so it may be absolute (the
 * portable-drive case) or relative. A relative value at either scope
 * resolves against `gitRoot`, not `process.cwd()`, and is bounded to
 * `dirname(gitRoot)` so it cannot escape onto the rest of the filesystem
 * (see resolveRelativeValue below).
 *
 * CLI usage:
 *   node resolve-worktree-root.cjs --git-root <path> [--agentkit-home <path>] [--json]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseArgs } = require('util');

const { parseYaml } = require('./mini-yaml-parser.cjs');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readYamlFile(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const parsed = parseYaml(fs.readFileSync(filePath, 'utf8'));
      return isPlainObject(parsed) ? parsed : {};
    }
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(`[resolve-worktree-root] failed to parse ${filePath}: ${error.message}`);
    }
  }
  return {};
}

/**
 * Mirrors the Go `isRootedPlansDirValue` (apps/cli/internal/runtime/ckprefs/plans_dir.go):
 * reports whether `v` is an absolute or rooted path, evaluated identically on
 * every OS regardless of the host platform, so a value written on one
 * platform (e.g. a Windows drive letter) is recognized the same way when this
 * script runs on another.
 */
function isRootedWorktreeRootValue(v) {
  if (path.isAbsolute(v)) return true;
  if (v.startsWith('/') || v.startsWith('\\')) return true;
  if (v.length >= 2 && v[1] === ':') {
    const c = v[0];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) return true;
  }
  return false;
}

/** Normalize backslashes to forward slashes so a relative value written on
 * Windows resolves the same way on macOS/Linux (mirrors PlansDirName's
 * GOOS-independent backslash normalization). */
function normalizeSeparators(value) {
  return value.replace(/\\/g, '/');
}

function resolveRelativeAgainstGitRoot(gitRoot, value) {
  return path.resolve(gitRoot, normalizeSeparators(value));
}

/** First `/`-delimited path segment of an already-forward-slash-normalized value. */
function firstPathSegment(cleanValue) {
  const idx = cleanValue.indexOf('/');
  return idx >= 0 ? cleanValue.slice(0, idx) : cleanValue;
}

/** Reports whether `target` is `boundary` itself or nested somewhere under it. */
function isWithinBoundary(target, boundary) {
  const rel = path.relative(boundary, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve symlinks for the deepest existing ancestor of `p`, then reattach
 * the remaining (possibly not-yet-created) path segments unresolved.
 *
 * SECURITY: `path.resolve`/`path.relative` are purely lexical — they never
 * consult the filesystem. A symlink committed inside the repo (e.g. a
 * project-controlled `escape -> /outside`) plus a project-config value like
 * `escape/wt` would pass the lexical `dirname(gitRoot)` boundary check
 * (`escape/wt` looks like it's inside the project) while `git worktree add`
 * follows the symlink to a location entirely outside that boundary — exactly
 * the untrusted-clone escape this module exists to prevent. `fs.realpathSync`
 * alone throws for a path that doesn't exist yet (the worktree directory
 * itself usually doesn't), so only the deepest existing ancestor is
 * realpath'd; the remaining not-yet-created segments are reattached as-is.
 */
function realpathDeepestExisting(p) {
  const trailing = [];
  let current = p;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return trailing.length ? path.join(real, ...trailing.reverse()) : real;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) return p;
      trailing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve a relative `worktree.root` value shared by both scopes, or null
 * (with a pushed warning) when the value cannot be safely honored.
 *
 * SECURITY: a relative value is contained to `dirname(gitRoot)` — the
 * project root and its immediate parent — so the documented sibling layout
 * (`../my-app-worktrees`) and an in-project value (`worktrees`) both resolve,
 * while an unbounded `../../../../etc/cron.d`-style value cannot escape onto
 * the rest of the filesystem. This mirrors the intent (not the exact rule) of
 * the Go `isRootedPlansDirValue`/`PlansDirName` precedent
 * (apps/cli/internal/runtime/ckprefs/plans_dir.go), which rejects any `..`
 * outright; that stricter rule is not used here because the sibling layout
 * this project's own issue recommends requires exactly one `..` to work.
 * A `.agentkit`-first-segment value is rejected outright, matching that same
 * precedent, since worktree content there would collide with config.
 */
function resolveRelativeValue(scope, gitRoot, value, warnings) {
  const clean = path.posix.normalize(normalizeSeparators(value));
  const segment = firstPathSegment(clean).toLowerCase();
  if (segment === '.agentkit') {
    warnings.push(
      `worktree.root in ${scope} config points inside the .agentkit directory ("${value}"); that location is reserved for AgentKit configuration, so it is being skipped.`
    );
    return null;
  }

  const resolved = resolveRelativeAgainstGitRoot(gitRoot, value);
  const boundary = path.dirname(gitRoot);
  // Compare realpath'd (symlink-resolved) locations, not the lexical paths —
  // see realpathDeepestExisting's SECURITY note above.
  const resolvedReal = realpathDeepestExisting(resolved);
  const boundaryReal = realpathDeepestExisting(boundary);
  if (!isWithinBoundary(resolvedReal, boundaryReal)) {
    warnings.push(
      `worktree.root in ${scope} config ("${value}") resolves outside the project and its parent directory, so it is being skipped as a safety boundary. Use a path no deeper than one level above the project root (e.g. "../my-app-worktrees"), or set an absolute path in user config instead.`
    );
    return null;
  }

  return resolved;
}

/**
 * Resolve one scope's raw `worktree.root` value into an absolute directory,
 * or null (with a pushed warning) when the value cannot be honored at this
 * scope.
 */
function resolveScopeValue(scope, gitRoot, rawValue, warnings) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return null;

  const rooted = isRootedWorktreeRootValue(value);
  if (scope === 'project') {
    if (rooted) {
      warnings.push(
        `worktree.root in project config is an absolute path ("${value}"); project scope only honors a relative path, so it is being skipped. Set it in your user config (~/.agentkit/config.yaml) instead.`
      );
      return null;
    }
    return resolveRelativeValue(scope, gitRoot, value, warnings);
  }

  // User scope: an absolute value (e.g. a portable drive) is honored as-is;
  // a relative value resolves (and is bounded) the same way as project scope.
  return rooted ? value : resolveRelativeValue(scope, gitRoot, value, warnings);
}

/**
 * @param {object} options
 * @param {string} options.gitRoot repo root a relative worktree.root resolves from
 * @param {string} options.agentkitHome the AgentKit home directory holding the
 *   user-scope config.yaml — `$AGENTKIT_HOME` when set, otherwise
 *   `<os-home>/.agentkit`. The caller resolves this (mirroring every other
 *   AGENTKIT_HOME-aware reader in the repo) so this module never guesses at
 *   an override it cannot see.
 * @returns {{root: string|null, source: 'project'|'user'|null, warnings: string[]}}
 */
function resolveWorktreeRoot({ gitRoot, agentkitHome }) {
  const warnings = [];

  const projectConfig = readYamlFile(path.join(gitRoot, '.agentkit', 'config.yaml'));
  const userConfig = readYamlFile(path.join(agentkitHome, 'config.yaml'));

  const projectRaw = isPlainObject(projectConfig.worktree) ? projectConfig.worktree.root : undefined;
  const projectResolved = resolveScopeValue('project', gitRoot, projectRaw, warnings);
  if (projectResolved) {
    return { root: projectResolved, source: 'project', warnings };
  }

  const userRaw = isPlainObject(userConfig.worktree) ? userConfig.worktree.root : undefined;
  const userResolved = resolveScopeValue('user', gitRoot, userRaw, warnings);
  if (userResolved) {
    return { root: userResolved, source: 'user', warnings };
  }

  return { root: null, source: null, warnings };
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        'git-root': { type: 'string' },
        'agentkit-home': { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(`[resolve-worktree-root] invalid arguments: ${error.message}`);
    process.exit(1);
    return;
  }

  if (values.help || !values['git-root']) {
    console.error('Usage: node resolve-worktree-root.cjs --git-root <path> [--agentkit-home <path>] [--json]');
    process.exit(values.help ? 0 : 1);
    return;
  }

  const gitRoot = path.resolve(values['git-root']);
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const agentkitHome = values['agentkit-home']
    ? path.resolve(values['agentkit-home'])
    : (process.env.AGENTKIT_HOME || path.join(homeDir, '.agentkit'));
  const resolved = resolveWorktreeRoot({ gitRoot, agentkitHome });
  console.log(values.json ? JSON.stringify(resolved, null, 2) : JSON.stringify(resolved));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[resolve-worktree-root] error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { resolveWorktreeRoot, isRootedWorktreeRootValue };
