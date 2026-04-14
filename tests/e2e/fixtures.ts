import { test as base, expect } from '@playwright/test';

/**
 * Mock Settings matching the real Settings type from settings.types.ts
 */
export const MOCK_SETTINGS = {
  general: {
    startWithWindows: false,
    maxResults: 8,
    closeOnLaunch: true,
    hasSeenOnboarding: true,
    language: 'en',
    featurePreview: false,
    searchSensitivity: 'medium',
    showOnScreen: 'cursor',
  },
  appearance: {
    theme: 'dark',
    transparency: 0.85,
    windowPosition: 'center',
  },
  hotkeys: {
    toggleWindow: 'Ctrl+Space',
    openSettings: 'Ctrl+,',
  },
  indexing: {
    folders: [],
    excludedPaths: [],
    fileExtensions: [],
    indexOnStartup: false,
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
    clipboardMonitoring: false,
  },
  shortcuts: {
    appShortcuts: [],
  },
  integrations: {
    github: { token: '', enabled: false },
    notion: { token: '', enabled: false },
  },
};

export const mockApps = (count = 5) =>
  Array.from({ length: count }, (_, i) => ({
    id: `app-${i}`,
    name: `Test App ${i + 1}`,
    path: `C:\\Program Files\\App${i + 1}\\app${i + 1}.exe`,
    icon: null,
    launch_count: 0,
    last_launched: null,
    is_pinned: false,
    source: 'StartMenu',
    score: 100 - i * 5,
  }));

/**
 * Injects a complete Tauri IPC mock into the page via addInitScript.
 * Must be called BEFORE page.goto('/').
 *
 * @param page - Playwright page
 * @param searchApps - Apps to return from scan_applications and search_streaming
 */
export async function injectTauriMock(
  page: import('@playwright/test').Page,
  searchApps: Array<Record<string, unknown>> = [],
) {
  await page.addInitScript(
    ({ settings, apps }) => {
      (window as any).__TAURI_INVOKE_CALLS__ = [];
      const CALLBACKS: Record<number, Function> = {};
      let cbCounter = 0;

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          (window as any).__TAURI_INVOKE_CALLS__.push({ cmd, args });

          // Tauri v2 internal plugin commands
          if (typeof cmd === 'string' && cmd.startsWith('plugin:')) {
            if (cmd === 'plugin:event|listen') return cbCounter++;
            if (cmd === 'plugin:event|unlisten') return null;
            return null;
          }

          // search_streaming: simulate Tauri Channel streaming
          if (cmd === 'search_streaming') {
            const channel = args?.onEvent;
            const channelId = typeof channel === 'object' ? channel?.id : channel;
            const cb = channelId != null ? CALLBACKS[channelId] : null;

            if (cb && apps.length > 0) {
              // Send data through Channel BEFORE resolving the invoke promise.
              // Tauri Channel uses indexed messages: { index: N, message: T }
              return new Promise((resolve) => {
                setTimeout(() => {
                  cb({ index: 0, message: { event: 'apps', data: { results: apps } } });
                  cb({ index: 1, message: { event: 'done' } });
                  cb({ index: 2, end: true });
                  resolve(null);
                }, 10);
              });
            }
            return null;
          }

          // Standard command handlers
          const handlers: Record<string, any> = {
            'load_settings': settings,
            'save_settings': null,
            'update_general_settings': settings,
            'update_appearance_settings': settings,
            'update_hotkey_settings': settings,
            'update_indexing_settings': settings,
            'update_plugin_settings': settings,
            'get_theme': 'dark',
            'set_theme': null,
            'scan_applications': apps,
            'search_applications': apps,
            'search_applications_frecency': apps,
            'get_app_icon': null,
            'search_files': [],
            'get_launch_history': [],
            'get_pinned_apps': [],
            'get_frecency_scores': {},
            'get_frecency_suggestions': [],
            'launch_application': null,
            'record_launch': null,
            'record_search_selection': null,
            'track_file_access': null,
            'start_indexing': null,
            'stop_indexing': null,
            'get_default_index_folders': [],
            'get_indexing_status': { isIndexing: false, filesIndexed: 0 },
            'get_clipboard_history': [],
            'start_clipboard_monitoring': null,
            'stop_clipboard_monitoring': null,
            'get_quick_links': [],
            'get_quicklinks': [],
            'get_snippets': [],
            'log_from_frontend': null,
            'hide_window': null,
            'show_window': null,
            'resize_window': null,
            'set_window_size': null,
            'get_window_position': { x: 0, y: 0 },
            'get_system_info': { cpu: 0, memory: 0, disk: 0 },
            'get_enabled_extensions_sources': [],
            'get_steam_games': [],
          };

          if (cmd in handlers) return handlers[cmd];
          console.warn('[TauriMock] Unknown command:', cmd);
          return null;
        },

        transformCallback: (callback: Function, once?: boolean) => {
          const id = cbCounter++;
          CALLBACKS[id] = callback;
          (window as any)['_' + id] = callback;
          return id;
        },

        unregisterCallback: (id: number) => {
          delete CALLBACKS[id];
          delete (window as any)['_' + id];
        },

        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main' },
        },

        convertFileSrc: (path: string) => {
          return 'https://asset.localhost/' + encodeURIComponent(path);
        },
      };
    },
    { settings: MOCK_SETTINGS, apps: searchApps },
  );
}

// Re-export base test and expect (no auto fixture - each test injects its own mock)
export const test = base;
export { expect };
