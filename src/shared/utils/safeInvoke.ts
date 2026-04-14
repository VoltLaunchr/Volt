import { invoke } from '@tauri-apps/api/core';
import { logger } from './logger';

/**
 * Safe Tauri invoke wrapper with automatic error logging.
 *
 * Replaces .catch(() => {}) patterns with properly logged errors.
 * Returns null on failure, making it safe for chaining and fallbacks.
 *
 * @template T - The return type of the Tauri command
 * @param command - Tauri command name
 * @param args - Command arguments
 * @param context - Optional context label for logs (defaults to command name)
 * @returns Promise resolving to T on success, null on failure
 *
 * @example
 * // Simple invoke with logging on error
 * const result = await safeInvoke<LaunchRecord[]>(
 *   'get_frecency_suggestions',
 *   { limit: 5 },
 *   'frecency-suggestions'
 * );
 * if (result) { ... }
 *
 * @example
 * // With fallback
 * const data = await safeInvoke<FileInfo[]>(
 *   'search_files',
 *   { query: 'test' }
 * ) ?? [];
 */
export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  context?: string
): Promise<T | null> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const label = context || command;
    logger.warn(`[${label}] Invoke failed: ${msg}`);
    return null;
  }
}
