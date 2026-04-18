import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GamesPlugin } from './index';
import { PluginResultType } from '../../types';

const mockGames = [
  {
    id: 'steam_12345',
    name: 'Counter-Strike 2',
    platform: 'Steam',
    platformIcon: '🎮',
    installPath: 'C:\\Games\\CS2',
    iconPath: null,
    lastPlayed: null,
    isInstalled: true,
    subtitle: '🎮 Steam • Installed',
  },
  {
    id: 'epic_fortnite',
    name: 'Fortnite',
    platform: 'Epic Games',
    platformIcon: '🟡',
    installPath: 'C:\\Games\\Fortnite',
    iconPath: null,
    lastPlayed: null,
    isInstalled: true,
    subtitle: '🟡 Epic Games • Installed',
  },
  {
    id: 'gog_witcher3',
    name: 'The Witcher 3',
    platform: 'GOG Galaxy',
    platformIcon: '🟣',
    installPath: 'C:\\Games\\Witcher3',
    iconPath: null,
    lastPlayed: null,
    isInstalled: true,
    subtitle: '🟣 GOG Galaxy • Installed',
  },
];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'get_all_games') return Promise.resolve(mockGames);
    if (cmd === 'search_games') {
      const query = (args?.query as string)?.toLowerCase() ?? '';
      return Promise.resolve(mockGames.filter((g) => g.name.toLowerCase().includes(query)));
    }
    if (cmd === 'launch_game') return Promise.resolve();
    return Promise.resolve([]);
  }),
}));

vi.mock('../../../../shared/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('GamesPlugin', () => {
  let plugin: GamesPlugin;

  beforeEach(() => {
    plugin = new GamesPlugin();
    plugin.clearCache();
  });

  // ── canHandle ──────────────────────────────────────────────────────────

  describe('canHandle', () => {
    it('accepts "game"', () => {
      expect(plugin.canHandle({ query: 'game' })).toBe(true);
    });

    it('accepts "games"', () => {
      expect(plugin.canHandle({ query: 'games' })).toBe(true);
    });

    it('accepts "jeux"', () => {
      expect(plugin.canHandle({ query: 'jeux' })).toBe(true);
    });

    it('accepts "play <name>"', () => {
      expect(plugin.canHandle({ query: 'play fortnite' })).toBe(true);
    });

    it('accepts "steam <name>"', () => {
      expect(plugin.canHandle({ query: 'steam cs2' })).toBe(true);
    });

    it('accepts "epic <name>"', () => {
      expect(plugin.canHandle({ query: 'epic fortnite' })).toBe(true);
    });

    it('accepts "gog <name>"', () => {
      expect(plugin.canHandle({ query: 'gog witcher' })).toBe(true);
    });

    it('rejects unrelated queries', () => {
      expect(plugin.canHandle({ query: 'calculator' })).toBe(false);
      expect(plugin.canHandle({ query: '' })).toBe(false);
    });
  });

  // ── match ──────────────────────────────────────────────────────────────

  describe('match', () => {
    it('returns all games for "games" keyword', async () => {
      const results = await plugin.match({ query: 'games' });
      expect(results.length).toBe(3);
      expect(results[0].type).toBe(PluginResultType.Game);
    });

    it('returns all games for "jeu" keyword', async () => {
      const results = await plugin.match({ query: 'jeu' });
      expect(results.length).toBe(3);
    });

    it('searches when using "games <query>" prefix', async () => {
      const results = await plugin.match({ query: 'games witcher' });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('The Witcher 3');
    });

    it('strips prefix for search', async () => {
      const results = await plugin.match({ query: 'games counter' });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Counter-Strike 2');
    });

    it('returns empty for queries shorter than 2 chars', async () => {
      const results = await plugin.match({ query: 'game x' });
      // 'x' is only 1 char after stripping prefix — but this goes through search path
      // game prefix triggers canHandle but searchQuery = 'x' < 2 chars
      expect(results.length).toBe(0);
    });

    it('attaches gameId and platform in data', async () => {
      const results = await plugin.match({ query: 'games fortnite' });
      expect(results[0].data).toEqual({
        gameId: 'epic_fortnite',
        platform: 'Epic Games',
      });
    });

    it('shows platform as subtitle', async () => {
      const results = await plugin.match({ query: 'games witcher' });
      expect(results[0].subtitle).toBe('GOG Galaxy');
    });

    it('caps results at 10 for "games" keyword', async () => {
      // Our mock only has 3 games, but verify the slice doesn't crash
      const results = await plugin.match({ query: 'games' });
      expect(results.length).toBeLessThanOrEqual(10);
    });
  });

  // ── execute ────────────────────────────────────────────────────────────

  describe('execute', () => {
    it('invokes launch_game with the gameId', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await plugin.execute({
        id: 'game_steam_12345',
        type: PluginResultType.Game,
        title: 'Counter-Strike 2',
        score: 92,
        data: { gameId: 'steam_12345', platform: 'Steam' },
      });
      expect(invoke).toHaveBeenCalledWith('launch_game', { gameId: 'steam_12345' });
    });

    it('does nothing when gameId is missing', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      vi.mocked(invoke).mockClear();
      await plugin.execute({
        id: 'game_none',
        type: PluginResultType.Game,
        title: 'No Game',
        score: 50,
        data: {},
      });
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  // ── caching ────────────────────────────────────────────────────────────

  describe('caching', () => {
    it('uses cache on second call', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      vi.mocked(invoke).mockClear();

      await plugin.match({ query: 'games' });
      await plugin.match({ query: 'games' });

      // get_all_games should only be called once (second call uses cache)
      const getAllCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'get_all_games');
      expect(getAllCalls.length).toBe(1);
    });

    it('clearCache forces re-fetch', async () => {
      const { invoke } = await import('@tauri-apps/api/core');

      await plugin.match({ query: 'games' });
      vi.mocked(invoke).mockClear();
      plugin.clearCache();
      await plugin.match({ query: 'games' });

      const getAllCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'get_all_games');
      expect(getAllCalls.length).toBe(1);
    });
  });
});
