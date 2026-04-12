// Components

export { SettingsApp } from './SettingsApp';

// Services
export { applyTheme, settingsService, setupThemeListener } from './services/settingsService';

// Types
export type {
  AppearanceSettings,
  CustomPosition,
  GeneralSettings,
  HotkeySettings,
  IndexingSettings,
  Settings,
  SettingsSection,
  Theme,
  WindowPosition,
} from './types/settings.types';

export { DEFAULT_SETTINGS } from './types/settings.types';
