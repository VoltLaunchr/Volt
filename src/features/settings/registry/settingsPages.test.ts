import { describe, expect, it } from 'vitest';
import enSettings from '../../../i18n/locales/en/settings.json';
import frSettings from '../../../i18n/locales/fr/settings.json';
import { SETTINGS_CATEGORIES, categoryTranslationKey } from '../constants/settingsCategories';
import {
  SETTINGS_PLATFORM_LABELS,
  detectSettingsPlatform,
  isAvailableOn,
  type SettingsPlatform,
} from './platform';
import { buildSettingsHash, parseSettingsHash } from './settingsHash';
import { SETTINGS_REGISTRY } from './settingsRegistry';
import { buildSettingsSearchIndex, searchSettings } from './settingsSearch';
import { resolveSettingsTarget } from './settingsTarget';

function translator(locale: unknown) {
  return (key: string): string => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? (node as Record<string, unknown>)[part]
            : undefined,
        locale
      );
    return typeof value === 'string' ? value : key;
  };
}

function indexFor(locale: unknown, platform: SettingsPlatform | null = null) {
  const translate = translator(locale);
  return buildSettingsSearchIndex(
    SETTINGS_CATEGORIES.map(({ id }) => ({
      id,
      title: translate(categoryTranslationKey(id)),
      description: translate(`navigation.descriptions.${id}`),
    })),
    SETTINGS_REGISTRY,
    translate,
    platform
  );
}

const english = indexFor(enSettings);
const french = indexFor(frSettings);

describe('settings search over every page', () => {
  it('indexes one page entry per category', () => {
    for (const index of [english, french]) {
      expect(index.filter((entry) => entry.kind === 'page')).toHaveLength(
        SETTINGS_CATEGORIES.length
      );
    }
  });

  it('finds the new pages by name in both languages', () => {
    expect(searchSettings(english, 'launcher')[0]).toMatchObject({ kind: 'page', id: 'launcher' });
    expect(searchSettings(english, 'calculator')[0]).toMatchObject({
      kind: 'page',
      id: 'calculator',
    });
    expect(searchSettings(english, 'games')[0]).toMatchObject({ kind: 'page', id: 'games' });
    expect(searchSettings(french, 'lanceur')[0]).toMatchObject({ kind: 'page', id: 'launcher' });
    expect(searchSettings(french, 'calculatrice')[0]).toMatchObject({
      kind: 'page',
      id: 'calculator',
    });
    expect(searchSettings(french, 'jeux')[0]).toMatchObject({ kind: 'page', id: 'games' });
  });

  it('finds rows of the new and migrated pages', () => {
    const ids = (index: typeof english, query: string) =>
      searchSettings(index, query).map(({ id }) => id);
    expect(ids(english, 'launch history')).toContain('launcher.history.launches');
    expect(ids(english, 'fallback')).toContain('launcher.fallbacks.list');
    expect(ids(english, 'rescan')).toContain('games.library.rescan');
    expect(ids(english, 'calculation history')).toContain('calculator.history.clear');
    expect(ids(english, 'check for updates automatically')).toContain('about.updates.auto');
    expect(ids(english, 'brave')).toContain('web-search.brave.key');
    expect(ids(english, 'recent emoji')).toContain('emoji.data.clearRecent');
    expect(ids(english, 'ollama')).toContain('ai.local.baseUrl');
    expect(ids(english, 'sign out')).toContain('account.profile.session');
    expect(ids(english, 'pull')).toContain('sync.cloud.pull');
    expect(ids(french, 'historique de lancement')).toContain('launcher.history.launches');
    expect(ids(french, 'mises a jour automatiquement')).toContain('about.updates.auto');
  });

  it('finds an activation switch by plugin name', () => {
    const results = searchSettings(english, 'enable calculator').map(({ id }) => id);
    expect(results).toContain('calculator.plugin.enabled');
    const plugins = searchSettings(english, 'pomodoro').map(({ id }) => id);
    expect(plugins).toContain('plugins.builtin.timer');
  });

  it('leaves out settings that cannot work on the current platform', () => {
    const rowIds = (index: typeof english) =>
      index.filter((entry) => entry.kind === 'row').map(({ id }) => id);
    expect(rowIds(english)).toContain('snippets.global.enabled');
    expect(rowIds(indexFor(enSettings, 'windows'))).toContain('snippets.global.enabled');
    expect(rowIds(indexFor(enSettings, 'macos'))).not.toContain('snippets.global.enabled');
    expect(rowIds(indexFor(enSettings, 'macos'))).not.toContain(
      'plugins.builtin.window-management'
    );
    expect(rowIds(indexFor(enSettings, 'linux'))).toContain('plugins.builtin.window-management');
  });
});

describe('platform availability', () => {
  it('detects the platform from a user agent', () => {
    expect(detectSettingsPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit')).toBe(
      'windows'
    );
    expect(detectSettingsPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('macos');
    expect(detectSettingsPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(detectSettingsPlatform('unknown')).toBeNull();
  });

  it('treats a missing availability or platform as supported', () => {
    expect(isAvailableOn(undefined, 'macos')).toBe(true);
    expect(isAvailableOn({ platforms: ['windows'] }, null)).toBe(true);
    expect(isAvailableOn({ platforms: ['windows'] }, 'windows')).toBe(true);
    expect(isAvailableOn({ platforms: ['windows'] }, 'linux')).toBe(false);
  });

  it('labels every platform', () => {
    expect(Object.keys(SETTINGS_PLATFORM_LABELS).sort()).toEqual(['linux', 'macos', 'windows']);
  });
});

describe('settings deep links', () => {
  it('round-trips a target through the URL hash', () => {
    expect(buildSettingsHash({ section: 'general' })).toBe('#general');
    expect(buildSettingsHash({ row: 'general.search.hotkey' })).toBe('#general.search.hotkey');
    expect(buildSettingsHash({})).toBe('');
    expect(parseSettingsHash('#general.startup')).toEqual({ section: 'general.startup' });
    expect(parseSettingsHash('')).toEqual({});
    expect(parseSettingsHash('#%E0%A4%A')).toEqual({});
  });

  it('resolves pages, sections and rows to a page and a scroll target', () => {
    expect(resolveSettingsTarget({ section: 'games' })).toEqual({
      pageId: 'games',
      kind: 'page',
      id: 'games',
    });
    expect(resolveSettingsTarget({ section: 'general.startup' })).toEqual({
      pageId: 'general',
      kind: 'section',
      id: 'general.startup',
    });
    expect(resolveSettingsTarget({ row: 'launcher.history.files' })).toEqual({
      pageId: 'launcher',
      kind: 'row',
      id: 'launcher.history.files',
    });
    expect(resolveSettingsTarget({ section: 'nope' })).toBeNull();
    expect(resolveSettingsTarget({})).toBeNull();
  });
});
