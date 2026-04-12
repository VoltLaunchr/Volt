/**
 * Application types for the applications feature
 * Re-exports common types and adds feature-specific types
 */

// Re-export from shared types
export { AppCategory } from '../../../shared/types/common.types';
export type { AppInfo } from '../../../shared/types/common.types';

/**
 * Options for searching applications
 */
export interface AppSearchOptions {
  /** Search query string */
  query: string;
  /** Maximum number of results to return */
  limit?: number;
  /** Sort results by specific field */
  sortBy?: AppSortField;
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
  /** Filter by category */
  category?: string;
}

/**
 * Fields available for sorting applications
 */
export type AppSortField = 'name' | 'lastUsed' | 'usageCount' | 'score';

/**
 * Result of launching an application
 */
export interface AppLaunchResult {
  /** Whether the launch was successful */
  success: boolean;
  /** Error message if launch failed */
  error?: string;
  /** Path of the launched application */
  path: string;
  /** Timestamp of launch */
  launchedAt: number;
}

/**
 * Status of the application scanning process
 */
export interface ScanStatus {
  /** Whether scanning is in progress */
  isScanning: boolean;
  /** Progress percentage (0-100) */
  progress: number;
  /** Number of apps found so far */
  appsFound: number;
  /** Error if scan failed */
  error?: string;
  /** Timestamp when scan started */
  startedAt?: number;
  /** Timestamp when scan completed */
  completedAt?: number;
}

/**
 * State for the applications feature
 */
export interface ApplicationsState {
  /** All loaded applications */
  apps: import('../../../shared/types/common.types').AppInfo[];
  /** Whether apps are currently loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Current scan status */
  scanStatus: ScanStatus;
  /** Last time apps were refreshed */
  lastRefresh: number | null;
}

/**
 * Initial state for applications
 */
export const INITIAL_APPLICATIONS_STATE: ApplicationsState = {
  apps: [],
  isLoading: false,
  error: null,
  scanStatus: {
    isScanning: false,
    progress: 0,
    appsFound: 0,
  },
  lastRefresh: null,
};

// Re-export launcher types
export type { LaunchRecord, LaunchOptions, LaunchResult, LauncherState } from './launcher.types';
export { INITIAL_LAUNCHER_STATE } from './launcher.types';
