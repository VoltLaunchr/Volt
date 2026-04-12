#!/usr/bin/env node
/**
 * Syncs the version from package.json into the other manifests:
 *   - src-tauri/Cargo.toml          (first `version = "..."` under [package])
 *   - src-tauri/tauri.conf.json     (top-level "version")
 *   - public/changelog.json         (latest entry's "version", only if missing)
 *
 * Usage:
 *   bun run sync-version
 *   bun run sync-version --check   (exits non-zero if anything is out of sync)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const files = {
  pkg: resolve(ROOT, 'package.json'),
  cargo: resolve(ROOT, 'src-tauri/Cargo.toml'),
  tauri: resolve(ROOT, 'src-tauri/tauri.conf.json'),
  changelog: resolve(ROOT, 'public/changelog.json'),
};

const checkMode = process.argv.includes('--check');
const drifts = [];

const pkg = JSON.parse(readFileSync(files.pkg, 'utf8'));
const target = pkg.version;
if (!target) {
  console.error('package.json has no "version" field');
  process.exit(1);
}

// Cargo.toml: only patch the first [package] version, not dependency versions
const cargoSrc = readFileSync(files.cargo, 'utf8');
const cargoMatch = cargoSrc.match(/^(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/m);
if (!cargoMatch) {
  console.error('Cargo.toml: could not find [package] version line');
  process.exit(1);
}
const cargoCurrent = cargoMatch[2];
if (cargoCurrent !== target) {
  if (checkMode) {
    drifts.push(`Cargo.toml: ${cargoCurrent} -> ${target}`);
  } else {
    const next = cargoSrc.replace(cargoMatch[0], `${cargoMatch[1]}${target}${cargoMatch[3]}`);
    writeFileSync(files.cargo, next);
    console.log(`✓ Cargo.toml: ${cargoCurrent} -> ${target}`);
  }
} else {
  console.log(`= Cargo.toml already at ${target}`);
}

// tauri.conf.json: preserve formatting via JSON.stringify with 2-space indent
const tauriSrc = readFileSync(files.tauri, 'utf8');
const tauri = JSON.parse(tauriSrc);
const tauriCurrent = tauri.version;
if (tauriCurrent !== target) {
  if (checkMode) {
    drifts.push(`tauri.conf.json: ${tauriCurrent} -> ${target}`);
  } else {
    tauri.version = target;
    writeFileSync(files.tauri, JSON.stringify(tauri, null, 2) + '\n');
    console.log(`✓ tauri.conf.json: ${tauriCurrent} -> ${target}`);
  }
} else {
  console.log(`= tauri.conf.json already at ${target}`);
}

// public/changelog.json: only verify the latest entry references the target version
const changelogSrc = readFileSync(files.changelog, 'utf8');
const changelog = JSON.parse(changelogSrc);
const latest = changelog.versions?.[0];
if (!latest) {
  console.warn('! public/changelog.json has no versions entries — skipping');
} else if (latest.version !== target) {
  if (checkMode) {
    drifts.push(
      `changelog.json latest entry: ${latest.version} (expected ${target} — add a new entry if releasing)`
    );
  } else {
    console.warn(
      `! public/changelog.json latest entry is ${latest.version}, not ${target}. ` +
        `Add a new entry before releasing ${target}.`
    );
  }
} else {
  console.log(`= changelog.json latest entry already at ${target}`);
}

if (checkMode && drifts.length > 0) {
  console.error('\nVersion drift detected:');
  for (const d of drifts) console.error('  - ' + d);
  console.error('\nRun `bun run sync-version` to fix.');
  process.exit(1);
}

console.log(`\nAll version manifests aligned to ${target}.`);
