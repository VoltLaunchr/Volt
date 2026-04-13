/**
 * Settings types for the frontend
 * These types mirror the Rust backend settings structure
 */

export interface GeneralSettings {
  startWithWindows: boolean;
  maxResults: number;
  closeOnLaunch: boolean;
  hasSeenOnboarding: boolean;
  language: 'auto' | 'en' | 'fr';
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

export interface Settings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  hotkeys: HotkeySettings;
  indexing: IndexingSettings;
  plugins: PluginSettings;
  shortcuts: ShortcutsSettings;
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
    excludedPaths: [],
    fileExtensions: [], // Empty = index all file types
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
    ],
    clipboardMonitoring: true,
  },
  shortcuts: {
    appShortcuts: [],
  },
};
