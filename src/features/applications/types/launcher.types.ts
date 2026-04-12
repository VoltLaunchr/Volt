/**
 * Launcher types for the frontend
 * These types mirror the Rust backend launcher types
 */

/**
 * A launch record tracking app usage history
 */
export interface LaunchRecord {
  /** Application path */
  path: string;
  /** Application name */
  name: string;
  /** Total number of launches */
  launchCount: number;
  /** Timestamp of first launch (ms) */
  firstLaunched: number;
  /** Timestamp of most recent launch (ms) */
  lastLaunched: number;
  /** Total time spent in app in ms (if tracked) */
  totalTimeMs?: number;
  /** Tags/categories assigned by user */
  tags: string[];
  /** Whether this app is pinned/favorited */
  pinned: boolean;
}

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
