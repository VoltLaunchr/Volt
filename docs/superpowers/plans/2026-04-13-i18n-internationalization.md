# i18n Internationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full i18n support to Volt with English and French, including OS language detection, manual override in Settings, co-localized plugin translations, and an extension i18n API.

**Architecture:** i18next + react-i18next with static JSON imports (no HTTP backend). Language detection via `@tauri-apps/plugin-os` `locale()` at boot, with manual override stored in settings. Each builtin plugin co-locates its own translation files. Multi-window sync via Tauri events.

**Tech Stack:** i18next, react-i18next, @tauri-apps/plugin-os (already in project)

**Spec:** `docs/superpowers/specs/2026-04-13-i18n-internationalization-design.md`

---

## File Structure

### Files to create:
- `src/i18n/index.ts` — i18next config + `initI18n()` async function
- `src/i18n/locales/en/common.json` — Global EN (search, footer, errors, a11y)
- `src/i18n/locales/en/settings.json` — Settings window EN
- `src/i18n/locales/en/help.json` — HelpDialog EN
- `src/i18n/locales/en/onboarding.json` — OnboardingModal EN
- `src/i18n/locales/en/results.json` — Results/context menu EN
- `src/i18n/locales/fr/common.json` — Global FR
- `src/i18n/locales/fr/settings.json` — Settings window FR
- `src/i18n/locales/fr/help.json` — HelpDialog FR
- `src/i18n/locales/fr/onboarding.json` — OnboardingModal FR
- `src/i18n/locales/fr/results.json` — Results/context menu FR
- `src/features/plugins/builtin/calculator/locales/en.json`
- `src/features/plugins/builtin/calculator/locales/fr.json`
- `src/features/plugins/builtin/emoji-picker/locales/en.json`
- `src/features/plugins/builtin/emoji-picker/locales/fr.json`
- `src/features/plugins/builtin/timer/locales/en.json`
- `src/features/plugins/builtin/timer/locales/fr.json`
- `src/features/plugins/builtin/websearch/locales/en.json`
- `src/features/plugins/builtin/websearch/locales/fr.json`
- `src/features/plugins/builtin/steam/locales/en.json`
- `src/features/plugins/builtin/steam/locales/fr.json`
- `src/features/plugins/builtin/systemcommands/locales/en.json`
- `src/features/plugins/builtin/systemcommands/locales/fr.json`
- `src/features/plugins/builtin/systemmonitor/locales/en.json`
- `src/features/plugins/builtin/systemmonitor/locales/fr.json`
- `src/features/plugins/builtin/games/locales/en.json`
- `src/features/plugins/builtin/games/locales/fr.json`

### Files to modify:
- `package.json` — Add i18next + react-i18next deps
- `src/main.tsx` — Import i18n, async init before render
- `src/settings.tsx` — Import i18n, async init before render
- `src-tauri/src/commands/settings.rs` — Add `language` field to `GeneralSettings`
- `src/features/settings/types/settings.types.ts` — Add `language` to `GeneralSettings`
- `src/features/settings/SettingsApp.tsx` — Language selector UI + useTranslation
- `src/features/settings/constants/settingsCategories.ts` — Translate category labels
- `src/app/App.tsx` — useTranslation('common'), listen for language-changed event
- `src/features/search/components/SearchBar.tsx` — Translate placeholder + a11y
- `src/shared/components/layout/Footer.tsx` — useTranslation('common')
- `src/shared/components/ui/HelpDialog.tsx` — useTranslation('help')
- `src/shared/constants/suggestions.ts` — Make translatable
- `src/features/plugins/builtin/calculator/index.ts` — Register translations
- `src/features/plugins/builtin/emoji-picker/index.ts` — Register translations
- `src/features/plugins/builtin/timer/index.ts` — Register translations
- `src/features/plugins/builtin/websearch/index.ts` — Register translations
- `src/features/plugins/builtin/steam/index.ts` — Register translations
- `src/features/plugins/builtin/systemcommands/index.ts` — Register translations
- `src/features/plugins/builtin/systemmonitor/index.ts` — Register translations
- `src/features/plugins/builtin/games/index.ts` — Register translations
- `src/features/extensions/loader/index.ts` — Expose i18n API in extension context

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install i18next and react-i18next**

```bash
cd D:\dev\Volt-public && bun add i18next react-i18next
```

- [ ] **Step 2: Verify installation**

```bash
cd D:\dev\Volt-public && bun run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
cd D:\dev\Volt-public && git add package.json bun.lockb && git commit -m "chore: add i18next and react-i18next dependencies"
```

---

### Task 2: Add `language` field to Rust backend settings

**Files:**
- Modify: `src-tauri/src/commands/settings.rs:10-16` (GeneralSettings struct)

- [ ] **Step 1: Add language field to GeneralSettings struct**

In `src-tauri/src/commands/settings.rs`, add `language` to the struct and its Default impl:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub start_with_windows: bool,
    pub max_results: u32,
    pub close_on_launch: bool,
    #[serde(default)]
    pub has_seen_onboarding: bool,
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_language() -> String {
    "auto".to_string()
}
```

Update the Default impl:

```rust
impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            start_with_windows: false,
            max_results: 8,
            close_on_launch: true,
            has_seen_onboarding: false,
            language: "auto".to_string(),
        }
    }
}
```

- [ ] **Step 2: Verify Rust compilation**

```bash
cd D:\dev\Volt-public\src-tauri && cargo check
```

Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
cd D:\dev\Volt-public && git add src-tauri/src/commands/settings.rs && git commit -m "feat(settings): add language field to GeneralSettings"
```

---

### Task 3: Add `language` field to frontend settings types

**Files:**
- Modify: `src/features/settings/types/settings.types.ts:6-11`
- Modify: `src/shared/types/common.types.ts:134-138`

- [ ] **Step 1: Update settings.types.ts**

In `src/features/settings/types/settings.types.ts`, add `language` to `GeneralSettings`:

