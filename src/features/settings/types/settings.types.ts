/**
 * Settings types for the frontend
 * These types mirror the Rust backend settings structure
 */

export type ShowOnScreen = 'cursor' | 'focusedWindow' | 'primaryScreen';
export type SearchSensitivity = 'low' | 'medium' | 'high';

export type UpdateChannel = 'stable' | 'beta';

export interface GeneralSettings {
  startWithWindows: boolean;
  maxResults: number;
  closeOnLaunch: boolean;
  hasSeenOnboarding: boolean;
  language: 'auto' | 'en' | 'fr';
  featurePreview: boolean;
  searchSensitivity: SearchSensitivity;
  showOnScreen: ShowOnScreen;
  autoCheckForUpdates: boolean;
  updateChannel: UpdateChannel;
}

export interface CustomPosition {
  x: number;
  y: number;
}

export type WindowEffect = 'volt-glass' | 'mica' | 'acrylic' | 'solid';

export interface AppearanceSettings {
  theme: Theme;
  windowEffect: WindowEffect;
  /** Shell opacity for glass / native materials (0.5–1). Ignored when `solid`. */
  transparency: number;
  windowPosition: WindowPosition;
  customPosition?: CustomPosition;
}

export interface HotkeySettings {
  toggleWindow: string;
  openSettings: string;
}

export interface IndexingSettings {
  folders: string[];
  excludedPaths: string[];
  fileExtensions: string[];
  indexOnStartup: boolean;
  deepSearch: boolean;
  /**
   * Re-walk the index on launch when the persisted snapshot is older than this
   * many seconds (the no-admin offline catch-up). `0` disables the catch-up.
   */
  staleThresholdSecs: number;
}

export interface PluginSettings {
  enabledPlugins: string[];
  clipboardMonitoring: boolean;
  clipboardRetentionDays: number;
  clipboardDisabledApps: string[];
}

export interface Integration {
  id: string;
  name: string;
  icon: string;
  description: string;
  website?: string;
  configured: boolean;
  enabled: boolean;
}

export interface IntegrationsSettings {
  github?: {
    token: string;
    enabled: boolean;
    lastUpdated?: string;
  };
  notion?: {
    token: string;
    enabled: boolean;
    lastUpdated?: string;
  };
}

export interface AppShortcut {
  id: string;
  name: string;
  category: string;
  icon?: string;
  path: string;
  alias?: string;
  hotkey?: string;
  enabled: boolean;
}

export interface ShortcutsSettings {
  appShortcuts: AppShortcut[];
}

export interface ShellSettings {
  enabled: boolean;
  defaultShell: string | null;
  workingDir: string | null;
  timeoutMs: number;
  historySize: number;
}

/**
 * Global snippet expansion (Pilier E1) — a system-wide `WH_KEYBOARD_LL`
 * keyboard hook that expands `;trigger`-style snippets in any foreground
 * Windows application. Parallel to (and independent of) the in-app snippet
 * plugin, which only operates on Volt's own search bar.
 *
 * Mirrors `SnippetExpansionSettings` in `src-tauri/src/commands/system/settings.rs`.
 */
export interface SnippetExpansionSettings {
  enabled: boolean;
  excludedApps: string[];
  maxTriggerLen: number;
}

/**
 * Fallback commands — taken over by the search bar when a query returns no
 * regular results. The typed query is substituted into the `target` template
 * via `{query}` (URL-encoded) and `{rawQuery}` (unencoded) placeholders.
 *
 * Mirrors `FallbackCommand` in `src-tauri/src/commands/settings.rs`.
 */
export type FallbackKind = 'webSearch' | 'shell' | 'url';

export interface FallbackCommand {
  id: string;
  label: string;
  icon?: string;
  kind: FallbackKind;
  target: string;
  enabled: boolean;
  order: number;
}

export interface FallbacksSettings {
  commands: FallbackCommand[];
}

export interface Settings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  hotkeys: HotkeySettings;
  indexing: IndexingSettings;
  plugins: PluginSettings;
  shortcuts: ShortcutsSettings;
  integrations?: IntegrationsSettings;
  shell: ShellSettings;
  fallbacks: FallbacksSettings;
  snippetExpansion: SnippetExpansionSettings;
}

export type Theme = 'light' | 'dark' | 'auto';
export type WindowPosition =
  | 'center'
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight'
  | 'leftCenter'
  | 'rightCenter'
  | 'custom';

