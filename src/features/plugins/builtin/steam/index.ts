import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../../shared/utils/logger';
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

interface SteamGame {
  appId: string;
  name: string;
  installDir: string;
  executable?: string;
  lastPlayed?: number;
}

/**
 * Games Plugin
 * Searches and launches games
 */
export class SteamPlugin implements Plugin {
  id = 'steam';
  name = 'Games';
  description = 'Search and launch games';
  enabled = true;

  private gamesCache: SteamGame[] | null = null;
  private lastCacheTime = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  canHandle(context: PluginContext): boolean {
    // Always return true - we'll filter in match()
    // This allows games to appear in general searches
    return context.query.trim().length >= 2;
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.toLowerCase().trim();

    // Don't trigger on very short queries
    if (query.length < 2) {
      return [];
    }

    try {
      // Get games (with caching)
      const games = await this.getSteamGames();

      if (games.length === 0) {
        return [];
      }

      // Filter games by search query
      const filteredGames = games
        .filter((game) => game.name.toLowerCase().includes(query))
        .slice(0, 5); // Limit to top 5 results

      return filteredGames.map((game, index) => ({
        id: `steam_${game.appId}`,
        type: PluginResultType.Steam,
        title: game.name,
        subtitle: `🎮 Game • App ID: ${game.appId}`,
        icon: '🎯',
        score: 92 - index, // High score, decreasing slightly for each result
        data: {
          appId: game.appId,
          installDir: game.installDir,
        },
      }));
    } catch (error) {
      logger.error('Failed to query games:', error);
      return [];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    const appId = result.data?.appId as string;
    if (!appId) return;

    try {
      await invoke('launch_steam_game', { appId });
    } catch (error) {
      logger.error(`Failed to launch game ${appId}:`, error);
      throw error;
    }
  }

  private async getSteamGames(): Promise<SteamGame[]> {
    const now = Date.now();

    // Return cached games if still valid
    if (this.gamesCache && now - this.lastCacheTime < this.CACHE_DURATION) {
      return this.gamesCache;
    }

    // Fetch fresh games list
    try {
      const games = await invoke<SteamGame[]>('get_steam_games');
      this.gamesCache = games;
      this.lastCacheTime = now;
      return games;
    } catch (error) {
      logger.error('Failed to fetch games:', error);
      // Return empty array if Steam is not installed or error occurs
      return [];
    }
  }

  /**
   * Clear the games cache (useful when settings change)
   */
  clearCache(): void {
    this.gamesCache = null;
    this.lastCacheTime = 0;
  }
}
