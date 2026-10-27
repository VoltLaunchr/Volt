import { describe, expect, it } from 'vitest';
import enSettings from '../../../i18n/locales/en/settings.json';
import frSettings from '../../../i18n/locales/fr/settings.json';
import { MANAGED_PLUGINS } from '../../plugins/builtin/manifest';
import {
  PLUGIN_PAGE_IDS,
  SETTINGS_CATEGORIES,
  categoryTranslationKey,
} from '../constants/settingsCategories';
import {
  SETTINGS_REGISTRY,
  getSettingsPage,
  getSettingsRow,
  getSettingsSection,
  pluginEnableKey,
  settingsRowDomId,
  settingsSectionDomId,
} from './settingsRegistry';

function resolveKey(source: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      source
    );
}

function flatten(node: unknown, trail = ''): string[] {
  if (node === null || typeof node !== 'object') return [trail];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, trail ? `${trail}.${key}` : key)
  );
}

const allSections = SETTINGS_REGISTRY.flatMap((page) => page.sections);
const allRows = allSections.flatMap((section) => section.rows);
const referencedKeys = [
  ...allSections.flatMap((s) => [s.titleKey, s.descriptionKey]),
  ...allRows.flatMap((r) => [r.titleKey, r.descriptionKey]),
].filter((key): key is string => key !== undefined);

describe('settings registry', () => {
  it('only declares pages that exist in the navigation', () => {
    const categories = new Set(SETTINGS_CATEGORIES.map(({ id }) => id));
    for (const page of SETTINGS_REGISTRY) expect(categories.has(page.id)).toBe(true);
    expect(new Set(SETTINGS_REGISTRY.map(({ id }) => id)).size).toBe(SETTINGS_REGISTRY.length);
  });

  it('describes every page of the navigation', () => {
    for (const { id } of SETTINGS_CATEGORIES) {
      expect(getSettingsPage(id)?.sections.length, id).toBeGreaterThan(0);
    }
  });

  it('keeps ids unique across sections and rows', () => {
    const ids = [...allSections.map(({ id }) => id), ...allRows.map(({ id }) => id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('namespaces every id with its parent id', () => {
    for (const page of SETTINGS_REGISTRY) {
      for (const section of page.sections) {
        expect(section.id.startsWith(`${page.id}.`)).toBe(true);
        for (const row of section.rows) expect(row.id.startsWith(`${section.id}.`)).toBe(true);
      }
    }
  });

  it('resolves every referenced text in both locales', () => {
    for (const locale of [enSettings, frSettings]) {
      for (const key of referencedKeys) {
        expect(typeof resolveKey(locale, key), key).toBe('string');
      }
    }
  });

  it('gives every navigation entry a localized title and description', () => {
    for (const { id } of SETTINGS_CATEGORIES) {
      for (const locale of [enSettings, frSettings]) {
        expect(typeof resolveKey(locale, categoryTranslationKey(id)), id).toBe('string');
        expect(typeof resolveKey(locale, `navigation.descriptions.${id}`), id).toBe('string');
      }
    }
  });

  it('does not leave unresolved interpolation in texts shown by the search', () => {
    for (const locale of [enSettings, frSettings]) {
      for (const key of referencedKeys) {
        expect(String(resolveKey(locale, key)), key).not.toContain('{{');
      }
    }
  });

  it('keeps French in step with English', () => {
    const french = new Set(flatten(frSettings));
    const missing = flatten(enSettings).filter(
      (key) => !french.has(key) && !/_(one|other|zero|few|many)$/.test(key)
    );
    expect(missing).toEqual([]);
  });

  it('lists every managed plugin on the plugins page with a description', () => {
    const rows = getSettingsPage('plugins')?.sections[0]?.rows ?? [];
    expect(rows.map(({ id }) => id)).toEqual(
      MANAGED_PLUGINS.map(({ id }) => `plugins.builtin.${id}`)
    );
    for (const plugin of MANAGED_PLUGINS) {
      expect(typeof resolveKey(enSettings, `plugins.descriptions.${plugin.id}`)).toBe('string');
      expect(typeof resolveKey(frSettings, `plugins.descriptions.${plugin.id}`)).toBe('string');
    }
  });

  it('gives each plugin page an activation row for its plugin', () => {
    for (const [page, pluginId] of Object.entries(PLUGIN_PAGE_IDS)) {
      const row = getSettingsRow(`${page}.plugin.enabled`);
      expect(row?.titleKey, page).toBe(pluginEnableKey(pluginId));
      expect(getSettingsSection(`${page}.plugin`)?.rows).toContain(row);
    }
  });

  it('flags platform specific settings with an availability', () => {
    expect(getSettingsRow('snippets.global.enabled')?.availability?.platforms).toEqual(['windows']);
    expect(getSettingsRow('plugins.builtin.window-management')?.availability?.platforms).toEqual([
      'windows',
      'linux',
    ]);
    expect(getSettingsRow('general.startup.openAtLogin')?.availability).toBeUndefined();
  });

  it('looks definitions up by id and builds distinct DOM anchors', () => {
    const row = getSettingsRow('general.search.hotkey');
    expect(row?.titleKey).toBe('general.voltHotkey');
    expect(getSettingsSection('general.search')?.rows).toContain(row);
    expect(getSettingsRow('missing')).toBeUndefined();
    expect(settingsRowDomId('a.b.c')).not.toBe(settingsSectionDomId('a.b.c'));
  });
});
