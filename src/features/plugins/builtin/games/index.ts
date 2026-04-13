import i18n from 'i18next';
import enGames from './locales/en.json';
import frGames from './locales/fr.json';
i18n.addResourceBundle('en', 'games', enGames);
i18n.addResourceBundle('fr', 'games', frGames);

import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../../shared/utils/logger';
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

export interface GameInfo {
  id: string;
  name: string;
  platform: string;
  platformIcon: string;
  installPath: string;
  executable?: string;
  launchUri?: string;
  iconPath?: string;
  lastPlayed?: number;
  isInstalled: boolean;
  subtitle: string;
}

export interface PlatformInfo {
  id: string;
  name: string;
  icon: string;
  isInstalled: boolean;
  gameCount: number;
}

/**
 * Unified Games Plugin
 * Searches and launches games from all platforms:
 * Steam, Epic, GOG, Ubisoft, EA, Xbox, Riot
 */
export class GamesPlugin implements Plugin {
  id = 'games';
  name = 'Games';
  description = 'Search and launch games from all platforms';
  enabled = true;

  private gamesCache: GameInfo[] | null = null;
  private lastCacheTime = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  canHandle(context: PluginContext): boolean {
    const query = context.query.toLowerCase().trim();

    // Trigger on "games" keyword or game search queries
    if (query === 'games' || query.startsWith('games ')) {
      return true;
    }

    // Also trigger on short queries (potential game names)
    return query.length >= 2;
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.toLowerCase().trim();

    // Special case: "games" shows all games
    if (query === 'games') {
      const games = await this.getAllGames();

      return games.slice(0, 10).map((game, index) => ({
        id: `game_${game.id}`,
        type: PluginResultType.Game,
        title: game.name,
        subtitle: game.platform, // Clean subtitle: just platform name
        icon: game.iconPath || game.platformIcon,
        badge: 'Game',
        score: 95 - index,
        data: {
          gameId: game.id,
          platform: game.platform,
        },
      }));
    }

    // Search for specific game
    let searchQuery = query;
    if (query.startsWith('games ')) {
      searchQuery = query.substring(6).trim();
    }

    if (searchQuery.length < 2) {
      return [];
    }

    try {
      const games = await this.searchGames(searchQuery);

      return games.slice(0, 8).map((game, index) => ({
        id: `game_${game.id}`,
        type: PluginResultType.Game,
        title: game.name,
        subtitle: game.platform, // Clean subtitle: just platform name
        icon: game.iconPath || game.platformIcon,
        badge: 'Game',
        score: 92 - index,
        data: {
          gameId: game.id,
          platform: game.platform,
        },
      }));
    } catch (error) {
      logger.error('Failed to search games:', error);
      return [];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    const gameId = result.data?.gameId as string;
    if (!gameId) return;

    try {
      await invoke('launch_game', { gameId });
    } catch (error) {
      logger.error(`Failed to launch game ${gameId}:`, error);
    }
  }

  private async getAllGames(): Promise<GameInfo[]> {
    const now = Date.now();

    // Return cached if valid
    if (this.gamesCache && now - this.lastCacheTime < this.CACHE_DURATION) {
      return this.gamesCache;
    }

    try {
      const games = await invoke<GameInfo[]>('get_all_games');
      this.gamesCache = games;
      this.lastCacheTime = now;
      return games;
    } catch (error) {
      logger.error('Failed to fetch games:', error);
      return [];
    }
  }

  private async searchGames(query: string): Promise<GameInfo[]> {
    try {
      return await invoke<GameInfo[]>('search_games', { query, limit: 10 });
    } catch (error) {
      logger.error('Failed to search games:', error);
      return [];
    }
  }

  /**
   * Get platforms info
   */
  async getPlatforms(): Promise<PlatformInfo[]> {
    try {
      return await invoke<PlatformInfo[]>('get_game_platforms');
    } catch (error) {
      logger.error('Failed to get platforms:', error);
      return [];
    }
  }

  /**
   * Rescan all games
   */
  async rescan(): Promise<number> {
    try {
      this.clearCache();
      return await invoke<number>('rescan_all_games');
    } catch (error) {
      logger.error('Failed to rescan games:', error);
      return 0;
    }
  }

  /**
   * Clear the games cache
   */
  clearCache(): void {
    this.gamesCache = null;
    this.lastCacheTime = 0;
  }
}

export default GamesPlugin;

export { GameView } from './components';
