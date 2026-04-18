#!/usr/bin/env node
/**
 * Opt-in activation of the repo-committed git hooks (scripts/hooks/*).
 *
 * Sets `core.hooksPath` in this repo's local .git/config only.
 * Does NOT touch the user's global git config.
 *
 * Usage: bun run setup-hooks
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOOKS_DIR = 'scripts/hooks';

try {
  statSync(resolve(ROOT, '.git'));
} catch {
  console.error('Not a git repo — skipping hook setup.');
  process.exit(0);
}

execFileSync('git', ['config', 'core.hooksPath', HOOKS_DIR], {
  cwd: ROOT,
  stdio: 'inherit',
});

// Make hooks executable (mostly a no-op on Windows, required on Unix)
for (const hook of ['pre-commit', 'commit-msg']) {
  try {
    chmodSync(resolve(ROOT, HOOKS_DIR, hook), 0o755);
  } catch {}
}

console.log(`\n✓ git hooks activated (core.hooksPath = ${HOOKS_DIR})`);
console.log('  pre-commit  → tsc --noEmit + cargo fmt --check');
console.log('  commit-msg  → commitlint (Conventional Commits)');
console.log('  To disable: git config --unset core.hooksPath');
