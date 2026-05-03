import { invoke } from '@tauri-apps/api/core';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { logger } from '../../../../../shared/utils/logger';
import { GameInfo, PlatformInfo } from '../index';

// Game controller SVG icon component
function GameControllerIcon({
  size = 24,
  className,
}: { size?: number; className?: string }): React.JSX.Element {
  return (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.00825 15.8092C2.23114 12.3161 2.88737 9.7599 3.44345 8.27511C3.72419 7.5255 4.32818 6.96728 5.10145 6.78021C9.40147 5.73993 14.5986 5.73993 18.8986 6.78021C19.6719 6.96728 20.2759 7.5255 20.5566 8.27511C21.1127 9.7599 21.7689 12.3161 21.9918 15.8092C22.1251 17.8989 20.6148 19.0503 18.9429 19.8925C17.878 20.4289 17.0591 18.8457 16.5155 17.6203C16.2185 16.9508 15.5667 16.5356 14.8281 16.5356H9.17196C8.43331 16.5356 7.78158 16.9508 7.48456 17.6203C6.94089 18.8457 6.122 20.4289 5.05711 19.8925C3.40215 19.0588 1.87384 17.9157 2.00825 15.8092Z" />
    <path d="M5 4.5L6.96285 4M19 4.5L17 4" />
    <path d="M9 13L7.5 11.5M7.5 11.5L6 10M7.5 11.5L6 13M7.5 11.5L9 10" />
    <path d="M15.9881 10H15.9971" />
    <path d="M17.9881 13H17.9971" />
  </svg>
  );
}

interface GameViewProps {
  onClose: () => void;
}

type PlatformFilter = 'all' | string;

