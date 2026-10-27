import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../types/settings.types';
import {
  isActionsMenuShortcut,
  navigationKey,
  resolveEscapeAction,
  resolveListNavigation,
  type NavigationKeyEvent,
} from './keyboard';
import { normalizeBehaviorSettings } from './normalize';
import {
  DEFAULT_TIMER_DURATIONS,
  clampInt,
  resolveMonitorRefreshMs,
  resolveTimerDurations,
  resolveWindowGapPx,
} from './pluginOptions';
import { isPopToRootDelay, popToRootDelayMs, shouldPopToRoot } from './popToRoot';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const key = (k: string, extra: Partial<NavigationKeyEvent> = {}): NavigationKeyEvent => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...extra,
});

describe('pop to root decision', () => {
  it('never resets when the delay is "never", whatever the hidden time', () => {
    expect(shouldPopToRoot('never', 0)).toBe(false);
    expect(shouldPopToRoot('never', 10 * 60 * 60_000)).toBe(false);
    expect(shouldPopToRoot(undefined, 10 * 60 * 60_000)).toBe(false);
  });

  it('always resets with the immediate delay', () => {
    expect(shouldPopToRoot('immediate', 0)).toBe(true);
    expect(shouldPopToRoot('immediate', 5)).toBe(true);
  });

  it('keeps the state until the configured delay is reached', () => {
    expect(shouldPopToRoot('30s', 29_999)).toBe(false);
    expect(shouldPopToRoot('30s', 30_000)).toBe(true);
    expect(shouldPopToRoot('1m', 59_000)).toBe(false);
    expect(shouldPopToRoot('1m', 61_000)).toBe(true);
    expect(shouldPopToRoot('5m', 4 * 60_000)).toBe(false);
    expect(shouldPopToRoot('5m', 5 * 60_000)).toBe(true);
  });

  it('maps every delay and validates the persisted value', () => {
    expect(popToRootDelayMs('never')).toBeNull();
    expect(popToRootDelayMs('5m')).toBe(300_000);
    expect(isPopToRootDelay('1m')).toBe(true);
    expect(isPopToRootDelay('2m')).toBe(false);
    expect(isPopToRootDelay(30)).toBe(false);
  });
});

describe('escape behaviour', () => {
  it('"close" always clears and hides (the historical behaviour)', () => {
    expect(resolveEscapeAction('close', '')).toBe('hide');
    expect(resolveEscapeAction('close', 'abc')).toBe('hide');
    expect(resolveEscapeAction(undefined, 'abc')).toBe('hide');
  });

  it('"clearThenClose" clears a non-empty query first, then hides', () => {
    expect(resolveEscapeAction('clearThenClose', 'abc')).toBe('clear');
    expect(resolveEscapeAction('clearThenClose', '')).toBe('hide');
  });

  it('"backToRoot" never hides', () => {
    expect(resolveEscapeAction('backToRoot', 'abc')).toBe('root');
    expect(resolveEscapeAction('backToRoot', '')).toBe('root');
  });
});

