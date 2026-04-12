/**
 * Hooks barrel export for applications feature
 */

export { useApplications } from './useApplications';
export type { UseApplicationsReturn } from './useApplications';

export { useApplicationSearch } from './useApplicationSearch';
export type {
  UseApplicationSearchOptions,
  UseApplicationSearchReturn,
} from './useApplicationSearch';

export { useLauncher } from './useLauncher';
export type { UseLauncherReturn } from './useLauncher';

export { useRecentApps } from './useRecentApps';
export type { UseRecentAppsOptions, UseRecentAppsReturn } from './useRecentApps';

export { useFrequentApps } from './useFrequentApps';
export type { UseFrequentAppsOptions, UseFrequentAppsReturn } from './useFrequentApps';

export { usePinnedApps } from './usePinnedApps';
export type { UsePinnedAppsReturn } from './usePinnedApps';
