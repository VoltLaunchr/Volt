import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { logger } from '../shared/utils/logger';

/**
 * Opens (or focuses) the standalone Volt Settings window.
 *
 * Lives outside `App.tsx` so it can be referenced by both the main app
 * and the various hooks (lifecycle event handlers, hotkeys, suggestion
 * actions) without tangling those imports through the component module.
 */
export const openSettingsWindow = async (section?: string): Promise<void> => {
  // Check if window already exists
  const existingWindow = await WebviewWindow.getByLabel('settings');
  if (existingWindow) {
    await existingWindow.show();
    await existingWindow.setFocus();
    if (section) {
      // Window is already open — emit a Tauri event so SettingsApp can switch.
      // The settings window listens via @tauri-apps/api/event.
      const { emit } = await import('@tauri-apps/api/event');
      await emit('volt://settings-navigate', { section });
    }
    return;
  }
  // Create new settings window. We pass the section through the URL hash so
  // SettingsApp can pick it up on first mount before any user interaction.
  const url = section ? `index.html#${encodeURIComponent(section)}` : 'index.html';
  const settingsWindow = new WebviewWindow('settings', {
    url,
    title: 'Volt Settings',
    width: 900,
    height: 600,
    minWidth: 700,
    minHeight: 500,
    resizable: true,
    center: true,
    decorations: false,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    focus: true,
  });
  void settingsWindow.once('tauri://error', (e) => {
    logger.error('Failed to create settings window:', e);
  });
};

/**
 * Opens (or focuses) the standalone System Monitor window.
 */
export const openSystemMonitorWindow = async (): Promise<void> => {
  const existing = await WebviewWindow.getByLabel('system-monitor');
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow('system-monitor', {
    url: 'index.html',
    title: 'Volt System Monitor',
    width: 1060,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    resizable: true,
    center: true,
    decorations: false,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    focus: true,
  });
  void win.once('tauri://error', (e) => {
    logger.error('Failed to create system-monitor window:', e);
  });
};

/** Extracts the parent directory of a path in a cross-platform way. */
export const getDirectoryPath = (filePath: string): string => {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSlash === -1) {
    return '.'; // Current directory if no separator found
  }
  const dirPath = filePath.substring(0, lastSlash);
  return dirPath || '/'; // Return root if empty
};
