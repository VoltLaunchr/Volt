import { describe, expect, it } from 'vitest';
import { PluginResultType, type PluginResult } from '../features/plugins/types';
import { AppCategory } from '../shared/types/common.types';
import {
  DEFAULT_ROOT_SEARCH_SCOPE,
  filterRootSearchApps,
  filterRootSearchPlugins,
  resolveRootSearchScope,
  shouldSearchFiles,
} from './rootSearchScope';

const everything = DEFAULT_ROOT_SEARCH_SCOPE;
const noFiles = { includeFiles: false, includeGames: true };
const noGames = { includeFiles: true, includeGames: false };

describe('root search scope', () => {
  it('keeps the historical scope when settings are missing or untouched', () => {
    expect(resolveRootSearchScope(undefined)).toEqual(everything);
    expect(resolveRootSearchScope({})).toEqual(everything);
    expect(
      resolveRootSearchScope({ includeFilesInRootSearch: true, includeGamesInRootSearch: true })
    ).toEqual(everything);
  });

  it('reads both switches independently', () => {
    expect(resolveRootSearchScope({ includeFilesInRootSearch: false })).toEqual(noFiles);
    expect(resolveRootSearchScope({ includeGamesInRootSearch: false })).toEqual(noGames);
  });

  it('searches files unless excluded, but always for operator queries', () => {
    expect(shouldSearchFiles(everything, false)).toBe(true);
    expect(shouldSearchFiles(noFiles, false)).toBe(false);
    expect(shouldSearchFiles(noFiles, true)).toBe(true);
  });

  it('removes installed games from app results only when excluded', () => {
    const apps = [
      { category: AppCategory.Gaming, name: 'Hades' },
      { category: AppCategory.Browsers, name: 'Firefox' },
      { category: undefined, name: 'Mystery' },
    ];
    expect(filterRootSearchApps(apps, everything, false)).toHaveLength(3);
    expect(filterRootSearchApps(apps, noGames, false).map((a) => a.name)).toEqual([
      'Firefox',
      'Mystery',
    ]);
    // Explicit browsing of games keeps them.
    expect(filterRootSearchApps(apps, noGames, true)).toHaveLength(3);
  });

  it('keeps explicitly requested game results and drops implicit ones', () => {
    const game = (matchKind?: PluginResult['matchKind']): PluginResult => ({
      id: `game-${matchKind ?? 'implicit'}`,
      type: PluginResultType.Game,
      title: 'Hades',
      score: 90,
      matchKind,
    });
    const other: PluginResult = {
      id: 'calc',
      type: PluginResultType.Calculator,
      title: '4',
      score: 100,
    };
    const input = [game('keyword'), game('prefix'), game(), other];
    expect(filterRootSearchPlugins(input, everything, false)).toHaveLength(4);
    expect(filterRootSearchPlugins(input, noGames, false).map((r) => r.id)).toEqual([
      'game-keyword',
      'game-prefix',
      'calc',
    ]);
    expect(filterRootSearchPlugins(input, noGames, true)).toHaveLength(4);
  });
});
