import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Package,
  Bug,
  FileText,
  Calculator,
  Globe,
  Terminal,
  Clock,
  Activity,
  Gamepad2,
  Clipboard as ClipboardIcon,
  Folder,
  FolderOpen,
  FolderX,
  Lightbulb,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';
import { Button, HotkeyCapture, Spinner, Toggle } from '../../shared/components/ui';
import { logger } from '../../shared/utils/logger';
import { applyTheme, settingsService } from './services/settingsService';
import {
  DEFAULT_SETTINGS,
  Settings,
  Theme,
  WindowPosition,
  AppShortcut,
} from './types/settings.types';
import { SETTINGS_CATEGORIES, type SettingsCategory } from './constants/settingsCategories';
import { ExtensionsStore } from '../extensions';
import logo from '../../assets/icons/logo.svg';
import './SettingsApp.css';

export function SettingsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [appShortcuts, setAppShortcuts] = useState<AppShortcut[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['Applications'])
  );
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const appVersion = '0.0.2';

  // Indexing stats for the File Search panel
  const [indexStats, setIndexStats] = useState<{
    indexedCount: number;
    dbSizeBytes: number;
    lastFullScan: number;
    isWatching: boolean;
  } | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);

  // Fetch DB index stats
  const fetchIndexStats = useCallback(async () => {
    try {
      const stats = await invoke<{
        indexedCount: number;
        dbSizeBytes: number;
        lastFullScan: number;
        isWatching: boolean;
      }>('get_db_index_stats');
      setIndexStats(stats);
    } catch (err) {
      logger.error('Failed to fetch index stats:', err);
    }
  }, []);

  // Refresh index stats whenever the file-search panel is shown
  useEffect(() => {
    if (activeCategory === 'file-search') {
      fetchIndexStats();
    }
  }, [activeCategory, fetchIndexStats]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(settings.appearance.theme);
  }, [settings.appearance.theme]);

  // Handle escape key to close window
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const currentWindow = getCurrentWindow();
        await currentWindow.close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load app shortcuts when switching to shortcuts category
  useEffect(() => {
    if (activeCategory === 'shortcuts') {
      loadAppShortcuts();
    }
  }, [activeCategory]);

  const loadAppShortcuts = async () => {
    try {
      const shortcuts = await invoke<AppShortcut[]>('get_app_shortcuts');
      setAppShortcuts(shortcuts);
    } catch (err) {
      logger.error('Failed to load app shortcuts:', err);
    }
  };

  const syncAppShortcuts = async () => {
    try {
      const shortcuts = await invoke<AppShortcut[]>('sync_app_shortcuts');
      setAppShortcuts(shortcuts);
    } catch (err) {
      logger.error('Failed to sync app shortcuts:', err);
      setError('Failed to sync app shortcuts');
    }
  };

  const saveAppShortcut = async (shortcut: AppShortcut) => {
    try {
      await invoke('save_app_shortcut', { shortcut });
      await loadAppShortcuts();
    } catch (err) {
      logger.error('Failed to save app shortcut:', err);
      setError('Failed to save shortcut');
    }
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const loadSettings = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loadedSettings = await settingsService.loadSettings();
      setSettings(loadedSettings);
      setHasChanges(false);
    } catch (err) {
      setError('Failed to load settings');
      logger.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await settingsService.saveSettings(settings);
      setHasChanges(false);
    } catch (err) {
      setError('Failed to save settings');
      logger.error('Failed to save settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = async () => {
    if (hasChanges) {
      await handleSave();
    }
    const currentWindow = getCurrentWindow();
    await currentWindow.close();
  };

  const handleMinimize = async () => {
    const currentWindow = getCurrentWindow();
    await currentWindow.minimize();
  };

  const updateSettings = useCallback(
    <K extends keyof Settings>(
      section: K,
      key: keyof Settings[K],
      value: Settings[K][keyof Settings[K]]
    ) => {
      setSettings((prev) => ({
        ...prev,
        [section]: {
          ...prev[section],
          [key]: value,
        },
      }));
      setHasChanges(true);
    },
    []
  );

  const handleThemeChange = useCallback(
    (theme: Theme) => {
      updateSettings('appearance', 'theme', theme);
      applyTheme(theme);
    },
    [updateSettings]
  );

  const handleAutostartChange = async (checked: boolean) => {
    try {
      if (checked) {
        await invoke('enable_autostart');
      } else {
        await invoke('disable_autostart');
      }
      updateSettings('general', 'startWithWindows', checked);
    } catch (err) {
      logger.error('Failed to change autostart setting:', err);
      setError(
        `Failed to ${checked ? 'enable' : 'disable'} autostart: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleToggleWindowHotkeyChange = async (hotkey: string) => {
    setHotkeyError(null);
    try {
      await invoke('set_global_hotkey', { newHotkey: hotkey });
      updateSettings('hotkeys', 'toggleWindow', hotkey);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setHotkeyError(errorMsg);
      logger.error('Failed to set global hotkey:', error);
    }
  };

  const handlePluginToggle = (pluginId: string, enabled: boolean) => {
    const currentPlugins = settings.plugins.enabledPlugins;
    const newPlugins = enabled
      ? [...currentPlugins, pluginId]
      : currentPlugins.filter((id) => id !== pluginId);
    updateSettings('plugins', 'enabledPlugins', newPlugins);
  };

  const handleClipboardMonitoringToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        await invoke('start_clipboard_monitoring');
      } else {
        await invoke('stop_clipboard_monitoring');
      }
      updateSettings('plugins', 'clipboardMonitoring', enabled);
    } catch (error) {
      logger.error('Failed to toggle clipboard monitoring:', error);
      setError(`Failed to ${enabled ? 'enable' : 'disable'} clipboard monitoring`);
    }
  };

  // Render sidebar
  const renderSidebar = () => {
    let currentSection = '';

    return (
      <nav className="settings-sidebar">
        <div className="settings-sidebar-header">
          <div className="settings-user-section">
            <div className="settings-user-avatar">
              <img src={logo} alt="Volt Logo" className="settings-logo" />
            </div>
            <div className="settings-user-info">
              <span className="settings-app-name">Volt</span>
              <span className="settings-app-version">v{appVersion}</span>
            </div>
          </div>
        </div>

        <div className="settings-nav-list">
          {SETTINGS_CATEGORIES.map((category) => {
            const showSection = category.section && category.section !== currentSection;
            if (category.section) currentSection = category.section;

            return (
              <div key={category.id}>
                {showSection && <div className="settings-nav-section">{category.section}</div>}
                <button
                  className={`settings-nav-item ${activeCategory === category.id ? 'active' : ''}`}
                  onClick={() => setActiveCategory(category.id)}
                >
                  <category.icon size={18} className="settings-nav-icon" />
                  <span className="settings-nav-label">{category.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      </nav>
    );
  };

  // Render General section
  const renderGeneralSection = () => (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">General</h2>
      </div>

      <div className="settings-panel-content">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Follow System Appearance</span>
          </div>
          <Toggle
            checked={settings.appearance.theme === 'auto'}
            onChange={(checked) => handleThemeChange(checked ? 'auto' : 'dark')}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Open at Login</span>
          </div>
          <Toggle checked={settings.general.startWithWindows} onChange={handleAutostartChange} />
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Close on Launch</span>
          </div>
          <Toggle
            checked={settings.general.closeOnLaunch}
            onChange={(checked) => updateSettings('general', 'closeOnLaunch', checked)}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label" id="hotkey-label">Volt Hotkey</span>
            <span className="settings-row-desc" id="hotkey-desc">
              Press a key combination to set your global shortcut
            </span>
          </div>
          <div className="settings-row-action">
            <HotkeyCapture
              value={settings.hotkeys.toggleWindow}
              onChange={handleToggleWindowHotkeyChange}
              onError={setHotkeyError}
              aria-labelledby="hotkey-label"
              aria-describedby="hotkey-desc"
            />
          </div>
        </div>

        {hotkeyError && (
          <div className="settings-error-inline">
            <AlertCircle size={16} />
            <span>{hotkeyError}</span>
          </div>
        )}
      </div>
    </div>
  );

  // Render Shortcuts section
  const renderShortcutsSection = () => {
    // Group shortcuts by category
    const groupedShortcuts = appShortcuts.reduce(
      (acc, shortcut) => {
        const category = shortcut.category || 'Applications';
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(shortcut);
        return acc;
      },
      {} as Record<string, AppShortcut[]>
    );

    // Filter shortcuts based on search query and category filter
    const filteredShortcuts = Object.entries(groupedShortcuts).reduce(
      (acc, [category, shortcuts]) => {
        if (categoryFilter !== 'all' && category.toLowerCase() !== categoryFilter.toLowerCase()) {
          return acc;
        }

        const filtered = shortcuts.filter((shortcut) => {
          if (!searchQuery) return true;
          const query = searchQuery.toLowerCase();
          return (
            shortcut.name.toLowerCase().includes(query) ||
            shortcut.alias?.toLowerCase().includes(query)
          );
        });

        if (filtered.length > 0) {
          acc[category] = filtered;
        }
        return acc;
      },
      {} as Record<string, AppShortcut[]>
    );

    const handleAliasClick = (shortcutId: string) => {
      setEditingAliasId(shortcutId);
    };

    const handleAliasChange = async (shortcut: AppShortcut, newAlias: string) => {
      const updatedShortcut = { ...shortcut, alias: newAlias || undefined };
      await saveAppShortcut(updatedShortcut);
      setEditingAliasId(null);
    };

    const handleToggleEnabled = async (shortcut: AppShortcut) => {
      const updatedShortcut = { ...shortcut, enabled: !shortcut.enabled };
      await saveAppShortcut(updatedShortcut);
    };

    const handleHotkeyChange = async (shortcut: AppShortcut, newHotkey: string) => {
      const updatedShortcut = { ...shortcut, hotkey: newHotkey || undefined };
      await saveAppShortcut(updatedShortcut);
    };

    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">Shortcuts</h2>
          <div className="settings-panel-actions">
            <input
              type="text"
              className="settings-search-input"
              placeholder="Search by name or alias"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="settings-filter-select"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">All categories</option>
              {Object.keys(groupedShortcuts).map((cat) => (
                <option key={cat} value={cat.toLowerCase()}>
                  {cat}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={syncAppShortcuts}>
              Sync Apps
            </Button>
          </div>
        </div>

        <div className="settings-panel-content">
          {Object.entries(filteredShortcuts).map(([category, shortcuts]) => {
            const isExpanded = expandedCategories.has(category);

            return (
              <div key={category} className="shortcuts-category">
                <div
                  className="shortcuts-category-header"
                  onClick={() => toggleCategory(category)}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  {isExpanded ? (
                    <ChevronDown size={20} className="shortcuts-category-icon" />
                  ) : (
                    <ChevronRight size={20} className="shortcuts-category-icon" />
                  )}
                  <Package size={20} className="shortcuts-category-icon" />
                  <span className="shortcuts-category-name">
                    {category} ({shortcuts.length})
                  </span>
                </div>

                {isExpanded && (
                  <div className="shortcuts-table">
                    <div className="shortcuts-table-header">
                      <span className="shortcuts-col-name">Name</span>
                      <span className="shortcuts-col-alias">Alias</span>
                      <span className="shortcuts-col-hotkey">Hotkey</span>
                      <span className="shortcuts-col-enabled"></span>
                    </div>

                    <div className="shortcuts-table-body">
                      {shortcuts.map((shortcut) => (
                        <div key={shortcut.id} className="shortcuts-row">
                          <span className="shortcuts-name">
                            {shortcut.icon ? (
                              <img
                                src={`data:image/png;base64,${shortcut.icon}`}
                                alt=""
                                className="shortcuts-app-icon"
                                style={{ width: 16, height: 16 }}
                              />
                            ) : (
                              <Package size={16} className="shortcuts-app-icon" />
                            )}
                            {shortcut.name}
                          </span>
                          <span className="shortcuts-alias">
                            {editingAliasId === shortcut.id ? (
                              <input
                                type="text"
                                className="shortcuts-alias-input"
                                defaultValue={shortcut.alias || ''}
                                autoFocus
                                onBlur={(e) => handleAliasChange(shortcut, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleAliasChange(shortcut, e.currentTarget.value);
                                  } else if (e.key === 'Escape') {
                                    setEditingAliasId(null);
                                  }
                                }}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border-color)',
                                  background: 'var(--input-bg)',
                                  color: 'var(--text-primary)',
                                  width: '100%',
                                }}
                              />
                            ) : (
                              <button
                                className="shortcuts-add-alias"
                                onClick={() => handleAliasClick(shortcut.id)}
                              >
                                {shortcut.alias || 'Add Alias'}
                              </button>
                            )}
                          </span>
                          <span className="shortcuts-hotkey">
                            <HotkeyCapture
                              value={shortcut.hotkey || ''}
                              onChange={(hotkey) => handleHotkeyChange(shortcut, hotkey)}
                              onError={setHotkeyError}
                            />
                          </span>
                          <span className="shortcuts-enabled">
                            <Toggle
                              checked={shortcut.enabled}
                              onChange={() => handleToggleEnabled(shortcut)}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {Object.keys(filteredShortcuts).length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
              {appShortcuts.length === 0
                ? 'No shortcuts available. Click "Sync Apps" to load your applications.'
                : 'No shortcuts match your search.'}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render Advanced section
  const renderAdvancedSection = () => (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">Advanced</h2>
      </div>

      <div className="settings-panel-content">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Show Volt on</span>
          </div>
          <select
            className="settings-dropdown"
            value={settings.appearance.windowPosition}
            onChange={async (e) => {
              const position = e.target.value as WindowPosition;
              updateSettings('appearance', 'windowPosition', position);
              if (position !== 'custom') {
                try {
                  await invoke('set_window_position', {
                    position,
                    customX: null,
                    customY: null,
                  });
                } catch (err) {
                  logger.error('Failed to set window position:', err);
                }
              }
            }}
          >
            <option value="center">Center of screen</option>
            <option value="topCenter">Top center</option>
            <option value="topLeft">Top left</option>
            <option value="topRight">Top right</option>
          </select>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Max Results</span>
            <span className="settings-row-desc">Maximum number of search results displayed</span>
          </div>
          <select
            className="settings-dropdown"
            value={settings.general.maxResults}
            onChange={(e) => updateSettings('general', 'maxResults', parseInt(e.target.value))}
          >
            <option value={5}>5 results</option>
            <option value={8}>8 results</option>
            <option value={10}>10 results</option>
            <option value={15}>15 results</option>
          </select>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Window Transparency</span>
            <span className="settings-row-desc">Adjust the window background transparency</span>
          </div>
          <div className="settings-slider-wrapper">
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.05"
              value={settings.appearance.transparency}
              onChange={(e) =>
                updateSettings('appearance', 'transparency', parseFloat(e.target.value))
              }
              className="settings-slider"
            />
            <span className="settings-slider-value">
              {Math.round(settings.appearance.transparency * 100)}%
            </span>
          </div>
        </div>

        <div className="settings-section-divider" />

        <h3 className="settings-subsection-title">Theme</h3>

        <div className="settings-theme-selector">
          <button
            className={`theme-card ${settings.appearance.theme === 'light' ? 'active' : ''}`}
            onClick={() => handleThemeChange('light')}
          >
            <div className="theme-preview light">
              <div className="theme-preview-bar" />
              <div className="theme-preview-content" />
            </div>
            <span>Light</span>
          </button>
          <button
            className={`theme-card ${settings.appearance.theme === 'dark' ? 'active' : ''}`}
            onClick={() => handleThemeChange('dark')}
          >
            <div className="theme-preview dark">
              <div className="theme-preview-bar" />
              <div className="theme-preview-content" />
            </div>
            <span>Dark</span>
          </button>
          <button
            className={`theme-card ${settings.appearance.theme === 'auto' ? 'active' : ''}`}
            onClick={() => handleThemeChange('auto')}
          >
            <div className="theme-preview auto">
              <div className="theme-preview-bar" />
              <div className="theme-preview-content" />
            </div>
            <span>Auto</span>
          </button>
        </div>
      </div>
    </div>
  );

  // Open the logs folder in the system file explorer
  const handleOpenLogsFolder = async () => {
    try {
      const logPath = await invoke<string>('get_log_file_path');
      try {
        const opener = await import('@tauri-apps/plugin-opener');
        if (typeof opener.revealItemInDir === 'function') {
          await opener.revealItemInDir(logPath);
          return;
        }
        if (typeof opener.openPath === 'function') {
          await opener.openPath(logPath);
          return;
        }
        logger.error('No supported opener API found for revealing logs folder');
      } catch (innerError) {
        logger.error('Failed to open logs folder:', innerError);
      }
    } catch (error) {
      logger.error('Failed to resolve log file path:', error);
    }
  };

  // Build a diagnostics blob and copy it to the clipboard
  const handleCopyDiagnostics = async () => {
    try {
      let logPath = '(unavailable)';
      try {
        logPath = await invoke<string>('get_log_file_path');
      } catch (error) {
        logger.error('Failed to resolve log file path for diagnostics:', error);
      }

      const lines = [
        'Volt Diagnostics',
        '================',
        `App: Volt`,
        `Version: ${appVersion}`,
        `Platform: ${navigator.platform}`,
        `User Agent: ${navigator.userAgent}`,
        `Log file path: ${logPath}`,
        `Timestamp: ${new Date().toISOString()}`,
      ];
      const blob = lines.join('\n');

      await navigator.clipboard.writeText(blob);
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1500);
    } catch (error) {
      logger.error('Failed to copy diagnostics:', error);
    }
  };

  // Render About section
  const renderAboutSection = () => (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">About</h2>
      </div>

      <div className="settings-panel-content">
        <div className="about-app">
          <div className="about-logo">
            <img src={logo} alt="Volt Logo" className="about-logo-image" />
          </div>
          <h3 className="about-name">Volt</h3>
          <p className="about-version">Version {appVersion}</p>
          <p className="about-desc">
            Fast, beautiful desktop launcher for Windows, macOS, and Linux
          </p>
        </div>

        <div className="settings-section-divider" />

        <div className="about-links">
          <button
            onClick={async () => {
              try {
                const { openUrl } = await import('@tauri-apps/plugin-opener');
                await openUrl('https://voltlaunchr.com');
              } catch (error) {
                logger.error('Failed to open website:', error);
              }
            }}
            className="about-link"
          >
            <Globe size={20} className="about-link-icon" />
            <span>Official Website</span>
          </button>
          <button
            onClick={async () => {
              try {
                const { openUrl } = await import('@tauri-apps/plugin-opener');
                await openUrl('https://github.com/VoltLaunchr/Volt');
              } catch (error) {
                logger.error('Failed to open GitHub:', error);
              }
            }}
            className="about-link"
          >
            <Package size={20} className="about-link-icon" />
            <span>GitHub Repository</span>
          </button>
          <button
            onClick={async () => {
              try {
                const { openUrl } = await import('@tauri-apps/plugin-opener');
                await openUrl('https://github.com/VoltLaunchr/Volt/issues/new');
              } catch (error) {
                logger.error('Failed to open issues:', error);
              }
            }}
            className="about-link"
          >
            <Bug size={20} className="about-link-icon" />
            <span>Report an Issue</span>
          </button>
          <button
            onClick={async () => {
              try {
                const { openUrl } = await import('@tauri-apps/plugin-opener');
                await openUrl('https://github.com/VoltLaunchr/Volt/blob/main/CHANGELOG.md');
              } catch (error) {
                logger.error('Failed to open changelog:', error);
              }
            }}
            className="about-link"
          >
            <FileText size={20} className="about-link-icon" />
            <span>Release Notes</span>
          </button>
        </div>

        <div className="settings-section-divider" />

        <div className="about-links">
          <button onClick={handleOpenLogsFolder} className="about-link">
            <FolderOpen size={20} className="about-link-icon" />
            <span>Open logs folder</span>
          </button>
          <button onClick={handleCopyDiagnostics} className="about-link">
            {diagnosticsCopied ? (
              <Check size={20} className="about-link-icon" />
            ) : (
              <Copy size={20} className="about-link-icon" />
            )}
            <span>{diagnosticsCopied ? 'Copied!' : 'Copy diagnostics'}</span>
          </button>
        </div>

        <div className="settings-section-divider" />

        <div className="about-credits">
          <p className="about-copyright">© 2026 VoltLaunchr Contributors • Licensed under Apache 2.0</p>
          <p className="about-tech">Built with Tauri, React, and Rust</p>
        </div>
      </div>
    </div>
  );

  // Render File Search section
  const renderFileSearchSection = () => {
    const addFolder = () => {
      const folder = window.prompt('Enter folder path to index:');
      if (folder && folder.trim()) {
        const newFolders = [...settings.indexing.folders, folder.trim()];
        updateSettings('indexing', 'folders', newFolders);
      }
    };

    const removeFolder = (index: number) => {
      const newFolders = settings.indexing.folders.filter((_, i) => i !== index);
      updateSettings('indexing', 'folders', newFolders);
    };

    const addExcludedPath = () => {
      const path = window.prompt('Enter path to exclude from indexing:');
      if (path && path.trim()) {
        const newPaths = [...settings.indexing.excludedPaths, path.trim()];
        updateSettings('indexing', 'excludedPaths', newPaths);
      }
    };

    const removeExcludedPath = (index: number) => {
      const newPaths = settings.indexing.excludedPaths.filter((_, i) => i !== index);
      updateSettings('indexing', 'excludedPaths', newPaths);
    };

    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">File Search</h2>
        </div>

        <div className="settings-panel-content">
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">Index on Startup</span>
              <span className="settings-row-desc">Automatically index files when Volt starts</span>
            </div>
            <Toggle
              checked={settings.indexing.indexOnStartup}
              onChange={(checked) => updateSettings('indexing', 'indexOnStartup', checked)}
            />
          </div>

          <div className="settings-section-divider" />

          <h3 className="settings-subsection-title">Folders to Index</h3>
          <p className="settings-subsection-desc" id="folders-desc">
            Directories to scan for files (e.g., Documents, Downloads)
          </p>

          <div className="folder-list" aria-describedby="folders-desc">
            {settings.indexing.folders.map((folder, index) => (
              <div key={index} className="folder-item">
                <Folder size={16} className="folder-icon" />
                <span className="folder-path" title={folder}>
                  {folder}
                </span>
                <button
                  className="folder-remove-btn"
                  onClick={() => removeFolder(index)}
                  title="Remove folder"
                >
                  ×
                </button>
              </div>
            ))}
            <button className="folder-add-btn" onClick={addFolder}>
              <span>+</span> Add Folder
            </button>
          </div>

          <div className="settings-section-divider" />

          <h3 className="settings-subsection-title">File Extensions</h3>
          <p className="settings-subsection-desc" id="extensions-desc">File types to include (comma-separated)</p>

          <input
            type="text"
            className="settings-text-input"
            aria-describedby="extensions-desc"
            value={settings.indexing.fileExtensions.join(', ')}
            onChange={(e) => {
              const extensions = e.target.value
                .split(',')
                .map((ext) => ext.trim())
                .filter((ext) => ext.length > 0);
              updateSettings('indexing', 'fileExtensions', extensions);
            }}
            placeholder="pdf, docx, txt, xlsx"
          />

          <div className="settings-section-divider" />

          <h3 className="settings-subsection-title">Excluded Paths</h3>
          <p className="settings-subsection-desc">Paths or folders to skip during indexing</p>

          <div className="folder-list">
            {settings.indexing.excludedPaths.map((path, index) => (
              <div key={index} className="folder-item">
                <FolderX size={16} className="folder-icon" />
                <span className="folder-path" title={path}>
                  {path}
                </span>
                <button
                  className="folder-remove-btn"
                  onClick={() => removeExcludedPath(index)}
                  title="Remove excluded path"
                >
                  ×
                </button>
              </div>
            ))}
            <button className="folder-add-btn" onClick={addExcludedPath}>
              <span>+</span> Add Exclusion
            </button>
          </div>

          <div className="settings-section-divider" />

          <h3 className="settings-subsection-title">Index Status</h3>
          <p className="settings-subsection-desc">
            Persistent SQLite index statistics and maintenance
          </p>

          {indexStats ? (
            <div className="index-stats-grid">
              <div className="index-stat-item">
                <span className="index-stat-label">Indexed files</span>
                <span className="index-stat-value">
                  {indexStats.indexedCount.toLocaleString()}
                </span>
              </div>
              <div className="index-stat-item">
                <span className="index-stat-label">DB size</span>
                <span className="index-stat-value">
                  {indexStats.dbSizeBytes > 0
                    ? `${(indexStats.dbSizeBytes / 1024).toFixed(1)} KB`
                    : '—'}
                </span>
              </div>
              <div className="index-stat-item">
                <span className="index-stat-label">Last full scan</span>
                <span className="index-stat-value">
                  {indexStats.lastFullScan > 0
                    ? new Date(indexStats.lastFullScan * 1000).toLocaleString()
                    : 'Never'}
                </span>
              </div>
              <div className="index-stat-item">
                <span className="index-stat-label">File watcher</span>
                <span
                  className={`index-stat-value ${indexStats.isWatching ? 'index-stat-active' : 'index-stat-inactive'}`}
                >
                  {indexStats.isWatching ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ) : (
            <p className="settings-subsection-desc">Loading stats…</p>
          )}

          <div className="settings-row" style={{ marginTop: '12px' }}>
            <div className="settings-row-info">
              <span className="settings-row-label">Rebuild Index</span>
              <span className="settings-row-desc">
                Clears the database and re-scans all configured folders from scratch
              </span>
            </div>
            <Button
              variant="secondary"
              disabled={isRebuilding}
              onClick={async () => {
                setIsRebuilding(true);
                try {
                  await invoke('invalidate_index');
                  // Poll until indexing is done
                  const pollStats = async () => {
                    try {
                      const status = await invoke<{ isIndexing: boolean }>('get_index_status');
                      if (status.isIndexing) {
                        setTimeout(pollStats, 800);
                      } else {
                        await fetchIndexStats();
                        setIsRebuilding(false);
                      }
                    } catch {
                      setIsRebuilding(false);
                    }
                  };
                  setTimeout(pollStats, 500);
                } catch (err) {
                  logger.error('Failed to rebuild index:', err);
                  setIsRebuilding(false);
                }
              }}
            >
              {isRebuilding ? <Spinner size="small" /> : null}
              {isRebuilding ? 'Rebuilding…' : 'Rebuild Index'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Render Applications section
  const renderApplicationsSection = () => (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">Applications</h2>
      </div>

      <div className="settings-panel-content">
        <div className="settings-info-box">
          <Lightbulb size={20} className="settings-info-icon" />
          <p>
            Volt automatically scans for installed applications on your system. Applications are
            refreshed each time Volt starts.
          </p>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Scan Applications</span>
            <span className="settings-row-desc">
              Manually trigger a scan for installed applications
            </span>
          </div>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await invoke('scan_applications');
              } catch (err) {
                logger.error('Failed to scan applications:', err);
              }
            }}
          >
            Scan Now
          </Button>
        </div>
      </div>
    </div>
  );

  // Render Plugins section
  const renderPluginsSection = () => {
    const plugins = [
      { id: 'calculator', name: 'Calculator', icon: Calculator, builtin: true },
      { id: 'web-search', name: 'Web Search', icon: Globe, builtin: true },
      { id: 'system-commands', name: 'System Commands', icon: Terminal, builtin: true },
      { id: 'timer', name: 'Timer', icon: Clock, builtin: true },
      { id: 'system-monitor', name: 'System Monitor', icon: Activity, builtin: true },
      { id: 'steam-games', name: 'Games', icon: Gamepad2, builtin: true },
      { id: 'clipboard-manager', name: 'Clipboard History', icon: ClipboardIcon, builtin: true },
    ];

    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">Plugins</h2>
        </div>

        <div className="settings-panel-content">
          <div className="plugins-list">
            {plugins.map((plugin) => {
              const isEnabled = settings.plugins.enabledPlugins.includes(plugin.id);
              return (
                <div key={plugin.id} className="plugin-item">
                  {React.createElement(plugin.icon, { size: 20, className: 'plugin-icon' })}
                  <div className="plugin-info">
                    <span className="plugin-name">{plugin.name}</span>
                    {plugin.builtin && <span className="plugin-badge">Built-in</span>}
                  </div>
                  <Toggle
                    checked={isEnabled}
                    onChange={(checked) => handlePluginToggle(plugin.id, checked)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // Render Clipboard section
  const renderClipboardSection = () => (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">Clipboard History</h2>
      </div>

      <div className="settings-panel-content">
        <div className="settings-info-box">
          <ClipboardIcon size={20} className="settings-info-icon" />
          <p>
            Clipboard History stores your recent clipboard entries for quick access. Use{' '}
            <kbd>cb</kbd> followed by your search term to find past clipboard items.
          </p>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Enable Clipboard Monitoring</span>
            <span className="settings-row-desc">Automatically track clipboard changes</span>
          </div>
          <Toggle
            checked={settings.plugins.clipboardMonitoring}
            onChange={handleClipboardMonitoringToggle}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Clear History</span>
            <span className="settings-row-desc">Remove all clipboard history items</span>
          </div>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await invoke('clear_clipboard_history');
              } catch (err) {
                logger.error('Failed to clear clipboard history:', err);
                setError('Failed to clear clipboard history');
              }
            }}
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );

  // Render main content
  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="settings-loading">
          <Spinner size="medium" message="Loading settings..." />
        </div>
      );
    }

    switch (activeCategory) {
      case 'general':
        return renderGeneralSection();
      case 'shortcuts':
        return renderShortcutsSection();
      case 'extensions':
        return <ExtensionsStore />;
      case 'advanced':
        return renderAdvancedSection();
      case 'about':
        return renderAboutSection();
      case 'applications':
        return renderApplicationsSection();
      case 'plugins':
        return renderPluginsSection();
      case 'file-search':
        return renderFileSearchSection();
      case 'clipboard':
        return renderClipboardSection();
      default:
        return renderGeneralSection();
    }
  };

  return (
    <div className="settings-app">
      {/* Custom title bar */}
      <div className="settings-titlebar" data-tauri-drag-region>
        <span className="settings-titlebar-title">Volt Settings</span>
        <div className="settings-titlebar-controls">
          <button className="titlebar-btn minimize" onClick={handleMinimize}>
            <span>−</span>
          </button>
          <button className="titlebar-btn close" onClick={handleClose}>
            <span>×</span>
          </button>
        </div>
      </div>

      <div className="settings-layout">
        {renderSidebar()}

        <main className="settings-main">
          {error && (
            <div className="settings-error-banner">
              <span>{error}</span>
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}

          {renderContent()}

          {hasChanges && (
            <div className="settings-save-bar">
              <span>You have unsaved changes</span>
              <div className="settings-save-actions">
                <Button variant="secondary" onClick={() => loadSettings()}>
                  Discard
                </Button>
                <Button variant="primary" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