export function GameView({ onClose }: GameViewProps): React.JSX.Element {
  const { t } = useTranslation('games');
  const [games, setGames] = useState<GameInfo[]>([]);
  const [filteredGames, setFilteredGames] = useState<GameInfo[]>([]);
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameInfo | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [showPlatformDropdown, setShowPlatformDropdown] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);

  // Load all games
  const loadGames = useCallback(async () => {
    try {
      setIsLoading(true);
      const [allGames, platformsInfo] = await Promise.all([
        invoke<GameInfo[]>('get_all_games'),
        invoke<PlatformInfo[]>('get_game_platforms'),
      ]);
      setGames(allGames);
      setPlatforms(platformsInfo.filter((p) => p.isInstalled && p.gameCount > 0));
      if (allGames.length > 0) {
        setSelectedGame(allGames[0]);
      }
    } catch (error) {
      logger.error('Failed to load games:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  // Filter games based on search query and platform
  useEffect(() => {
    let filtered = games;

    // Filter by platform
    if (platformFilter !== 'all') {
      filtered = filtered.filter((game) => game.platform === platformFilter);
    }

    // Filter by search query
    if (filterQuery.trim()) {
      const query = filterQuery.toLowerCase();
      filtered = filtered.filter((game) => game.name.toLowerCase().includes(query));
    }

    setFilteredGames(filtered);

    // Reset selection
    if (filtered.length > 0) {
      setSelectedIndex(0);
      setSelectedGame(filtered[0]);
    } else {
      setSelectedIndex(0);
      setSelectedGame(null);
    }
  }, [games, filterQuery, platformFilter]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (selectedIndex < filteredGames.length - 1) {
            const newIndex = selectedIndex + 1;
            setSelectedIndex(newIndex);
            setSelectedGame(filteredGames[newIndex]);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1;
            setSelectedIndex(newIndex);
            setSelectedGame(filteredGames[newIndex]);
          }
          break;

        case 'Enter':
          e.preventDefault();
          if (selectedGame) {
            handleLaunchGame(selectedGame);
          }
          break;

        default:
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIndex, filteredGames, selectedGame, onClose]
  );

  // Launch game
  const handleLaunchGame = async (game: GameInfo) => {
    try {
      await invoke<void>('launch_game', { gameId: game.id });
      onClose();
    } catch (error) {
      logger.error('Failed to launch game:', error);
    }
  };

  // Rescan games
  const handleRescan = async () => {
    try {
      setIsRescanning(true);
      await invoke<number>('rescan_all_games');
      await loadGames();
    } catch (error) {
      logger.error('Failed to rescan games:', error);
    } finally {
      setIsRescanning(false);
    }
  };

  // Get platform icon as JSX element
  const getPlatformIcon = (_platform: string, size: number = 20): React.ReactNode => {
    return <GameControllerIcon size={size} className="inline-block align-middle text-current" />;
  };

  // Group games by platform
  const groupedGames = filteredGames.reduce(
    (groups, game) => {
      const platform = game.platform;
      if (!groups[platform]) {
        groups[platform] = [];
      }
      groups[platform].push(game);
      return groups;
    },
    {} as Record<string, GameInfo[]>
  );

  // Format last played timestamp
  const formatLastPlayed = (timestamp?: number): string => {
    if (!timestamp) return t('view.neverPlayed');
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('view.today');
    if (diffDays === 1) return t('view.yesterday');
    if (diffDays < 7) return t('view.daysAgo', { count: diffDays });
    if (diffDays < 30) return t('view.weeksAgo', { count: Math.floor(diffDays / 7) });
    return date.toLocaleDateString();
  };

  return (
    <div
      className="flex flex-col h-full bg-canvas text-ink"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Games library view"
      style={{ outline: 'none' }}
    >
      {/* Header with search and filter */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-hairline bg-surface shrink-0">
        {/* Back button */}
        <button
          className="flex items-center justify-center w-8 h-8 rounded-md text-mute transition-all cursor-pointer shrink-0 bg-transparent border-0 hover:bg-surface-elevated hover:text-ink"
          onClick={onClose}
          title="Back"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Search input */}
        <div className="flex-1">
          <input
            type="text"
            className="w-full px-3 py-2 text-base bg-canvas border border-hairline rounded-md text-ink outline-none transition-all focus:border-hairline-strong focus:bg-surface placeholder:text-ash"
            placeholder={t('view.searchPlaceholder')}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* Platform filter dropdown */}
        <div className="relative">
          <button
            className="flex items-center gap-2 px-3 py-2 bg-canvas border border-hairline rounded-md text-ink text-sm cursor-pointer transition-all whitespace-nowrap hover:bg-surface-elevated hover:border-hairline-strong"
            onClick={() => setShowPlatformDropdown(!showPlatformDropdown)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-mute"
            >
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
            </svg>
            <span>{platformFilter === 'all' ? t('view.allPlatforms') : platformFilter}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-ash"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {showPlatformDropdown && (
            <div className="absolute top-[calc(100%+4px)] right-0 min-w-[200px] bg-surface border border-hairline rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.15)] overflow-hidden z-[100]">
              <button
                className={cn(
                  'flex items-center gap-2 w-full px-3.5 py-2.5 text-left text-sm text-ink bg-transparent cursor-pointer transition-colors border-0 hover:bg-surface-elevated',
                  platformFilter === 'all' && 'bg-accent-blue-soft text-on-dark'
                )}
                onClick={() => {
                  setPlatformFilter('all');
                  setShowPlatformDropdown(false);
                }}
              >
                {t('view.allPlatforms')} ({games.length})
              </button>
              {platforms.map((platform) => (
                <button
                  key={platform.id}
                  className={cn(
                    'flex items-center gap-2 w-full px-3.5 py-2.5 text-left text-sm text-ink bg-transparent cursor-pointer transition-colors border-0 hover:bg-surface-elevated',
                    platformFilter === platform.name && 'bg-accent-blue-soft text-on-dark'
                  )}
                  onClick={() => {
                    setPlatformFilter(platform.name);
                    setShowPlatformDropdown(false);
                  }}
                >
                  <span className="text-base">{platform.icon}</span>
                  {platform.name} ({platform.gameCount})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Rescan button */}
        <button
          className="flex items-center justify-center w-8 h-8 bg-canvas border border-hairline rounded-md text-mute cursor-pointer transition-all hover:bg-surface-elevated hover:border-hairline-strong hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleRescan}
          disabled={isRescanning}
          title={t('view.rescan')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={isRescanning ? 'animate-spin' : ''}
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Games list */}
        <div className="w-[45%] border-r border-hairline overflow-y-auto bg-canvas">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-ash text-sm gap-2">
              {t('view.loading')}
            </div>
          ) : filteredGames.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-ash text-sm gap-2">
              {games.length === 0 ? (
                <>
                  <span className="flex items-center justify-center text-ash opacity-50">
                    <GameControllerIcon size={48} />
                  </span>
                  <span>{t('view.noGames')}</span>
                  <span className="text-xs text-ash text-center">{t('view.noGamesHint')}</span>
                </>
              ) : (
                <>
                  <span className="text-4xl opacity-50">🔍</span>
                  <span>{t('view.noMatchingGames')}</span>
                </>
              )}
            </div>
          ) : platformFilter === 'all' ? (
            // Grouped by platform when showing all
            Object.entries(groupedGames).map(([platform, platformGames]) => (
              <div key={platform} className="mb-2">
                <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-ash uppercase tracking-[0.5px] bg-surface sticky top-0 z-[1]">
                  <span className="text-sm opacity-70">{getPlatformIcon(platform, 14)}</span>
                  <span>{platform}</span>
                  <span className="ml-auto px-2 py-0.5 text-xs bg-canvas rounded-sm">{platformGames.length}</span>
                </div>
                {platformGames.map((game) => {
                  const globalIndex = filteredGames.indexOf(game);
                  const isSelected = globalIndex === selectedIndex;

                  return (
                    <div
                      key={game.id}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors',
                        isSelected ? 'bg-accent-blue-soft text-on-dark' : 'hover:bg-surface-elevated'
                      )}
                      onClick={() => {
                        setSelectedIndex(globalIndex);
                        setSelectedGame(game);
                      }}
                      onDoubleClick={() => handleLaunchGame(game)}
                    >
                      <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 bg-surface flex items-center justify-center">
                        {game.iconPath ? (
                          <img src={game.iconPath} alt={game.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className={cn('flex items-center justify-center', isSelected ? 'text-white/90' : 'text-ash')}>
                            {getPlatformIcon(game.platform, 24)}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis mb-0.5">
                          {game.name}
                        </div>
                        <div className={cn('text-xs', isSelected ? 'text-white/80' : 'text-ash')}>
                          {game.platform}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            // Flat list when filtered by platform
            filteredGames.map((game, index) => {
              const isSelected = index === selectedIndex;

              return (
                <div
                  key={game.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors',
                    isSelected ? 'bg-accent-blue-soft text-on-dark' : 'hover:bg-surface-elevated'
                  )}
                  onClick={() => {
                    setSelectedIndex(index);
                    setSelectedGame(game);
                  }}
                  onDoubleClick={() => handleLaunchGame(game)}
                >
                  <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 bg-surface flex items-center justify-center">
                    {game.iconPath ? (
                      <img src={game.iconPath} alt={game.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className={cn('flex items-center justify-center', isSelected ? 'text-white/90' : 'text-ash')}>
                        {getPlatformIcon(game.platform, 24)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis mb-0.5">
                      {game.name}
                    </div>
                    <div className={cn('text-xs', isSelected ? 'text-white/80' : 'text-ash')}>
                      {game.platform}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Details panel */}
        {selectedGame && (
          <div className="flex-1 flex flex-col bg-surface overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
              {/* Game header */}
              <div className="flex items-center gap-4 mb-4 pb-4 border-b border-hairline">
                <div className="w-20 h-20 rounded-lg overflow-hidden bg-canvas flex items-center justify-center shrink-0">
                  {selectedGame.iconPath ? (
                    <img src={selectedGame.iconPath} alt={selectedGame.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="flex items-center justify-center text-ash">
                      {getPlatformIcon(selectedGame.platform, 40)}
                    </span>
                  )}
                </div>
                <div>
                  <h2 className="m-0 mb-1 text-lg font-semibold text-ink">{selectedGame.name}</h2>
                  <span className="flex items-center gap-1 text-sm text-mute">
                    {getPlatformIcon(selectedGame.platform, 14)} {selectedGame.platform}
                  </span>
                </div>
              </div>

              {/* Metadata */}
              <div className="mt-3">
                <div>
                  <h3 className="text-sm font-semibold text-ash mb-3 uppercase tracking-[0.5px]">
                    {t('view.information')}
                  </h3>

                  <div className="flex justify-between items-center py-2 border-b border-hairline">
                    <span className="text-sm text-mute">{t('view.platform')}</span>
                    <span className="text-sm text-ink font-medium text-right max-w-[60%]">{selectedGame.platform}</span>
                  </div>

                  <div className="flex justify-between items-center py-2 border-b border-hairline">
                    <span className="text-sm text-mute">{t('view.status')}</span>
                    <span
                      className={cn(
                        'text-sm font-medium text-right max-w-[60%]',
                        selectedGame.isInstalled ? 'text-accent-green' : 'text-ash'
                      )}
                    >
                      {selectedGame.isInstalled ? t('view.installed') : t('view.notInstalled')}
                    </span>
                  </div>

                  {selectedGame.lastPlayed && (
                    <div className="flex justify-between items-center py-2 border-b border-hairline">
                      <span className="text-sm text-mute">{t('view.lastPlayed')}</span>
                      <span className="text-sm text-ink font-medium text-right max-w-[60%]">
                        {formatLastPlayed(selectedGame.lastPlayed)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-mute">{t('view.installPath')}</span>
                    <span
                      className="text-xs text-ink font-medium text-right max-w-[60%] font-mono whitespace-nowrap overflow-hidden text-ellipsis"
                      title={selectedGame.installPath}
                    >
                      {selectedGame.installPath}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions footer */}
            <div className="flex gap-2 px-4 py-3 border-t border-hairline bg-canvas">
              <button
                className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-hairline bg-accent-blue-soft text-on-dark cursor-pointer transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleLaunchGame(selectedGame)}
                disabled={!selectedGame.isInstalled}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>{t('view.play')}</span>
                <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white/20 rounded-sm">Enter</kbd>
              </button>
              <button
                className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-hairline bg-surface text-ink cursor-pointer transition-all hover:bg-surface-elevated hover:border-hairline-strong"
                onClick={() => {
                  invoke<void>('open_path', { path: selectedGame.installPath });
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>{t('view.openFolder')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-hairline bg-surface text-xs shrink-0">
        <div className="flex items-center gap-2 text-mute font-medium">
          <span className="flex items-center justify-center text-mute">
            <GameControllerIcon size={16} />
          </span>
          <span>{t('view.gamesLibrary')}</span>
          <span className="text-ash font-normal">
            {filteredGames.length}{' '}
            {filteredGames.length === 1 ? t('view.game') : t('view.games')}
          </span>
        </div>
        <div className="text-ash">
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-mute">↑</kbd>
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-mute">↓</kbd>
            {t('view.footer.navigate')}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-mute">Enter</kbd>
            {t('view.footer.play')}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-mute">Esc</kbd>
            {t('view.footer.close')}
          </span>
        </div>
      </div>
    </div>
  );
};
