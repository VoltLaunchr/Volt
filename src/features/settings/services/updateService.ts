/**
 * Update service for checking and installing app updates.
 *
 * Palier 1 features (shipped):
 * - Startup throttle (skip if last check was <6h ago)
 * - Periodic background check (every 6h)
 * - "Remind me later" snooze (48h)
 * - "Skip this version" suppression
 *
 * Palier 2 features (this file):
 * - Update channels: stable (Tauri-managed) or beta (manual manifest fetch)
 * - Critical-update flag: read from `latest.json` rawJson, shows non-dismissable toast
 * - Deferred install: download now, install + relaunch on next app close
 */

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { logger } from '../../../shared/utils/logger';

export type UpdateChannel = 'stable' | 'beta';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  /** True when `latest.json` contains `"critical": true`. Non-dismissable toast. */
  critical?: boolean;
  /** True when this update came from the beta manifest (manual fetch). */
  isBeta?: boolean;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export type UpdateCallback = (progress: UpdateProgress) => void;

// ── Endpoints ────────────────────────────────────────────────────────────────

const ENDPOINT_BETA =
  'https://github.com/VoltLaunchr/Volt/releases/latest/download/latest-beta.json';

// ── Storage keys ─────────────────────────────────────────────────────────────

const KEY_LAST_CHECK = 'volt:lastUpdateCheckAt';
const KEY_SNOOZED_UNTIL = 'volt:updateSnoozedUntil';
const KEY_SKIPPED_VERSION = 'volt:skippedVersion';
/** Persists the version string of a downloaded-but-not-yet-installed update. */
const KEY_PENDING_UPDATE = 'volt:pendingUpdateVersion';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

// ── In-memory deferred update reference ──────────────────────────────────────

/**
 * Holds the Tauri `Update` resource after `deferredInstall()` downloads it.
 * Must stay alive until `installPendingUpdate()` is called on app close.
 * Not persisted across restarts — if the app exits without installing,
 * `KEY_PENDING_UPDATE` will be stale and `installPendingUpdate()` will clear it.
 */
let _pendingUpdate: Update | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNumber(key: string): number {
  return Number(localStorage.getItem(key) || 0);
}

function getString(key: string): string | null {
  return localStorage.getItem(key);
}

function isThrottleExpired(): boolean {
  const lastCheck = getNumber(KEY_LAST_CHECK);
  return Date.now() - lastCheck >= SIX_HOURS_MS;
}

function isSnoozed(): boolean {
  const until = getNumber(KEY_SNOOZED_UNTIL);
  return until > 0 && Date.now() < until;
}

function isVersionSkipped(version: string): boolean {
  return getString(KEY_SKIPPED_VERSION) === version;
}

function recordCheckTimestamp(): void {
  localStorage.setItem(KEY_LAST_CHECK, String(Date.now()));
}

/**
 * Naive semver comparison. Returns true if `candidate` is strictly newer
 * than `current`. Pre-release suffixes (e.g. `-beta.1`) are stripped before
 * comparison — a pre-release is considered equal to its base version for the
 * purpose of the "is newer" check.
 */
