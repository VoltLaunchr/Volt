import { describe, expect, it } from 'vitest';
import { PluginResultType, type PluginResult } from '../features/plugins/types';
import {
  SearchResultType,
  type ResultRank,
  type SearchResult,
  type SearchTier,
} from '../shared/types/common.types';
import { SEARCH_TIER_ORDER } from '../shared/types/generated/searchTierOrder';
import {
  bandRank,
  compareResults,
  isTierAtLeast,
  matchText,
  rankCommand,
  rankPluginResult,
  strongestTier,
} from './searchRanking';
import { mergeSearchResults } from './searchResults';

function app(id: string, tier: SearchTier, quality: number, frecency = 0): SearchResult {
  return {
    id,
    type: SearchResultType.Application,
    title: id,
    score: quality,
    data: { id, name: id, path: `C:\\Apps\\${id}.exe`, usageCount: 0 },
    rank: { band: 'ranked', tier, quality, frecency, source: 'app', declared: 0 },
  };
}

function withRank(id: string, rank: ResultRank, type = SearchResultType.Plugin): SearchResult {
  return {
    id,
    type,
    title: id,
    score: rank.declared,
    data: { id, type: 'info', title: id, score: rank.declared },
    rank,
  };
}

function plugin(overrides: Partial<PluginResult>): PluginResult {
  return {
    id: 'cmd',
    type: PluginResultType.SystemCommand,
    title: 'Command',
    score: 90,
    pluginId: 'systemcommands',
    matchKind: 'none',
    ...overrides,
  };
}

const noLearned = new Map<string, SearchTier>();

function order(...results: SearchResult[]): string[] {
  return [...results].sort(compareResults).map((result) => result.id);
}

describe('generated tier ladder', () => {
  it('is read from Rust, strongest first', () => {
    expect(SEARCH_TIER_ORDER[0]).toBe('aliasExact');
    expect(SEARCH_TIER_ORDER.at(-1)).toBe('filePathOnly');
    expect(isTierAtLeast('learnedExact', 'titleExact')).toBe(true);
    expect(isTierAtLeast('secondary', 'fuzzy')).toBe(false);
    expect(strongestTier('fuzzy', 'learnedExact')).toBe('learnedExact');
  });
});

describe('matchText', () => {
  it('mirrors the Rust exact / prefix / fuzzy scale', () => {
    expect(matchText('Open Settings', 'open settings')).toEqual({ kind: 'exact', quality: 100 });
    expect(matchText('Left Half', 'left')).toEqual({ kind: 'prefix', quality: 90 });
    const wordStart = matchText('Open Settings', 'sett');
    const midWord = matchText('Reset', 'set');
    const scattered = matchText('Window Manager', 'wmg');
    expect(wordStart?.kind).toBe('fuzzy');
    expect(midWord?.kind).toBe('fuzzy');
    expect(scattered?.kind).toBe('fuzzy');
    for (const match of [wordStart, midWord, scattered]) {
      expect(match?.quality).toBeGreaterThanOrEqual(50);
      expect(match?.quality).toBeLessThanOrEqual(89);
    }
    expect(matchText('Quit Volt', 'zz')).toBeNull();
  });
});

describe('rankCommand', () => {
  const base = { query: 'settings', activated: false, frecency: 0, declared: 90 };

  it('places plugin titles on the app cascade', () => {
    expect(rankCommand({ ...base, title: 'Settings' }).tier).toBe('titleExact');
    expect(rankCommand({ ...base, title: 'Settings Sync' }).tier).toBe('titlePrefix');
    expect(rankCommand({ ...base, title: 'Open Settings' }).tier).toBe('fuzzy');
    expect(rankCommand({ ...base, title: 'Open Settings', activated: true }).tier).toBe(
      'activation'
    );
    expect(rankCommand({ ...base, title: 'Preferences', subtitle: 'Volt settings' }).tier).toBe(
      'secondary'
    );
  });

  it('lets a learned binding promote, never demote', () => {
    expect(rankCommand({ ...base, title: 'Open Settings', learned: 'learnedExact' }).tier).toBe(
      'learnedExact'
    );
    expect(rankCommand({ ...base, title: 'Settings', learned: 'aliasPrefix' }).tier).toBe(
      'titleExact'
    );
  });
});

