import { describe, expect, it } from 'vitest';
import { MANAGED_PLUGIN_IDS } from '../../plugins/builtin/manifest';
import {
  PLUGIN_PAGE_IDS,
  SETTINGS_CATEGORIES,
  SETTINGS_GROUPS,
  matchesSettingsQuery,
  settingsPageForPlugin,
} from './settingsCategories';

describe('Settings navigation', () => {
  it('keeps every deep-linked category reachable in exactly one group', () => {
    const categories = SETTINGS_CATEGORIES.map(({ id }) => id).sort();
    const grouped = SETTINGS_GROUPS.flatMap(({ categories: ids }) => ids).sort();
    expect(grouped).toEqual(categories);
    expect(new Set(grouped).size).toBe(categories.length);
  });

  it('lists the launcher, calculator and games pages with a tile icon', () => {
    for (const id of ['launcher', 'calculator', 'games'] as const) {
      const category = SETTINGS_CATEGORIES.find((candidate) => candidate.id === id);
      expect(category?.iconSrc, id).toMatch(/^\/icons\/app\/.+\.svg$/);
    }
  });

  it('ties plugin pages to managed plugins, one page per plugin', () => {
    const pluginIds = Object.values(PLUGIN_PAGE_IDS);
    expect(new Set(pluginIds).size).toBe(pluginIds.length);
    for (const pluginId of pluginIds) expect(MANAGED_PLUGIN_IDS).toContain(pluginId);
    expect(settingsPageForPlugin('calculator')).toBe('calculator');
    expect(settingsPageForPlugin('timer')).toBe('timer');
    expect(settingsPageForPlugin('developer-tools')).toBeUndefined();
  });

  it('matches localized labels and descriptions independently of accents, case and word order', () => {
    const values = ['Paramètres avancés', 'Réglages de la fenêtre'];
    expect(matchesSettingsQuery('  FENETRE avances ', values)).toBe(true);
    expect(matchesSettingsQuery('compte', values)).toBe(false);
    expect(matchesSettingsQuery('   ', values)).toBe(true);
  });
});
