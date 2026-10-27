import { describe, expect, it } from 'vitest';
import enSettings from '../../../i18n/locales/en/settings.json';
import { SETTINGS_REGISTRY } from './settingsRegistry';
import {
  buildSettingsSearchIndex,
  normalizeSearchText,
  searchSettings,
  type SettingsSearchPage,
} from './settingsSearch';

function translate(key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      enSettings
    );
  return typeof value === 'string' ? value : key;
}

const pages: SettingsSearchPage[] = [
  { id: 'general', title: 'General', description: 'Language and startup' },
  { id: 'shell', title: 'Shell Commands', description: 'Configure shell commands' },
  { id: 'about', title: 'About', description: 'Version information' },
];
const index = buildSettingsSearchIndex(pages, SETTINGS_REGISTRY, translate);

describe('settings search', () => {
  it('indexes pages, sections and rows', () => {
    expect(index.filter((entry) => entry.kind === 'page')).toHaveLength(pages.length);
    expect(index.some((entry) => entry.kind === 'section' && entry.id === 'general.startup')).toBe(
      true
    );
    expect(
      index.some((entry) => entry.kind === 'row' && entry.id === 'general.search.hotkey')
    ).toBe(true);
  });

  it('returns nothing for an empty query', () => {
    expect(searchSettings(index, '   ')).toEqual([]);
  });

  it('finds a row by title and reports its page and trail', () => {
    const [first] = searchSettings(index, 'language');
    expect(first?.kind).toBe('row');
    expect(first?.id).toBe('general.personalization.language');
    expect(first?.pageId).toBe('general');
    expect(first?.trail).toContain('General');
  });

  it('finds a row through a keyword that is not in its visible text', () => {
    const results = searchSettings(index, 'powershell');
    expect(results.map(({ id }) => id)).toContain('shell.execution.defaultShell');
  });

  it('matches descriptions and is accent and case insensitive', () => {
    expect(searchSettings(index, 'EXPERIMENTAL').map(({ id }) => id)).toContain(
      'general.setup.featurePreview'
    );
    expect(normalizeSearchText('Fenêtre')).toBe('fenetre');
  });

  it('requires every word of the query to match', () => {
    expect(searchSettings(index, 'language zzzzqq')).toEqual([]);
    expect(searchSettings(index, 'close launch').map(({ id }) => id)).toContain(
      'general.startup.closeOnLaunch'
    );
  });

  it('ranks a title prefix above a description-only match and pages before rows on ties', () => {
    const results = searchSettings(index, 'shell');
    expect(results[0]?.kind).toBe('page');
    expect(results[0]?.id).toBe('shell');
    const scores = results.map(({ score }) => score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('tolerates a missing letter through the subsequence fallback and honours the limit', () => {
    expect(searchSettings(index, 'sensitvity').map(({ id }) => id)).toContain(
      'general.search.sensitivity'
    );
    expect(searchSettings(index, 'e', 3)).toHaveLength(3);
  });
});
