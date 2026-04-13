import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Global namespace imports — EN
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enHelp from './locales/en/help.json';
import enOnboarding from './locales/en/onboarding.json';
import enResults from './locales/en/results.json';
import enClipboard from './locales/en/clipboard.json';
import enFileSearch from './locales/en/fileSearch.json';
import enExtensions from './locales/en/extensions.json';
import enChangelog from './locales/en/changelog.json';

// Global namespace imports — FR
import frCommon from './locales/fr/common.json';
import frSettings from './locales/fr/settings.json';
import frHelp from './locales/fr/help.json';
import frOnboarding from './locales/fr/onboarding.json';
import frResults from './locales/fr/results.json';
import frClipboard from './locales/fr/clipboard.json';
import frFileSearch from './locales/fr/fileSearch.json';
import frExtensions from './locales/fr/extensions.json';
import frChangelog from './locales/fr/changelog.json';

const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}

async function resolveLanguage(savedLanguage?: string): Promise<SupportedLanguage> {
  if (savedLanguage && savedLanguage !== 'auto' && isSupportedLanguage(savedLanguage)) {
    return savedLanguage;
  }

  try {
    const { locale } = await import('@tauri-apps/plugin-os');
    const osLocale = await locale();
    if (osLocale) {
      const base = osLocale.split('-')[0].toLowerCase();
      if (isSupportedLanguage(base)) return base;
    }
  } catch {
    // Running outside Tauri (dev mode / tests)
  }

  return 'en';
}

export async function initI18n(savedLanguage?: string): Promise<void> {
  const lng = await resolveLanguage(savedLanguage);

  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    ns: ['common', 'settings', 'help', 'onboarding', 'results', 'clipboard', 'fileSearch', 'extensions', 'changelog'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        help: enHelp,
        onboarding: enOnboarding,
        results: enResults,
        clipboard: enClipboard,
        fileSearch: enFileSearch,
        extensions: enExtensions,
        changelog: enChangelog,
      },
      fr: {
        common: frCommon,
        settings: frSettings,
        help: frHelp,
        onboarding: frOnboarding,
        results: frResults,
        clipboard: frClipboard,
        fileSearch: frFileSearch,
        extensions: frExtensions,
        changelog: frChangelog,
      },
    },
  });
}

export default i18n;
