import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

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
    const mockSettings = {
      general: { startWithWindows: false, maxResults: 8, closeOnLaunch: true },
      appearance: { theme: 'dark', transparency: 0.85, windowPosition: 'center' },
      hotkeys: { toggleWindow: 'Ctrl+Space', openSettings: 'Ctrl+,' },
      indexing: { folders: [], excludedPaths: [], fileExtensions: [], indexOnStartup: true },
      plugins: { enabledPlugins: [], clipboardMonitoring: true },
      shortcuts: { appShortcuts: [] },
    } as any;
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
    useAppStore.getState().setSettings({ general: {} } as any);
    useAppStore.getState().setSettings(null);
    expect(useAppStore.getState().settings).toBeNull();
  });
});
