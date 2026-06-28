import { invoke } from '@tauri-apps/api/core';
import { extractErrorMessage } from '../../../shared/utils/error';
import { logger } from '../../../shared/utils/logger';
import { normalizeEnabledPlugins } from '../../plugins/builtin/manifest';
import {
  AppearanceSettings,
  DEFAULT_SETTINGS,
  GeneralSettings,
  HotkeySettings,
  IndexingSettings,
  PluginSettings,
  Settings,
  Theme,
} from '../types/settings.types';

const errorMessage = extractErrorMessage;

/**
 * Migrate persisted plugin ids to their canonical runtime ids. Legacy installs
 * stored display ids (`web-search`, `steam-games`, …) that never matched the
 * registry; this keeps every settings consumer (main window + Settings window)
 * working with one canonical id set. Idempotent for already-canonical data.
 */
function normalizePluginIds(settings: Settings): Settings {
  const enabledPlugins = normalizeEnabledPlugins(settings.plugins?.enabledPlugins);
  return {
    ...settings,
    plugins: { ...settings.plugins, enabledPlugins },
  };
}

/**
 * Settings service for interacting with the Tauri backend
 */
export const settingsService = {
  /**
   * Load settings from the backend
   */
  async loadSettings(): Promise<Settings> {
    try {
      const settings = await invoke<Settings>('load_settings');
      return normalizePluginIds(settings);
    } catch (error) {
      logger.error('Failed to load settings:', error);
      return DEFAULT_SETTINGS;
    }
  },

  /**
   * Save complete settings to the backend
   */
  async saveSettings(settings: Settings): Promise<void> {
    try {
      await invoke<void>('save_settings', { settings });
    } catch (error) {
      logger.error('Failed to save settings:', error);
      throw new Error(`Failed to save settings: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Update general settings
   */
  async updateGeneralSettings(general: GeneralSettings): Promise<Settings> {
    try {
      return await invoke<Settings>('update_general_settings', { general });
    } catch (error) {
      logger.error('Failed to update general settings:', error);
      throw new Error(`Failed to update general settings: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  },

  /**
   * Update appearance settings
   */
  async updateAppearanceSettings(appearance: AppearanceSettings): Promise<Settings> {
    try {
      return await invoke<Settings>('update_appearance_settings', { appearance });
    } catch (error) {
      logger.error('Failed to update appearance settings:', error);
      throw new Error(`Failed to update appearance settings: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  },

  /**
   * Update hotkey settings
   */
  async updateHotkeySettings(hotkeys: HotkeySettings): Promise<Settings> {
    try {
      return await invoke<Settings>('update_hotkey_settings', { hotkeys });
    } catch (error) {
      logger.error('Failed to update hotkey settings:', error);
      throw new Error(`Failed to update hotkey settings: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  },

  /**
   * Update indexing settings
   */
  async updateIndexingSettings(indexing: IndexingSettings): Promise<Settings> {
    try {
      return await invoke<Settings>('update_indexing_settings', { indexing });
    } catch (error) {
      logger.error('Failed to update indexing settings:', error);
      throw new Error(`Failed to update indexing settings: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  },

  /**
   * Update plugin settings
   */
  async updatePluginSettings(plugins: PluginSettings): Promise<Settings> {
    try {
      return await invoke<Settings>('update_plugin_settings', { plugins });
    } catch (error) {
      logger.error('Failed to update plugin settings:', error);
      throw new Error(`Failed to update plugin settings: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  },

  /**
   * Get current theme
   */
  async getTheme(): Promise<Theme> {
    try {
      const theme = await invoke<string>('get_theme');
      return theme as Theme;
    } catch (error) {
      logger.error('Failed to get theme:', error);
      return 'dark';
    }
  },

  /**
   * Set theme
   */
  async setTheme(theme: Theme): Promise<void> {
    try {
      await invoke<void>('set_theme', { theme });
    } catch (error) {
      logger.error('Failed to set theme:', error);
      throw new Error(`Failed to set theme: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Export settings to a file
   */
  async exportSettings(path: string): Promise<string> {
    try {
      return await invoke<string>('export_settings', { path });
    } catch (error) {
      logger.error('Failed to export settings:', error);
      throw new Error(`Failed to export settings: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Import settings from a file
   */
  async importSettings(path: string): Promise<Settings> {
    try {
      return await invoke<Settings>('import_settings', { path });
    } catch (error) {
      logger.error('Failed to import settings:', error);
      throw new Error(`Failed to import settings: ${errorMessage(error)}`, { cause: error });
    }
  },
};

/**
 * Apply theme to the document
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === 'auto') {
    // Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

/**
 * Listen for system theme changes (for auto mode)
 */
export function setupThemeListener(callback: (isDark: boolean) => void): () => void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const handler = (e: MediaQueryListEvent) => {
    callback(e.matches);
  };

  mediaQuery.addEventListener('change', handler);

  return () => {
    mediaQuery.removeEventListener('change', handler);
  };
}

export default settingsService;