```typescript
export interface GeneralSettings {
  startWithWindows: boolean;
  maxResults: number;
  closeOnLaunch: boolean;
  hasSeenOnboarding: boolean;
  language: 'auto' | 'en' | 'fr';
}
```

Update `DEFAULT_SETTINGS`:

```typescript
general: {
  startWithWindows: false,
  maxResults: 8,
  closeOnLaunch: true,
  hasSeenOnboarding: false,
  language: 'auto',
},
```

- [ ] **Step 2: Update common.types.ts**

In `src/shared/types/common.types.ts`, add `language` to `GeneralSettings`:

```typescript
export interface GeneralSettings {
  startWithWindows: boolean;
  maxResults: number;
  closeOnLaunch: boolean;
  language: 'auto' | 'en' | 'fr';
}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd D:\dev\Volt-public && bun run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd D:\dev\Volt-public && git add src/features/settings/types/settings.types.ts src/shared/types/common.types.ts && git commit -m "feat(types): add language field to GeneralSettings"
```

---

### Task 4: Create i18n configuration and global translation files

**Files:**
- Create: `src/i18n/index.ts`
- Create: `src/i18n/locales/en/common.json`
- Create: `src/i18n/locales/en/settings.json`
- Create: `src/i18n/locales/en/help.json`
- Create: `src/i18n/locales/en/onboarding.json`
- Create: `src/i18n/locales/en/results.json`
- Create: `src/i18n/locales/fr/common.json`
- Create: `src/i18n/locales/fr/settings.json`
- Create: `src/i18n/locales/fr/help.json`
- Create: `src/i18n/locales/fr/onboarding.json`
- Create: `src/i18n/locales/fr/results.json`

- [ ] **Step 1: Create `src/i18n/index.ts`**

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Global namespace imports — EN
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enHelp from './locales/en/help.json';
import enOnboarding from './locales/en/onboarding.json';
import enResults from './locales/en/results.json';

// Global namespace imports — FR
import frCommon from './locales/fr/common.json';
import frSettings from './locales/fr/settings.json';
import frHelp from './locales/fr/help.json';
import frOnboarding from './locales/fr/onboarding.json';
import frResults from './locales/fr/results.json';

const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}

/**
 * Resolve the language to use.
 * 1. If savedLanguage is set and not 'auto', use it directly.
 * 2. Otherwise, detect OS locale via @tauri-apps/plugin-os.
 * 3. Fallback to 'en'.
 */
async function resolveLanguage(savedLanguage?: string): Promise<SupportedLanguage> {
  // User explicitly chose a language
  if (savedLanguage && savedLanguage !== 'auto' && isSupportedLanguage(savedLanguage)) {
    return savedLanguage;
  }

  // Auto-detect from OS
  try {
    const { locale } = await import('@tauri-apps/plugin-os');
    const osLocale = await locale();
    if (osLocale) {
      const base = osLocale.split('-')[0].toLowerCase();
      if (isSupportedLanguage(base)) return base;
    }
  } catch {
    // Running outside Tauri (dev mode / tests) — fallback silently
  }

  return 'en';
}

/**
 * Initialize i18next. Must be called before React renders.
 * @param savedLanguage - The language from user settings ('auto' | 'en' | 'fr')
 */
export async function initI18n(savedLanguage?: string): Promise<void> {
  const lng = await resolveLanguage(savedLanguage);

  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    ns: ['common', 'settings', 'help', 'onboarding', 'results'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false, // React already escapes
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
      },
      fr: {
        common: frCommon,
        settings: frSettings,
        help: frHelp,
        onboarding: frOnboarding,
        results: frResults,
      },
    },
  });
}

