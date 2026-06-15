/**
 * Launcher types for the frontend
 * These types mirror the Rust backend launcher types
 */

// `LaunchRecord` is the single source of truth generated from the Rust struct
// by ts-rs (run `cargo test`); imported for local use and re-exported so
// existing imports keep working. Change the shape in
// src-tauri/src/launcher/history.rs, not here.
import type { LaunchRecord } from '../../../shared/types/generated/LaunchRecord';
export type { LaunchRecord };

/**
 * Options for launching an application
 */
export interface LaunchOptions {
  /** Working directory for the launched process */
  workingDir?: string;
  /** Command line arguments to pass */
  args?: string[];
  /** Environment variables to set */
  env?: Array<[string, string]>;
  /** Run as administrator (Windows) */
  elevated?: boolean;
  /** Hide the window */
  hidden?: boolean;
  /** Wait for process to exit */
  wait?: boolean;
  /** Track in history */
  trackHistory?: boolean;
}

/**
 * Result of a launch operation
 */
export interface LaunchResult {
  /** Path of launched application */
  path: string;
  /** Process ID if available */
  pid?: number;
  /** Timestamp when launched */
  launchedAt: number;
  /** Exit code if wait was true */
  exitCode?: number;
  /** Elapsed time if wait was true */
  elapsedMs?: number;
}

/**
 * State for launcher feature
 */
export interface LauncherState {
  /** Recent apps list */
  recentApps: LaunchRecord[];
  /** Frequently used apps */
  frequentApps: LaunchRecord[];
  /** Pinned/favorite apps */
  pinnedApps: LaunchRecord[];
  /** All available tags */
  tags: string[];
  /** Whether data is loading */
  isLoading: boolean;
  /** Error if any */
  error: string | null;
}

/**
 * Initial launcher state
 */
export const INITIAL_LAUNCHER_STATE: LauncherState = {
  recentApps: [],
  frequentApps: [],
  pinnedApps: [],
  tags: [],
  isLoading: false,
  error: null,
};
