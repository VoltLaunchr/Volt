import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';
import { DEFAULT_SETTINGS, type Settings } from '../../features/settings/types/settings.types';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  it('has correct initial state', () => {
    const state = useAppStore.getState();
    expect(state.settings).toBeNull();
    expect(state.isIndexing).toBe(false);
  });

  it('setSettings updates settings', () => {
    const mockSettings: Settings = {
      ...DEFAULT_SETTINGS,
      general: {
        ...DEFAULT_SETTINGS.general,
        startWithWindows: false,
        maxResults: 8,
        closeOnLaunch: true,
      },
      appearance: {
        ...DEFAULT_SETTINGS.appearance,
        theme: 'dark',
        windowEffect: 'volt-glass',
        transparency: 0.85,
        windowPosition: 'center',
      },
      hotkeys: { toggleWindow: 'Ctrl+Space', openSettings: 'Ctrl+,' },
      indexing: { folders: [], excludedPaths: [], fileExtensions: [], indexOnStartup: true, deepSearch: false, staleThresholdSecs: 3600 },
      plugins: { enabledPlugins: [], clipboardMonitoring: true, clipboardRetentionDays: 30, clipboardDisabledApps: [] },
      shortcuts: { appShortcuts: [] },
    };
    useAppStore.getState().setSettings(mockSettings);
    expect(useAppStore.getState().settings).toBe(mockSettings);
  });

  it('setIsIndexing updates indexing state', () => {
    useAppStore.getState().setIsIndexing(true);
    expect(useAppStore.getState().isIndexing).toBe(true);
    useAppStore.getState().setIsIndexing(false);
    expect(useAppStore.getState().isIndexing).toBe(false);
  });

  it('setSettings to null works', () => {
    useAppStore.getState().setSettings(DEFAULT_SETTINGS);
    useAppStore.getState().setSettings(null);
    expect(useAppStore.getState().settings).toBeNull();
  });
});
