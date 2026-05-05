import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { logger } from '../shared/utils/logger';

/**
 * Opens (or focuses) the standalone Volt Settings window.
 *
 * Lives outside `App.tsx` so it can be referenced by both the main app
 * and the various hooks (lifecycle event handlers, hotkeys, suggestion
 * actions) without tangling those imports through the component module.
 */
export const openSettingsWindow = async (): Promise<void> => {
  // Check if window already exists
  const existingWindow = await WebviewWindow.getByLabel('settings');
  if (existingWindow) {
    await existingWindow.show();
    await existingWindow.setFocus();
    return;
  }
  // Create new settings window
  const settingsWindow = new WebviewWindow('settings', {
    url: 'index.html',
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
