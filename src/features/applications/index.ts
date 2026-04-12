/**
 * Applications feature barrel export
 * Provides application management functionality for Volt
 */

// Types
export type {
  AppInfo,
  AppLaunchResult,
  ApplicationsState,
  AppSearchOptions,
  AppSortField,
  LaunchOptions,
  LaunchRecord,
  LaunchResult,
  LauncherState,
  ScanStatus,
} from './types';
export { AppCategory, INITIAL_APPLICATIONS_STATE, INITIAL_LAUNCHER_STATE } from './types';

// Services
export { applicationService } from './services/applicationService';
export { launcherService } from './services/launcherService';

// Hooks
export {
  useApplications,
  useApplicationSearch,
  useFrequentApps,
  useLauncher,
  usePinnedApps,
  useRecentApps,
} from './hooks';
export type {
  UseApplicationsReturn,
  UseApplicationSearchOptions,
  UseApplicationSearchReturn,
  UseFrequentAppsOptions,
  UseFrequentAppsReturn,
  UseLauncherReturn,
  UsePinnedAppsReturn,
  UseRecentAppsOptions,
  UseRecentAppsReturn,
} from './hooks';

// Utils
export {
  filterAppsByCategory,
  filterRecentlyUsed,
  formatAppPath,
  getAppNameFromPath,
  getCategoryIcon,
  getCategoryName,
  getRecentApps,
  getTimeSinceLastUsed,
  getTopUsedApps,
  groupAppsByCategory,
  isValidAppPath,
  sortAppsByLastUsed,
  sortAppsByName,
  sortAppsByUsage,
} from './utils/appHelpers';