export type SettingsSection = 'general' | 'appearance' | 'hotkeys' | 'indexing';

/**
 * Default settings values
 */
export const DEFAULT_SETTINGS: Settings = {
  general: {
    startWithWindows: false,
    maxResults: 8,
    closeOnLaunch: true,
    hasSeenOnboarding: false,
    language: 'auto',
    featurePreview: false,
    searchSensitivity: 'medium',
    showOnScreen: 'cursor',
    autoCheckForUpdates: true,
    updateChannel: 'stable',
  },
  appearance: {
    theme: 'dark',
    windowEffect: 'volt-glass',
    transparency: 0.85,
    windowPosition: 'center',
    customPosition: undefined,
  },
  hotkeys: {
    toggleWindow: 'Ctrl+Space', // Per documentation: /docs/user-guide/shortcuts
    openSettings: 'Ctrl+,',
  },
  indexing: {
    folders: [],
    excludedPaths: [
      // JS / Python ecosystem noise
      'node_modules',
      '.git',
      '.svn',
      '__pycache__',
      '.venv',
      'venv',
      // Build outputs
      'target',
      'dist',
      'build',
      '.next',
      '.nuxt',
      // Temp & cache
      'tmp',
      'temp',
      'Temp',
      'Cache',
      'cache',
      'Caches',
      'caches',
      '.cache',
      // Windows system
      '$Recycle.Bin',
      'System Volume Information',
      'AppData',
      'Windows',
      // macOS system
      'Library',
    ],
    fileExtensions: ['pdf', 'docx', 'doc', 'txt', 'xlsx', 'xls', 'pptx', 'ppt', 'md', 'csv'],
    indexOnStartup: true,
    deepSearch: false,
    staleThresholdSecs: 3600,
  },
  plugins: {
    // Canonical runtime plugin ids — must match `Plugin.id` and the
    // `MANAGED_PLUGINS` manifest (src/features/plugins/builtin/manifest.ts).
    enabledPlugins: [
      'calculator',
      'websearch',
      'systemcommands',
      'timer',
      'system_monitor',
      'games',
      'clipboard',
      'emoji-picker',
      'notes',
      'snippets',
      'shellcommand',
      'quicklinks',
      'window-management',
      'developer-tools',
    ],
    clipboardMonitoring: true,
    clipboardRetentionDays: 30,
    clipboardDisabledApps: [],
  },
  shortcuts: {
    appShortcuts: [],
  },
  shell: {
    enabled: true,
    defaultShell: null,
    workingDir: null,
    timeoutMs: 30000,
    historySize: 500,
  },
  snippetExpansion: {
    // A system-wide keyboard hook is opt-in, never active by default.
    enabled: false,
    excludedApps: ['keepass', '1password', 'bitwarden', 'lastpass'],
    maxTriggerLen: 32,
  },
  fallbacks: {
    commands: [
      {
        id: 'fallback-google',
        label: 'Search {rawQuery} on Google',
        icon: 'globe',
        kind: 'webSearch',
        target: 'https://www.google.com/search?q={query}',
        enabled: true,
        order: 0,
      },
      {
        id: 'fallback-duckduckgo',
        label: 'Search {rawQuery} on DuckDuckGo',
        icon: 'shield',
        kind: 'webSearch',
        target: 'https://duckduckgo.com/?q={query}',
        enabled: true,
        order: 1,
      },
      {
        id: 'fallback-youtube',
        label: 'Search {rawQuery} on YouTube',
        icon: 'youtube',
        kind: 'webSearch',
        target: 'https://www.youtube.com/results?search_query={query}',
        enabled: true,
        order: 2,
      },
      {
        id: 'fallback-chatgpt',
        label: 'Ask ChatGPT about {rawQuery}',
        icon: 'message-circle',
        kind: 'webSearch',
        target: 'https://chat.openai.com/?q={query}',
        enabled: false,
        order: 3,
      },
      {
        id: 'fallback-perplexity',
        label: 'Ask Perplexity about {rawQuery}',
        icon: 'sparkles',
        kind: 'webSearch',
        target: 'https://www.perplexity.ai/search?q={query}',
        enabled: false,
        order: 4,
      },
    ],
  },
  integrations: {
    github: {
      token: '',
      enabled: false,
    },
    notion: {
      token: '',
      enabled: false,
    },
  },
};
