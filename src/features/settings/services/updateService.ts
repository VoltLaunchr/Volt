/**
 * Update service for checking and installing app updates
 */

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { logger } from '../../../shared/utils/logger';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export type UpdateCallback = (progress: UpdateProgress) => void;

/**
 * Check for available updates
 * @returns Update info if available, null otherwise
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();

    if (update) {
      return {
        version: update.version,
        currentVersion: update.currentVersion,
        date: update.date,
        body: update.body,
      };
    }

    return null;
  } catch (error) {
    // Use debug level - this is expected to fail in development or when no releases exist
    console.debug('Update check skipped:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Download and install an update
 * @param onProgress - Callback for download progress
 */
export async function downloadAndInstall(onProgress?: UpdateCallback): Promise<void> {
  try {
    const update = await check();

    if (!update) {
      throw new Error('No update available');
    }

    let downloaded = 0;
    let total = 0;

    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength || 0;
        console.log(`Update download started: ${total} bytes`);
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        const percentage = total > 0 ? Math.round((downloaded / total) * 100) : 0;

        if (onProgress) {
          onProgress({ downloaded, total, percentage });
        }

        console.log(`Download progress: ${percentage}%`);
      } else if (event.event === 'Finished') {
        console.log('Update download finished');
      }
    });

    console.log('Update installed, restarting...');
    await relaunch();
  } catch (error) {
    logger.error('Failed to download/install update:', error);
    throw error;
  }
}

/**
 * Check for updates silently on startup
 * Shows notification if update available
 */
export async function checkUpdateOnStartup(): Promise<UpdateInfo | null> {
  try {
    const update = await checkForUpdate();

    if (update) {
      console.log(`Update available: v${update.version}`);

      // Show system notification (best-effort)
      if ('Notification' in window) {
        if (Notification.permission === 'default') {
          try {
            await Notification.requestPermission();
          } catch {
            // ignore
          }
        }

        if (Notification.permission === 'granted') {
          new Notification('Volt Update Available', {
            body: `Version ${update.version} is available.`,
            icon: '/icon.png',
            tag: 'volt-update',
          });
        }
      }
    }

    return update;
  } catch (error) {
    // Silently fail on startup check
    console.debug('Update check failed:', error);
    return null;
  }
}

export const updateService = {
  checkForUpdate,
  downloadAndInstall,
  checkUpdateOnStartup,
};

export default updateService;
