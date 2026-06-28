# Volt i18n — Internationalization Design Spec

**Date**: 2026-04-13
**Status**: Approved
**Languages**: English (en), French (fr)
**Stack**: i18next + react-i18next + @tauri-apps/plugin-os

---

## 1. Overview

Add full internationalization support to Volt with English and French as initial languages. The system must support auto-detection of the OS language, manual override in Settings, co-localized translations per builtin plugin, and an API for community extensions (volt-extensions repo) to register their own translations.

## 2. Architecture

### 2.1 Dependencies

- `i18next` — core i18n framework
- `react-i18next` — React integration (useTranslation hook)
- `@tauri-apps/plugin-os` — OS locale detection via `locale()`

No HTTP backend needed — translations are imported statically (desktop app).

### 2.2 File Structure

```
src/
  i18n/
    index.ts                    # Config + initI18n() async function
    locales/
      en/
        common.json             # Global app strings (search, footer, errors, accessibility)
        settings.json           # Settings window
        help.json               # HelpDialog
        onboarding.json         # OnboardingModal
        results.json            # ResultsList, ResultItem, context menu, properties
      fr/
        common.json
        settings.json
        help.json
        onboarding.json
        results.json
  features/
    plugins/
      builtin/
        calculator/
          locales/
            en.json
            fr.json
        emoji-picker/
          locales/
            en.json
            fr.json
        timer/
          locales/
            en.json
            fr.json
        websearch/
          locales/
            en.json
            fr.json
        steam/
          locales/
            en.json
            fr.json
        systemcommands/
          locales/
            en.json
            fr.json
        systemmonitor/
          locales/
            en.json
            fr.json
        games/
          locales/
            en.json
            fr.json
```

### 2.3 Namespaces

| Namespace | Scope |
|---|---|
| `common` | Global app (search bar, footer, errors, accessibility labels) |
| `settings` | Settings window |
| `help` | HelpDialog |
| `onboarding` | OnboardingModal |
| `results` | ResultsList, ResultItem, ResultContextMenu, PropertiesDialog |
| `calculator` | Calculator plugin |
| `emoji-picker` | Emoji picker plugin |
| `timer` | Timer plugin |
| `websearch` | Web search plugin |
| `steam` | Steam plugin |
| `systemcommands` | System commands plugin |
| `systemmonitor` | System monitor plugin |
| `games` | Games plugin |

## 3. Language Detection Flow

1. On app boot, read `settings.general.language`
2. If value is `'auto'` or undefined, call `locale()` from `@tauri-apps/plugin-os`
3. Map BCP-47 tag to supported language (`fr-FR` -> `fr`, `en-US` -> `en`, `en-GB` -> `en`)
4. If no match, fallback to `en`
5. Initialize i18next with resolved language

```typescript
export async function initI18n(savedLanguage?: string): Promise<void> {
  let lng = 'en';

  if (savedLanguage && savedLanguage !== 'auto') {
    lng = savedLanguage;
  } else {
    try {
      const osLocale = await locale();
      if (osLocale) {
        const base = osLocale.split('-')[0].toLowerCase();
        if (['en', 'fr'].includes(base)) lng = base;
      }
    } catch {
      // fallback to 'en'
    }
  }

  await i18n
    .use(initReactI18next)
    .init({
      lng,
      fallbackLng: 'en',
      ns: ['common', 'settings', 'help', 'onboarding', 'results'],
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      resources: { en: { ... }, fr: { ... } },
    });
}
```

## 4. Settings Integration

### 4.1 New Setting

Add `language` field to `GeneralSettings`:

```typescript
interface GeneralSettings {
  // ... existing fields
  language: 'auto' | 'en' | 'fr';  // default: 'auto'
}
```

### 4.2 Settings UI

New "Language" selector in Settings > General section:
- **Auto (System)** — detects from OS
- **English**
- **Francais**

### 4.3 Multi-Window Sync

When the user changes language in Settings:

1. Save to settings file (source of truth for next boot)
2. Call `i18n.changeLanguage(lng)` locally in Settings window
3. Emit Tauri event: `emit('volt://language-changed', { language: lng })`

Main window listens:

```typescript
listen('volt://language-changed', ({ payload }) => {
  i18n.changeLanguage(payload.language);
});
```

Both windows share the same i18n config (imported from `src/i18n/index.ts`).

## 5. Plugin Translation System

