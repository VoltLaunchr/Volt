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

export interface AppearanceSettings {
  theme: Theme;
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
}

export interface PluginSettings {
  enabledPlugins: string[];
  clipboardMonitoring: boolean;
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

export interface Settings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  hotkeys: HotkeySettings;
  indexing: IndexingSettings;
  plugins: PluginSettings;
  shortcuts: ShortcutsSettings;
  integrations?: IntegrationsSettings;
  shell: ShellSettings;
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
  },
  plugins: {
    enabledPlugins: [
      'calculator',
      'web-search',
      'system-commands',
      'timer',
      'system-monitor',
      'steam-games',
      'clipboard-manager',
      'quicklinks',
      'window-management',
    ],
    clipboardMonitoring: true,
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
