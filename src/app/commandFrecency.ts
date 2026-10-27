import { invoke } from '@tauri-apps/api/core';
import { logger } from '../shared/utils/logger';

/**
 * Frontend cache of the universal frecency of non-application results
 * (`identity → frecencyDate`, see `LaunchHistory::command_frecency` in
 * `src-tauri/src/launcher/history.rs`).
 *
 * Plugin commands are produced in the renderer, so ranking them must not cost
 * an IPC round trip per keystroke: the map (bounded to 500 entries in Rust) is
 * loaded when the search pipeline mounts, refreshed when the query is
 * cleared, and updated in place with the date returned by every
 * `record_command_usage` call.
 */
const frecencyByIdentity = new Map<string, number>();
/** Only the latest refresh may replace the cache. */
let refreshGeneration = 0;
/** Bumped on every local update so an in-flight refresh cannot erase it. */
let localUpdates = 0;

function isFrecencyMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reload the cache from Rust. Never throws. */
export async function refreshCommandFrecency(): Promise<void> {
  refreshGeneration += 1;
  const generation = refreshGeneration;
  const updatesAtStart = localUpdates;

  let loaded: unknown;
  try {
    loaded = await invoke<Record<string, number>>('get_command_frecency');
  } catch (err) {
    logger.warn('Failed to load command frecency:', err);
    return;
  }
  if (generation !== refreshGeneration || !isFrecencyMap(loaded)) return;

  const fresh = new Map<string, number>();
  for (const [identity, date] of Object.entries(loaded)) {
    if (typeof date === 'number' && Number.isFinite(date) && date >= 0) {
      fresh.set(identity, date);
    }
  }
  if (updatesAtStart !== localUpdates) {
    // A usage was recorded while loading: keep the newer local dates.
    for (const [identity, date] of frecencyByIdentity) {
      fresh.set(identity, Math.max(date, fresh.get(identity) ?? 0));
    }
  }
  frecencyByIdentity.clear();
  for (const [identity, date] of fresh) frecencyByIdentity.set(identity, date);
}

/** Frecency date (ms) of a stable result identity; `0` when never used. */
export function getCommandFrecency(identity: string | null): number {
  return identity ? (frecencyByIdentity.get(identity) ?? 0) : 0;
}

/**
 * Record one execution of a non-application result (fire-and-forget).
 * Applications are recorded by `launch_app` and files by `track_file_access`.
 */
export function recordCommandUsage(identity: string, title: string): void {
  invoke<number>('record_command_usage', { identity, title })
    .then((date) => {
      if (typeof date !== 'number' || !Number.isFinite(date) || date < 0) return;
      localUpdates += 1;
      frecencyByIdentity.set(identity, Math.max(date, frecencyByIdentity.get(identity) ?? 0));
    })
    .catch((err) => {
      logger.error('Failed to record command usage:', err);
    });
}
