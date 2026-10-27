import { DEFAULT_SETTINGS, type Settings } from '../types/settings.types';
import { isPopToRootDelay } from './popToRoot';
import { ESCAPE_BEHAVIOR_OPTIONS, LIST_NAVIGATION_OPTIONS } from './keyboard';
import {
  resolveMonitorRefreshMs,
  resolveTimerDurations,
  resolveWindowGapPx,
} from './pluginOptions';

/** Value `hotkeys.openSettings` held while it was stored but never registered. */
const LEGACY_OPEN_SETTINGS_HOTKEY = 'Ctrl+,';

/**
 * Brings the behaviour settings (launcher, keyboard, plugin options, open-settings hotkey)
 * into valid ranges and fills what an older backend or a hand-edited file left out. Mirrors
 * `Settings::normalize_behavior` in Rust so both sides agree. Idempotent.
 */
export function normalizeBehaviorSettings(settings: Settings): Settings {
  const defaults = DEFAULT_SETTINGS;
  const launcher = { ...defaults.launcher, ...settings.launcher };
  const keyboard = { ...defaults.keyboard, ...settings.keyboard };
  const plugins = { ...defaults.plugins, ...settings.plugins };
  const timer = resolveTimerDurations(plugins);
  const openSettings = (settings.hotkeys?.openSettings ?? '').trim();

  return {
    ...settings,
    hotkeys: {
      ...defaults.hotkeys,
      ...settings.hotkeys,
      openSettings: openSettings === LEGACY_OPEN_SETTINGS_HOTKEY ? '' : openSettings,
    },
    launcher: {
      ...launcher,
      popToRoot: isPopToRootDelay(launcher.popToRoot)
        ? launcher.popToRoot
        : defaults.launcher.popToRoot,
      includeFilesInRootSearch: launcher.includeFilesInRootSearch !== false,
      includeGamesInRootSearch: launcher.includeGamesInRootSearch !== false,
    },
    keyboard: {
      ...keyboard,
      escapeBehavior: ESCAPE_BEHAVIOR_OPTIONS.includes(keyboard.escapeBehavior)
        ? keyboard.escapeBehavior
        : defaults.keyboard.escapeBehavior,
      escapeClosesSecondaryWindows: keyboard.escapeClosesSecondaryWindows !== false,
      listNavigation: LIST_NAVIGATION_OPTIONS.includes(keyboard.listNavigation)
        ? keyboard.listNavigation
        : defaults.keyboard.listNavigation,
    },
    plugins: {
      ...plugins,
      systemMonitorRefreshMs: resolveMonitorRefreshMs(plugins),
      timerWorkMinutes: timer.workMinutes,
      timerShortBreakMinutes: timer.shortBreakMinutes,
      timerLongBreakMinutes: timer.longBreakMinutes,
      windowManagementGapPx: resolveWindowGapPx(plugins),
      quicklinksUsePreferredBrowser: plugins.quicklinksUsePreferredBrowser === true,
    },
  };
}