export default i18n;
```

- [ ] **Step 2: Create `src/i18n/locales/en/common.json`**

```json
{
  "search": {
    "placeholder": "Search for apps and commands...",
    "placeholderLoading": "Loading applications...",
    "noResults": "No results found",
    "resultCount": "{{count}} result found",
    "resultCount_other": "{{count}} results found",
    "clearSearch": "Clear search",
    "label": "Search"
  },
  "footer": {
    "openCommand": "Open Command",
    "actions": "Actions",
    "indexing": "Indexing"
  },
  "errors": {
    "generic": "An error occurred",
    "retry": "Retry",
    "dismiss": "Dismiss"
  },
  "accessibility": {
    "skipToSearch": "Skip to search"
  }
}
```

- [ ] **Step 3: Create `src/i18n/locales/fr/common.json`**

```json
{
  "search": {
    "placeholder": "Rechercher des apps et commandes...",
    "placeholderLoading": "Chargement des applications...",
    "noResults": "Aucun resultat",
    "resultCount": "{{count}} resultat trouve",
    "resultCount_other": "{{count}} resultats trouves",
    "clearSearch": "Effacer la recherche",
    "label": "Rechercher"
  },
  "footer": {
    "openCommand": "Ouvrir",
    "actions": "Actions",
    "indexing": "Indexation"
  },
  "errors": {
    "generic": "Une erreur est survenue",
    "retry": "Reessayer",
    "dismiss": "Fermer"
  },
  "accessibility": {
    "skipToSearch": "Aller a la recherche"
  }
}
```

- [ ] **Step 4: Create `src/i18n/locales/en/help.json`**

```json
{
  "title": "Keyboard Shortcuts",
  "groups": {
    "navigation": {
      "title": "Navigation",
      "moveResults": "Move between results",
      "jumpFirst": "Jump to first result",
      "jumpLast": "Jump to last result",
      "moveFive": "Move 5 results at a time"
    },
    "actions": {
      "title": "Actions",
      "launch": "Launch selected result",
      "autocomplete": "Autocomplete with selected title",
      "launchAdmin": "Launch as administrator",
      "launchKeepOpen": "Launch without closing Volt",
      "quickLaunch": "Quick-launch result by number"
    },
    "fileApp": {
      "title": "File & App Commands",
      "openFolder": "Open containing folder",
      "copyPath": "Copy path to clipboard",
      "showProperties": "Show item properties",
      "removeHistory": "Remove from launch history"
    },
    "application": {
      "title": "Application",
      "clearClose": "Clear search / close Volt",
      "clearInput": "Clear search input",
      "openSettings": "Open Settings",
      "reload": "Reload Volt",
      "quit": "Quit / hide Volt",
      "showHelp": "Show this help dialog"
    }
  },
  "closeHint": "Press {{key}} to close"
}
```

- [ ] **Step 5: Create `src/i18n/locales/fr/help.json`**

```json
{
  "title": "Raccourcis clavier",
  "groups": {
    "navigation": {
      "title": "Navigation",
      "moveResults": "Naviguer entre les resultats",
      "jumpFirst": "Aller au premier resultat",
      "jumpLast": "Aller au dernier resultat",
      "moveFive": "Deplacer de 5 resultats"
    },
    "actions": {
      "title": "Actions",
      "launch": "Lancer le resultat selectionne",
      "autocomplete": "Autocompleter avec le titre",
      "launchAdmin": "Lancer en administrateur",
      "launchKeepOpen": "Lancer sans fermer Volt",
      "quickLaunch": "Lancer rapidement par numero"
    },
    "fileApp": {
      "title": "Fichiers et Applications",
      "openFolder": "Ouvrir le dossier parent",
      "copyPath": "Copier le chemin",
      "showProperties": "Afficher les proprietes",
      "removeHistory": "Supprimer de l'historique"
    },
    "application": {
      "title": "Application",
      "clearClose": "Effacer / fermer Volt",
      "clearInput": "Effacer la recherche",
      "openSettings": "Ouvrir les Parametres",
      "reload": "Recharger Volt",
      "quit": "Quitter / masquer Volt",
      "showHelp": "Afficher cette aide"
    }
  },
  "closeHint": "Appuyez sur {{key}} pour fermer"
}
```

- [ ] **Step 6: Create `src/i18n/locales/en/settings.json`**

```json
{
  "title": "Settings",
  "sections": {
    "general": "General",
    "shortcuts": "Shortcuts",
    "extensions": "Extensions",
    "advanced": "Advanced",
    "about": "About",
    "applications": "Applications",
    "plugins": "Plugins",
    "fileSearch": "File Search",
    "clipboard": "Clipboard History",
    "builtIn": "BUILT-IN"
  },
  "general": {
    "language": "Language",
    "languageAuto": "Auto (System)",
    "languageEn": "English",
    "languageFr": "Francais",
    "startWithWindows": "Start with Windows",
    "maxResults": "Maximum results",
    "closeOnLaunch": "Close after launch",
    "hotkey": "Toggle hotkey"
  },
  "actions": {
    "save": "Save",
    "saving": "Saving...",
    "close": "Close",
    "reset": "Reset to defaults"
  }
}
```

- [ ] **Step 7: Create `src/i18n/locales/fr/settings.json`**

```json
{
  "title": "Parametres",
  "sections": {
    "general": "General",
    "shortcuts": "Raccourcis",
    "extensions": "Extensions",
    "advanced": "Avance",
    "about": "A propos",
    "applications": "Applications",
    "plugins": "Plugins",
    "fileSearch": "Recherche de fichiers",
    "clipboard": "Historique du presse-papiers",
    "builtIn": "INTEGRE"
  },
  "general": {
    "language": "Langue",
    "languageAuto": "Auto (Systeme)",
    "languageEn": "English",
    "languageFr": "Francais",
    "startWithWindows": "Demarrer avec Windows",
    "maxResults": "Nombre max de resultats",
    "closeOnLaunch": "Fermer apres le lancement",
    "hotkey": "Raccourci d'activation"
  },
  "actions": {
    "save": "Enregistrer",
    "saving": "Enregistrement...",
    "close": "Fermer",
    "reset": "Reinitialiser"
  }
}
```

- [ ] **Step 8: Create `src/i18n/locales/en/onboarding.json`**

```json
{
  "welcome": "Welcome to Volt",
  "subtitle": "Your keyboard-driven app launcher",
  "steps": {
    "search": "Type to search for any application",
    "launch": "Press Enter to launch",
    "settings": "Press Ctrl+, to open Settings"
  },
  "getStarted": "Get Started",
  "skip": "Skip"
}
```

- [ ] **Step 9: Create `src/i18n/locales/fr/onboarding.json`**

```json
{
  "welcome": "Bienvenue sur Volt",
  "subtitle": "Votre lanceur d'applications au clavier",
  "steps": {
    "search": "Tapez pour rechercher une application",
    "launch": "Appuyez sur Entree pour lancer",
    "settings": "Appuyez sur Ctrl+, pour les Parametres"
  },
  "getStarted": "Commencer",
  "skip": "Passer"
}
```

- [ ] **Step 10: Create `src/i18n/locales/en/results.json`**

```json
{
  "contextMenu": {
    "launch": "Launch",
    "launchAdmin": "Launch as Administrator",
    "openFolder": "Open Containing Folder",
    "copyPath": "Copy Path",
    "properties": "Properties",
    "removeHistory": "Remove from History"
  },
  "properties": {
    "title": "Properties",
    "name": "Name",
    "path": "Path",
    "type": "Type",
    "size": "Size",
    "modified": "Modified"
  },
  "badges": {
    "game": "Game",
    "app": "App",
    "file": "File",
    "command": "Command"
  },
  "empty": "No results found. Try a different search.",
  "loading": "Searching..."
}
```

- [ ] **Step 11: Create `src/i18n/locales/fr/results.json`**

```json
{
  "contextMenu": {
    "launch": "Lancer",
    "launchAdmin": "Lancer en administrateur",
    "openFolder": "Ouvrir le dossier",
    "copyPath": "Copier le chemin",
    "properties": "Proprietes",
    "removeHistory": "Supprimer de l'historique"
  },
  "properties": {
    "title": "Proprietes",
    "name": "Nom",
    "path": "Chemin",
    "type": "Type",
    "size": "Taille",
    "modified": "Modifie"
  },
  "badges": {
    "game": "Jeu",
    "app": "App",
    "file": "Fichier",
    "command": "Commande"
  },
  "empty": "Aucun resultat. Essayez une autre recherche.",
  "loading": "Recherche en cours..."
}
```

- [ ] **Step 12: Verify TypeScript compilation**

```bash
cd D:\dev\Volt-public && bun run build
```

Expected: Build succeeds.

- [ ] **Step 13: Commit**

```bash
cd D:\dev\Volt-public && git add src/i18n/ && git commit -m "feat(i18n): add i18next config and EN/FR translation files"
```

---

### Task 5: Wire i18n initialization into entry points

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/settings.tsx`

