import { describe, expect, it } from 'vitest';
import enSettings from '../../../../i18n/locales/en/settings.json';
import frSettings from '../../../../i18n/locales/fr/settings.json';
import { PluginResultType } from '../../types';
import { SettingsCommandsPlugin, type SettingsTranslator } from './index';

function translatorFor(language: string, locale: unknown): SettingsTranslator {
  return {
    language,
    translate: (key) => {
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
    },
  };
}

const english = () => new SettingsCommandsPlugin(() => translatorFor('en', enSettings));
const french = () => new SettingsCommandsPlugin(() => translatorFor('fr', frSettings));

const ids = (plugin: SettingsCommandsPlugin, query: string) =>
  (plugin.match({ query }) ?? []).map((result) => result.data?.target);

describe('SettingsCommandsPlugin', () => {
  it('is an always-on command plugin that is not a managed toggle', () => {
    const plugin = english();
    expect(plugin.id).toBe('settings-commands');
    expect(plugin.activation?.keywords).toContain('settings');
  });

  it('opens a page when its name is typed', () => {
    const [first] = english().match({ query: 'clipboard' }) ?? [];
    expect(first).toMatchObject({
      type: PluginResultType.SystemCommand,
      data: { action: 'settings-target', target: 'clipboard' },
    });
    expect(first?.title).toBe('Clipboard History');
    expect(first?.icon).toBe('/icons/app/clipboard_history_icon.svg');
  });

  it('opens a new page by name in both languages', () => {
    expect(ids(english(), 'launcher')[0]).toBe('launcher');
    expect(ids(english(), 'calculator')[0]).toBe('calculator');
    expect(ids(french(), 'calculatrice')[0]).toBe('calculator');
    expect(ids(french(), 'lanceur')[0]).toBe('launcher');
  });

  it('opens a setting row when its title is typed and reports where it lives', () => {
    const [first] = english().match({ query: 'opacity' }) ?? [];
    expect(first?.data?.target).toBe('advanced.appearance.transparency');
    expect(first?.title).toBe('Shell opacity');
    expect(first?.subtitle).toContain('Advanced');
  });

  it('accepts the settings keyword in front of a looser search', () => {
    const plugin = english();
    expect(plugin.canHandle({ query: 'settings language' })).toBe(true);
    expect(ids(plugin, 'settings language')).toContain('general.personalization.language');
    // Keyword matches (not in the title) only count after the keyword.
    expect(ids(plugin, 'powershell')).toEqual([]);
    expect(ids(plugin, 'settings powershell')).toContain('shell.execution.defaultShell');
    expect(ids(french(), 'réglages historique lancement')).toContain('launcher.history.launches');
  });

  it('stays quiet for bare keywords and short or unrelated queries', () => {
    const plugin = english();
    expect(plugin.canHandle({ query: 'settings' })).toBe(false);
    expect(plugin.canHandle({ query: 'ab' })).toBe(false);
    expect(plugin.match({ query: 'zzzzqqxx' })).toBeNull();
    expect(plugin.match({ query: 'chrome' })).toBeNull();
  });

  it('caps the number of suggestions and never offers whole sections', () => {
    const plugin = english();
    const implicit = plugin.match({ query: 'history' }) ?? [];
    expect(implicit.length).toBeLessThanOrEqual(3);
    const explicit = plugin.match({ query: 'settings history' }) ?? [];
    expect(explicit.length).toBeLessThanOrEqual(6);
    for (const result of [...implicit, ...explicit]) {
      expect(String(result.data?.target)).not.toBe('launcher.history');
    }
  });
});
