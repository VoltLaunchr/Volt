#!/usr/bin/env node
/**
 * Auto-generate a changelog.json entry from conventional commits.
 *
 * Reads commits since the last git tag, groups them by type into sections,
 * and prepends a new entry to public/changelog.json.
 *
 * SECURITY: Commits touching security-sensitive areas (auth, permissions,
 * credentials, XSS, injection, CVE, etc.) are intentionally vague in the
 * output. They are collapsed into a single "Security hardening and
 * improvements" bullet — never exposing what was fixed or where.
 *
 * Usage:
 *   bun run generate-changelog              # auto-detect version from package.json
 *   bun run generate-changelog --version 0.1.0
 *   bun run generate-changelog --dry-run    # print to stdout, don't write
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const versionIdx = args.indexOf('--version');
const versionArg = versionIdx !== -1 ? args[versionIdx + 1] : null;

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

const version = versionArg || readPackageVersion();
if (!version) {
  console.error('Could not determine version');
  process.exit(1);
}

// ── Git helpers (execFileSync — no shell, no injection risk) ────────────

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function getLastTag() {
  try {
    return git('describe', '--tags', '--abbrev=0', 'HEAD');
  } catch {
    // No tags yet — use the root commit
    return git('rev-list', '--max-parents=0', 'HEAD');
  }
}

function getCommits(since) {
  const raw = git('log', `${since}..HEAD`, '--pretty=format:%s');
  if (!raw) return [];
  return raw.split('\n').filter(Boolean);
}

// ── Security filter ─────────────────────────────────────────────────────
//
// Any commit whose scope or subject matches these patterns is considered
// security-sensitive. Its message is NEVER surfaced in the public
// changelog — only a generic "Security hardening and improvements" line.

const SECURITY_SCOPES = /\b(security|auth|permission|cred|secret|token|xss|injection|cve|vuln|sandbox|capability)\b/i;
const SECURITY_SUBJECTS = /\b(CVE-|XSS|CSRF|injection|credential|secret|token|auth.?bypass|priv.?escalation|sandbox.?escape|vulnerability|exploit)\b/i;

function isSensitive(scope, subject) {
  if (scope && SECURITY_SCOPES.test(scope)) return true;
  if (SECURITY_SUBJECTS.test(subject)) return true;
  return false;
}

// ── Commit parsing ──────────────────────────────────────────────────────

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/** @returns {{ type: string; scope: string|null; breaking: boolean; subject: string; sensitive: boolean }|null} */
function parseCommit(message) {
  const m = message.match(CONVENTIONAL);
  if (!m) return null;
  const [, type, scope = null, bang, subject] = m;
  return {
    type,
    scope,
    breaking: !!bang,
    subject: subject.charAt(0).toUpperCase() + subject.slice(1),
    sensitive: isSensitive(scope, subject),
  };
}

// ── Section mapping ─────────────────────────────────────────────────────

const SECTION_MAP = {
  feat:     { title: 'New Features',           icon: 'sparkles', type: 'features' },
  fix:      { title: 'Bug Fixes',              icon: 'shield',   type: 'fixes' },
  perf:     { title: 'Performance',            icon: 'zap',      type: 'performance' },
  refactor: { title: 'Under the Hood',         icon: 'cpu',      type: 'refactor' },
  docs:     { title: 'Documentation',          icon: 'package',  type: 'docs' },
  ci:       { title: 'CI & Build',             icon: 'settings', type: 'ci' },
  build:    { title: 'CI & Build',             icon: 'settings', type: 'ci' },
  test:     { title: 'Testing',               icon: 'shield',   type: 'testing' },
  // chore, style, revert → skip (noise for end users)
};

// Types that are too noisy for an end-user changelog
const SKIP_TYPES = new Set(['chore', 'style', 'revert']);

// ── Build sections ──────────────────────────────────────────────────────

const lastTag = getLastTag();
console.log(`Generating changelog for v${version} (commits since ${lastTag})\n`);

const commits = getCommits(lastTag);
if (commits.length === 0) {
  console.log('No commits found since last tag. Skipping.');
  process.exit(0);
}