- [ ] **Step 1: Update `src/main.tsx`**

Replace the entire file:

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { initI18n } from './i18n';
import './styles/global.css';

async function bootstrap() {
  // Initialize i18n before rendering — language is resolved from settings later
  // At boot time we don't have settings yet, so pass undefined (will auto-detect OS)
  await initI18n();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
```

- [ ] **Step 2: Update `src/settings.tsx`**

Replace the entire file:

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsApp } from './features/settings/SettingsApp';
import { initI18n } from './i18n';
import './styles/global.css';

async function bootstrap() {
  await initI18n();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <SettingsApp />
    </React.StrictMode>
  );
}

bootstrap();
```

- [ ] **Step 3: Verify the app boots correctly**

```bash
cd D:\dev\Volt-public && bun run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd D:\dev\Volt-public && git add src/main.tsx src/settings.tsx && git commit -m "feat(i18n): wire i18n initialization into main and settings entry points"
```

---

### Task 6: Translate main window components (App, SearchBar, Footer)

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/features/search/components/SearchBar.tsx`
- Modify: `src/shared/components/layout/Footer.tsx`

- [ ] **Step 1: Update `src/app/App.tsx`**

Add import at top:

```typescript
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import i18n from '../i18n';
```

Inside the `App` function, add the hook and language listener:

```typescript
const { t } = useTranslation('common');

// Listen for language changes from Settings window
useEffect(() => {
  let unlisten: (() => void) | undefined;
  listen<{ language: string }>('volt://language-changed', ({ payload }) => {
    i18n.changeLanguage(payload.language);
  }).then((fn) => { unlisten = fn; });
  return () => { unlisten?.(); };
}, []);
```

Update the SearchBar placeholder prop:

```tsx
<SearchBar
  value={searchQuery}
  onChange={setQuery}
  onKeyDown={handleKeyDown}
  placeholder={isLoading ? t('search.placeholderLoading') : t('search.placeholder')}
  resultCount={results.length}
/>
```

Update the skip link:

```tsx
<a href="#search-input" className="skip-link">
  {t('accessibility.skipToSearch')}
</a>
```

- [ ] **Step 2: Update `src/features/search/components/SearchBar.tsx`**

Add import:

```typescript
import { useTranslation } from 'react-i18next';
```

Inside the component, add:

```typescript
const { t } = useTranslation('common');
```

Update `liveAnnouncement`:

```typescript
const liveAnnouncement = (() => {
  if (resultCount === undefined || !value.trim()) return '';
  if (resultCount === 0) return t('search.noResults');
  return t('search.resultCount', { count: resultCount });
})();
```

Update the clear button aria-label:

```tsx
<button className="clear-button" onClick={() => onChange('')} aria-label={t('search.clearSearch')}>
```

Update the input aria-label:

```tsx
aria-label={t('search.label')}
```

- [ ] **Step 3: Update `src/shared/components/layout/Footer.tsx`**

Add import:

```typescript
import { useTranslation } from 'react-i18next';
```

Inside the component, add:

```typescript
const { t } = useTranslation('common');
```

Replace hardcoded strings:

```tsx
{isIndexing && (
  <div className="footer-indexing" aria-label={t('footer.indexing')} title={`${t('footer.indexing')}...`}>
    <span className="footer-indexing-dot" aria-hidden="true" />
    <span className="footer-indexing-label">{t('footer.indexing')}</span>
  </div>
)}
```

```tsx
<div className="footer-action">
  <span>{t('footer.openCommand')}</span>
  <div className="footer-key">↵</div>
</div>

<div className="footer-divider" />

<div className="footer-action">
  <span>{t('footer.actions')}</span>
  <div className="footer-key">Ctrl K</div>
</div>
```

- [ ] **Step 4: Verify build**

```bash
cd D:\dev\Volt-public && bun run build
```

- [ ] **Step 5: Commit**

```bash
cd D:\dev\Volt-public && git add src/app/App.tsx src/features/search/components/SearchBar.tsx src/shared/components/layout/Footer.tsx && git commit -m "feat(i18n): translate main window components (App, SearchBar, Footer)"
```

---

### Task 7: Translate HelpDialog

**Files:**
- Modify: `src/shared/components/ui/HelpDialog.tsx`

- [ ] **Step 1: Rewrite HelpDialog to use translations**

The current HelpDialog has all strings hardcoded in a `SHORTCUT_GROUPS` const. We need to make the data structure use translation keys while keeping the keyboard keys (`↑`, `↓`, `Home`, etc.) untranslated.

Add import:

```typescript
import { useTranslation } from 'react-i18next';
```

Replace the `SHORTCUT_GROUPS` const with a function that takes `t`:

```typescript
function getShortcutGroups(t: (key: string) => string): ShortcutGroup[] {
  return [
    {
      title: t('groups.navigation.title'),
      shortcuts: [
        { keys: ['↑', '↓'], description: t('groups.navigation.moveResults') },
        { keys: ['Home'], description: t('groups.navigation.jumpFirst') },
        { keys: ['End'], description: t('groups.navigation.jumpLast') },
        { keys: ['PgUp', 'PgDn'], description: t('groups.navigation.moveFive') },
      ],
    },
    {
      title: t('groups.actions.title'),
      shortcuts: [
        { keys: ['Enter'], description: t('groups.actions.launch') },
        { keys: ['Tab'], description: t('groups.actions.autocomplete') },
        { keys: ['Shift+Enter'], description: t('groups.actions.launchAdmin') },
        { keys: ['Ctrl+Enter'], description: t('groups.actions.launchKeepOpen') },
        { keys: ['Alt+1–9'], description: t('groups.actions.quickLaunch') },
      ],
    },
    {
      title: t('groups.fileApp.title'),
      shortcuts: [
        { keys: ['Ctrl+O'], description: t('groups.fileApp.openFolder') },
        { keys: ['Ctrl+C'], description: t('groups.fileApp.copyPath') },
        { keys: ['Ctrl+I'], description: t('groups.fileApp.showProperties') },
        { keys: ['Ctrl+Delete'], description: t('groups.fileApp.removeHistory') },
      ],
    },
    {
      title: t('groups.application.title'),
      shortcuts: [
        { keys: ['Esc'], description: t('groups.application.clearClose') },
        { keys: ['Ctrl+K'], description: t('groups.application.clearInput') },
        { keys: ['Ctrl+,'], description: t('groups.application.openSettings') },
        { keys: ['Ctrl+R'], description: t('groups.application.reload') },
        { keys: ['Ctrl+Q'], description: t('groups.application.quit') },
        { keys: ['F1', '?'], description: t('groups.application.showHelp') },
      ],
    },
  ];
}
```

Update the component:

```tsx
export const HelpDialog: React.FC<HelpDialogProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation('help');
  const shortcutGroups = getShortcutGroups(t);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('title')} size="medium">
      <div className="help-dialog-content">
        {shortcutGroups.map((group) => (
          // ... same JSX as before, using group.title and entry.description
        ))}
        <p className="help-dialog-footer">
          {t('closeHint', { key: 'Esc' })}
        </p>
      </div>
    </Modal>
  );
};
```

Note: Keep the full JSX mapping from the original — only the data source and footer text change.

- [ ] **Step 2: Verify build**

```bash
cd D:\dev\Volt-public && bun run build
```

- [ ] **Step 3: Commit**

```bash
cd D:\dev\Volt-public && git add src/shared/components/ui/HelpDialog.tsx && git commit -m "feat(i18n): translate HelpDialog"
```

---

### Task 8: Add language selector to Settings and multi-window sync

**Files:**
- Modify: `src/features/settings/SettingsApp.tsx`
- Modify: `src/features/settings/constants/settingsCategories.ts`

- [ ] **Step 1: Add language selector in SettingsApp.tsx**

Add imports at top of `SettingsApp.tsx`:

```typescript
import { useTranslation } from 'react-i18next';
import { emit } from '@tauri-apps/api/event';
import i18n from '../../i18n';
```

Inside the `SettingsApp` function, add the hook:

```typescript
const { t } = useTranslation('settings');
```

Add a language change handler:

```typescript
const handleLanguageChange = useCallback(
  async (language: 'auto' | 'en' | 'fr') => {
    updateSettings('general', 'language', language);

    // Resolve the actual language for 'auto'
    let resolvedLng = language;
    if (language === 'auto') {
      try {
        const { locale } = await import('@tauri-apps/plugin-os');
        const osLocale = await locale();
        if (osLocale) {
          const base = osLocale.split('-')[0].toLowerCase();
          if (base === 'fr' || base === 'en') resolvedLng = base as 'en' | 'fr';
        }
      } catch {
        resolvedLng = 'en';
      }
    }

    // Change locally
    i18n.changeLanguage(resolvedLng);

    // Notify main window
    await emit('volt://language-changed', { language: resolvedLng });
  },
  [updateSettings]
);
```

In the General settings rendering section, add the language selector (add it after the "Start with Windows" toggle or wherever the General section renders):

```tsx
<div className="setting-item">
  <div className="setting-info">
    <label>{t('general.language')}</label>
  </div>
  <select
    className="setting-select"
    value={settings.general.language}
    onChange={(e) => handleLanguageChange(e.target.value as 'auto' | 'en' | 'fr')}
  >
    <option value="auto">{t('general.languageAuto')}</option>
    <option value="en">{t('general.languageEn')}</option>
    <option value="fr">{t('general.languageFr')}</option>
  </select>
