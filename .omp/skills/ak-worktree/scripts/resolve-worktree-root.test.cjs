#!/usr/bin/env node
/**
 * Test suite for resolve-worktree-root.cjs
 * Run: node kits/core/skills/ak-worktree/scripts/resolve-worktree-root.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveWorktreeRoot, isRootedWorktreeRootValue } = require('./resolve-worktree-root.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function mkTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeWorktreeConfig(dir, root) {
  fs.mkdirSync(path.join(dir, '.agentkit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agentkit', 'config.yaml'), `worktree:\n  root: ${root}\n`);
}

console.log('\n📋 resolve-worktree-root Tests');

test('no config anywhere resolves to null', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.root === null, `expected null root, got ${result.root}`);
  assert(result.source === null, `expected null source, got ${result.source}`);
  assert(Array.isArray(result.warnings) && result.warnings.length === 0, 'expected no warnings');
});

test('project-only relative value resolves against gitRoot', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, '../my-app-worktrees');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.source === 'project', `expected project source, got ${result.source}`);
  assert(
    result.root === path.resolve(gitRoot, '../my-app-worktrees'),
    `unexpected root: ${result.root}`
  );
});

test('user-only absolute value is honored as-is', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  const absolute = path.join(os.tmpdir(), 'portable-drive-worktrees');
  writeWorktreeConfig(homeDir, absolute);
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.source === 'user', `expected user source, got ${result.source}`);
  assert(result.root === absolute, `expected ${absolute}, got ${result.root}`);
});

test('project scope wins over user scope when both are set', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, '../project-worktrees');
  writeWorktreeConfig(homeDir, path.join(os.tmpdir(), 'user-worktrees'));
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.source === 'project', `expected project to win, got ${result.source}`);
  assert(
    result.root === path.resolve(gitRoot, '../project-worktrees'),
    `unexpected root: ${result.root}`
  );
});

test('absolute value at project scope is skipped with a warning, falls through to user', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  const userAbsolute = path.join(os.tmpdir(), 'user-fallback-worktrees');
  writeWorktreeConfig(gitRoot, path.join(os.tmpdir(), 'untrusted-absolute-worktrees'));
  writeWorktreeConfig(homeDir, userAbsolute);
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.source === 'user', `expected fallback to user, got ${result.source}`);
  assert(result.root === userAbsolute, `unexpected root: ${result.root}`);
  assert(result.warnings.length === 1, `expected exactly one warning, got ${result.warnings.length}`);
  assert(/project scope only honors a relative path/.test(result.warnings[0]), 'warning should explain the rejection');
});

test('absolute value at project scope with no user config falls through to null', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, path.join(os.tmpdir(), 'untrusted-absolute-worktrees'));
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.root === null, `expected null root, got ${result.root}`);
  assert(result.source === null, `expected null source, got ${result.source}`);
  assert(result.warnings.length === 1, 'expected one warning');
});

test('relative value resolves from gitRoot, not process.cwd()', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, 'sibling-worktrees');
  const elsewhere = mkTempDir('ak-wt-elsewhere-');
  const previousCwd = process.cwd();
  process.chdir(elsewhere);
  try {
    const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
    assert(
      result.root === path.resolve(gitRoot, 'sibling-worktrees'),
      `expected resolution against gitRoot, got ${result.root}`
    );
    assert(result.root !== path.resolve(elsewhere, 'sibling-worktrees'), 'must not resolve against cwd');
  } finally {
    process.chdir(previousCwd);
  }
});

test('Windows-style backslash relative value normalizes on any host', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, '..\\windows-style-worktrees');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.source === 'project', `expected project source, got ${result.source}`);
  assert(
    result.root === path.resolve(gitRoot, '../windows-style-worktrees'),
    `unexpected root: ${result.root}`
  );
});

test('Windows drive-letter absolute value at user scope is recognized as rooted', () => {
  assert(isRootedWorktreeRootValue('D:\\AgentKit\\worktrees'), 'drive-letter path should be rooted');
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(homeDir, 'D:\\AgentKit\\worktrees');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.source === 'user', `expected user source, got ${result.source}`);
  assert(result.root === 'D:\\AgentKit\\worktrees', `expected drive path unchanged, got ${result.root}`);
});

test('empty/whitespace-only value is treated as absent', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, '""');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.root === null, `expected null root for empty value, got ${result.root}`);
});

test('malformed config file degrades to no config instead of throwing', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  fs.mkdirSync(path.join(gitRoot, '.agentkit'), { recursive: true });
  fs.writeFileSync(path.join(gitRoot, '.agentkit', 'config.yaml'), '::: not valid: [yaml');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.root === null, `expected null root for malformed config, got ${result.root}`);
});

test('missing gitRoot/.agentkit directory entirely is a no-op, not a throw', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.root === null && result.source === null, 'expected empty resolution');
});

test('deep .. traversal at project scope cannot escape past the parent directory', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, '../../../../../../../../etc/cron.d');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.root === null, `expected the escape to be rejected, got ${result.root}`);
  assert(result.warnings.length === 1, 'expected exactly one warning');
  assert(/resolves outside the project and its parent directory/.test(result.warnings[0]), 'warning should explain the boundary');
});

test('single-level .. (the documented sibling layout) still resolves', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, '../my-app-worktrees');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.source === 'project', `expected project source, got ${result.source}`);
  assert(
    result.root === path.resolve(gitRoot, '../my-app-worktrees'),
    `expected the sibling path to resolve, got ${result.root}`
  );
  assert(result.warnings.length === 0, 'sibling layout should not warn');
});

test('a symlink planted inside the repo cannot smuggle a relative value past the boundary', () => {
  // gitRoot must be nested one level inside its own fresh parent so that
  // dirname(gitRoot) (the boundary) does not also contain `outside` as an
  // unrelated sibling under the shared os.tmpdir() — that would make the
  // escape target look "within boundary" by coincidence rather than by the
  // symlink-following bug this test targets.
  const parentDir = mkTempDir('ak-wt-parent-');
  const gitRoot = fs.mkdtempSync(path.join(parentDir, 'git-'));
  const outside = mkTempDir('ak-wt-outside-');
  // Simulates a committed symlink in an untrusted clone: escape -> <outside>,
  // with worktree.root: escape/wt. Lexically "escape/wt" looks like it's
  // inside the project; the symlink actually routes it outside dirname(gitRoot).
  fs.symlinkSync(outside, path.join(gitRoot, 'escape'));
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, 'escape/wt');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.root === null, `expected the symlink escape to be rejected, got ${result.root}`);
  assert(result.warnings.length === 1, 'expected exactly one warning');
  assert(/resolves outside the project and its parent directory/.test(result.warnings[0]), 'warning should explain the boundary');
});

test('a value rooted at .agentkit is rejected even though it is nested inside the project', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(gitRoot, '.agentkit/worktrees');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.root === null, `expected .agentkit destination to be rejected, got ${result.root}`);
  assert(result.warnings.length === 1, 'expected exactly one warning');
  assert(/reserved for AgentKit configuration/.test(result.warnings[0]), 'warning should explain the rejection');
});

test('agentkitHome need not be nested under a .agentkit directory (AGENTKIT_HOME override contract)', () => {
  // worktree.cjs's getAgentKitHome() passes `$AGENTKIT_HOME` verbatim when
  // set, which is the AgentKit home itself (holding config.yaml directly),
  // not `<home>/.agentkit`. This module must read agentkitHome/config.yaml,
  // not agentkitHome/.agentkit/config.yaml.
  const gitRoot = mkTempDir('ak-wt-git-');
  const customAgentkitHome = mkTempDir('ak-wt-custom-akhome-');
  fs.writeFileSync(path.join(customAgentkitHome, 'config.yaml'), 'worktree:\n  root: /custom-akhome-worktrees\n');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: customAgentkitHome });
  assert(result.source === 'user', `expected user source, got ${result.source}`);
  assert(result.root === '/custom-akhome-worktrees', `unexpected root: ${result.root}`);
});

test('deep .. traversal at user scope is also bounded, not just project scope', () => {
  const gitRoot = mkTempDir('ak-wt-git-');
  const homeDir = mkTempDir('ak-wt-home-');
  writeWorktreeConfig(homeDir, '../../../../../../../../etc/cron.d');
  const result = resolveWorktreeRoot({ gitRoot, agentkitHome: path.join(homeDir, '.agentkit') });
  assert(result.root === null, `expected the escape to be rejected, got ${result.root}`);
  assert(result.warnings.length === 1, 'expected exactly one warning');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
