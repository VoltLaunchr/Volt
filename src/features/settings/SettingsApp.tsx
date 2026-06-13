import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
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
  FolderPlus,
  FolderOpen,
  FolderX,
  Lightbulb,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  CheckCircle,
  Download,
  Upload,
  RefreshCw,
  Plus,
  X,
} from 'lucide-react';
import { Button, HotkeyCapture, Spinner, Toggle } from '../../shared/components/ui';
import { extractErrorMessage } from '../../shared/utils/error';
import { logger } from '../../shared/utils/logger';
import {
  getPreferredSkinTone,
  setPreferredSkinTone,
  getSkinToneDisplayName,
} from '../plugins/builtin/emoji-picker/utils/skinTones';
import {
  getEmojiColumns,
  setEmojiColumns,
  getEmojiPrimaryAction,
  setEmojiPrimaryAction,
} from '../plugins/builtin/emoji-picker/utils/emojiSettings';
import type { SkinTone } from '../plugins/builtin/emoji-picker/types';
import { applyTheme, settingsService } from './services/settingsService';
import {
  checkForUpdate,
  downloadAndInstall,
  deferredInstall,
  hasPendingUpdate,
  clearPendingUpdate,
  snoozeUpdate,
  skipVersion,
  type UpdateInfo,
  type UpdateChannel,
} from './services/updateService';
import {
  DEFAULT_SETTINGS,
  Settings,
  Theme,
  WindowPosition,
  ShowOnScreen,
  AppShortcut,
} from './types/settings.types';
import { SETTINGS_CATEGORIES, type SettingsCategory } from './constants/settingsCategories';
import { ExtensionsStore } from '../extensions';
import { AiSettingsView } from './components/AiSettingsView';
import { IntegrationsPanel } from './components/IntegrationsPanel';
import { NotesSettingsPanel } from './components/NotesSettingsPanel';
import { SyncPanel } from './components/SyncPanel';
import { AccountSection } from '../auth';
import logo from '../../assets/icons/logo.svg';
import { cn } from '@/lib/utils';

