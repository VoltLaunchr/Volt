import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
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
  const { t } = useTranslation('settings');
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
  const [isScanningApps, setIsScanningApps] = useState(false);
  const [scanResult, setScanResult] = useState<{ count: number; error: string | null } | null>(null);
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
      setError(t('errors.loadFailed'));
    }
  };

  const saveAppShortcut = async (shortcut: AppShortcut) => {
    try {
      await invoke('save_app_shortcut', { shortcut });
      await loadAppShortcuts();
    } catch (err) {
      logger.error('Failed to save app shortcut:', err);
      setError(t('errors.saveFailed'));
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
      setError(t('errors.loadFailed'));
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
      setError(t('errors.saveFailed'));
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

  const handleLanguageChange = useCallback(
    async (language: 'auto' | 'en' | 'fr') => {
      updateSettings('general', 'language', language);

      let resolvedLng: string = language;
      if (language === 'auto') {
        try {
          const { locale } = await import('@tauri-apps/plugin-os');
          const osLocale = await locale();
          if (osLocale) {
            const base = osLocale.split('-')[0].toLowerCase();
            if (base === 'fr' || base === 'en') resolvedLng = base;
            else resolvedLng = 'en';
          } else {
            resolvedLng = 'en';
          }
        } catch {
          resolvedLng = 'en';
        }
      }

      i18n.changeLanguage(resolvedLng);
      await emit('volt://language-changed', { language: resolvedLng });
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
      setError(t('errors.saveFailed'));
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
                {showSection && (
                  <div className="settings-nav-section">{t('sections.builtIn')}</div>
                )}
                <button
                  className={`settings-nav-item ${activeCategory === category.id ? 'active' : ''}`}
                  onClick={() => setActiveCategory(category.id)}
                >
                  <category.icon size={18} className="settings-nav-icon" />
                  <span className="settings-nav-label">
                    {t(`sections.${category.id === 'file-search' ? 'fileSearch' : category.id === 'clipboard' ? 'clipboard' : category.id}`)}
                  </span>
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
        <h2 className="settings-panel-title">{t('general.title')}</h2>
      </div>

      <div className="settings-panel-content">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('general.language')}</span>
          </div>
          <select
            className="settings-select"
            value={settings.general.language}
            onChange={(e) => handleLanguageChange(e.target.value as 'auto' | 'en' | 'fr')}
          >
            <option value="auto">{t('general.languageAuto')}</option>
            <option value="en">{t('general.languageEn')}</option>
            <option value="fr">{t('general.languageFr')}</option>
          </select>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('general.followSystemAppearance')}</span>
          </div>
          <Toggle
            checked={settings.appearance.theme === 'auto'}
            onChange={(checked) => handleThemeChange(checked ? 'auto' : 'dark')}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('general.openAtLogin')}</span>
          </div>
          <Toggle checked={settings.general.startWithWindows} onChange={handleAutostartChange} />
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('general.closeOnLaunch')}</span>
          </div>
          <Toggle
            checked={settings.general.closeOnLaunch}
            onChange={(checked) => updateSettings('general', 'closeOnLaunch', checked)}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label" id="hotkey-label">{t('general.voltHotkey')}</span>
            <span className="settings-row-desc" id="hotkey-desc">
              {t('general.hotkeyDesc')}
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
          <h2 className="settings-panel-title">{t('shortcuts.title')}</h2>
          <div className="settings-panel-actions">
            <input
              type="text"
              className="settings-search-input"
              placeholder={t('shortcuts.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="settings-filter-select"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">{t('shortcuts.allCategories')}</option>
              {Object.keys(groupedShortcuts).map((cat) => (
                <option key={cat} value={cat.toLowerCase()}>
                  {cat}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={syncAppShortcuts}>
              {t('shortcuts.syncApps')}
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
                      <span className="shortcuts-col-name">{t('shortcuts.tableHeaders.name')}</span>
                      <span className="shortcuts-col-alias">{t('shortcuts.tableHeaders.alias')}</span>
                      <span className="shortcuts-col-hotkey">{t('shortcuts.tableHeaders.hotkey')}</span>
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
                                {shortcut.alias || t('shortcuts.addAlias')}
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
                ? t('shortcuts.noShortcuts')
                : t('shortcuts.noMatch')}
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
        <h2 className="settings-panel-title">{t('advanced.title')}</h2>
      </div>

      <div className="settings-panel-content">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('advanced.showVoltOn')}</span>
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
            <option value="center">{t('advanced.positions.center')}</option>
            <option value="topCenter">{t('advanced.positions.topCenter')}</option>
            <option value="topLeft">{t('advanced.positions.topLeft')}</option>
            <option value="topRight">{t('advanced.positions.topRight')}</option>
          </select>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('advanced.maxResults')}</span>
            <span className="settings-row-desc">{t('advanced.maxResultsDesc')}</span>
          </div>
          <select
            className="settings-dropdown"
            value={settings.general.maxResults}
            onChange={(e) => updateSettings('general', 'maxResults', parseInt(e.target.value))}
          >
            <option value={5}>{t('advanced.results', { count: 5 })}</option>
            <option value={8}>{t('advanced.results', { count: 8 })}</option>
            <option value={10}>{t('advanced.results', { count: 10 })}</option>
            <option value={15}>{t('advanced.results', { count: 15 })}</option>
          </select>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('advanced.windowTransparency')}</span>
            <span className="settings-row-desc">{t('advanced.transparencyDesc')}</span>
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

        <h3 className="settings-subsection-title">{t('advanced.theme')}</h3>

        <div className="settings-theme-selector">
          <button
            className={`theme-card ${settings.appearance.theme === 'light' ? 'active' : ''}`}
            onClick={() => handleThemeChange('light')}
          >
            <div className="theme-preview light">
              <div className="theme-preview-bar" />
              <div className="theme-preview-content" />
            </div>
            <span>{t('advanced.themeLight')}</span>
          </button>
          <button
            className={`theme-card ${settings.appearance.theme === 'dark' ? 'active' : ''}`}
            onClick={() => handleThemeChange('dark')}
          >
            <div className="theme-preview dark">
              <div className="theme-preview-bar" />
              <div className="theme-preview-content" />
            </div>
            <span>{t('advanced.themeDark')}</span>
          </button>
          <button
            className={`theme-card ${settings.appearance.theme === 'auto' ? 'active' : ''}`}
            onClick={() => handleThemeChange('auto')}
          >
            <div className="theme-preview auto">
              <div className="theme-preview-bar" />
              <div className="theme-preview-content" />
            </div>
            <span>{t('advanced.themeAuto')}</span>
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
        <h2 className="settings-panel-title">{t('about.title')}</h2>
      </div>

      <div className="settings-panel-content">
        <div className="about-app">
          <div className="about-logo">
            <img src={logo} alt="Volt Logo" className="about-logo-image" />
          </div>
          <h3 className="about-name">Volt</h3>
          <p className="about-version">Version {appVersion}</p>
          <p className="about-desc">{t('about.description')}</p>
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
            <span>{t('about.officialWebsite')}</span>
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
            <span>{t('about.githubRepo')}</span>
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
            <span>{t('about.reportIssue')}</span>
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
            <span>{t('about.releaseNotes')}</span>
          </button>
        </div>

        <div className="settings-section-divider" />

        <div className="about-links">
          <button onClick={handleOpenLogsFolder} className="about-link">
            <FolderOpen size={20} className="about-link-icon" />
            <span>{t('about.openLogs')}</span>
          </button>
          <button onClick={handleCopyDiagnostics} className="about-link">
            {diagnosticsCopied ? (
              <Check size={20} className="about-link-icon" />
            ) : (
              <Copy size={20} className="about-link-icon" />
            )}
            <span>{diagnosticsCopied ? t('about.copied') : t('about.copyDiagnostics')}</span>
          </button>
        </div>

        <div className="settings-section-divider" />

        <div className="about-credits">
          <p className="about-copyright">{t('about.copyright')}</p>
          <p className="about-tech">{t('about.builtWith')}</p>
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
          <h2 className="settings-panel-title">{t('fileSearch.title')}</h2>
        </div>

        <div className="settings-panel-content">
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{t('fileSearch.indexOnStartup')}</span>
              <span className="settings-row-desc">{t('fileSearch.indexOnStartupDesc')}</span>
            </div>
            <Toggle
              checked={settings.indexing.indexOnStartup}
              onChange={(checked) => updateSettings('indexing', 'indexOnStartup', checked)}
            />
          </div>

          <div className="settings-section-divider" />

          <h3 className="settings-subsection-title">{t('fileSearch.foldersToIndex')}</h3>
          <p className="settings-subsection-desc" id="folders-desc">
            {t('fileSearch.foldersToIndexDesc')}
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
              <span>+</span> {t('fileSearch.addFolder')}
            </button>
          </div>

          <div className="settings-section-divider" />

          <h3 className="settings-subsection-title">{t('fileSearch.fileExtensions')}</h3>
          <p className="settings-subsection-desc" id="extensions-desc">{t('fileSearch.fileExtensionsDesc')}</p>

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
            placeholder={t('fileSearch.fileExtensionsPlaceholder')}
          />

          <div className="settings-section-divider" />

          <h3 className="settings-subsection-title">{t('fileSearch.excludedPaths')}</h3>
          <p className="settings-subsection-desc">{t('fileSearch.excludedPathsDesc')}</p>

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
              <span>+</span> {t('fileSearch.addPath')}
            </button>
          </div>

          <div className="settings-section-divider" />

          <h3 className="settings-subsection-title">{t('fileSearch.indexStatus')}</h3>
          <p className="settings-subsection-desc">
            {t('fileSearch.indexStatusDesc')}
          </p>

          {indexStats ? (
            <div className="index-stats-grid">
              <div className="index-stat-item">
                <span className="index-stat-label">{t('fileSearch.stats.indexedFiles')}</span>
                <span className="index-stat-value">
                  {indexStats.indexedCount.toLocaleString()}
                </span>
              </div>
              <div className="index-stat-item">
                <span className="index-stat-label">{t('fileSearch.stats.dbSize')}</span>
                <span className="index-stat-value">
                  {indexStats.dbSizeBytes > 0
                    ? `${(indexStats.dbSizeBytes / 1024).toFixed(1)} KB`
                    : '—'}
                </span>
              </div>
              <div className="index-stat-item">
                <span className="index-stat-label">{t('fileSearch.stats.lastScan')}</span>
                <span className="index-stat-value">
                  {indexStats.lastFullScan > 0
                    ? new Date(indexStats.lastFullScan * 1000).toLocaleString()
                    : t('fileSearch.stats.never')}
                </span>
              </div>
              <div className="index-stat-item">
                <span className="index-stat-label">{t('fileSearch.stats.watcher')}</span>
                <span
                  className={`index-stat-value ${indexStats.isWatching ? 'index-stat-active' : 'index-stat-inactive'}`}
                >
                  {indexStats.isWatching ? t('fileSearch.stats.active') : t('fileSearch.stats.inactive')}
                </span>
              </div>
            </div>
          ) : (
            <p className="settings-subsection-desc">{t('fileSearch.loadingStats')}</p>
          )}

          <div className="settings-row" style={{ marginTop: '12px' }}>
            <div className="settings-row-info">
              <span className="settings-row-label">{t('fileSearch.stats.rebuild')}</span>
              <span className="settings-row-desc">
                {t('fileSearch.stats.rebuildDesc')}
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
              {isRebuilding ? t('fileSearch.stats.rebuilding') : t('fileSearch.stats.rebuild')}
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
        <h2 className="settings-panel-title">{t('applications.title')}</h2>
      </div>

      <div className="settings-panel-content">
        <div className="settings-info-box">
          <Lightbulb size={20} className="settings-info-icon" />
          <p>{t('applications.infoText')}</p>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('applications.scanApps')}</span>
            <span className="settings-row-desc">
              {t('applications.scanAppsDesc')}
            </span>
          </div>
          <Button
            variant="secondary"
            disabled={isScanningApps}
            onClick={async () => {
              setIsScanningApps(true);
              setScanResult(null);
              try {
                const apps = await invoke<unknown[]>('scan_applications');
                setScanResult({ count: apps.length, error: null });
              } catch (err) {
                logger.error('Failed to scan applications:', err);
                setScanResult({ count: 0, error: String(err) });
              } finally {
                setIsScanningApps(false);
              }
            }}
          >
            {isScanningApps ? 'Analyse en cours...' : t('applications.scanNow')}
          </Button>
        </div>
        {scanResult && (
          <div className="settings-info-box" style={{ marginTop: 8 }}>
            {scanResult.error ? (
              <p style={{ color: 'var(--color-error)' }}>Erreur: {scanResult.error}</p>
            ) : (
              <p>{scanResult.count} applications trouvées</p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Render Plugins section
  const renderPluginsSection = () => {
    const plugins = [
      { id: 'calculator', nameKey: 'plugins.names.calculator', icon: Calculator, builtin: true },
      { id: 'web-search', nameKey: 'plugins.names.webSearch', icon: Globe, builtin: true },
      { id: 'system-commands', nameKey: 'plugins.names.systemCommands', icon: Terminal, builtin: true },
      { id: 'timer', nameKey: 'plugins.names.timer', icon: Clock, builtin: true },
      { id: 'system-monitor', nameKey: 'plugins.names.systemMonitor', icon: Activity, builtin: true },
      { id: 'steam-games', nameKey: 'plugins.names.games', icon: Gamepad2, builtin: true },
      { id: 'clipboard-manager', nameKey: 'plugins.names.clipboardHistory', icon: ClipboardIcon, builtin: true },
    ];

    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">{t('plugins.title')}</h2>
        </div>

        <div className="settings-panel-content">
          <div className="plugins-list">
            {plugins.map((plugin) => {
              const isEnabled = settings.plugins.enabledPlugins.includes(plugin.id);
              return (
                <div key={plugin.id} className="plugin-item">
                  {React.createElement(plugin.icon, { size: 20, className: 'plugin-icon' })}
                  <div className="plugin-info">
                    <span className="plugin-name">{t(plugin.nameKey)}</span>
                    {plugin.builtin && <span className="plugin-badge">{t('plugins.builtin')}</span>}
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
        <h2 className="settings-panel-title">{t('clipboard.title')}</h2>
      </div>

      <div className="settings-panel-content">
        <div className="settings-info-box">
          <ClipboardIcon size={20} className="settings-info-icon" />
          <p>
            {t('clipboard.infoText')}{' '}
            <kbd>cb</kbd> {t('clipboard.infoTextSuffix')}
          </p>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('clipboard.monitoring')}</span>
            <span className="settings-row-desc">{t('clipboard.monitoringDesc')}</span>
          </div>
          <Toggle
            checked={settings.plugins.clipboardMonitoring}
            onChange={handleClipboardMonitoringToggle}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('clipboard.clearHistory')}</span>
            <span className="settings-row-desc">{t('clipboard.clearHistoryDesc')}</span>
          </div>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await invoke('clear_clipboard_history');
              } catch (err) {
                logger.error('Failed to clear clipboard history:', err);
                setError(t('errors.saveFailed'));
              }
            }}
          >
            {t('clipboard.clear')}
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
          <Spinner size="medium" message={t('loading')} />
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
        <span className="settings-titlebar-title">{t('titlebar')}</span>
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
              <span>{t('saveBar.unsavedChanges')}</span>
              <div className="settings-save-actions">
                <Button variant="secondary" onClick={() => loadSettings()}>
                  {t('saveBar.discard')}
                </Button>
                <Button variant="primary" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? t('actions.saving') : t('saveBar.saveChanges')}
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