</div>
```

- [ ] **Step 2: Verify build**

```bash
cd D:\dev\Volt-public && bun run build
```

- [ ] **Step 3: Commit**

```bash
cd D:\dev\Volt-public && git add src/features/settings/SettingsApp.tsx src/features/settings/constants/settingsCategories.ts && git commit -m "feat(i18n): add language selector to Settings with multi-window sync"
```

---

### Task 9: Create plugin translation files and register them

**Files:**
- Create: `src/features/plugins/builtin/calculator/locales/en.json`
- Create: `src/features/plugins/builtin/calculator/locales/fr.json`
- Create: `src/features/plugins/builtin/emoji-picker/locales/en.json`
- Create: `src/features/plugins/builtin/emoji-picker/locales/fr.json`
- Create: `src/features/plugins/builtin/timer/locales/en.json`
- Create: `src/features/plugins/builtin/timer/locales/fr.json`
- Create: `src/features/plugins/builtin/websearch/locales/en.json`
- Create: `src/features/plugins/builtin/websearch/locales/fr.json`
- Create: `src/features/plugins/builtin/steam/locales/en.json`
- Create: `src/features/plugins/builtin/steam/locales/fr.json`
- Create: `src/features/plugins/builtin/systemcommands/locales/en.json`
- Create: `src/features/plugins/builtin/systemcommands/locales/fr.json`
- Create: `src/features/plugins/builtin/systemmonitor/locales/en.json`
- Create: `src/features/plugins/builtin/systemmonitor/locales/fr.json`
- Create: `src/features/plugins/builtin/games/locales/en.json`
- Create: `src/features/plugins/builtin/games/locales/fr.json`
- Modify: `src/features/plugins/builtin/calculator/index.ts`
- Modify: `src/features/plugins/builtin/emoji-picker/index.ts`
- Modify: `src/features/plugins/builtin/timer/index.ts`
- Modify: `src/features/plugins/builtin/websearch/index.ts`
- Modify: `src/features/plugins/builtin/steam/index.ts`
- Modify: `src/features/plugins/builtin/systemcommands/index.ts`
- Modify: `src/features/plugins/builtin/systemmonitor/index.ts`
- Modify: `src/features/plugins/builtin/games/index.ts`

- [ ] **Step 1: Create calculator translations**

`src/features/plugins/builtin/calculator/locales/en.json`:
```json
{
  "openCalculator": "Open Calculator",
  "description": "Math, conversions, dates, and timezones",
  "copyHint": "Click to copy"
}
```

`src/features/plugins/builtin/calculator/locales/fr.json`:
```json
{
  "openCalculator": "Ouvrir la Calculatrice",
  "description": "Maths, conversions, dates et fuseaux horaires",
  "copyHint": "Cliquer pour copier"
}
```

- [ ] **Step 2: Create emoji-picker translations**

`src/features/plugins/builtin/emoji-picker/locales/en.json`:
```json
{
  "loading": "Loading emojis...",
  "loadingSubtitle": "Please wait while emoji data is being loaded",
  "noResults": "No emojis found",
  "noResultsSubtitle": "Try searching for \"{{query}}\" with different keywords"
}
```

`src/features/plugins/builtin/emoji-picker/locales/fr.json`:
```json
{
  "loading": "Chargement des emojis...",
  "loadingSubtitle": "Veuillez patienter pendant le chargement",
  "noResults": "Aucun emoji trouve",
  "noResultsSubtitle": "Essayez de chercher \"{{query}}\" avec d'autres mots-cles"
}
```

- [ ] **Step 3: Create timer translations**

`src/features/plugins/builtin/timer/locales/en.json`:
```json
{
  "start": "Start {{duration}} Timer",
  "clickToStart": "Click to start",
  "pomodoroWork": "Pomodoro Work (25 minutes)",
  "pomodoroWorkDesc": "Standard Pomodoro work session",
  "shortBreak": "Short Break (5 minutes)",
  "shortBreakDesc": "Pomodoro short break",
  "longBreak": "Long Break (15 minutes)",
  "longBreakDesc": "Pomodoro long break",
  "oneMinute": "1 Minute Timer",
  "oneMinuteDesc": "Quick 60 second countdown",
  "fiveMinutes": "5 Minutes Timer",
  "fiveMinutesDesc": "Short break timer",
  "tenMinutes": "10 Minutes Timer",
  "tenMinutesDesc": "Medium duration timer",
  "pomodoro25": "25 Minutes (Pomodoro)",
  "pomodoro25Desc": "Standard Pomodoro work session"
}
```

`src/features/plugins/builtin/timer/locales/fr.json`:
```json
{
  "start": "Demarrer un minuteur de {{duration}}",
  "clickToStart": "Cliquer pour demarrer",
  "pomodoroWork": "Pomodoro Travail (25 minutes)",
  "pomodoroWorkDesc": "Session de travail Pomodoro standard",
  "shortBreak": "Pause courte (5 minutes)",
  "shortBreakDesc": "Pause courte Pomodoro",
  "longBreak": "Pause longue (15 minutes)",
  "longBreakDesc": "Pause longue Pomodoro",
  "oneMinute": "Minuteur 1 Minute",
  "oneMinuteDesc": "Compte a rebours de 60 secondes",
  "fiveMinutes": "Minuteur 5 Minutes",
  "fiveMinutesDesc": "Minuteur de pause courte",
  "tenMinutes": "Minuteur 10 Minutes",
  "tenMinutesDesc": "Minuteur de duree moyenne",
  "pomodoro25": "25 Minutes (Pomodoro)",
  "pomodoro25Desc": "Session de travail Pomodoro standard"
}
```

- [ ] **Step 4: Create websearch translations**

`src/features/plugins/builtin/websearch/locales/en.json`:
```json
{
  "searchOn": "Search \"{{query}}\" on {{engine}}",
  "pressEnter": "Press Enter to search"
}
```

`src/features/plugins/builtin/websearch/locales/fr.json`:
```json
{
  "searchOn": "Rechercher \"{{query}}\" sur {{engine}}",
  "pressEnter": "Appuyez sur Entree pour rechercher"
}
```

- [ ] **Step 5: Create steam translations**

`src/features/plugins/builtin/steam/locales/en.json`:
```json
{
  "game": "Game",
  "appId": "App ID: {{id}}"
}
```

`src/features/plugins/builtin/steam/locales/fr.json`:
```json
{
  "game": "Jeu",
  "appId": "App ID: {{id}}"
}
```

- [ ] **Step 6: Create systemcommands translations**

`src/features/plugins/builtin/systemcommands/locales/en.json`:
```json
{
  "about": { "title": "About", "subtitle": "Volt information" },
  "account": { "title": "Account", "subtitle": "User Settings" },
  "reload": { "title": "Reload Volt", "subtitle": "Restart the application" },
  "settings": { "title": "Open Settings", "subtitle": "Configure Volt preferences" },
  "quit": { "title": "Quit Volt", "subtitle": "Close the application" }
}
```

`src/features/plugins/builtin/systemcommands/locales/fr.json`:
```json
{
  "about": { "title": "A propos", "subtitle": "Informations sur Volt" },
  "account": { "title": "Compte", "subtitle": "Parametres utilisateur" },
  "reload": { "title": "Recharger Volt", "subtitle": "Redemarrer l'application" },
  "settings": { "title": "Ouvrir les Parametres", "subtitle": "Configurer les preferences" },
  "quit": { "title": "Quitter Volt", "subtitle": "Fermer l'application" }
}
```

- [ ] **Step 7: Create systemmonitor translations**

`src/features/plugins/builtin/systemmonitor/locales/en.json`:
```json
{
  "cpu": "CPU",
  "memory": "Memory",
  "disk": "Disk",
  "available": "{{value}} GB available",
  "free": "{{value}} GB free",
  "usage": {
    "critical": "Critical usage",
    "high": "High usage",
    "moderate": "Moderate usage",
    "normal": "Normal"
  },
  "clipboardTitle": "System Performance"
}
```

`src/features/plugins/builtin/systemmonitor/locales/fr.json`:
```json
{
  "cpu": "CPU",
  "memory": "Memoire",
  "disk": "Disque",
  "available": "{{value}} Go disponibles",
  "free": "{{value}} Go libres",
  "usage": {
    "critical": "Utilisation critique",
    "high": "Utilisation elevee",
    "moderate": "Utilisation moderee",
    "normal": "Normal"
  },
  "clipboardTitle": "Performance Systeme"
}
```

- [ ] **Step 8: Create games translations**

`src/features/plugins/builtin/games/locales/en.json`:
```json
{
  "badge": "Game"
}
```

`src/features/plugins/builtin/games/locales/fr.json`:
```json
{
  "badge": "Jeu"
}
```

- [ ] **Step 9: Register translations in each plugin's index.ts**

Add the following at the top of each plugin's `index.ts`, **after** existing imports:

**calculator/index.ts:**
```typescript
import i18n from 'i18next';
import enCalculator from './locales/en.json';
import frCalculator from './locales/fr.json';
i18n.addResourceBundle('en', 'calculator', enCalculator);
i18n.addResourceBundle('fr', 'calculator', frCalculator);
```

**emoji-picker/index.ts:**
```typescript
import i18n from 'i18next';
import enEmojiPicker from './locales/en.json';
import frEmojiPicker from './locales/fr.json';
i18n.addResourceBundle('en', 'emoji-picker', enEmojiPicker);
i18n.addResourceBundle('fr', 'emoji-picker', frEmojiPicker);
```

**timer/index.ts:**
```typescript
import i18n from 'i18next';
import enTimer from './locales/en.json';
import frTimer from './locales/fr.json';
i18n.addResourceBundle('en', 'timer', enTimer);
i18n.addResourceBundle('fr', 'timer', frTimer);
```

**websearch/index.ts:**
```typescript
import i18n from 'i18next';
import enWebsearch from './locales/en.json';
import frWebsearch from './locales/fr.json';
i18n.addResourceBundle('en', 'websearch', enWebsearch);
i18n.addResourceBundle('fr', 'websearch', frWebsearch);
```

**steam/index.ts:**
```typescript
import i18n from 'i18next';
import enSteam from './locales/en.json';
import frSteam from './locales/fr.json';
i18n.addResourceBundle('en', 'steam', enSteam);
i18n.addResourceBundle('fr', 'steam', frSteam);
```

**systemcommands/index.ts:**
```typescript
import i18n from 'i18next';
import enSystemCommands from './locales/en.json';
import frSystemCommands from './locales/fr.json';
i18n.addResourceBundle('en', 'systemcommands', enSystemCommands);
i18n.addResourceBundle('fr', 'systemcommands', frSystemCommands);
```

**systemmonitor/index.ts:**
```typescript
import i18n from 'i18next';
import enSystemMonitor from './locales/en.json';
import frSystemMonitor from './locales/fr.json';
i18n.addResourceBundle('en', 'systemmonitor', enSystemMonitor);
i18n.addResourceBundle('fr', 'systemmonitor', frSystemMonitor);
```

**games/index.ts:**
```typescript
import i18n from 'i18next';
import enGames from './locales/en.json';
import frGames from './locales/fr.json';
i18n.addResourceBundle('en', 'games', enGames);
i18n.addResourceBundle('fr', 'games', frGames);
```

- [ ] **Step 10: Verify build**

```bash
cd D:\dev\Volt-public && bun run build
```

- [ ] **Step 11: Commit**

```bash
cd D:\dev\Volt-public && git add src/features/plugins/builtin/ && git commit -m "feat(i18n): add co-localized translations for all builtin plugins"
```

---

### Task 10: Expose i18n API for community extensions

**Files:**
- Modify: `src/features/extensions/loader/index.ts`

- [ ] **Step 1: Add i18n API to extension context**

In `src/features/extensions/loader/index.ts`, add an import at the top:

```typescript
import i18n from 'i18next';
```

In the `buildBundleWithOrder` method, add the i18n API to the bundle preamble (after the `VoltAPI` reference):

```typescript
// i18n API for extensions
const VoltI18n = {
  addTranslations: function(lng, namespace, resources) {
    const prefixed = 'ext-' + namespace;
    window.__volt_i18n_addBundle__(lng, prefixed, resources);
  }
};
```

In `executeExtensionCode`, expose the i18n function on window before executing:

```typescript
// Expose i18n bridge for extensions
(window as any).__volt_i18n_addBundle__ = (lng: string, ns: string, resources: Record<string, string>) => {
  i18n.addResourceBundle(lng, ns, resources, true, true);
};
```

- [ ] **Step 2: Verify build**

```bash
cd D:\dev\Volt-public && bun run build
```

- [ ] **Step 3: Commit**

```bash
cd D:\dev\Volt-public && git add src/features/extensions/loader/index.ts && git commit -m "feat(i18n): expose i18n API for community extensions"
```

---

### Task 11: Update suggestions to support translation

**Files:**
- Modify: `src/shared/constants/suggestions.ts`

- [ ] **Step 1: Add translation keys to suggestions**

The suggestions are static data used for the default view. Since they're rendered in a React component, the actual translation should happen at render time. Add a `titleKey` and `subtitleKey` field so the rendering component can call `t()`:

At the top of `src/shared/constants/suggestions.ts`, add:

```typescript
import i18n from 'i18next';
```

Add a helper to get translated suggestions. Keep the existing `defaultSuggestions` as-is (it serves as the data structure), but add a function:

```typescript
/**
 * Get the current language's suggestion text.
 * Falls back to the hardcoded English if no translation exists.
 */