export function SettingsApp() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isRestartingOnboarding, setIsRestartingOnboarding] = useState(false);
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
  const [scanResult, setScanResult] = useState<{ count: number; error: string | null } | null>(
    null
  );
  const [exportImportStatus, setExportImportStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeferring, setIsDeferring] = useState(false);
  const [deferralReady, setDeferralReady] = useState(() => hasPendingUpdate());
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  const [emojiSkinTone, setEmojiSkinToneState] = useState<SkinTone>(() => getPreferredSkinTone());
  const [emojiColumns, setEmojiColumnsState] = useState<number>(() => getEmojiColumns());
  const [emojiPrimaryAction, setEmojiPrimaryActionState] = useState<'copy' | 'paste'>(() =>
    getEmojiPrimaryAction()
  );

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {
        // best-effort; leave appVersion empty if Tauri runtime is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      void fetchIndexStats();
    }
  }, [activeCategory, fetchIndexStats]);

  const loadSettings = useCallback(async () => {
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
  }, [t]);

  // Load settings on mount
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(settings.appearance.theme);
  }, [settings.appearance.theme]);

  // Handle escape key to close window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void (async () => {
          const currentWindow = getCurrentWindow();
          await currentWindow.close();
        })();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadAppShortcuts = useCallback(async () => {
    try {
      const shortcuts = await invoke<AppShortcut[]>('get_app_shortcuts');
      setAppShortcuts(shortcuts);
    } catch (err) {
      logger.error('Failed to load app shortcuts:', err);
    }
  }, []);

  // Load app shortcuts when switching to shortcuts category
  useEffect(() => {
    if (activeCategory === 'shortcuts') {
      void loadAppShortcuts();
    }
  }, [activeCategory, loadAppShortcuts]);

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
      await invoke<void>('save_app_shortcut', { shortcut });
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

      await i18n.changeLanguage(resolvedLng);
      await emit('volt://language-changed', { language: resolvedLng });
    },
    [updateSettings]
  );

  const handleAutostartChange = async (checked: boolean) => {
    try {
      if (checked) {
        await invoke<void>('enable_autostart');
      } else {
        await invoke<void>('disable_autostart');
      }
      updateSettings('general', 'startWithWindows', checked);
    } catch (err) {
      logger.error('Failed to change autostart setting:', err);
      setError(
        `Failed to ${checked ? 'enable' : 'disable'} autostart: ${extractErrorMessage(err)}`
      );
    }
  };

  const handleRestartOnboarding = async () => {
    setIsRestartingOnboarding(true);
    try {
      const updated = { ...settings.general, hasSeenOnboarding: false };
      await settingsService.updateGeneralSettings(updated);
      await emit('volt://restart-onboarding', {});
      const currentWindow = getCurrentWindow();
      await currentWindow.close();
    } catch (err) {
      logger.error('Failed to restart onboarding:', err);
      setError(t('errors.saveFailed'));
      setIsRestartingOnboarding(false);
    }
  };

  const handleToggleWindowHotkeyChange = async (hotkey: string) => {
    setHotkeyError(null);
    try {
      await invoke<void>('set_global_hotkey', { newHotkey: hotkey });
      updateSettings('hotkeys', 'toggleWindow', hotkey);
    } catch (error) {
      const errorMsg = extractErrorMessage(error);
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
        await invoke<void>('start_clipboard_monitoring');
      } else {
        await invoke<void>('stop_clipboard_monitoring');
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
      <nav className="w-52 flex flex-col bg-surface border-r border-hairline py-3 shrink-0">
        <div className="px-4 pb-3 border-b border-hairline mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-transparent text-[22px]">
              <img src={logo} alt="Volt Logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-ink">Volt</span>
              <span className="text-xs text-ash">v{appVersion}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {SETTINGS_CATEGORIES.map((category) => {
            const showSection = category.section && category.section !== currentSection;
            if (category.section) currentSection = category.section;

            return (
              <div key={category.id}>
                {showSection && (
                  <div className="px-3 py-1 mt-3 text-[10px] font-medium text-ash uppercase tracking-widest">
                    {t('sections.builtIn')}
                  </div>
                )}
                <button
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 mx-0 w-full rounded-sm text-sm cursor-pointer transition-colors border-none text-left',
                    activeCategory === category.id
                      ? 'text-on-dark bg-surface-elevated'
                      : 'text-body hover:bg-surface-elevated hover:text-on-dark'
                  )}
                  onClick={() => setActiveCategory(category.id)}
                >
                  {category.iconSrc ? (
                    <img
                      src={category.iconSrc}
                      alt=""
                      className="w-[18px] h-[18px] shrink-0 rounded-[4px] object-contain"
                    />
                  ) : (
                    <category.icon size={18} className="shrink-0" />
                  )}
                  <span className="flex-1">
                    {t(
                      `sections.${category.id === 'file-search' ? 'fileSearch' : category.id === 'clipboard' ? 'clipboard' : category.id}`
                    )}
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
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
        <h2 className="text-sm font-medium text-ink m-0">{t('general.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('general.language')}</span>
          </div>
          <select
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong cursor-pointer"
            value={settings.general.language}
            onChange={(e) => {
              void handleLanguageChange(e.target.value as 'auto' | 'en' | 'fr');
            }}
          >
            <option value="auto">{t('general.languageAuto')}</option>
            <option value="en">{t('general.languageEn')}</option>
            <option value="fr">{t('general.languageFr')}</option>
          </select>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('general.followSystemAppearance')}</span>
          </div>
          <Toggle
            checked={settings.appearance.theme === 'auto'}
            onChange={(checked) => handleThemeChange(checked ? 'auto' : 'dark')}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('general.openAtLogin')}</span>
          </div>
          <Toggle
            checked={settings.general.startWithWindows}
            onChange={(checked) => {
              void handleAutostartChange(checked);
            }}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('general.closeOnLaunch')}</span>
          </div>
          <Toggle
            checked={settings.general.closeOnLaunch}
            onChange={(checked) => updateSettings('general', 'closeOnLaunch', checked)}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('general.featurePreview')}</span>
            <span className="text-xs text-mute mt-0.5">{t('general.featurePreviewDesc')}</span>
          </div>
          <Toggle
            checked={settings.general.featurePreview}
            onChange={(checked) => updateSettings('general', 'featurePreview', checked)}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('general.searchSensitivity')}</span>
            <span className="text-xs text-mute mt-0.5">{t('general.searchSensitivityDesc')}</span>
          </div>
          <select
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong cursor-pointer"
            value={settings.general.searchSensitivity ?? 'medium'}
            onChange={(e) =>
              updateSettings(
                'general',
                'searchSensitivity',
                e.target.value as 'low' | 'medium' | 'high'
              )
            }
          >
            <option value="low">{t('general.sensitivityLow')}</option>
            <option value="medium">{t('general.sensitivityMedium')}</option>
            <option value="high">{t('general.sensitivityHigh')}</option>
          </select>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body" id="hotkey-label">
              {t('general.voltHotkey')}
            </span>
            <span className="text-xs text-mute mt-0.5" id="hotkey-desc">
              {t('general.hotkeyDesc')}
            </span>
          </div>
          <div className="shrink-0">
            <HotkeyCapture
              value={settings.hotkeys.toggleWindow}
              onChange={(hotkey) => {
                void handleToggleWindowHotkeyChange(hotkey);
              }}
              onError={setHotkeyError}
              aria-labelledby="hotkey-label"
              aria-describedby="hotkey-desc"
            />
          </div>
        </div>

        {hotkeyError && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 bg-accent-red/10 border border-accent-red/20 rounded-md text-accent-red text-[13px] mb-4">
            <AlertCircle size={16} />
            <span>{hotkeyError}</span>
          </div>
        )}

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('general.restartOnboarding')}</span>
            <span className="text-xs text-mute mt-0.5">{t('general.restartOnboardingDesc')}</span>
          </div>
          <Button
            variant="secondary"
            disabled={isRestartingOnboarding}
            onClick={() => {
              void handleRestartOnboarding();
            }}
          >
            {isRestartingOnboarding ? <Spinner size="small" /> : <RefreshCw size={14} />}
            {t('general.restartOnboarding')}
          </Button>
        </div>
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
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
          <h2 className="text-sm font-medium text-ink m-0">{t('shortcuts.title')}</h2>
          <div className="flex items-center gap-2.5 flex-wrap">
            <input
              type="text"
              className="w-52 bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash"
              placeholder={t('shortcuts.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong cursor-pointer"
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
            <Button
              variant="secondary"
              onClick={() => {
                void syncAppShortcuts();
              }}
            >
              {t('shortcuts.syncApps')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {Object.entries(filteredShortcuts).map(([category, shortcuts]) => {
            const isExpanded = expandedCategories.has(category);

            return (
              <div key={category} className="mb-6">
                <div
                  className="flex items-center gap-2.5 px-4 py-3 cursor-pointer bg-surface-elevated/30 rounded-md mb-2 transition-colors hover:bg-surface-elevated/50 select-none"
                  onClick={() => toggleCategory(category)}
                >
                  {isExpanded ? (
                    <ChevronDown size={20} className="text-ash" />
                  ) : (
                    <ChevronRight size={20} className="text-ash" />
                  )}
                  <Package size={20} className="text-ash" />
                  <span className="flex-1 text-sm font-semibold text-ink">
                    {category} ({shortcuts.length})
                  </span>
                </div>

                {isExpanded && (
                  <div className="bg-surface-elevated/20 rounded-lg overflow-hidden">
                    <div
                      className="grid gap-4 px-4 py-2.5 bg-black/20 text-[12px] font-semibold text-mute uppercase tracking-[0.5px]"
                      style={{ gridTemplateColumns: '1fr 120px 160px 60px' }}
                    >
                      <span>{t('shortcuts.tableHeaders.name')}</span>
                      <span>{t('shortcuts.tableHeaders.alias')}</span>
                      <span>{t('shortcuts.tableHeaders.hotkey')}</span>
                      <span></span>
                    </div>

                    <div className="max-h-[400px] overflow-y-auto">
                      {shortcuts.map((shortcut) => (
                        <div
                          key={shortcut.id}
                          className="grid gap-4 px-4 py-3 items-center border-b border-hairline/40 last:border-0 transition-colors hover:bg-white/[0.03]"
                          style={{ gridTemplateColumns: '1fr 120px 160px 60px' }}
                        >
                          <span className="flex items-center gap-2.5 text-[13px] text-ink">
                            {shortcut.icon ? (
                              <img
                                src={`data:image/png;base64,${shortcut.icon}`}
                                alt=""
                                className="shrink-0"
                                style={{ width: 16, height: 16 }}
                              />
                            ) : (
                              <Package size={16} className="text-ash shrink-0" />
                            )}
                            {shortcut.name}
                          </span>
                          <span className="flex items-center pointer-events-auto">
                            {editingAliasId === shortcut.id ? (
                              <input
                                type="text"
                                className="w-full bg-surface-elevated border border-hairline rounded-md px-2 py-1 text-sm text-on-dark outline-none focus:border-hairline-strong"
                                defaultValue={shortcut.alias || ''}
                                autoFocus
                                onBlur={(e) => {
                                  void handleAliasChange(shortcut, e.target.value);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    void handleAliasChange(shortcut, e.currentTarget.value);
                                  } else if (e.key === 'Escape') {
                                    setEditingAliasId(null);
                                  }
                                }}
                              />
                            ) : (
                              <button
                                className="px-3 py-1.5 rounded-sm bg-transparent border border-dashed border-white/20 text-mute text-xs cursor-pointer transition-all hover:border-accent-blue hover:text-accent-blue whitespace-nowrap"
                                onClick={() => handleAliasClick(shortcut.id)}
                              >
                                {shortcut.alias || t('shortcuts.addAlias')}
                              </button>
                            )}
                          </span>
                          <span className="flex items-center pointer-events-auto">
                            <HotkeyCapture
                              value={shortcut.hotkey || ''}
                              onChange={(hotkey) => {
                                void handleHotkeyChange(shortcut, hotkey);
                              }}
                              onError={setHotkeyError}
                            />
                          </span>
                          <span className="flex items-center justify-center pointer-events-auto">
                            <Toggle
                              checked={shortcut.enabled}
                              onChange={() => {
                                void handleToggleEnabled(shortcut);
                              }}
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
            <div className="text-center py-10 text-mute">
              {appShortcuts.length === 0 ? t('shortcuts.noShortcuts') : t('shortcuts.noMatch')}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render Advanced section
  const renderAdvancedSection = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
        <h2 className="text-sm font-medium text-ink m-0">{t('advanced.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('advanced.showVoltOn')}</span>
          </div>
          <select
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong cursor-pointer"
            value={settings.appearance.windowPosition}
            onChange={(e) => {
              const position = e.target.value as WindowPosition;
              updateSettings('appearance', 'windowPosition', position);
              if (position !== 'custom') {
                void (async () => {
                  try {
                    await invoke<void>('set_window_position', {
                      position,
                      customX: null,
                      customY: null,
                    });
                  } catch (err) {
                    logger.error('Failed to set window position:', err);
                  }
                })();
              }
            }}
          >
            <option value="center">{t('advanced.positions.center')}</option>
            <option value="topCenter">{t('advanced.positions.topCenter')}</option>
            <option value="topLeft">{t('advanced.positions.topLeft')}</option>
            <option value="topRight">{t('advanced.positions.topRight')}</option>
          </select>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('advanced.showOnScreen')}</span>
            <span className="text-xs text-mute mt-0.5">{t('advanced.showOnScreenDesc')}</span>
          </div>
          <select
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong cursor-pointer"
            value={settings.general.showOnScreen ?? 'cursor'}
            onChange={(e) => {
              const value = e.target.value as ShowOnScreen;
              updateSettings('general', 'showOnScreen', value);
              void (async () => {
                try {
                  await invoke<void>('update_show_on_screen', { value });
                } catch (err) {
                  logger.error('Failed to update show_on_screen state:', err);
                }
              })();
            }}
          >
            <option value="cursor">{t('advanced.screenOptions.cursor')}</option>
            <option value="focusedWindow">{t('advanced.screenOptions.focusedWindow')}</option>
            <option value="primaryScreen">{t('advanced.screenOptions.primaryScreen')}</option>
          </select>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('advanced.maxResults')}</span>
            <span className="text-xs text-mute mt-0.5">{t('advanced.maxResultsDesc')}</span>
          </div>
          <select
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong cursor-pointer"
            value={settings.general.maxResults}
            onChange={(e) => updateSettings('general', 'maxResults', parseInt(e.target.value))}
          >
            <option value={5}>{t('advanced.results', { count: 5 })}</option>
            <option value={8}>{t('advanced.results', { count: 8 })}</option>
            <option value={10}>{t('advanced.results', { count: 10 })}</option>
            <option value={15}>{t('advanced.results', { count: 15 })}</option>
          </select>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('advanced.windowTransparency')}</span>
            <span className="text-xs text-mute mt-0.5">{t('advanced.transparencyDesc')}</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.05"
              value={settings.appearance.transparency}
              onChange={(e) =>
                updateSettings('appearance', 'transparency', parseFloat(e.target.value))
              }
              className="w-36 h-1 rounded-full bg-white/10 outline-none cursor-pointer appearance-none"
            />
            <span className="text-[13px] text-body min-w-[44px] text-right">
              {Math.round(settings.appearance.transparency * 100)}%
            </span>
          </div>
        </div>

        <div className="h-px bg-hairline my-5" />

        <h3 className="text-sm font-semibold text-ink mb-1.5">{t('advanced.theme')}</h3>

        <div className="flex gap-4">
          {(['light', 'dark', 'auto'] as const).map((themeOption) => (
            <button
              key={themeOption}
              className={cn(
                'flex-1 p-4 rounded-xl bg-surface-elevated/30 border-2 cursor-pointer transition-all flex flex-col items-center gap-3',
                settings.appearance.theme === themeOption
                  ? 'border-accent-blue bg-accent-blue/10'
                  : 'border-transparent hover:bg-surface-elevated/50'
              )}
              onClick={() => handleThemeChange(themeOption)}
            >
              <div
                className={cn(
                  'w-full h-[60px] rounded-md overflow-hidden flex flex-col',
                  themeOption === 'light' && 'bg-[#f3f4f6]',
                  themeOption === 'dark' && 'bg-[#1f2937]',
                  themeOption === 'auto' && 'bg-gradient-to-br from-[#f3f4f6] to-[#1f2937]'
                )}
              >
                <div
                  className={cn('h-3', themeOption === 'light' ? 'bg-black/10' : 'bg-white/10')}
                />
                <div
                  className={cn(
                    'flex-1 m-2 rounded-xs',
                    themeOption === 'light' ? 'bg-black/5' : 'bg-white/5'
                  )}
                />
              </div>
              <span
                className={cn(
                  'text-[13px] font-medium',
                  settings.appearance.theme === themeOption ? 'text-accent-blue' : 'text-body'
                )}
              >
                {t(`advanced.theme${themeOption.charAt(0).toUpperCase() + themeOption.slice(1)}`)}
              </span>
            </button>
          ))}
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

  const handleCheckForUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);
    setUpdateInfo(null);
    try {
      const channel = settings?.general.updateChannel ?? 'stable';
      const update = await checkForUpdate(channel);
      setUpdateInfo(update);
      setUpdateChecked(true);
    } catch (error) {
      logger.error('Failed to check for updates:', error);
      setUpdateError(error instanceof Error ? error.message : 'Failed to check for updates');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleSnooze = () => {
    snoozeUpdate();
    setUpdateInfo(null);
    setUpdateChecked(false);
  };

  const handleSkipVersion = () => {
    if (updateInfo?.version) skipVersion(updateInfo.version);
    setUpdateInfo(null);
    setUpdateChecked(false);
  };

  const handleDeferredInstall = async () => {
    setIsDeferring(true);
    setUpdateProgress(0);
    setUpdateError(null);
    try {
      await deferredInstall((progress) => {
        setUpdateProgress(progress.percentage);
      });
      setDeferralReady(true);
      setUpdateInfo(null);
    } catch (error) {
      logger.error('Failed to defer install:', error);
      setUpdateError(error instanceof Error ? error.message : 'Failed to download update');
    } finally {
      setIsDeferring(false);
    }
  };

  const handleCancelDeferral = () => {
    clearPendingUpdate();
    setDeferralReady(false);
  };

  const handleDownloadAndInstall = async () => {
    setIsUpdating(true);
    setUpdateProgress(0);
    setUpdateError(null);
    try {
      await downloadAndInstall((progress) => {
        setUpdateProgress(progress.percentage);
      });
    } catch (error) {
      logger.error('Failed to download/install update:', error);
      setUpdateError(error instanceof Error ? error.message : 'Failed to install update');
      setIsUpdating(false);
    }
  };

  // Render About section
  const renderAboutSection = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
        <h2 className="text-sm font-medium text-ink m-0">{t('about.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="text-center py-6 flex flex-col items-center">
          <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
            <img src={logo} alt="Volt Logo" className="w-full h-full object-contain" />
          </div>
          <h3 className="text-2xl font-bold text-ink mt-0 mb-1">Volt</h3>
          <p className="text-sm text-mute mt-0 mb-3">Version {appVersion}</p>
          <p className="text-sm text-body mt-0 max-w-[400px] mx-auto">{t('about.description')}</p>
        </div>

        <div className="h-px bg-hairline my-5" />

        <div className="flex flex-col gap-1">
          {[
            { icon: Globe, label: t('about.officialWebsite'), url: 'https://voltlaunchr.com' },
            {
              icon: Package,
              label: t('about.githubRepo'),
              url: 'https://github.com/VoltLaunchr/Volt',
            },
            {
              icon: Bug,
              label: t('about.reportIssue'),
              url: 'https://github.com/VoltLaunchr/Volt/issues/new',
            },
            {
              icon: FileText,
              label: t('about.releaseNotes'),
              url: 'https://github.com/VoltLaunchr/Volt/blob/main/CHANGELOG.md',
            },
          ].map(({ icon: Icon, label, url }) => (
            <button
              key={url}
              onClick={() => {
                void (async () => {
                  try {
                    const { openUrl } = await import('@tauri-apps/plugin-opener');
                    await openUrl(url);
                  } catch (error) {
                    logger.error('Failed to open URL:', error);
                  }
                })();
              }}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-body bg-transparent border-none w-full text-left text-[length:inherit] font-[inherit] cursor-pointer transition-colors hover:bg-white/5 hover:text-on-dark"
            >
              <Icon size={20} className="text-accent-blue shrink-0 transition-colors" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="h-px bg-hairline my-5" />

        <div className="flex flex-col gap-1">
          <button
            onClick={() => {
              void handleOpenLogsFolder();
            }}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-body bg-transparent border-none w-full text-left text-[length:inherit] font-[inherit] cursor-pointer transition-colors hover:bg-white/5 hover:text-on-dark"
          >
            <FolderOpen size={20} className="text-accent-blue shrink-0" />
            <span>{t('about.openLogs')}</span>
          </button>
          <button
            onClick={() => {
              void handleCopyDiagnostics();
            }}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-body bg-transparent border-none w-full text-left text-[length:inherit] font-[inherit] cursor-pointer transition-colors hover:bg-white/5 hover:text-on-dark"
          >
            {diagnosticsCopied ? (
              <Check size={20} className="text-accent-green shrink-0" />
            ) : (
              <Copy size={20} className="text-accent-blue shrink-0" />
            )}
            <span>{diagnosticsCopied ? t('about.copied') : t('about.copyDiagnostics')}</span>
          </button>
        </div>

        <div className="h-px bg-hairline my-5" />

        <div className="rounded-xl border border-hairline bg-surface/60 p-4 overflow-hidden">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 rounded-lg border border-accent-blue/20 bg-accent-blue/10 text-accent-blue flex items-center justify-center shrink-0">
                <RefreshCw size={15} />
              </span>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-ink m-0">{t('about.updates')}</h4>
                <p className="text-[11px] text-mute m-0 mt-0.5">Volt {appVersion || ''}</p>
              </div>
            </div>
            <div
              className="inline-flex rounded-lg border border-hairline bg-canvas p-0.5 shrink-0"
              aria-label={t('about.channel')}
            >
              {(['stable', 'beta'] as UpdateChannel[]).map((ch) => {
                const isActive = (settings?.general.updateChannel ?? 'stable') === ch;
                return (
                  <button
                    key={ch}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      const updated = {
                        ...settings,
                        general: { ...settings.general, updateChannel: ch },
                      };
                      setSettings(updated);
                      void settingsService.updateGeneralSettings(updated.general).catch(() => {});
                    }}
                    className={cn(
                      'px-2.5 py-1 rounded-md border-none text-[11px] font-medium cursor-pointer transition-colors',
                      isActive
                        ? 'bg-accent-blue text-white shadow-sm'
                        : 'bg-transparent text-mute hover:text-ink'
                    )}
                  >
                    {ch === 'stable' ? t('about.channelStable') : t('about.channelBeta')}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {/* Deferred update ready banner */}
            {deferralReady && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-accent-blue/10 border border-accent-blue/30 text-[13px] text-ink">
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-accent-blue shrink-0" />
                  <span>{t('about.deferralReady')}</span>
                </div>
                <button
                  onClick={handleCancelDeferral}
                  className="text-xs text-mute hover:text-body transition-colors cursor-pointer bg-transparent border-none"
                >
                  {t('about.cancelDeferral')}
                </button>
              </div>
            )}

            {!updateChecked && !isCheckingUpdate && !deferralReady && (
              <Button
                onClick={() => {
                  void handleCheckForUpdate();
                }}
                disabled={isCheckingUpdate}
                className="w-full justify-center bg-accent-blue text-white hover:bg-accent-blue/90"
              >
                <RefreshCw size={16} />
                {t('about.checkForUpdates')}
              </Button>
            )}
            {isCheckingUpdate && (
              <div className="flex items-center gap-2 rounded-lg border border-hairline bg-canvas/70 px-3 py-2.5 text-[13px] text-ink">
                <Spinner size="small" />
                <span>{t('about.checking')}</span>
              </div>
            )}
            {updateChecked && !updateInfo && !isCheckingUpdate && (
              <div className="flex items-center gap-2 rounded-lg border border-accent-green/20 bg-accent-green/10 px-3 py-2.5 text-[13px] text-ink">
                <CheckCircle size={16} className="text-accent-green" />
                <span>{t('about.upToDate')}</span>
                <Button
                  onClick={() => {
                    void handleCheckForUpdate();
                  }}
                  className="p-1 min-w-0 ml-auto"
                >
                  <RefreshCw size={14} />
                </Button>
              </div>
            )}
            {updateInfo && !isUpdating && !isDeferring && (
              <div className="flex flex-col gap-2">
                {/* Critical update banner */}
                {updateInfo.critical && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/30 text-[13px] text-accent-red font-medium">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>{t('about.criticalUpdate')}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[13px] text-ink">
                  <span>{t('about.updateAvailable')}</span>
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-accent-green text-on-dark">
                    v{updateInfo.version}
                    {updateInfo.isBeta ? ' beta' : ''}
                  </span>
                </div>
                {updateInfo.body && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-body">{t('about.whatsNew')}</span>
                    <div className="max-h-[150px] overflow-y-auto p-2 bg-surface border border-hairline rounded-md text-xs leading-relaxed text-body whitespace-pre-wrap">
                      {updateInfo.body}
                    </div>
                  </div>
                )}
                {updateInfo.isBeta ? (
                  <Button
                    onClick={() => {
                      void import('@tauri-apps/plugin-opener').then(({ openUrl }) =>
                        openUrl('https://github.com/VoltLaunchr/Volt/releases')
                      );
                    }}
                  >
                    <Download size={16} />
                    {t('about.downloadFromGitHub')}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => {
                        void handleDownloadAndInstall();
                      }}
                    >
                      <Download size={16} />
                      {t('about.downloadAndInstall')}
                    </Button>
                    {!updateInfo.critical && (
                      <Button
                        onClick={() => {
                          void handleDeferredInstall();
                        }}
                        className="bg-transparent border border-hairline hover:bg-white/5"
                      >
                        <Download size={16} />
                        {t('about.installOnNextRestart')}
                      </Button>
                    )}
                  </>
                )}
                {/* Snooze / Skip — hidden for critical updates */}
                {!updateInfo.critical && (
                  <div className="flex items-center gap-3 mt-1">
                    <button
                      onClick={handleSnooze}
                      className="text-xs text-mute hover:text-body transition-colors cursor-pointer bg-transparent border-none"
                    >
                      {t('about.remindLater')}
                    </button>
                    <button
                      onClick={handleSkipVersion}
                      className="text-xs text-mute hover:text-body transition-colors cursor-pointer bg-transparent border-none"
                    >
                      {t('about.skipVersion')}
                    </button>
                  </div>
                )}
              </div>
            )}
            {(isUpdating || isDeferring) && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[13px] text-ink">
                  <Spinner size="small" />
                  <span>
                    {isDeferring
                      ? t('about.deferring')
                      : updateProgress < 100
                        ? t('about.downloading')
                        : t('about.installing')}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-surface border border-hairline rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent-blue to-accent-green rounded-full transition-[width] duration-300"
                    style={{ width: `${updateProgress}%` }}
                  />
                </div>
                <span className="text-xs text-body text-right">{updateProgress}%</span>
              </div>
            )}
            {updateError && (
              <div className="flex items-center gap-2 text-[13px] text-accent-red">
                <AlertCircle size={16} />
                <span>{updateError}</span>
              </div>
            )}
          </div>
        </div>

        <div className="h-px bg-hairline my-5" />

        <div className="flex flex-col gap-1">
          <button
            onClick={() => {
              void (async () => {
                try {
                  const { save } = await import('@tauri-apps/plugin-dialog');
                  const path = await save({
                    filters: [{ name: 'JSON', extensions: ['json'] }],
                    defaultPath: 'volt-settings.json',
                  });
                  if (!path) return;
                  await settingsService.exportSettings(path);
                  setExportImportStatus({ type: 'success', message: t('about.exportSuccess') });
                  setTimeout(() => setExportImportStatus(null), 3000);
                } catch (error) {
                  logger.error('Failed to export settings:', error);
                  setExportImportStatus({ type: 'error', message: t('about.exportError') });
                  setTimeout(() => setExportImportStatus(null), 3000);
                }
              })();
            }}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-body bg-transparent border-none w-full text-left text-[length:inherit] font-[inherit] cursor-pointer transition-colors hover:bg-white/5 hover:text-on-dark"
          >
            <Download size={20} className="text-accent-blue shrink-0" />
            <span>{t('about.exportSettings')}</span>
          </button>
          <button
            onClick={() => {
              void (async () => {
                try {
                  const { open } = await import('@tauri-apps/plugin-dialog');
                  const path = await open({
                    filters: [{ name: 'JSON', extensions: ['json'] }],
                    multiple: false,
                  });
                  if (!path) return;
                  const imported = await settingsService.importSettings(path);
                  setSettings(imported);
                  setExportImportStatus({ type: 'success', message: t('about.importSuccess') });
                  setTimeout(() => setExportImportStatus(null), 3000);
                } catch (error) {
                  logger.error('Failed to import settings:', error);
                  setExportImportStatus({ type: 'error', message: t('about.importError') });
                  setTimeout(() => setExportImportStatus(null), 3000);
                }
              })();
            }}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-body bg-transparent border-none w-full text-left text-[length:inherit] font-[inherit] cursor-pointer transition-colors hover:bg-white/5 hover:text-on-dark"
          >
            <Upload size={20} className="text-accent-blue shrink-0" />
            <span>{t('about.importSettings')}</span>
          </button>
        </div>

        {exportImportStatus && (
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-sm text-[13px] mt-2',
              exportImportStatus.type === 'success'
                ? 'bg-accent-green/10 text-accent-green'
                : 'bg-accent-red/10 text-accent-red'
            )}
          >
            {exportImportStatus.type === 'success' ? (
              <Check size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            <span>{exportImportStatus.message}</span>
          </div>
        )}

        <div className="h-px bg-hairline my-5" />

        <div className="text-center">
          <p className="text-xs text-mute my-1">{t('about.copyright')}</p>
          <p className="text-xs text-mute my-1">{t('about.builtWith')}</p>
        </div>
      </div>
    </div>
  );

  // Render File Search section
  const renderFileSearchSection = () => {
    const selectDirectory = async (title: string): Promise<string | null> => {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({ directory: true, multiple: false, title });
        return typeof selected === 'string' ? selected : null;
      } catch (dialogError) {
        logger.error('Failed to open directory picker:', dialogError);
        return null;
      }
    };

    const addFolder = async () => {
      const folder = await selectDirectory(t('fileSearch.addFolder'));
      if (folder && !settings.indexing.folders.includes(folder)) {
        updateSettings('indexing', 'folders', [...settings.indexing.folders, folder]);
      }
    };

    const removeFolder = (index: number) => {
      const newFolders = settings.indexing.folders.filter((_, i) => i !== index);
      updateSettings('indexing', 'folders', newFolders);
    };

    const addExcludedPath = async () => {
      const path = await selectDirectory(t('fileSearch.addPath'));
      if (path && !settings.indexing.excludedPaths.includes(path)) {
        updateSettings('indexing', 'excludedPaths', [...settings.indexing.excludedPaths, path]);
      }
    };

    const removeExcludedPath = (index: number) => {
      const newPaths = settings.indexing.excludedPaths.filter((_, i) => i !== index);
      updateSettings('indexing', 'excludedPaths', newPaths);
    };

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
          <h2 className="text-sm font-medium text-ink m-0">{t('fileSearch.title')}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-body">{t('fileSearch.indexOnStartup')}</span>
              <span className="text-xs text-mute mt-0.5">{t('fileSearch.indexOnStartupDesc')}</span>
            </div>
            <Toggle
              checked={settings.indexing.indexOnStartup}
              onChange={(checked) => updateSettings('indexing', 'indexOnStartup', checked)}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-body">Deep Search</span>
              <span className="text-xs text-mute mt-0.5">
                Search up to 10 levels deep inside indexed folders (vs 3 by default)
              </span>
            </div>
            <Toggle
              checked={settings.indexing.deepSearch}
              onChange={(checked) => updateSettings('indexing', 'deepSearch', checked)}
            />
          </div>

          <div className="h-px bg-hairline my-5" />

          <h3 className="text-sm font-semibold text-ink mb-1.5">
            {t('fileSearch.foldersToIndex')}
          </h3>
          <p className="text-xs text-mute mb-4" id="folders-desc">
            {t('fileSearch.foldersToIndexDesc')}
          </p>

          <div className="flex flex-col gap-2" aria-describedby="folders-desc">
            {settings.indexing.folders.map((folder, index) => (
              <div
                key={index}
                className="flex items-center gap-2.5 px-3.5 py-2.5 bg-surface-elevated/30 rounded-md border border-hairline transition-all hover:bg-surface-elevated/50"
              >
                <Folder size={16} className="text-body shrink-0" />
                <span
                  className="flex-1 text-[13px] text-body font-mono whitespace-nowrap overflow-hidden text-ellipsis"
                  title={folder}
                >
                  {folder}
                </span>
                <button
                  className="w-7 h-7 rounded-md bg-transparent border-none text-ash cursor-pointer flex items-center justify-center transition-all hover:bg-accent-red/15 hover:text-accent-red"
                  onClick={() => removeFolder(index)}
                  title="Remove folder"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              className="flex items-center justify-center gap-1.5 py-3 rounded-md bg-transparent border border-dashed border-accent-blue/30 text-accent-blue text-[13px] font-medium cursor-pointer transition-all hover:bg-accent-blue/10 hover:border-accent-blue"
              onClick={() => {
                void addFolder();
              }}
            >
              <FolderPlus size={15} /> {t('fileSearch.addFolder')}
            </button>
          </div>

          <div className="h-px bg-hairline my-5" />

          <h3 className="text-sm font-semibold text-ink mb-1.5">
            {t('fileSearch.fileExtensions')}
          </h3>
          <p className="text-xs text-mute mb-4" id="extensions-desc">
            {t('fileSearch.fileExtensionsDesc')}
          </p>

          <input
            type="text"
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash w-full"
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

          <div className="h-px bg-hairline my-5" />

          <h3 className="text-sm font-semibold text-ink mb-1.5">{t('fileSearch.excludedPaths')}</h3>
          <p className="text-xs text-mute mb-4">{t('fileSearch.excludedPathsDesc')}</p>

          <div className="flex flex-col gap-2">
            {settings.indexing.excludedPaths.map((path, index) => (
              <div
                key={index}
                className="flex items-center gap-2.5 px-3.5 py-2.5 bg-surface-elevated/30 rounded-md border border-hairline transition-all hover:bg-surface-elevated/50"
              >
                <FolderX size={16} className="text-body shrink-0" />
                <span
                  className="flex-1 text-[13px] text-body font-mono whitespace-nowrap overflow-hidden text-ellipsis"
                  title={path}
                >
                  {path}
                </span>
                <button
                  className="w-7 h-7 rounded-md bg-transparent border-none text-ash cursor-pointer flex items-center justify-center transition-all hover:bg-accent-red/15 hover:text-accent-red"
                  onClick={() => removeExcludedPath(index)}
                  title="Remove excluded path"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              className="flex items-center justify-center gap-1.5 py-3 rounded-md bg-transparent border border-dashed border-accent-blue/30 text-accent-blue text-[13px] font-medium cursor-pointer transition-all hover:bg-accent-blue/10 hover:border-accent-blue"
              onClick={() => {
                void addExcludedPath();
              }}
            >
              <Plus size={15} /> {t('fileSearch.addPath')}
            </button>
          </div>

          <div className="h-px bg-hairline my-5" />

          <h3 className="text-sm font-semibold text-ink mb-1.5">{t('fileSearch.indexStatus')}</h3>
          <p className="text-xs text-mute mb-4">{t('fileSearch.indexStatusDesc')}</p>

          {indexStats ? (
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                {
                  label: t('fileSearch.stats.indexedFiles'),
                  value: indexStats.indexedCount.toLocaleString(),
                },
                {
                  label: t('fileSearch.stats.dbSize'),
                  value:
                    indexStats.dbSizeBytes > 0
                      ? `${(indexStats.dbSizeBytes / 1024).toFixed(1)} KB`
                      : '—',
                },
                {
                  label: t('fileSearch.stats.lastScan'),
                  value:
                    indexStats.lastFullScan > 0
                      ? new Date(indexStats.lastFullScan * 1000).toLocaleString()
                      : t('fileSearch.stats.never'),
                },
                {
                  label: t('fileSearch.stats.watcher'),
                  value: indexStats.isWatching
                    ? t('fileSearch.stats.active')
                    : t('fileSearch.stats.inactive'),
                  accent: indexStats.isWatching ? 'text-accent-green' : undefined,
                },
              ].map(({ label, value, accent }) => (
                <div
                  key={label}
                  className="flex flex-col gap-0.5 px-3 py-2.5 rounded-md bg-surface-elevated/20 border border-hairline"
                >
                  <span className="text-[11px] text-body uppercase tracking-[0.04em]">{label}</span>
                  <span className={cn('text-[13px] font-medium text-ink', accent)}>{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-mute mb-4">{t('fileSearch.loadingStats')}</p>
          )}

          <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0 mt-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-body">{t('fileSearch.stats.rebuild')}</span>
              <span className="text-xs text-mute mt-0.5">{t('fileSearch.stats.rebuildDesc')}</span>
            </div>
            <Button
              variant="secondary"
              disabled={isRebuilding}
              onClick={() => {
                setIsRebuilding(true);
                void (async () => {
                  try {
                    await invoke<void>('invalidate_index');
                    // Poll until indexing is done
                    const pollStats = () => {
                      void (async () => {
                        try {
                          const status = await invoke<{ isIndexing: boolean }>('get_index_status');
                          if (status.isIndexing) {
                            setTimeout(pollStats, 800);
                          } else {
                            await invoke<void>('start_file_watcher');
                            await fetchIndexStats();
                            setIsRebuilding(false);
                          }
                        } catch {
                          setIsRebuilding(false);
                        }
                      })();
                    };
                    setTimeout(pollStats, 500);
                  } catch (err) {
                    logger.error('Failed to rebuild index:', err);
                    setIsRebuilding(false);
                  }
                })();
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

  // Render Emoji & Symbols section
  const renderEmojiSection = () => {
    const skinTones: SkinTone[] = [
      'none',
      'light',
      'medium-light',
      'medium',
      'medium-dark',
      'dark',
    ];
    const skinToneEmoji: Record<SkinTone, string> = {
      none: '✋',
      light: '✋🏻',
      'medium-light': '✋🏼',
      medium: '✋🏽',
      'medium-dark': '✋🏾',
      dark: '✋🏿',
    };

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
          <h2 className="text-sm font-medium text-ink m-0">Emoji & Symbols</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between py-3 border-b border-hairline">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-body">Primary Action</span>
              <span className="text-xs text-mute mt-0.5">
                What happens when you select an emoji
              </span>
            </div>
            <select
              className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong cursor-pointer"
              value={emojiPrimaryAction}
              onChange={(e) => {
                const action = e.target.value as 'copy' | 'paste';
                setEmojiPrimaryActionState(action);
                setEmojiPrimaryAction(action);
              }}
            >
              <option value="copy">Copy to Clipboard</option>
              <option value="paste">Paste to Active App</option>
            </select>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-hairline">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-body">Grid Columns</span>
              <span className="text-xs text-mute mt-0.5">
                Number of columns in the emoji grid ({emojiColumns})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={4}
                max={12}
                step={1}
                value={emojiColumns}
                className="w-28 accent-accent-blue"
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setEmojiColumnsState(n);
                  setEmojiColumns(n);
                }}
              />
              <span className="text-sm text-mute w-4 text-right">{emojiColumns}</span>
            </div>
          </div>

          <div className="py-3 border-b border-hairline">
            <div className="flex flex-col gap-0.5 mb-4">
              <span className="text-sm text-body">Skin Tone</span>
              <span className="text-xs text-mute mt-0.5">
                Default skin tone for emojis that support it
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {skinTones.map((tone) => (
                <button
                  key={tone}
                  title={getSkinToneDisplayName(tone)}
                  className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border-2 cursor-pointer transition-all ${
                    emojiSkinTone === tone
                      ? 'border-accent-blue bg-accent-blue/10'
                      : 'border-hairline bg-surface-elevated/30 hover:bg-surface-elevated/60'
                  }`}
                  onClick={() => {
                    setEmojiSkinToneState(tone);
                    setPreferredSkinTone(tone);
                  }}
                >
                  <span className="text-2xl leading-none">{skinToneEmoji[tone]}</span>
                  <span className="text-[10px] text-mute whitespace-nowrap">
                    {getSkinToneDisplayName(tone)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Applications section
  const renderApplicationsSection = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
        <h2 className="text-sm font-medium text-ink m-0">{t('applications.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-start gap-3 px-3.5 py-3.5 bg-accent-blue/8 border border-accent-blue/20 rounded-lg mb-5">
          <Lightbulb size={20} className="text-accent-blue shrink-0 mt-0.5" />
          <p className="m-0 text-[13px] text-body leading-relaxed">{t('applications.infoText')}</p>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('applications.scanApps')}</span>
            <span className="text-xs text-mute mt-0.5">{t('applications.scanAppsDesc')}</span>
          </div>
          <Button
            variant="secondary"
            disabled={isScanningApps}
            onClick={() => {
              void (async () => {
                setIsScanningApps(true);
                setScanResult(null);
                try {
                  const apps = await invoke<unknown[]>('scan_applications');
                  setScanResult({ count: apps.length, error: null });
                } catch (err) {
                  logger.error('Failed to scan applications:', err);
                  setScanResult({ count: 0, error: extractErrorMessage(err) });
                } finally {
                  setIsScanningApps(false);
                }
              })();
            }}
          >
            {isScanningApps ? t('applications.scanning') : t('applications.scanNow')}
          </Button>
        </div>
        {scanResult && (
          <div className="flex items-start gap-3 px-3.5 py-3.5 bg-accent-blue/8 border border-accent-blue/20 rounded-lg mt-2">
            {scanResult.error ? (
              <p className="m-0 text-[13px] text-accent-red">
                {t('applications.scanError', { error: scanResult.error })}
              </p>
            ) : (
              <p className="m-0 text-[13px] text-body">
                {t('applications.scanResult', { count: scanResult.count })}
              </p>
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
      {
        id: 'system-commands',
        nameKey: 'plugins.names.systemCommands',
        icon: Terminal,
        builtin: true,
      },
      { id: 'timer', nameKey: 'plugins.names.timer', icon: Clock, builtin: true },
      {
        id: 'system-monitor',
        nameKey: 'plugins.names.systemMonitor',
        icon: Activity,
        builtin: true,
      },
      { id: 'steam-games', nameKey: 'plugins.names.games', icon: Gamepad2, builtin: true },
      {
        id: 'clipboard-manager',
        nameKey: 'plugins.names.clipboardHistory',
        icon: ClipboardIcon,
        builtin: true,
      },
    ];

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
          <h2 className="text-sm font-medium text-ink m-0">{t('plugins.title')}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex flex-col gap-2">
            {plugins.map((plugin) => {
              const isEnabled = settings.plugins.enabledPlugins.includes(plugin.id);
              return (
                <div
                  key={plugin.id}
                  className="flex items-center gap-3 px-4 py-3 bg-surface-elevated/30 rounded-lg transition-colors hover:bg-surface-elevated/50"
                >
                  {React.createElement(plugin.icon, {
                    size: 20,
                    className: 'text-accent-blue shrink-0',
                  })}
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{t(plugin.nameKey)}</span>
                    {plugin.builtin && (
                      <span className="px-2 py-0.5 rounded-xs bg-accent-blue/15 text-accent-blue text-[10px] font-semibold uppercase">
                        {t('plugins.builtin')}
                      </span>
                    )}
                  </div>
                  <Toggle
                    checked={isEnabled}
                    onChange={(checked) => {
                      void handlePluginToggle(plugin.id, checked);
                    }}
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
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
        <h2 className="text-sm font-medium text-ink m-0">{t('clipboard.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-start gap-3 px-3.5 py-3.5 bg-accent-blue/8 border border-accent-blue/20 rounded-lg mb-5">
          <ClipboardIcon size={20} className="text-accent-blue shrink-0 mt-0.5" />
          <p className="m-0 text-[13px] text-body leading-relaxed">
            {t('clipboard.infoText')}{' '}
            <kbd className="px-1.5 py-0.5 rounded-xs bg-black/30 font-mono text-xs">cb</kbd>{' '}
            {t('clipboard.infoTextSuffix')}
          </p>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('clipboard.monitoring')}</span>
            <span className="text-xs text-mute mt-0.5">{t('clipboard.monitoringDesc')}</span>
          </div>
          <Toggle
            checked={settings.plugins.clipboardMonitoring}
            onChange={(checked) => {
              void handleClipboardMonitoringToggle(checked);
            }}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">Keep History For</span>
            <span className="text-xs text-mute mt-0.5">How long to retain clipboard entries</span>
          </div>
          <select
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong cursor-pointer"
            value={settings.plugins.clipboardRetentionDays}
            onChange={(e) => {
              const days = parseInt(e.target.value, 10);
              updateSettings('plugins', 'clipboardRetentionDays', days);
              void invoke<void>('set_clipboard_retention_days', { days }).catch((err) => {
                logger.error('Failed to update clipboard retention:', err);
              });
            }}
          >
            <option value={7}>1 Week</option>
            <option value={14}>2 Weeks</option>
            <option value={30}>1 Month</option>
            <option value={90}>3 Months</option>
            <option value={0}>Forever</option>
          </select>
        </div>

        <div className="py-3 border-b border-hairline last:border-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-body">Disabled Applications</span>
              <span className="text-xs text-mute mt-0.5">
                Clipboard changes from these apps will not be recorded
              </span>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                const name = window.prompt('Enter executable name to exclude (e.g. 1password):');
                if (name?.trim()) {
                  const newList = [
                    ...settings.plugins.clipboardDisabledApps,
                    name.trim().toLowerCase(),
                  ];
                  updateSettings('plugins', 'clipboardDisabledApps', newList);
                  void invoke<void>('set_clipboard_disabled_apps', { apps: newList }).catch(
                    (err) => {
                      logger.error('Failed to update clipboard disabled apps:', err);
                    }
                  );
                }
              }}
            >
              + Add
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {settings.plugins.clipboardDisabledApps.length === 0 ? (
              <p className="text-xs text-stone italic">No applications excluded</p>
            ) : (
              settings.plugins.clipboardDisabledApps.map((app, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2.5 px-3 py-2 bg-surface-elevated/30 rounded-md border border-hairline"
                >
                  <span className="flex-1 text-[13px] text-body font-mono">{app}</span>
                  <button
                    className="w-6 h-6 rounded-sm bg-transparent border-none text-ash text-lg cursor-pointer flex items-center justify-center transition-all hover:bg-accent-red/15 hover:text-accent-red"
                    onClick={() => {
                      const newList = settings.plugins.clipboardDisabledApps.filter(
                        (_, i) => i !== index
                      );
                      updateSettings('plugins', 'clipboardDisabledApps', newList);
                      void invoke<void>('set_clipboard_disabled_apps', { apps: newList }).catch(
                        (err) => {
                          logger.error('Failed to update clipboard disabled apps:', err);
                        }
                      );
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('clipboard.clearHistory')}</span>
            <span className="text-xs text-mute mt-0.5">{t('clipboard.clearHistoryDesc')}</span>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              void (async () => {
                try {
                  await invoke<void>('clear_clipboard_history');
                } catch (err) {
                  logger.error('Failed to clear clipboard history:', err);
                  setError(t('errors.saveFailed'));
                }
              })();
            }}
          >
            {t('clipboard.clear')}
          </Button>
        </div>
      </div>
    </div>
  );

  // Render Shell Commands section
  const renderShellSection = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
        <h2 className="text-sm font-medium text-ink m-0">{t('shell.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-start gap-3 px-3.5 py-3.5 bg-accent-blue/8 border border-accent-blue/20 rounded-lg mb-5">
          <Terminal size={20} className="text-accent-blue shrink-0 mt-0.5" />
          <p className="m-0 text-[13px] text-body leading-relaxed">
            {t('shell.infoText')}{' '}
            <kbd className="px-1.5 py-0.5 rounded-xs bg-black/30 font-mono text-xs">&gt;</kbd>{' '}
            {t('shell.infoTextSuffix')}
          </p>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('shell.enabled')}</span>
            <span className="text-xs text-mute mt-0.5">{t('shell.enabledDesc')}</span>
          </div>
          <Toggle
            checked={settings.shell?.enabled ?? true}
            onChange={(enabled) => updateSettings('shell', 'enabled', enabled)}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('shell.defaultShell')}</span>
            <span className="text-xs text-mute mt-0.5">{t('shell.defaultShellDesc')}</span>
          </div>
          <input
            type="text"
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash"
            placeholder={t('shell.defaultShellPlaceholder')}
            value={settings.shell?.defaultShell ?? ''}
            onChange={(e) => updateSettings('shell', 'defaultShell', e.target.value || null)}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('shell.workingDir')}</span>
            <span className="text-xs text-mute mt-0.5">{t('shell.workingDirDesc')}</span>
          </div>
          <input
            type="text"
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash"
            placeholder={t('shell.workingDirPlaceholder')}
            value={settings.shell?.workingDir ?? ''}
            onChange={(e) => updateSettings('shell', 'workingDir', e.target.value || null)}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('shell.timeout')}</span>
            <span className="text-xs text-mute mt-0.5">{t('shell.timeoutDesc')}</span>
          </div>
          <input
            type="number"
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong"
            min={1000}
            max={300000}
            step={1000}
            value={settings.shell?.timeoutMs ?? 30000}
            onChange={(e) =>
              updateSettings('shell', 'timeoutMs', Math.max(1000, Number(e.target.value)))
            }
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('shell.historySize')}</span>
            <span className="text-xs text-mute mt-0.5">{t('shell.historySizeDesc')}</span>
          </div>
          <input
            type="number"
            className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong"
            min={0}
            max={5000}
            step={50}
            value={settings.shell?.historySize ?? 500}
            onChange={(e) =>
              updateSettings('shell', 'historySize', Math.max(0, Number(e.target.value)))
            }
          />
        </div>

        <div className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-body">{t('shell.clearHistory')}</span>
            <span className="text-xs text-mute mt-0.5">{t('shell.clearHistoryDesc')}</span>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              void (async () => {
                try {
                  await invoke<void>('clear_shell_history');
                } catch (err) {
                  logger.error('Failed to clear shell history:', err);
                  setError(t('shell.clearFailed'));
                }
              })();
            }}
          >
            {t('shell.clear')}
          </Button>
        </div>
      </div>
    </div>
  );

  // Render main content
  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex-1 flex items-center justify-center">
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
      case 'account':
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
              <h2 className="text-sm font-medium text-ink m-0">{t('account.title', 'Account')}</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <AccountSection />
            </div>
          </div>
        );
      case 'integrations':
        return <IntegrationsPanel />;
      case 'sync':
        return <SyncPanel />;
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
      case 'shell':
        return renderShellSection();
      case 'emoji':
        return renderEmojiSection();
      case 'ai':
        return <AiSettingsView />;
      case 'notes':
        return <NotesSettingsPanel />;
      default:
        return renderGeneralSection();
    }
  };

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink overflow-hidden">
      {/* Custom title bar */}
      <div
        className="flex items-center justify-between h-8 px-3 bg-black/30 border-b border-hairline shrink-0 select-none"
        data-tauri-drag-region
      >
        <span className="text-[13px] font-medium text-mute">{t('titlebar')}</span>
        <div className="no-drag flex gap-2">
          <button
            className="w-7 h-7 rounded-sm bg-transparent border-none text-ash text-lg cursor-pointer flex items-center justify-center transition-colors hover:bg-white/10 hover:text-on-dark"
            onClick={() => {
              void handleMinimize();
            }}
          >
            <span>−</span>
          </button>
          <button
            className="w-7 h-7 rounded-sm bg-transparent border-none text-ash text-lg cursor-pointer flex items-center justify-center transition-colors hover:bg-accent-red/20 hover:text-accent-red"
            onClick={() => {
              void handleClose();
            }}
          >
            <span>×</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {renderSidebar()}

        <main className="flex-1 flex flex-col overflow-hidden relative">
          {error && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-accent-red/10 border-b border-accent-red/20 text-accent-red text-[13px]">
              <span>{error}</span>
              <button
                className="w-6 h-6 rounded-sm bg-transparent border-none text-accent-red text-lg cursor-pointer hover:bg-accent-red/20"
                onClick={() => setError(null)}
              >
                ×
              </button>
            </div>
          )}

          {renderContent()}

          {hasChanges && (
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-6 py-3 bg-black/30 border-t border-hairline">
              <span className="text-[13px] text-body">{t('saveBar.unsavedChanges')}</span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    void loadSettings();
                  }}
                >
                  {t('saveBar.discard')}
                </Button>
                <Button
                  variant="default"
                  onClick={() => {
                    void handleSave();
                  }}
                  disabled={isSaving}
                >
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
