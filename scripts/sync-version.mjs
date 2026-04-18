#!/usr/bin/env node
/**
 * Single source of truth for Volt's version. Reads package.json "version"
 * and propagates it to every file that hard-codes the version.
 *
 * Managed targets:
 *   - src-tauri/Cargo.toml                         [package].version
 *   - src-tauri/tauri.conf.json                    top-level "version"
 *   - src/features/settings/SettingsApp.tsx        const appVersion = '...'
 *   - src/shared/constants/suggestions.ts          subtitle: 'v...'
 *   - src/i18n/locales/en/common.json              whats-new.subtitle = "v..."
 *   - src/i18n/locales/fr/common.json              whats-new.subtitle = "v..."
 *   - public/changelog.json                        latest entry must match (warn)
 *
 * Usage:
 *   bun run sync-version          patch all files
 *   bun run sync-version --check  exit non-zero if anything is out of sync (CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const checkMode = process.argv.includes('--check');
const drifts = [];

function rel(p) {
  return p.replace(ROOT + '/', '').replace(ROOT + '\\', '').replace(/\\/g, '/');
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  if (!pkg.version) {
    console.error('package.json has no "version" field');
    process.exit(1);
  }
  return pkg.version;
}

/**
 * Generic patcher: runs a regex against a text file, compares capture group #2
 * to the target version, and rewrites it. Used for every non-JSON target so we
 * never touch formatting or neighbouring data.
 */
function patchText({ file, label, regex, target, hint }) {
  const path = resolve(ROOT, file);
  const src = readFileSync(path, 'utf8');
  const match = src.match(regex);
  if (!match) {
    console.error(`${label}: could not find version line (${hint})`);
    process.exit(1);
  }
  const current = match[2];
  if (current === target) {
    console.log(`= ${label} already at ${target}`);
    return;
  }
  if (checkMode) {
    drifts.push(`${label}: ${current} -> ${target}`);
    return;
  }
  const next = src.replace(match[0], `${match[1]}${target}${match[3]}`);
  writeFileSync(path, next);
  console.log(`✓ ${label}: ${current} -> ${target}`);
}

/**
 * JSON patcher with dotted-path support. Re-serialises with 2-space indent and
 * a trailing newline to match existing files.
 */
function patchJson({ file, label, path: dotted, target, transform = (v) => v }) {
  const filePath = resolve(ROOT, file);
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  const segments = dotted.split('.');
  let cursor = data;
  for (let i = 0; i < segments.length - 1; i++) {
    if (cursor?.[segments[i]] == null) {
      console.error(`${label}: missing path segment "${segments[i]}"`);
      process.exit(1);
    }
    cursor = cursor[segments[i]];
  }
  const leaf = segments[segments.length - 1];
  const desired = transform(target);
  const current = cursor[leaf];
  if (current === desired) {
    console.log(`= ${label} already at ${target}`);
    return;
  }
  if (checkMode) {
    drifts.push(`${label}: ${current} -> ${desired}`);
    return;
  }
  cursor[leaf] = desired;
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ ${label}: ${current} -> ${desired}`);
}

const target = readPackageVersion();
console.log(`Target version: ${target}\n`);

// ---------------------------------------------------------------------------
// 1. Cargo.toml — only patch [package] version, never dependency versions
// ---------------------------------------------------------------------------
patchText({
  file: 'src-tauri/Cargo.toml',
  label: 'Cargo.toml',
  regex: /^(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/m,
  target,
  hint: '[package] version line',
});

// ---------------------------------------------------------------------------
// 2. tauri.conf.json — top-level "version"
// ---------------------------------------------------------------------------
patchJson({
  file: 'src-tauri/tauri.conf.json',
  label: 'tauri.conf.json',
  path: 'version',
  target,
});

// ---------------------------------------------------------------------------
// 3. SettingsApp.tsx — const appVersion = '...'
// ---------------------------------------------------------------------------
patchText({
  file: 'src/features/settings/SettingsApp.tsx',
  label: 'SettingsApp.tsx',
  regex: /(const\s+appVersion\s*=\s*')([^']+)(')/,
  target,
  hint: "const appVersion = '...'",
});

// ---------------------------------------------------------------------------
// 4. suggestions.ts — subtitle: 'v...' (whats-new suggestion)
// ---------------------------------------------------------------------------
patchText({
  file: 'src/shared/constants/suggestions.ts',
  label: 'suggestions.ts',
  regex: /(subtitle:\s*'v)([^']+)(')/,
  target,
  hint: "subtitle: 'v...'",
});

// ---------------------------------------------------------------------------
// 5 & 6. i18n whats-new subtitle (en + fr) — string literal "vX.Y.Z"
// ---------------------------------------------------------------------------
for (const locale of ['en', 'fr']) {
  patchJson({
    file: `src/i18n/locales/${locale}/common.json`,
    label: `i18n/${locale}/common.json whats-new.subtitle`,
    path: 'suggestions.whats-new.subtitle',
    target,
    transform: (v) => `v${v}`,
  });
}

// ---------------------------------------------------------------------------
// 7. public/changelog.json — latest entry must exist for the target version.
//    The entry is auto-generated by `scripts/generate-changelog.mjs` during
//    version bumps. This check just verifies the result is in place.
// ---------------------------------------------------------------------------
const changelogFile = resolve(ROOT, 'public/changelog.json');
const changelog = JSON.parse(readFileSync(changelogFile, 'utf8'));
const latest = changelog.versions?.[0];
if (!latest) {
  console.warn('! public/changelog.json has no versions[] entries');
  if (checkMode) drifts.push('public/changelog.json: no entries');
} else if (latest.version !== target) {
  const msg = `public/changelog.json: latest entry is ${latest.version} (expected ${target} — run \`bun run generate-changelog\`)`;
  if (checkMode) {
    drifts.push(msg);
  } else {
    console.warn(`! ${msg}`);
  }
} else {
  console.log(`= public/changelog.json latest entry already at ${target}`);
}

// ---------------------------------------------------------------------------
// Final gate
// ---------------------------------------------------------------------------
if (checkMode && drifts.length > 0) {
  console.error('\nVersion drift detected:');
  for (const d of drifts) console.error('  - ' + d);
  console.error('\nRun `bun run sync-version` to fix.');
  process.exit(1);
}

console.log(`\nAll version manifests aligned to ${target}.`);
