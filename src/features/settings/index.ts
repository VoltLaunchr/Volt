// Components

export { SettingsApp } from './SettingsApp';

// Services
export { applyTheme, settingsService, setupThemeListener } from './services/settingsService';
export {
  applyAppearance,
  applyWindowOpacity,
  clampTransparency,
  TRANSPARENCY_DEFAULT,
  TRANSPARENCY_MAX,
  TRANSPARENCY_MIN,
  TRANSPARENCY_STEP,
} from './services/appearanceService';
export { applyWindowEffect, previewAppearanceOnMain } from '../window/services/windowEffectService';

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
