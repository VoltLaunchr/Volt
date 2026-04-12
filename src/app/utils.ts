import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { logger } from '../shared/utils/logger';

export const getDirectoryPath = (filePath: string): string => {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSlash === -1) return '.';
  const dirPath = filePath.substring(0, lastSlash);
  return dirPath || '/';
};

export const openSettingsWindow = async (): Promise<void> => {
  const existingWindow = await WebviewWindow.getByLabel('settings');
  if (existingWindow) {
    await existingWindow.show();
    await existingWindow.setFocus();
    return;
  }
  const settingsWindow = new WebviewWindow('settings', {
    url: 'settings.html',
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
  settingsWindow.once('tauri://error', (e) => {
    logger.error('Failed to create settings window:', e);
  });
};
