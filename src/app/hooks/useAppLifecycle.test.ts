import { act, renderHook, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { EventCallback, EventName, UnlistenFn } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../features/settings/types/settings.types';
import { useAppStore } from '../../stores/appStore';
import { useAppLifecycle } from './useAppLifecycle';

interface ListenerRegistration {
  event: EventName;
  callback: EventCallback<unknown>;
  unlisten: UnlistenFn;
}

function emit(registration: ListenerRegistration | undefined, payload: unknown): void {
  registration?.callback({ event: registration.event, id: 1, payload });
}

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  updateIndexingSettings: vi.fn(),
  addToast: vi.fn(),
  stopPeriodicCheck: vi.fn(),
  startPeriodicCheck: vi.fn(),
  checkUpdateOnStartup: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('../../features/applications', () => ({
  useApplications: () => ({
    apps: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('../../features/clipboard', () => ({
  ClipboardPlugin: class ClipboardPlugin {
    static startMonitoring = vi.fn();
  },
}));

vi.mock('../../features/extensions', () => ({
  extensionLoader: {
    setPermissionRequestHandler: vi.fn(),
    loadAllExtensions: vi.fn(),
    reloadExtension: vi.fn(),
    unloadExtension: vi.fn(),
  },
}));

vi.mock('../../features/plugins/builtin', () => {
  class Plugin {}
  return {
    AiChatPlugin: Plugin,
    CalculatorPlugin: Plugin,
    DeveloperCommandsPlugin: Plugin,
    DeveloperToolsPlugin: Plugin,
    EmojiPickerPlugin: Plugin,
    GamesPlugin: Plugin,
    NotesPlugin: Plugin,
    QuicklinksPlugin: Plugin,
    ShellCommandPlugin: Plugin,
    SystemCommandsPlugin: Plugin,
    SystemMonitorPlugin: Plugin,
    TimerPlugin: Plugin,
    WebSearchPlugin: Plugin,
    WindowManagementPlugin: Plugin,
  };
});

vi.mock('../../features/plugins/builtin/snippets', () => ({
  SnippetsPlugin: class SnippetsPlugin {},
}));

vi.mock('../../features/plugins/core', () => ({
  pluginRegistry: {
    isInitialized: () => true,
  },
}));

vi.mock('../../features/settings', () => ({
  applyTheme: vi.fn(),
  applyWindowEffect: vi.fn(),
  applyWindowOpacity: vi.fn(),
  setupThemeListener: vi.fn(() => vi.fn()),
  settingsService: {
    loadSettings: mocks.loadSettings,
    updateIndexingSettings: mocks.updateIndexingSettings,
  },
}));

vi.mock('../../features/settings/services/updateService', () => ({
  updateService: {
    stopPeriodicCheck: mocks.stopPeriodicCheck,
    startPeriodicCheck: mocks.startPeriodicCheck,
    checkUpdateOnStartup: mocks.checkUpdateOnStartup,
  },
}));

vi.mock('../../shared/components/ui/toast-store', () => ({
  useToastStore: {
    getState: () => ({ addToast: mocks.addToast }),
  },
}));

vi.mock('../../shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useAppLifecycle file watcher', () => {
  const mockInvoke = vi.mocked(invoke);
  const mockListen = vi.mocked(listen);
  let registrations: ListenerRegistration[];
  let settings: Settings;

  beforeEach(() => {
    registrations = [];
    settings = {
      ...DEFAULT_SETTINGS,
      general: { ...DEFAULT_SETTINGS.general, autoCheckForUpdates: false },
      indexing: {
        ...DEFAULT_SETTINGS.indexing,
        folders: ['C:\\Users\\Volt\\Documents'],
      },
    };

    useAppStore.setState({
      settings: null,
      isIndexing: false,
      allApps: [],
      isLoading: false,
      appError: null,
    });
    mocks.loadSettings.mockResolvedValue(settings);
    mocks.updateIndexingSettings.mockResolvedValue(undefined);
    mocks.checkUpdateOnStartup.mockResolvedValue(null);
    mockInvoke.mockImplementation((command) => {
      if (command === 'get_default_index_folders') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    mockListen.mockImplementation((event, callback) => {
      const registration: ListenerRegistration = {
        event,
        callback,
        unlisten: vi.fn<UnlistenFn>(),
      };
      registrations.push(registration);
      return Promise.resolve(registration.unlisten);
    });
  });

  it('starts after indexing, stops before config restart, and cleans up on unmount', async () => {
    const { unmount } = renderHook(() => useAppLifecycle());

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start_indexing', expect.any(Object));
    });
    expect(mockInvoke).not.toHaveBeenCalledWith('start_file_watcher');

    const initialProgress = registrations.find((entry) => entry.event === 'indexing-progress');
    act(() => {
      emit(initialProgress, {
        phase: 'complete',
        indexedFiles: 12,
        totalFiles: 12,
        isComplete: true,
      });
      emit(initialProgress, {
        phase: 'complete',
        indexedFiles: 12,
        totalFiles: 12,
        isComplete: true,
      });
    });

    await waitFor(() => {
      expect(mockInvoke.mock.calls.filter(([command]) => command === 'start_file_watcher')).toHaveLength(1);
    });

    const settingsListener = registrations.find((entry) => entry.event === 'settings-changed');
    const restartedSettings: Settings = {
      ...settings,
      indexing: { ...settings.indexing, folders: ['D:\\Projects'] },
    };
    act(() => {
      emit(settingsListener, restartedSettings);
    });

    await waitFor(() => {
      expect(mockInvoke.mock.calls.filter(([command]) => command === 'stop_file_watcher')).toHaveLength(1);
      expect(mockInvoke.mock.calls.filter(([command]) => command === 'start_indexing')).toHaveLength(2);
    });

    const restartedProgress = registrations.filter((entry) => entry.event === 'indexing-progress').at(-1);
    act(() => {
      emit(restartedProgress, { phase: 'complete', indexedFiles: 4 });
    });

    await waitFor(() => {
      expect(mockInvoke.mock.calls.filter(([command]) => command === 'start_file_watcher')).toHaveLength(2);
    });

    unmount();

    await waitFor(() => {
      expect(mockInvoke.mock.calls.filter(([command]) => command === 'stop_file_watcher')).toHaveLength(2);
    });
    expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual([
      'start_indexing',
      'start_file_watcher',
      'stop_file_watcher',
      'start_indexing',
      'start_file_watcher',
      'stop_file_watcher',
    ]);
    expect(initialProgress?.unlisten).toHaveBeenCalled();
    expect(restartedProgress?.unlisten).toHaveBeenCalled();
    for (const registration of registrations) {
      expect(registration.unlisten).toHaveBeenCalled();
    }
  });

  it('unlistens a progress listener that resolves after unmount', async () => {
    let resolveProgressListener: ((unlisten: () => void) => void) | undefined;
    const lateUnlisten = vi.fn();
    mockListen.mockImplementation((event, callback) => {
      if (event === 'indexing-progress') {
        return new Promise((resolve) => {
          resolveProgressListener = resolve;
        });
      }
      const registration: ListenerRegistration = {
        event,
        callback,
        unlisten: vi.fn<UnlistenFn>(),
      };
      registrations.push(registration);
      return Promise.resolve(registration.unlisten);
    });

    const { unmount } = renderHook(() => useAppLifecycle());
    await waitFor(() => expect(resolveProgressListener).toBeDefined());

    unmount();
    resolveProgressListener?.(lateUnlisten);

    await waitFor(() => expect(lateUnlisten).toHaveBeenCalled());
    expect(mockInvoke).not.toHaveBeenCalledWith('start_indexing', expect.any(Object));
    expect(mockInvoke).not.toHaveBeenCalledWith('start_file_watcher');
  });
});