export function getSuggestionTitle(id: string): string {
  const key = `suggestions.${id}.title`;
  const translated = i18n.t(key, { ns: 'common' });
  // If the key is returned as-is, fallback to original
  return translated === key ? '' : translated;
}

export function getSuggestionSubtitle(id: string): string {
  const key = `suggestions.${id}.subtitle`;
  const translated = i18n.t(key, { ns: 'common' });
  return translated === key ? '' : translated;
}
```

Then add the suggestion translations to `src/i18n/locales/en/common.json` and `src/i18n/locales/fr/common.json`:

**Add to en/common.json:**
```json
{
  "suggestions": {
    "whats-new": { "title": "See what's new", "subtitle": "v0.0.2" },
    "settings": { "title": "Settings", "subtitle": "Application Settings" },
    "clipboard-history": { "title": "Clipboard History", "subtitle": "View Clipboard" },
    "search-files": { "title": "Search Files", "subtitle": "File Search" },
    "search-emoji": { "title": "Search Emoji & Symbols", "subtitle": "Emoji Picker" },
    "about": { "title": "About", "subtitle": "Volt Information" },
    "account": { "title": "Account", "subtitle": "User Settings" },
    "system-monitor": { "title": "System Monitor", "subtitle": "View Performance" },
    "calculator": { "title": "Calculator", "subtitle": "Quick Math" },
    "timer": { "title": "Timer", "subtitle": "Set Timer" },
    "web-search": { "title": "Web Search", "subtitle": "Search Online" },
    "steam-games": { "title": "Games", "subtitle": "Launch Games" }
  }
}
```

**Add to fr/common.json:**
```json
{
  "suggestions": {
    "whats-new": { "title": "Voir les nouveautes", "subtitle": "v0.0.2" },
    "settings": { "title": "Parametres", "subtitle": "Parametres de l'application" },
    "clipboard-history": { "title": "Historique du presse-papiers", "subtitle": "Voir le presse-papiers" },
    "search-files": { "title": "Rechercher des fichiers", "subtitle": "Recherche de fichiers" },
    "search-emoji": { "title": "Rechercher des Emojis", "subtitle": "Selecteur d'emojis" },
    "about": { "title": "A propos", "subtitle": "Informations Volt" },
    "account": { "title": "Compte", "subtitle": "Parametres utilisateur" },
    "system-monitor": { "title": "Moniteur systeme", "subtitle": "Voir les performances" },
    "calculator": { "title": "Calculatrice", "subtitle": "Calcul rapide" },
    "timer": { "title": "Minuteur", "subtitle": "Definir un minuteur" },
    "web-search": { "title": "Recherche Web", "subtitle": "Rechercher en ligne" },
    "steam-games": { "title": "Jeux", "subtitle": "Lancer des jeux" }
  }
}
```

Note: Merge these into the existing common.json files — don't overwrite, add the `suggestions` key alongside the existing keys.

- [ ] **Step 2: Verify build**

```bash
cd D:\dev\Volt-public && bun run build
```

- [ ] **Step 3: Commit**

```bash
cd D:\dev\Volt-public && git add src/shared/constants/suggestions.ts src/i18n/locales/ && git commit -m "feat(i18n): add translatable suggestions"
```

---

### Task 12: Final integration — load saved language at boot

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/settings.tsx`