/** @type {Map<string, { title: string; icon: string; type: string; items: string[] }>} */
const sections = new Map();
let hasSensitive = false;

for (const msg of commits) {
  const parsed = parseCommit(msg);
  if (!parsed) continue;

  // Sensitive commits → flag but don't add their text
  if (parsed.sensitive) {
    hasSensitive = true;
    continue;
  }

  // Skip noise types
  if (SKIP_TYPES.has(parsed.type)) continue;

  const mapping = SECTION_MAP[parsed.type];
  if (!mapping) continue;

  const key = mapping.type;
  if (!sections.has(key)) {
    sections.set(key, { ...mapping, items: [] });
  }

  const section = sections.get(key);
  // Deduplicate identical items
  if (!section.items.includes(parsed.subject)) {
    section.items.push(parsed.subject);
  }
}

// If any sensitive commit was found, add a single generic line
if (hasSensitive) {
  const key = 'security';
  sections.set(key, {
    title: 'Security',
    icon: 'shield',
    type: 'security',
    items: ['Security hardening and improvements'],
  });
}

// Build ordered sections array (features first, then the rest)
const ORDER = ['features', 'security', 'fixes', 'performance', 'refactor', 'ci', 'testing', 'docs'];
const orderedSections = ORDER
  .filter((k) => sections.has(k))
  .map((k) => {
    const s = sections.get(k);
    return { type: s.type, title: s.title, icon: s.icon, items: s.items };
  });

if (orderedSections.length === 0) {
  console.log('No user-facing changes found. Skipping.');
  process.exit(0);
}

// ── Build description ───────────────────────────────────────────────────

const featureCount = sections.get('features')?.items.length ?? 0;
const fixCount = sections.get('fixes')?.items.length ?? 0;
const parts = [];
if (featureCount > 0) parts.push(`${featureCount} new feature${featureCount > 1 ? 's' : ''}`);
if (fixCount > 0) parts.push(`${fixCount} bug fix${fixCount > 1 ? 'es' : ''}`);
if (hasSensitive) parts.push('security improvements');
if (sections.has('performance')) parts.push('performance optimizations');

const title = orderedSections[0]?.items[0]
  ? `${orderedSections[0].items[0]} & more`
  : `v${version} Release`;

const description = parts.length > 0
  ? `Volt v${version} brings ${parts.join(', ')}.`
  : `Volt v${version} release.`;

// ── Build entry ─────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);

const entry = {
  version,
  date: today,
  title,
  description,
  sections: orderedSections,
  footer: {
    gettingStarted: `Press Ctrl+Space to open Volt anytime. Check out what's new in v${version}!`,
    feedback:
      'Have feedback or found a bug? Visit our GitHub repository to report issues or request features.',
    links: {
      github: 'https://github.com/VoltLaunchr/Volt',
      releases: 'https://github.com/VoltLaunchr/Volt/releases',
      docs: 'https://voltlaunchr.com/docs',
    },
  },
};

// ── Output ──────────────────────────────────────────────────────────────

if (dryRun) {
  console.log(JSON.stringify(entry, null, 2));
  process.exit(0);
}

// Write to changelog.json
const changelogPath = resolve(ROOT, 'public/changelog.json');
const changelog = JSON.parse(readFileSync(changelogPath, 'utf8'));

// Replace existing entry for same version, or prepend
const existingIdx = changelog.versions.findIndex((v) => v.version === version);
if (existingIdx !== -1) {
  changelog.versions[existingIdx] = entry;
  console.log(`Updated existing entry for v${version}`);
} else {
  changelog.versions.unshift(entry);
  console.log(`Prepended new entry for v${version}`);
}

writeFileSync(changelogPath, JSON.stringify(changelog, null, 2) + '\n');
console.log(`✓ public/changelog.json updated with v${version}`);
console.log(`  ${orderedSections.length} section(s), ${orderedSections.reduce((n, s) => n + s.items.length, 0)} item(s)`);
if (hasSensitive) {
  console.log('  ⚠ Security-sensitive commits redacted (generic line only)');
}
