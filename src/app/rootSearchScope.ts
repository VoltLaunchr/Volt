import type { PluginResult } from '../features/plugins/types';
import { PluginResultType } from '../features/plugins/types';
import { AppCategory, type AppInfo } from '../shared/types/common.types';
import { isExplicitActivation } from './searchRanking';

/** What the root search bar may surface (Settings -> Launcher). */
export interface RootSearchScope {
  includeFiles: boolean;
  includeGames: boolean;
}

export const DEFAULT_ROOT_SEARCH_SCOPE: RootSearchScope = {
  includeFiles: true,
  includeGames: true,
};

/** Reads the scope from persisted settings; a missing value keeps the historical "everything". */
export function resolveRootSearchScope(
  launcher: { includeFilesInRootSearch?: boolean; includeGamesInRootSearch?: boolean } | undefined
): RootSearchScope {
  return {
    includeFiles: launcher?.includeFilesInRootSearch !== false,
    includeGames: launcher?.includeGamesInRootSearch !== false,
  };
}

/**
 * Whether the file index is searched. Operators (`ext:`, `in:`, `size:`, `modified:`) are an
 * explicit request for files and always search them.
 */
export function shouldSearchFiles(scope: RootSearchScope, hasFileOperators: boolean): boolean {
  return scope.includeFiles || hasFileOperators;
}

/**
 * Drops installed games from the application results when games are excluded from the root
 * search. Browsing games explicitly (`games`, `jeux`) keeps them.
 */
export function filterRootSearchApps<T extends Pick<AppInfo, 'category'>>(
  apps: readonly T[],
  scope: RootSearchScope,
  gameBrowse: boolean
): T[] {
  if (scope.includeGames || gameBrowse) return [...apps];
  return apps.filter((app) => app.category !== AppCategory.Gaming);
}

/**
 * Drops game results that no activation prefix / keyword asked for when games are excluded from
 * the root search. `game <name>`, `play <name>` and game browsing still answer.
 */
export function filterRootSearchPlugins(
  results: readonly PluginResult[],
  scope: RootSearchScope,
  gameBrowse: boolean
): PluginResult[] {
  if (scope.includeGames || gameBrowse) return [...results];
  return results.filter(
    (result) => result.type !== PluginResultType.Game || isExplicitActivation(result)
  );
}