describe('list navigation bindings', () => {
  it('has no alternative binding in the arrows-only preset', () => {
    for (const k of ['n', 'p', 'j', 'k']) {
      expect(resolveListNavigation('arrows', key(k, { ctrlKey: true }))).toBeNull();
    }
  });

  it('maps Ctrl+N / Ctrl+P in the emacs preset', () => {
    expect(resolveListNavigation('emacs', key('n', { ctrlKey: true }))).toBe('down');
    expect(resolveListNavigation('emacs', key('p', { ctrlKey: true }))).toBe('up');
    expect(resolveListNavigation('emacs', key('j', { ctrlKey: true }))).toBeNull();
    expect(resolveListNavigation(undefined, key('n', { ctrlKey: true }))).toBe('down');
  });

  it('maps Ctrl+J / Ctrl+K in the vim preset', () => {
    expect(resolveListNavigation('vim', key('j', { ctrlKey: true }))).toBe('down');
    expect(resolveListNavigation('vim', key('k', { ctrlKey: true }))).toBe('up');
    expect(resolveListNavigation('vim', key('n', { ctrlKey: true }))).toBeNull();
  });

  it('ignores bare letters and chords with other modifiers', () => {
    expect(resolveListNavigation('vim', key('j'))).toBeNull();
    expect(resolveListNavigation('vim', key('j', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(resolveListNavigation('vim', key('j', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveListNavigation('emacs', key('n', { ctrlKey: true, metaKey: true }))).toBeNull();
  });

  it('is case-insensitive (Caps Lock)', () => {
    expect(resolveListNavigation('vim', key('J', { ctrlKey: true }))).toBe('down');
  });

  it('translates bindings to arrow key names and leaves other keys alone', () => {
    expect(navigationKey('vim', key('j', { ctrlKey: true }))).toBe('ArrowDown');
    expect(navigationKey('vim', key('k', { ctrlKey: true }))).toBe('ArrowUp');
    expect(navigationKey('arrows', key('j', { ctrlKey: true }))).toBe('j');
    expect(navigationKey('vim', key('Enter'))).toBe('Enter');
    expect(navigationKey('vim', key('ArrowDown'))).toBe('ArrowDown');
  });

  it('moves the actions menu to Ctrl+Shift+K only in the vim preset', () => {
    expect(isActionsMenuShortcut('emacs', key('k', { ctrlKey: true }))).toBe(true);
    expect(isActionsMenuShortcut('arrows', key('k', { ctrlKey: true }))).toBe(true);
    expect(isActionsMenuShortcut('vim', key('k', { ctrlKey: true }))).toBe(false);
    expect(isActionsMenuShortcut('vim', key('K', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isActionsMenuShortcut('emacs', key('k', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isActionsMenuShortcut('emacs', key('k'))).toBe(false);
  });
});

describe('plugin option bounds', () => {
  it('rounds and clamps integers, falling back on garbage', () => {
    const range = { min: 1, max: 10 };
    expect(clampInt(5.6, range, 3)).toBe(6);
    expect(clampInt(0, range, 3)).toBe(1);
    expect(clampInt(99, range, 3)).toBe(10);
    expect(clampInt(Number.NaN, range, 3)).toBe(3);
    expect(clampInt('7', range, 3)).toBe(3);
    expect(clampInt(undefined, range, 3)).toBe(3);
  });

  it('keeps the current timer durations as defaults', () => {
    expect(resolveTimerDurations(undefined)).toEqual(DEFAULT_TIMER_DURATIONS);
    expect(DEFAULT_TIMER_DURATIONS).toEqual({
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
    });
  });

  it('bounds the timer durations', () => {
    expect(
      resolveTimerDurations({
        timerWorkMinutes: 0,
        timerShortBreakMinutes: 500,
        timerLongBreakMinutes: 45,
      })
    ).toEqual({ workMinutes: 1, shortBreakMinutes: 60, longBreakMinutes: 45 });
    expect(resolveTimerDurations({ timerWorkMinutes: 999 }).workMinutes).toBe(180);
  });

  it('defaults the monitor refresh to the backend period and bounds it', () => {
    expect(resolveMonitorRefreshMs(undefined)).toBe(5000);
    expect(resolveMonitorRefreshMs({ systemMonitorRefreshMs: 10 })).toBe(1000);
    expect(resolveMonitorRefreshMs({ systemMonitorRefreshMs: 600_000 })).toBe(60_000);
    expect(resolveMonitorRefreshMs({ systemMonitorRefreshMs: 2000 })).toBe(2000);
  });

  it('bounds the window gap', () => {
    expect(resolveWindowGapPx(undefined)).toBe(0);
    expect(resolveWindowGapPx({ windowManagementGapPx: -5 })).toBe(0);
    expect(resolveWindowGapPx({ windowManagementGapPx: 500 })).toBe(64);
    expect(resolveWindowGapPx({ windowManagementGapPx: 12 })).toBe(12);
  });
});

describe('settings normalization', () => {
  const legacySettings = (): Settings => {
    const legacy = clone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    delete legacy.launcher;
    delete legacy.keyboard;
    const plugins = { ...(legacy.plugins as Record<string, unknown>) };
    for (const field of [
      'systemMonitorRefreshMs',
      'timerWorkMinutes',
      'timerShortBreakMinutes',
      'timerLongBreakMinutes',
      'windowManagementGapPx',
      'quicklinksUsePreferredBrowser',
    ]) {
      delete plugins[field];
    }
    legacy.plugins = plugins;
    legacy.hotkeys = { toggleWindow: 'Ctrl+Space', openSettings: 'Ctrl+,' };
    return legacy as unknown as Settings;
  };

  it('upgrades a settings file written before the new settings existed', () => {
    const upgraded = normalizeBehaviorSettings(legacySettings());
    expect(upgraded.launcher).toEqual(DEFAULT_SETTINGS.launcher);
    expect(upgraded.keyboard).toEqual(DEFAULT_SETTINGS.keyboard);
    expect(upgraded.plugins.systemMonitorRefreshMs).toBe(5000);
    expect(upgraded.plugins.timerWorkMinutes).toBe(25);
    expect(upgraded.plugins.windowManagementGapPx).toBe(0);
    expect(upgraded.plugins.quicklinksUsePreferredBrowser).toBe(false);
    expect(upgraded.plugins.enabledPlugins).toEqual(DEFAULT_SETTINGS.plugins.enabledPlugins);
  });

  it('migrates the never-registered legacy open-settings hotkey to "unset"', () => {
    expect(normalizeBehaviorSettings(legacySettings()).hotkeys.openSettings).toBe('');
    const custom = legacySettings();
    custom.hotkeys.openSettings = 'Ctrl+Alt+S';
    expect(normalizeBehaviorSettings(custom).hotkeys.openSettings).toBe('Ctrl+Alt+S');
  });

  it('coerces invalid values and is idempotent', () => {
    const broken = clone(DEFAULT_SETTINGS);
    (broken.launcher as unknown as Record<string, unknown>).popToRoot = 'tomorrow';
    (broken.keyboard as unknown as Record<string, unknown>).escapeBehavior = 'explode';
    (broken.keyboard as unknown as Record<string, unknown>).listNavigation = 'dvorak';
    broken.plugins.timerWorkMinutes = 100_000;
    broken.plugins.systemMonitorRefreshMs = 1;
    const once = normalizeBehaviorSettings(broken);
    expect(once.launcher.popToRoot).toBe('never');
    expect(once.keyboard.escapeBehavior).toBe('close');
    expect(once.keyboard.listNavigation).toBe('emacs');
    expect(once.plugins.timerWorkMinutes).toBe(180);
    expect(once.plugins.systemMonitorRefreshMs).toBe(1000);
    expect(normalizeBehaviorSettings(once)).toEqual(once);
  });

  it('keeps valid user choices', () => {
    const custom = clone(DEFAULT_SETTINGS);
    custom.launcher = {
      popToRoot: '5m',
      includeFilesInRootSearch: false,
      includeGamesInRootSearch: false,
    };
    custom.keyboard = {
      escapeBehavior: 'clearThenClose',
      escapeClosesSecondaryWindows: false,
      listNavigation: 'vim',
    };
    custom.plugins.quicklinksUsePreferredBrowser = true;
    expect(normalizeBehaviorSettings(custom)).toEqual(custom);
  });
});