function isNewerVersion(candidate: string, current: string): boolean {
  const strip = (v: string) => v.replace(/-.*$/, '').split('.').map(Number);
  const a = strip(candidate);
  const b = strip(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// ── Beta manifest fetch ───────────────────────────────────────────────────────

interface BetaManifest {
  version?: string;
  pub_date?: string;
  notes?: string;
  critical?: boolean;
}

async function checkBetaUpdate(): Promise<UpdateInfo | null> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    const [currentVersion, resp] = await Promise.all([
      getVersion(),
      fetch(ENDPOINT_BETA, { cache: 'no-cache' }),
    ]);

    if (!resp.ok) return null;
    const manifest = (await resp.json()) as BetaManifest;

    if (!manifest.version) return null;
    if (!isNewerVersion(manifest.version, currentVersion)) return null;

    return {
      version: manifest.version,
      currentVersion,
      date: manifest.pub_date,
      body: manifest.notes,
      critical: manifest.critical === true,
      isBeta: true,
    };
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function snoozeUpdate(): void {
  localStorage.setItem(KEY_SNOOZED_UNTIL, String(Date.now() + FORTY_EIGHT_HOURS_MS));
}

export function skipVersion(version: string): void {
  localStorage.setItem(KEY_SKIPPED_VERSION, version);
}

/** True when a deferred update has been downloaded and is awaiting install. */
export function hasPendingUpdate(): boolean {
  return localStorage.getItem(KEY_PENDING_UPDATE) !== null;
}

/** Clears the pending update flag and drops the in-memory Update resource. */
export function clearPendingUpdate(): void {
  localStorage.removeItem(KEY_PENDING_UPDATE);
  _pendingUpdate = null;
}

/**
 * Check for an available update.
 * - `stable` (default): uses the Tauri-configured endpoint; reads `critical`
 *   from `rawJson` so the manifest can flag security releases.
 * - `beta`: manually fetches `latest-beta.json` and compares versions.
 */
export async function checkForUpdate(channel: UpdateChannel = 'stable'): Promise<UpdateInfo | null> {
  try {
    if (channel === 'beta') {
      return await checkBetaUpdate();
    }

    const update = await check();
    if (!update) return null;

    return {
      version: update.version,
      currentVersion: update.currentVersion,
      date: update.date,
      body: update.body,
      critical: update.rawJson['critical'] === true,
    };
  } catch (error) {
    logger.debug('Update check skipped:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Download and install immediately, then relaunch.
 * Only works for the stable channel (Tauri-managed installer).
 * Beta updates show a GitHub link instead.
 */
export async function downloadAndInstall(onProgress?: UpdateCallback): Promise<void> {
  try {
    const update = await check();
    if (!update) throw new Error('No update available');

    let downloaded = 0;
    let total = 0;

    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        const percentage = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        onProgress?.({ downloaded, total, percentage });
      }
    });

    await relaunch();
  } catch (error) {
    logger.error('Failed to download/install update:', error);
    throw error;
  }
}

/**
 * Download the update now, store it, and relaunch on next app close.
 * Call `installPendingUpdate()` from the `CloseRequested` handler.
 */
export async function deferredInstall(onProgress?: UpdateCallback): Promise<void> {
  const update = await check();
  if (!update) throw new Error('No update available');

  let downloaded = 0;
  let total = 0;

  await update.download((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0;
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      const percentage = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      onProgress?.({ downloaded, total, percentage });
    }
  });

  _pendingUpdate = update;
  localStorage.setItem(KEY_PENDING_UPDATE, update.version);
}

/**
 * Apply a previously-downloaded update and relaunch.
 * Called from the `CloseRequested` window event handler in App.tsx.
 * If the in-memory reference was lost (app restarted), clears the stale flag.
 */
export async function installPendingUpdate(): Promise<void> {
  if (!_pendingUpdate) {
    clearPendingUpdate();
    throw new Error('Downloaded update not in memory — restart required to retry');
  }
  await _pendingUpdate.install();
  clearPendingUpdate();
  await relaunch();
}

/**
 * Throttled update check. Returns update info only when:
 * 1. >6h have passed since the last check
 * 2. User has not snoozed the toast
 * 3. User has not skipped this version
 */
export async function checkUpdateThrottled(
  channel: UpdateChannel = 'stable'
): Promise<UpdateInfo | null> {
  if (!isThrottleExpired()) return null;

  const update = await checkForUpdate(channel);
  recordCheckTimestamp();

  if (!update) return null;
  if (isSnoozed()) return null;
  if (isVersionSkipped(update.version)) return null;

  return update;
}

export async function checkUpdateOnStartup(
  channel: UpdateChannel = 'stable'
): Promise<UpdateInfo | null> {
  try {
    const update = await checkUpdateThrottled(channel);
    if (update) logger.info(`Update available: v${update.version}`);
    return update;
  } catch (error) {
    logger.debug('Update check failed:', error);
    return null;
  }
}

// ── Periodic check ───────────────────────────────────────────────────────────

let periodicInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicCheck(
  onUpdate: (info: UpdateInfo) => void,
  channel: UpdateChannel = 'stable'
): void {
  stopPeriodicCheck();
  periodicInterval = setInterval(() => {
    void (async () => {
      const update = await checkUpdateThrottled(channel);
      if (update) onUpdate(update);
    })();
  }, SIX_HOURS_MS);
}

export function stopPeriodicCheck(): void {
  if (periodicInterval) {
    clearInterval(periodicInterval);
    periodicInterval = null;
  }
}

export const updateService = {
  checkForUpdate,
  downloadAndInstall,
  deferredInstall,
  installPendingUpdate,
  hasPendingUpdate,
  clearPendingUpdate,
  checkUpdateOnStartup,
  checkUpdateThrottled,
  snoozeUpdate,
  skipVersion,
  startPeriodicCheck,
  stopPeriodicCheck,
};

export default updateService;
