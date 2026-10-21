#!/usr/bin/env node
/**
 * One-shot version bump. Updates `package.json`'s version field and then runs
 * `sync-version.mjs` to propagate the new value to every other manifest
 * (Cargo.toml, tauri.conf.json) and verify the changelog.
 *
 * The Tauri runtime exposes the version via `getVersion()` which reads
 * `tauri.conf.json`, so once that file is in sync every UI surface
 * (`SuggestionsView`, `SettingsApp`, "See what's new" badge…) updates with
 * zero code changes.
 *
 * Usage:
 *   pnpm run bump-version 0.2.0     explicit version
 *   pnpm run bump-version patch     0.1.2 -> 0.1.3
 *   pnpm run bump-version minor     0.1.2 -> 0.2.0
 *   pnpm run bump-version major     0.1.2 -> 1.0.0
 *
 * Does NOT touch git — review the diff and commit yourself when ready.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const arg = process.argv[2];
if (!arg) {
  console.error('Missing version argument.');
  console.error('Usage: pnpm run bump-version <X.Y.Z | patch | minor | major>');
  process.exit(1);
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function bumpSemver(current, kind) {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    console.error(`Cannot parse current version "${current}" — pass an explicit X.Y.Z.`);
    process.exit(1);
  }
  let [, major, minor, patch] = match.map(Number);
  if (kind === 'patch') patch += 1;
  else if (kind === 'minor') {
    minor += 1;
    patch = 0;
  } else if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  }
  return `${major}.${minor}.${patch}`;
}

const pkgPath = resolve(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;

let next;
if (['patch', 'minor', 'major'].includes(arg)) {
  next = bumpSemver(current, arg);
} else if (SEMVER_RE.test(arg)) {
  next = arg;
} else {
  console.error(`"${arg}" is not a valid semver (X.Y.Z) or bump kind (patch|minor|major).`);
  process.exit(1);
}

if (next === current) {
  console.log(`Version is already ${current} — nothing to do.`);
  process.exit(0);
}

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ package.json: ${current} -> ${next}\n`);

execFileSync(process.execPath, [resolve(__dirname, 'sync-version.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});

console.log('\nNext steps:');
console.log('  1. Run `pnpm run generate-changelog` to refresh public/changelog.json');
console.log('  2. Review the diff and commit when ready');
