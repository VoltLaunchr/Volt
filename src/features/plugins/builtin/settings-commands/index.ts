import { openSettingsWindow } from '../../../../app/windows';
import i18n from '../../../../i18n';
import { logger } from '../../../../shared/utils/logger';
import {
  SETTINGS_CATEGORIES,
  categoryTranslationKey,
} from '../../../settings/constants/settingsCategories';
import { detectSettingsPlatform } from '../../../settings/registry/platform';
import { SETTINGS_REGISTRY } from '../../../settings/registry/settingsRegistry';
import {
  buildSettingsSearchIndex,
  searchSettings,
  type SettingsSearchEntry,
} from '../../../settings/registry/settingsSearch';
import { resolveActivation } from '../../core/activation';
import {
  Plugin,
  PluginActivation,
  PluginContext,
  PluginResult,
  PluginResultType,
} from '../../types';

/** Translation context of the Settings window texts (a language and its `settings` bundle). */
export interface SettingsTranslator {
  language: string;
  translate: (key: string) => string;
}

function defaultTranslator(): SettingsTranslator {
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const t = i18n.getFixedT(language, 'settings');
  return { language, translate: (key) => String(t(key)) };
}

const ICON_BY_PAGE = new Map(
  SETTINGS_CATEGORIES.map((category) => [category.id as string, category.iconSrc])
);

/** Titles of a page/row must start a word to be offered without the `settings` keyword. */
const IMPLICIT_MIN_WORD_SCORE = 3;
const IMPLICIT_MIN_LENGTH = 3;
const IMPLICIT_LIMIT = 3;
const EXPLICIT_LIMIT = 6;

/**
 * Settings pages and individual settings as launcher commands. Typing a page name opens the
 * Settings window on that page; typing a setting name (or `settings <name>`) opens it on the row,
 * which pulses. Everything comes from the Settings registry, so a new page or row is searchable
 * here with no extra wiring.
 */
export class SettingsCommandsPlugin implements Plugin {
  id = 'settings-commands';
  name = 'Settings';
  description = 'Open a Settings page or a single setting from the launcher';
  enabled = true;

  // `mode: 'custom'` — the keyword form (`settings language`) is strict about its search term,
  // the bare form (`language`) only offers close title matches; both are decided in `match`.
  activation: PluginActivation = {
    mode: 'custom',
    keywords: [
      'settings',
      'setting',
      'preferences',
      'prefs',
      'options',
      'config',
      'réglages',
      'reglages',
      'paramètres',
      'parametres',
    ],
  };

  private cache: { language: string; entries: SettingsSearchEntry[] } | null = null;

  constructor(private readonly resolveTranslator: () => SettingsTranslator = defaultTranslator) {}

  canHandle(context: PluginContext): boolean {
    return this.searchTerm(context).term.length > 0;
  }

  match(context: PluginContext): PluginResult[] | null {
    const { term, explicit } = this.searchTerm(context);
    if (!term) return null;

    const words = term.split(/\s+/).length;
    const hits = searchSettings(this.getIndex(), term, 24)
      .filter((entry) => entry.kind !== 'section')
      .filter((entry) => explicit || entry.score / words >= IMPLICIT_MIN_WORD_SCORE)
      .slice(0, explicit ? EXPLICIT_LIMIT : IMPLICIT_LIMIT);
    if (hits.length === 0) return null;

    const { translate } = this.resolveTranslator();
    return hits.map((entry) => ({
      id: `settings-${entry.id}`,
      type: PluginResultType.SystemCommand,
      title: entry.title,
      subtitle: entry.kind === 'page' ? translate('titlebar') : entry.trail,
      icon: ICON_BY_PAGE.get(entry.pageId),
      badge: translate('title'),
      score: entry.kind === 'page' ? 70 : 60,
      data: { action: 'settings-target', target: entry.id },
    }));
  }

  async execute(result: PluginResult): Promise<void> {
    const target = result.data?.target;
    if (typeof target !== 'string') return;
    try {
      await openSettingsWindow(target);
    } catch (error) {
      logger.error('Failed to open settings target:', error);
    }
  }

  /** The text to look up: the query without a leading `settings`-style keyword, if any. */
  private searchTerm(context: PluginContext): { term: string; explicit: boolean } {
    const activation = resolveActivation(this, context);
    if (activation.matched && activation.kind === 'keyword') {
      return { term: activation.stripped.trim(), explicit: true };
    }
    const term = context.query.trim();
    return { term: term.length >= IMPLICIT_MIN_LENGTH ? term : '', explicit: false };
  }

  private getIndex(): SettingsSearchEntry[] {
    const { language, translate } = this.resolveTranslator();
    if (this.cache?.language !== language) {
      this.cache = {
        language,
        entries: buildSettingsSearchIndex(
          SETTINGS_CATEGORIES.map((category) => ({
            id: category.id,
            title: translate(categoryTranslationKey(category.id)),
            description: translate(`navigation.descriptions.${category.id}`),
          })),
          SETTINGS_REGISTRY,
          translate,
          detectSettingsPlatform()
        ),
      };
    }
    return this.cache.entries;
  }
}
