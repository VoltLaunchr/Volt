/**
 * Update service for checking and installing app updates.
 *
 * Supports:
 * - Startup throttle (skip if last check was <6h ago)
 * - Periodic background check (every 6h)
 * - "Remind me later" snooze (48h)
 * - "Skip this version" suppression
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

// ── Storage keys ─────────────────────────────────────────────────────────────

const KEY_LAST_CHECK = 'volt:lastUpdateCheckAt';
const KEY_SNOOZED_UNTIL = 'volt:updateSnoozedUntil';
const KEY_SKIPPED_VERSION = 'volt:skippedVersion';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNumber(key: string): number {
  return Number(localStorage.getItem(key) || 0);
}

function getString(key: string): string | null {
  return localStorage.getItem(key);
}

/**
 * Whether the check throttle has expired (>6h since last successful check).
 */
function isThrottleExpired(): boolean {
  const lastCheck = getNumber(KEY_LAST_CHECK);
  return Date.now() - lastCheck >= SIX_HOURS_MS;
}

/**
 * Whether the update toast is currently snoozed.
 */
function isSnoozed(): boolean {
  const until = getNumber(KEY_SNOOZED_UNTIL);
  return until > 0 && Date.now() < until;
}

/**
 * Whether a specific version has been skipped by the user.
 */
function isVersionSkipped(version: string): boolean {
  return getString(KEY_SKIPPED_VERSION) === version;
}

function recordCheckTimestamp(): void {
  localStorage.setItem(KEY_LAST_CHECK, String(Date.now()));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Snooze the update toast for 48 hours.
 */
export function snoozeUpdate(): void {
  localStorage.setItem(KEY_SNOOZED_UNTIL, String(Date.now() + FORTY_EIGHT_HOURS_MS));
}

/**
 * Skip a specific version (suppress toast until a newer version is published).
 */
export function skipVersion(version: string): void {
  localStorage.setItem(KEY_SKIPPED_VERSION, version);
}

/**
 * Check for available updates (raw, no throttle/snooze).
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
    console.debug('Update check skipped:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Download and install an update.
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
        onProgress?.({ downloaded, total, percentage });
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
 * Throttled update check. Returns update info only if:
 * 1. Enough time has passed since the last check (6h)
 * 2. The user hasn't snoozed the toast
 * 3. The user hasn't skipped this version
 */
export async function checkUpdateThrottled(): Promise<UpdateInfo | null> {
  if (!isThrottleExpired()) return null;

  const update = await checkForUpdate();
  recordCheckTimestamp();

  if (!update) return null;
  if (isSnoozed()) return null;
  if (isVersionSkipped(update.version)) return null;

  return update;
}

/**
 * Check for updates silently on startup.
 * Respects throttle, snooze, and skip-version.
 */
export async function checkUpdateOnStartup(): Promise<UpdateInfo | null> {
  try {
    const update = await checkUpdateThrottled();
    if (update) {
      console.log(`Update available: v${update.version}`);
    }
    return update;
  } catch (error) {
    console.debug('Update check failed:', error);
    return null;
  }
}

// ── Periodic check ───────────────────────────────────────────────────────────

let periodicInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic background update check (every 6h).
 * Call `stopPeriodicCheck()` to clear.
 */
export function startPeriodicCheck(onUpdate: (info: UpdateInfo) => void): void {
  stopPeriodicCheck();
  periodicInterval = setInterval(async () => {
    const update = await checkUpdateThrottled();
    if (update) onUpdate(update);
  }, SIX_HOURS_MS);
}

/**
 * Stop the periodic background update check.
 */
export function stopPeriodicCheck(): void {
  if (periodicInterval) {
    clearInterval(periodicInterval);
    periodicInterval = null;
  }
}

export const updateService = {
  checkForUpdate,
  downloadAndInstall,
  checkUpdateOnStartup,
  checkUpdateThrottled,
  snoozeUpdate,
  skipVersion,
  startPeriodicCheck,
  stopPeriodicCheck,
};

export default updateService;