- [ ] **Step 1: Update main.tsx to load settings before i18n init**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import App from './app/App';
import { initI18n } from './i18n';
import './styles/global.css';

async function bootstrap() {
  // Try to load saved language from settings before i18n init
  let savedLanguage: string | undefined;
  try {
    const settings = await invoke<{ general: { language?: string } }>('load_settings');
    savedLanguage = settings.general.language;
  } catch {
    // First boot or error — will auto-detect
  }

  await initI18n(savedLanguage);

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
```

- [ ] **Step 2: Update settings.tsx similarly**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { SettingsApp } from './features/settings/SettingsApp';
import { initI18n } from './i18n';
import './styles/global.css';

async function bootstrap() {
  let savedLanguage: string | undefined;
  try {
    const settings = await invoke<{ general: { language?: string } }>('load_settings');
    savedLanguage = settings.general.language;
  } catch {
    // First boot or error — will auto-detect
  }

  await initI18n(savedLanguage);

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <SettingsApp />
    </React.StrictMode>
  );
}

bootstrap();
```

- [ ] **Step 3: Verify full build**

```bash
cd D:\dev\Volt-public && bun run build
```

- [ ] **Step 4: Commit**

```bash
cd D:\dev\Volt-public && git add src/main.tsx src/settings.tsx && git commit -m "feat(i18n): load saved language preference at boot"
```

---

### Task 13: Manual smoke test

- [ ] **Step 1: Run full dev server**

```bash
cd D:\dev\Volt-public && bun tauri dev
```

- [ ] **Step 2: Test English (default)**

Verify:
- Search bar shows "Search for apps and commands..."
- Footer shows "Open Command" and "Actions"
- HelpDialog (F1) shows "Keyboard Shortcuts"
- Default suggestions show English text

- [ ] **Step 3: Test French**

Open Settings > General > Language > select "Francais":
- Settings window labels switch to French
- Main window search bar switches to "Rechercher des apps et commandes..."
- Footer switches to "Ouvrir" and "Actions"
- HelpDialog shows "Raccourcis clavier"

- [ ] **Step 4: Test persistence**

Close and reopen Volt:
- Language should still be French

- [ ] **Step 5: Test "Auto" setting**

Switch back to "Auto (System)" and verify it picks the correct OS language.
