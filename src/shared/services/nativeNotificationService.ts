import { logger } from '../utils/logger';
import { invoke } from '@tauri-apps/api/core';

export interface NativeNotificationOptions {
  title: string;
  body?: string;
}

let permissionPromise: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permissionPromise) return permissionPromise;

  permissionPromise = (async () => {
    try {
      const { isPermissionGranted, requestPermission } =
        await import('@tauri-apps/plugin-notification');

      if (await isPermissionGranted()) {
        return true;
      }

      return (await requestPermission()) === 'granted';
    } catch (err) {
      logger.warn('Native notification permission check failed:', err);
      return false;
    }
  })();

  return permissionPromise;
}

export async function notifyNative({ title, body }: NativeNotificationOptions): Promise<boolean> {
  try {
    if (!(await ensurePermission())) {
      return false;
    }

    try {
      await invoke('send_native_notification', { payload: { title, body } });
      return true;
    } catch (err) {
      logger.warn('Volt native notification command failed, falling back to plugin:', err);
    }

    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    sendNotification(body ? { title, body } : { title });
    return true;
  } catch (err) {
    logger.warn('Native notification failed:', err);
    return false;
  }
}