### 5.1 Builtin Plugins (this repo)

Each builtin plugin registers its translations in its `index.ts`:

```typescript
import i18n from 'i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

i18n.addResourceBundle('en', 'calculator', en);
i18n.addResourceBundle('fr', 'calculator', fr);
```

Plugin components use their own namespace:

```tsx
const { t } = useTranslation('calculator');
return <span>{t('result.label')}</span>;
```

### 5.2 Community Extensions (volt-extensions repo)

The `PluginContext` exposes an i18n API:

```typescript
context.i18n.addTranslations(lng: string, namespace: string, resources: Record<string, string>);
```

This wraps `i18next.addResourceBundle()`. Extensions provide their own translation files and register them on load. Extension namespace should be prefixed with `ext-` to avoid collisions (e.g., `ext-my-extension`).

## 6. Component Usage Pattern

### Before (hardcoded)
```tsx
<SearchBar placeholder="Search for apps and commands..." />
```

### After (translated)
```tsx
const { t } = useTranslation('common');
<SearchBar placeholder={t('search.placeholder')} />
```

## 7. Files to Create

| File | Purpose |
|---|---|
| `src/i18n/index.ts` | i18next config + initI18n() |
| `src/i18n/locales/en/common.json` | Global EN translations |
| `src/i18n/locales/en/settings.json` | Settings EN |
| `src/i18n/locales/en/help.json` | HelpDialog EN |
| `src/i18n/locales/en/onboarding.json` | OnboardingModal EN |
| `src/i18n/locales/en/results.json` | Results EN |
| `src/i18n/locales/fr/common.json` | Global FR translations |
| `src/i18n/locales/fr/settings.json` | Settings FR |
| `src/i18n/locales/fr/help.json` | HelpDialog FR |
| `src/i18n/locales/fr/onboarding.json` | OnboardingModal FR |
| `src/i18n/locales/fr/results.json` | Results FR |
| `src/features/plugins/builtin/*/locales/en.json` | Plugin EN (x8 plugins) |
| `src/features/plugins/builtin/*/locales/fr.json` | Plugin FR (x8 plugins) |

## 8. Files to Modify

| File | Change |
|---|---|
| `package.json` | Add i18next + react-i18next deps |
| `src/main.tsx` | Import i18n, call initI18n() before render |
| `src/settings.tsx` | Import i18n, call initI18n() before render |
| `src/app/App.tsx` | useTranslation('common'), replace hardcoded strings |
| `src/features/search/components/SearchBar.tsx` | t('search.placeholder') |
| `src/shared/components/layout/Footer.tsx` | useTranslation('common') |
| `src/shared/components/ui/HelpDialog.tsx` | useTranslation('help') |
| `src/shared/components/ui/OnboardingModal.tsx` | useTranslation('onboarding') |
| `src/features/results/components/ResultsList.tsx` | useTranslation('results') |
| `src/features/results/components/ResultItem.tsx` | useTranslation('results') |
| `src/app/components/ResultContextMenu.tsx` | useTranslation('results') |
| `src/shared/components/ui/PropertiesDialog.tsx` | useTranslation('results') |
| `src/features/settings/SettingsApp.tsx` | Language selector + useTranslation('settings') |
| `src/features/settings/services/settingsService.ts` | language field handling |
| `src/shared/types/common.types.ts` | GeneralSettings.language type |
| `src/features/plugins/builtin/*/index.ts` | addResourceBundle calls (x8) |
| `src/features/plugins/builtin/*/components/*.tsx` | useTranslation per plugin (x8) |
| `src/features/extensions/loader/index.ts` | Expose context.i18n.addTranslations() |
| `src/shared/constants/suggestions.ts` | Translate default suggestions |

## 9. Testing Strategy

- **Unit test**: `src/i18n/index.test.ts` — initI18n() with various inputs (saved language, auto + OS locale mock, fallback)
- **Unit test**: Verify changeLanguage() switches all translations correctly
- **Adapt existing tests**: Update tests that assert on hardcoded English strings
- **Manual verification**: `bun tauri dev`, switch language in Settings, verify both windows update

## 10. Out of Scope

- Rust backend translations (error messages stay in English, internal only)
- Languages beyond EN/FR (structure supports it, not implementing now)
- Translations in the volt-extensions repo (separate work)
- ICU MessageFormat / complex pluralization (not needed for current strings)
