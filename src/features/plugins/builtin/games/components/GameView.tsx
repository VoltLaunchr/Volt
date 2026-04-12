import { invoke } from '@tauri-apps/api/core';
import React, { useCallback, useEffect, useState } from 'react';
import { logger } from '../../../../../shared/utils/logger';
import { GameInfo, PlatformInfo } from '../index';
import './GameView.css';

// Game controller SVG icon component
const GameControllerIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 24,
  className,
}) => (
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

interface GameViewProps {
  onClose: () => void;
}

type PlatformFilter = 'all' | string;

export const GameView: React.FC<GameViewProps> = ({ onClose }) => {
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
      await invoke('launch_game', { gameId: game.id });
      onClose();
    } catch (error) {
      logger.error('Failed to launch game:', error);
    }
  };

  // Rescan games
  const handleRescan = async () => {
    try {
      setIsRescanning(true);
      await invoke('rescan_all_games');
      await loadGames();
    } catch (error) {
      logger.error('Failed to rescan games:', error);
    } finally {
      setIsRescanning(false);
    }
  };

  // Get platform icon as JSX element
  const getPlatformIcon = (_platform: string, size: number = 20): React.ReactNode => {
    return <GameControllerIcon size={size} className="platform-icon-svg" />;
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
    if (!timestamp) return 'Never played';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  return (
    <div
      className="game-view"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Games library view"
      style={{ outline: 'none' }}
    >
      {/* Header with search and filter */}
      <div className="game-header">
        <button className="back-button" onClick={onClose} title="Back">
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

        <div className="search-filter-container">
          <input
            type="text"
            className="filter-input"
            placeholder="Search games..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="platform-filter-dropdown">
          <button
            className="platform-filter-button"
            onClick={() => setShowPlatformDropdown(!showPlatformDropdown)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
            </svg>
            <span>{platformFilter === 'all' ? 'All Platforms' : platformFilter}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {showPlatformDropdown && (
            <div className="platform-filter-menu">
              <button
                className={`platform-filter-option ${platformFilter === 'all' ? 'active' : ''}`}
                onClick={() => {
                  setPlatformFilter('all');
                  setShowPlatformDropdown(false);
                }}
              >
                All Platforms ({games.length})
              </button>
              {platforms.map((platform) => (
                <button
                  key={platform.id}
                  className={`platform-filter-option ${platformFilter === platform.name ? 'active' : ''}`}
                  onClick={() => {
                    setPlatformFilter(platform.name);
                    setShowPlatformDropdown(false);
                  }}
                >
                  <span className="platform-emoji">{platform.icon}</span>
                  {platform.name} ({platform.gameCount})
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="rescan-button"
          onClick={handleRescan}
          disabled={isRescanning}
          title="Rescan games"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={isRescanning ? 'spinning' : ''}
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>

      {/* Main content area */}
      <div className="game-content">
        {/* Games list */}
        <div className="game-list">
          {isLoading ? (
            <div className="loading-state">Loading games...</div>
          ) : filteredGames.length === 0 ? (
            <div className="empty-state">
              {games.length === 0 ? (
                <>
                  <span className="empty-icon">
                    <GameControllerIcon size={48} />
                  </span>
                  <span>No games found</span>
                  <span className="empty-hint">
                    Install games from Steam, Epic, GOG, or other launchers
                  </span>
                </>
              ) : (
                <>
                  <span className="empty-icon">🔍</span>
                  <span>No matching games</span>
                </>
              )}
            </div>
          ) : platformFilter === 'all' ? (
            // Grouped by platform when showing all
            Object.entries(groupedGames).map(([platform, platformGames]) => (
              <div key={platform} className="game-group">
                <div className="group-header">
                  <span className="group-icon">{getPlatformIcon(platform, 14)}</span>
                  <span>{platform}</span>
                  <span className="group-count">{platformGames.length}</span>
                </div>
                {platformGames.map((game) => {
                  const globalIndex = filteredGames.indexOf(game);
                  const isSelected = globalIndex === selectedIndex;

                  return (
                    <div
                      key={game.id}
                      className={`game-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedIndex(globalIndex);
                        setSelectedGame(game);
                      }}
                      onDoubleClick={() => handleLaunchGame(game)}
                    >
                      <div className="game-icon">
                        {game.iconPath ? (
                          <img src={game.iconPath} alt={game.name} />
                        ) : (
                          <span className="game-icon-fallback">
                            {getPlatformIcon(game.platform, 24)}
                          </span>
                        )}
                      </div>
                      <div className="game-info">
                        <div className="game-name">{game.name}</div>
                        <div className="game-subtitle">{game.platform}</div>
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
                  className={`game-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedIndex(index);
                    setSelectedGame(game);
                  }}
                  onDoubleClick={() => handleLaunchGame(game)}
                >
                  <div className="game-icon">
                    {game.iconPath ? (
                      <img src={game.iconPath} alt={game.name} />
                    ) : (
                      <span className="game-icon-fallback">
                        {getPlatformIcon(game.platform, 24)}
                      </span>
                    )}
                  </div>
                  <div className="game-info">
                    <div className="game-name">{game.name}</div>
                    <div className="game-subtitle">{game.platform}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Details panel */}
        {selectedGame && (
          <div className="game-details-panel">
            <div className="details-content">
              {/* Game header */}
              <div className="game-detail-header">
                <div className="game-detail-icon">
                  {selectedGame.iconPath ? (
                    <img src={selectedGame.iconPath} alt={selectedGame.name} />
                  ) : (
                    <span className="game-icon-large">
                      {getPlatformIcon(selectedGame.platform, 40)}
                    </span>
                  )}
                </div>
                <div className="game-detail-title">
                  <h2>{selectedGame.name}</h2>
                  <span className="game-detail-platform">
                    {getPlatformIcon(selectedGame.platform, 14)} {selectedGame.platform}
                  </span>
                </div>
              </div>

              {/* Metadata */}
              <div className="details-metadata">
                <div className="metadata-section">
                  <h3>Information</h3>

                  <div className="metadata-row">
                    <span className="metadata-label">Platform</span>
                    <span className="metadata-value">{selectedGame.platform}</span>
                  </div>

                  <div className="metadata-row">
                    <span className="metadata-label">Status</span>
                    <span
                      className={`metadata-value status-${selectedGame.isInstalled ? 'installed' : 'not-installed'}`}
                    >
                      {selectedGame.isInstalled ? 'Installed' : 'Not Installed'}
                    </span>
                  </div>

                  {selectedGame.lastPlayed && (
                    <div className="metadata-row">
                      <span className="metadata-label">Last Played</span>
                      <span className="metadata-value">
                        {formatLastPlayed(selectedGame.lastPlayed)}
                      </span>
                    </div>
                  )}

                  <div className="metadata-row">
                    <span className="metadata-label">Install Path</span>
                    <span className="metadata-value path" title={selectedGame.installPath}>
                      {selectedGame.installPath}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions footer */}
            <div className="details-actions">
              <button
                className="action-button primary"
                onClick={() => handleLaunchGame(selectedGame)}
                disabled={!selectedGame.isInstalled}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>Play</span>
                <kbd>Enter</kbd>
              </button>
              <button
                className="action-button"
                onClick={() => {
                  invoke('open_path', { path: selectedGame.installPath });
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
                <span>Open Folder</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="game-footer">
        <div className="footer-left">
          <div className="footer-icon">
            <GameControllerIcon size={16} />
          </div>
          <span>Games Library</span>
          <span className="footer-count">
            {filteredGames.length} {filteredGames.length === 1 ? 'game' : 'games'}
          </span>
        </div>
        <div className="footer-right">
          <span className="footer-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> Navigate
            <kbd>Enter</kbd> Play
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
};