describe('compareResults', () => {
  it('ranks an alias exact above every other ranked tier', () => {
    expect(
      order(
        app('title-exact', 'titleExact', 100, Date.now() + 1e9),
        app('learned', 'learnedExact', 60),
        app('alias', 'aliasExact', 100)
      )
    ).toEqual(['alias', 'learned', 'title-exact']);
  });

  it('ranks a learned exact binding above a title exact', () => {
    const learnedCommand = withRank(
      'learned-cmd',
      rankCommand({
        title: 'Open Settings',
        query: 'set',
        activated: false,
        learned: 'learnedExact',
        frecency: 0,
        declared: 80,
      })
    );
    expect(order(app('set', 'titleExact', 100), learnedCommand)).toEqual(['learned-cmd', 'set']);
  });

  it('ranks a plugin command with an exact title above a fuzzy app', () => {
    const command = withRank(
      'Left Half',
      rankCommand({
        title: 'Left Half',
        query: 'left half',
        activated: false,
        frecency: 0,
        declared: 50,
      })
    );
    expect(order(app('Leftover Halfling', 'fuzzy', 89, Date.now() + 1e9), command)).toEqual([
      'Left Half',
      'Leftover Halfling',
    ]);
  });

  it('uses frecency only to break ties inside a tier and quality', () => {
    const now = Date.now();
    expect(order(app('rare', 'titlePrefix', 90), app('frequent', 'titlePrefix', 90, now))).toEqual([
      'frequent',
      'rare',
    ]);
    // A huge frecency cannot lift a fuzzy match over a prefix match.
    expect(order(app('used', 'fuzzy', 89, now + 1e12), app('prefix', 'titlePrefix', 90))).toEqual([
      'prefix',
      'used',
    ]);
  });

  it('breaks full ties by source, then declared score, then numeric title', () => {
    const rank = (declared: number): ResultRank => ({
      band: 'ranked',
      tier: 'activation',
      quality: 0,
      frecency: 0,
      source: 'command',
      declared,
    });
    expect(order(withRank('Timer 10', rank(5)), withRank('Timer 9', rank(5)))).toEqual([
      'Timer 9',
      'Timer 10',
    ]);
    expect(order(withRank('low', rank(1)), withRank('high', rank(9)))).toEqual(['high', 'low']);
    const appTie = app('App', 'activation', 0);
    expect(order(withRank('Cmd', rank(100)), appTie)).toEqual(['App', 'Cmd']);
  });

  it('keeps fallbacks last and explicit web on top', () => {
    const fallback = withRank('fallback', bandRank('fallback', 3), SearchResultType.WebSearch);
    const web = withRank('web', bandRank('explicitWeb', 0), SearchResultType.WebSearch);
    expect(
      order(fallback, app('weak', 'secondary', 50), web, app('alias', 'aliasExact', 100))
    ).toEqual(['web', 'alias', 'weak', 'fallback']);
  });

  it('places results built without a rank at the bottom of the ranked band', () => {
    const bare: SearchResult = {
      id: 'bare',
      type: SearchResultType.Plugin,
      title: 'bare',
      score: 1000,
      data: { id: 'bare', type: 'info', title: 'bare', score: 1000 },
    };
    const fallback = withRank('fallback', bandRank('fallback', 1));
    expect(order(fallback, bare, app('path', 'filePathOnly', 0))).toEqual([
      'path',
      'bare',
      'fallback',
    ]);
  });
});

describe('rankPluginResult', () => {
  const context = {
    query: '2+2',
    identity: null,
    learned: noLearned,
    frecency: 0,
    gameBrowse: false,
  };

  it('puts computed calculator answers in the answer band, above every app', () => {
    const answer = plugin({
      id: 'calc-math-1',
      type: PluginResultType.Calculator,
      title: '4',
      data: { queryType: 'math' },
    });
    const rank = rankPluginResult(answer, context);
    expect(rank.band).toBe('answer');
    expect(order(app('alias', 'aliasExact', 100), withRank('calc', rank))).toEqual([
      'calc',
      'alias',
    ]);

    // The "open calculator" keyword entry is a ranked command, not an answer.
    const openView = plugin({
      id: 'calc-open-view',
      type: PluginResultType.Calculator,
      title: 'Open Calculator',
      matchKind: 'keyword',
      data: { action: 'open-calculator-view' },
    });
    expect(rankPluginResult(openView, { ...context, query: 'calc' }).band).toBe('ranked');
  });

  it('puts an activated web search in the explicit web band', () => {
    const web = plugin({ type: PluginResultType.WebSearch, title: 'Search', matchKind: 'prefix' });
    expect(rankPluginResult(web, { ...context, query: '? volt' }).band).toBe('explicitWeb');
    const passive = plugin({ type: PluginResultType.WebSearch, title: 'Search' });
    expect(rankPluginResult(passive, { ...context, query: 'volt' }).band).toBe('ranked');
  });

  it('gives games their browse band only for game browse queries', () => {
    const game = plugin({ type: PluginResultType.Game, title: 'Hades', matchKind: 'keyword' });
    expect(rankPluginResult(game, { ...context, query: 'games', gameBrowse: true }).band).toBe(
      'browse'
    );
    expect(rankPluginResult(game, { ...context, query: 'hades' }).tier).toBe('titleExact');
  });

  it('applies learned tiers and frecency by stable identity', () => {
    const quit = plugin({ id: 'syscmd-quit', title: 'Quit Volt' });
    const rank = rankPluginResult(quit, {
      ...context,
      query: 'q',
      identity: 'systemcommands:syscmd-quit',
      learned: new Map<string, SearchTier>([['systemcommands:syscmd-quit', 'learnedExact']]),
      frecency: 42,
    });
    expect(rank).toMatchObject({ tier: 'learnedExact', frecency: 42, source: 'command' });
  });
});

describe('mergeSearchResults', () => {
  it('orders mixed sources with the unified comparator', () => {
    const merged = mergeSearchResults(
      10,
      [app('fuzzy-app', 'fuzzy', 70)],
      [
        withRank(
          'exact-cmd',
          rankCommand({
            title: 'Exact',
            query: 'exact',
            activated: false,
            frecency: 0,
            declared: 0,
          })
        ),
      ],
      [withRank('fallback', bandRank('fallback', 1))]
    );
    expect(merged.map((result) => result.id)).toEqual(['exact-cmd', 'fuzzy-app', 'fallback']);
  });
});
