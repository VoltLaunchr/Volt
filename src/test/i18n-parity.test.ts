import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';

/** Recursively extract all keys from a nested object */
function extractKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? extractKeys(value as Record<string, unknown>, fullKey)
      : [fullKey];
  });
}

function loadJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ── Global locale namespaces ─────────────────────────────────────────────────

const LOCALES_DIR = join(__dirname, '..', 'i18n', 'locales');
const enNamespaces = readdirSync(join(LOCALES_DIR, 'en'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

describe('i18n: FR/EN key parity (global namespaces)', () => {
  for (const ns of enNamespaces) {
    test(`FR has all EN keys for "${ns}"`, () => {
      const enKeys = extractKeys(loadJson(join(LOCALES_DIR, 'en', `${ns}.json`)));
      const frKeys = new Set(extractKeys(loadJson(join(LOCALES_DIR, 'fr', `${ns}.json`))));
      const missing = enKeys.filter((k) => !frKeys.has(k));
      expect(missing, `Missing FR keys in ${ns}`).toEqual([]);
    });
  }
});

// ── Per-plugin locale files ──────────────────────────────────────────────────

const PLUGINS_DIR = join(__dirname, '..', 'features', 'plugins', 'builtin');
const pluginDirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe('i18n: FR/EN key parity (plugin locales)', () => {
  for (const plugin of pluginDirs) {
    const localesDir = join(PLUGINS_DIR, plugin, 'locales');
    const enPath = join(localesDir, 'en.json');
    const frPath = join(localesDir, 'fr.json');

    // Skip plugins without locale files
    try {
      readFileSync(enPath);
    } catch {
      continue;
    }

    test(`FR has all EN keys for plugin "${plugin}"`, () => {
      const enKeys = extractKeys(loadJson(enPath));
      const frKeys = new Set(extractKeys(loadJson(frPath)));
      const missing = enKeys.filter((k) => !frKeys.has(k));
      expect(missing, `Missing FR keys in plugin ${plugin}`).toEqual([]);
    });
  }
});
