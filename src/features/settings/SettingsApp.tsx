import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { resolveAppLanguage } from '../../i18n';
import { Folder, FolderPlus, FolderX, Plus, RefreshCw } from 'lucide-react';
import { Button, HotkeyCapture, Spinner } from '../../shared/components/ui';
import { extractErrorMessage } from '../../shared/utils/error';
import { logger } from '../../shared/utils/logger';
import { applyTheme, settingsService } from './services/settingsService';
import { formatIndexDiagnostics, type IndexDiagnostics } from './services/indexDiagnostics';
import {
  applyWindowOpacity,
  clampTransparency,
  TRANSPARENCY_MAX,
  TRANSPARENCY_MIN,
  TRANSPARENCY_STEP,
} from './services/appearanceService';
import { previewAppearanceOnMain } from '../window/services/windowEffectService';
import {
  DEFAULT_SETTINGS,
  Settings,
  Theme,
  WindowEffect,
  WindowPosition,
  ShowOnScreen,
  AppShortcut,
  GeneralSettings,
} from './types/settings.types';
import { PLUGIN_PAGE_IDS, type SettingsCategory } from './constants/settingsCategories';
import { ExtensionsStore } from '../extensions';
import { AiSettingsView } from './components/AiSettingsView';
import { IntegrationsPanel } from './components/IntegrationsPanel';
import { NotesSettingsPanel } from './components/NotesSettingsPanel';
import { WebSearchSettingsPanel } from './components/WebSearchSettingsPanel';
import { webSearchHistory } from '../web-search';
import { stripShortcutIcon } from './hooks/useShortcutAppIcons';
import { SyncPanel } from './components/SyncPanel';
import { AccountSection } from '../auth';
import { cn } from '@/lib/utils';
import {
  SettingsNavigation,
  SettingsPageHeader,
  SettingsStatus,
  SettingsBody,
  SettingsSelect,
  SettingsTitleBar,
  type SettingsBadges,
} from './components/SettingsChrome';
import {
  SettingsGate,
  SettingsList,
  SettingsListItem,
  SettingsNote,
  SettingsPluginSection,
  SettingsRow,
  SettingsSection as RegistrySection,
  type SettingsPluginState,
} from './components/SettingsPrimitives';
import { AboutPage } from './pages/AboutPage';
import { CalculatorPage } from './pages/CalculatorPage';
import { EmojiPage } from './pages/EmojiPage';
import { GamesPage } from './pages/GamesPage';
import { LauncherPage } from './pages/LauncherPage';
import { KeyboardPage } from './pages/KeyboardPage';
import {
  QuicklinksPage,
  SystemMonitorPage,
  TimerPage,
  WindowManagementPage,
} from './pages/PluginOptionPages';
import { PluginsPage } from './pages/PluginsPage';
import { ShortcutsPage } from './pages/ShortcutsPage';
import { SnippetsPage } from './pages/SnippetsPage';
import { useSettingsHistory } from './hooks/useSettingsHistory';
import { useAccountSummary } from './hooks/useAccountSummary';
import { useUpdateController } from './hooks/useUpdateController';
import { SettingsPageContext } from './hooks/settingsPageContext';
import { scrollToRow, scrollToSection } from './registry/scrollToRow';
import { parseSettingsHash, type SettingsLinkTarget } from './registry/settingsHash';
import type { SettingsSearchResult } from './registry/settingsSearch';
import { settingsSectionDomId } from './registry/settingsRegistry';
import { resolveSettingsTarget } from './registry/settingsTarget';
import './settings.css';
import { Input } from '@/shared/components/ui/input';
import { Switch } from '@/shared/components/ui/switch';
import { Slider } from '@/shared/components/ui/slider';
import { addClipboardAppExclusion, normalizeClipboardAppName } from './clipboardExclusions';

/** A deep-link target may render after an async load: poll briefly before giving up. */
const SCROLL_RETRIES = 15;
const SCROLL_RETRY_MS = 100;

export function SettingsApp() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // Deep-link support: openSettingsWindow(section) injects the page, section or row id into
  // window.location.hash so the window can land on the right place without a round-trip event.
  // Falls back to 'general' if absent or unknown.
  const [initialTarget] = useState(() =>
    typeof window === 'undefined'
      ? null
      : resolveSettingsTarget(parseSettingsHash(window.location.hash))
  );
  const history = useSettingsHistory<SettingsCategory>(() => initialTarget?.pageId ?? 'general');
  const activeCategory = history.current;
  const navigate = history.navigate;
  const account = useAccountSummary();
  // Deep-link target; `nonce` makes a repeated request for the same row scroll again.
  const [scrollRequest, setScrollRequest] = useState<{
    kind: 'row' | 'section';
    id: string;
    nonce: number;
  } | null>(() =>
    initialTarget && initialTarget.kind !== 'page'
      ? { kind: initialTarget.kind, id: initialTarget.id, nonce: 1 }
      : null
  );
  const [clipboardAppDraft, setClipboardAppDraft] = useState('');
  const [showClipboardAppForm, setShowClipboardAppForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isRestartingOnboarding, setIsRestartingOnboarding] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [appShortcuts, setAppShortcuts] = useState<AppShortcut[]>([]);
  // Applications are listed from the cache filled at launch: no manual scan, just state flags.
  const [appShortcutsLoaded, setAppShortcutsLoaded] = useState(false);
  const [isRefreshingApps, setIsRefreshingApps] = useState(false);
  const appRefreshRef = useRef<Promise<void> | null>(null);
  const appRefreshAgainRef = useRef(false);
  const update = useUpdateController(settings.general.updateChannel ?? 'stable');
  const [appVersion, setAppVersion] = useState<string>('');
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
  const [indexStats, setIndexStats] = useState<IndexDiagnostics | null>(null);
  const [indexStatsLoadState, setIndexStatsLoadState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [indexReportCopied, setIndexReportCopied] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);

  // Fetch DB index stats
  const fetchIndexStats = useCallback(async () => {
    setIndexStatsLoadState('loading');
    try {
      const stats = await invoke<IndexDiagnostics>('get_db_index_stats');
      setIndexStats(stats);
      setIndexStatsLoadState('ready');
    } catch (err) {
      logger.error('Failed to fetch index stats:', err);
      setIndexStatsLoadState('error');
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

  // Switch to a target section when the main window pings us via Tauri event.
  // This covers the case where the settings window is already open — the URL
  // hash only fires on initial mount, so we need a second channel.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<SettingsLinkTarget>('volt://settings-navigate', (e) => {
        const target = resolveSettingsTarget(e.payload ?? {});
        if (!target) return;
        navigate(target.pageId);
        if (target.kind === 'page') return;
        const { kind, id } = target;
        setScrollRequest((previous) => ({ kind, id, nonce: (previous?.nonce ?? 0) + 1 }));
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [navigate]);

  // App shortcuts are persisted by dedicated commands, but `handleSave` writes the
  // whole `settings` snapshot back. Keep that snapshot in step with the backend so
  // a later save cannot overwrite aliases/hotkeys with a stale copy.
  const applyAppShortcuts = useCallback((shortcuts: AppShortcut[]) => {
    setAppShortcuts(shortcuts);
    setSettings((prev) => ({ ...prev, shortcuts: { ...prev.shortcuts, appShortcuts: shortcuts } }));
  }, []);

  const loadAppShortcuts = useCallback(async () => {
    try {
      const shortcuts = await invoke<AppShortcut[]>('get_app_shortcuts');
      applyAppShortcuts(shortcuts);
      if (shortcuts.length > 0) setAppShortcutsLoaded(true);
    } catch (err) {
      logger.error('Failed to load app shortcuts:', err);
    }
  }, [applyAppShortcuts]);

  // Read the latest catalog without scanning. Coalesce startup, navigation and scan events.
  const refreshAppShortcuts = useCallback(
    (catalogChanged = false) => {
      if (appRefreshRef.current) {
        // Do not lose a scan-completion event arriving during an older catalog read.
        if (catalogChanged) appRefreshAgainRef.current = true;
        return appRefreshRef.current;
      }
      const pending = (async () => {
        setIsRefreshingApps(true);
        try {
          do {
            appRefreshAgainRef.current = false;
            const shortcuts = await invoke<AppShortcut[]>('sync_app_shortcuts', { force: false });
            applyAppShortcuts(shortcuts);
          } while (appRefreshAgainRef.current);
        } catch (err) {
          logger.error('Failed to refresh app shortcuts:', err);
        } finally {
          appRefreshRef.current = null;
          setAppShortcutsLoaded(true);
          setIsRefreshingApps(false);
        }
      })();
      appRefreshRef.current = pending;
      return pending;
    },
    [applyAppShortcuts]
  );

  const isAppListPage = activeCategory === 'shortcuts' || activeCategory === 'applications';
  useEffect(() => {
    if (!isAppListPage) return;
    void (async () => {
      await loadAppShortcuts();
      await refreshAppShortcuts();
    })();
  }, [isAppListPage, loadAppShortcuts, refreshAppShortcuts]);

  // A background scan elsewhere (main window) finished: pick up the new list without any click.
  useEffect(() => {
    if (!isAppListPage) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen('apps:scan-finished', () => void refreshAppShortcuts(true));
        if (cancelled) stop();
        else unlisten = stop;
      } catch (err) {
        logger.warn('Failed to subscribe to app scan updates:', err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isAppListPage, refreshAppShortcuts]);

  const saveAppShortcut = useCallback(
    async (shortcut: AppShortcut) => {
      try {
        await invoke<void>('save_app_shortcut', { shortcut: stripShortcutIcon(shortcut) });
        await loadAppShortcuts();
      } catch (err) {
        logger.error('Failed to save app shortcut:', err);
        setError(t('errors.saveFailed'));
      }
    },
    [loadAppShortcuts, t]
  );

  const handleSave = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    setError(null);
    try {
      await settingsService.saveSettings(settings);
      setHasChanges(false);
      return true;
    } catch (err) {
      setError(t('errors.saveFailed'));
      logger.error('Failed to save settings:', err);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [settings, t]);

  const handleClose = useCallback(async () => {
    if (hasChanges && !(await handleSave())) {
      return;
    }
    const currentWindow = getCurrentWindow();
    await currentWindow.close();
  }, [handleSave, hasChanges]);

  // Escape follows the same save-before-close contract as the title-bar button, unless the user
  // turned "Escape closes secondary windows" off (Settings -> Keyboard).
  const escapeCloses = settings.keyboard?.escapeClosesSecondaryWindows !== false;
  useEffect(() => {
    if (!escapeCloses) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, escapeCloses]);

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

  /** Merges several keys of one settings section at once (marks the page as unsaved). */
  const patchSettings = useCallback(
    <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => {
      setSettings((prev) => ({ ...prev, [section]: { ...prev[section], ...patch } }));
      setHasChanges(true);
    },
    []
  );

  /** Update controls persist at once (no save bar), like the update channel always did. */
  const handleGeneralChange = useCallback(
    (patch: Partial<GeneralSettings>) => {
      const general = { ...settings.general, ...patch };
      setSettings((prev) => ({ ...prev, general: { ...prev.general, ...patch } }));
      void settingsService.updateGeneralSettings(general).catch((err) => {
        logger.error('Failed to persist general settings:', err);
        setError(t('errors.saveFailed'));
      });
    },
    [settings.general, t]
  );

  const handleWebSearchSettingsUpdated = useCallback((webSearch: Settings['webSearch']) => {
    setSettings((current) => ({ ...current, webSearch }));
  }, []);

  const handleThemeChange = useCallback(
    (theme: Theme) => {
      updateSettings('appearance', 'theme', theme);
      applyTheme(theme);
    },
    [updateSettings]
  );

  const handleWindowEffectChange = useCallback(
    (windowEffect: WindowEffect) => {
      const nextAppearance = {
        ...settings.appearance,
        windowEffect,
      };
      updateSettings('appearance', 'windowEffect', windowEffect);
      applyWindowOpacity(nextAppearance.transparency, windowEffect);
      void previewAppearanceOnMain(nextAppearance);
    },
    [settings.appearance, updateSettings]
  );

  const handleTransparencyChange = useCallback(
    (transparency: number) => {
      const clamped = clampTransparency(transparency);
      const nextAppearance = {
        ...settings.appearance,
        transparency: clamped,
      };
      updateSettings('appearance', 'transparency', clamped);
      applyWindowOpacity(clamped, nextAppearance.windowEffect);
      void previewAppearanceOnMain(nextAppearance);
    },
    [settings.appearance, updateSettings]
  );

  const handleLanguageChange = useCallback(
    async (language: 'auto' | 'en' | 'fr') => {
      updateSettings('general', 'language', language);

      const resolvedLng = await resolveAppLanguage(language);

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

  /** Registers the "open Settings" global shortcut with the OS, then records it (empty clears). */
  const handleOpenSettingsHotkeyChange = async (hotkey: string) => {
    try {
      await invoke<void>('set_open_settings_hotkey', { newHotkey: hotkey });
    } catch (err) {
      logger.error('Failed to set the open-settings hotkey:', err);
      throw new Error(extractErrorMessage(err), { cause: err });
    }
    updateSettings('hotkeys', 'openSettings', hotkey);
  };

  const handlePluginToggle = (pluginId: string, enabled: boolean) => {
    const currentPlugins = settings.plugins.enabledPlugins;
    const newPlugins = enabled
      ? currentPlugins.includes(pluginId)
        ? currentPlugins
        : [...currentPlugins, pluginId]
      : currentPlugins.filter((id) => id !== pluginId);
    updateSettings('plugins', 'enabledPlugins', newPlugins);
  };

  /** Activation switch of the plugin a Settings page configures (see `PLUGIN_PAGE_IDS`). */
  const pluginStateFor = (page: SettingsCategory): SettingsPluginState => {
    const pluginId = PLUGIN_PAGE_IDS[page] ?? '';
    return {
      enabled: settings.plugins.enabledPlugins.includes(pluginId),
      onToggle: (enabled) => handlePluginToggle(pluginId, enabled),
    };
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

  // Wait for the target page to render (and settings to load) before scrolling to its row. Some
  // pages fill their rows after an async load (account, sync...), so retry for a short while.
  useEffect(() => {
    if (!scrollRequest || isLoading) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryScroll = () => {
      const reached =
        scrollRequest.kind === 'row'
          ? scrollToRow(scrollRequest.id)
          : scrollToSection(scrollRequest.id);
      attempts += 1;
      if (!reached && attempts < SCROLL_RETRIES) timer = setTimeout(tryScroll, SCROLL_RETRY_MS);
    };
    const frame = requestAnimationFrame(tryScroll);
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [scrollRequest, isLoading, activeCategory]);

  // Search results open their page, then the scroll effect above reaches the row or section.
  const handleOpenSearchResult = useCallback(
    (result: SettingsSearchResult) => {
      navigate(result.pageId);
      const { kind, id } = result;
      if (kind === 'page') return;
      setScrollRequest((previous) => ({ kind, id, nonce: (previous?.nonce ?? 0) + 1 }));
    },
    [navigate]
  );

  // Sidebar badges: plan gate on Sync and a pending update on About.
  const navBadges = useMemo<SettingsBadges>(() => {
    const badges: SettingsBadges = {};
    if (account.loaded && (account.tier === null || account.tier === 'free')) {
      badges.sync = t('navigation.badges.pro');
    }
    if (update.info) badges.about = t('navigation.badges.update');
    return badges;
  }, [account.loaded, account.tier, update.info, t]);

  // Mouse back/forward buttons and Alt+Arrow walk the page history like a browser.
  useEffect(() => {
    const onMouse = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        history.back();
      } else if (event.button === 4) {
        event.preventDefault();
        history.forward();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        history.back();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        history.forward();
      }
    };
    window.addEventListener('mouseup', onMouse);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mouseup', onMouse);
      window.removeEventListener('keydown', onKey);
    };
  }, [history]);

  // Navigation keeps category IDs stable for deep links and cross-window events.
  const renderSidebar = () => (
    <SettingsNavigation
      activeCategory={activeCategory}
      onSelect={navigate}
      onOpenResult={handleOpenSearchResult}
      version={appVersion}
      badges={navBadges}
      account={account}
    />
  );

  // Purposeful groups keep everyday preferences separate from advanced setup.
  const renderGeneralSection = () => (
    <div className="settings-page">
      <SettingsPageHeader category="general" />
      <SettingsBody className="gap-4">
        <RegistrySection sectionId="general.personalization">
          <SettingsRow rowId="general.personalization.language" htmlFor="settings-language">
            <SettingsSelect
              id="settings-language"
              label={t('general.language')}
              value={settings.general.language}
              options={[
                { value: 'auto', label: t('general.languageAuto') },
                { value: 'en', label: t('general.languageEn') },
                { value: 'fr', label: t('general.languageFr') },
              ]}
              onValueChange={(value) => void handleLanguageChange(value)}
            />
          </SettingsRow>
          <SettingsRow rowId="general.personalization.followSystemAppearance">
            <Switch
              checked={settings.appearance.theme === 'auto'}
              onCheckedChange={(checked) => handleThemeChange(checked ? 'auto' : 'dark')}
            />
          </SettingsRow>
        </RegistrySection>
        <RegistrySection sectionId="general.startup">
          <SettingsRow rowId="general.startup.openAtLogin">
            <Switch
              checked={settings.general.startWithWindows}
              onCheckedChange={(checked) => void handleAutostartChange(checked)}
            />
          </SettingsRow>
          <SettingsRow rowId="general.startup.closeOnLaunch">
            <Switch
              checked={settings.general.closeOnLaunch}
              onCheckedChange={(checked) => updateSettings('general', 'closeOnLaunch', checked)}
            />
          </SettingsRow>
        </RegistrySection>
        <RegistrySection sectionId="general.search">
          <SettingsRow rowId="general.search.sensitivity" htmlFor="search-sensitivity">
            <SettingsSelect
              id="search-sensitivity"
              label={t('general.searchSensitivity')}
              value={settings.general.searchSensitivity ?? 'medium'}
              options={[
                { value: 'low', label: t('general.sensitivityLow') },
                { value: 'medium', label: t('general.sensitivityMedium') },
                { value: 'high', label: t('general.sensitivityHigh') },
              ]}
              onValueChange={(value) => updateSettings('general', 'searchSensitivity', value)}
            />
          </SettingsRow>
          <SettingsRow rowId="general.search.hotkey">
            {({ labelId, descriptionId }) => (
              <HotkeyCapture
                value={settings.hotkeys.toggleWindow}
                onChange={(hotkey) => void handleToggleWindowHotkeyChange(hotkey)}
                onError={setHotkeyError}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
              />
            )}
          </SettingsRow>
          {hotkeyError && <SettingsStatus kind="error">{hotkeyError}</SettingsStatus>}
        </RegistrySection>
        <RegistrySection sectionId="general.setup">
          <SettingsRow rowId="general.setup.featurePreview">
            <Switch
              checked={settings.general.featurePreview}
              onCheckedChange={(checked) => updateSettings('general', 'featurePreview', checked)}
            />
          </SettingsRow>
          <SettingsRow rowId="general.setup.restartOnboarding">
            <Button
              variant="outline"
              disabled={isRestartingOnboarding}
              onClick={() => void handleRestartOnboarding()}
            >
              {isRestartingOnboarding ? <Spinner size="small" /> : <RefreshCw size={14} />}
              {t('general.restartOnboarding')}
            </Button>
          </SettingsRow>
        </RegistrySection>
      </SettingsBody>
    </div>
  );

  // Render Shortcuts section (state, filtering and windowing live in ShortcutsPage)
  const renderShortcutsSection = () => (
    <ShortcutsPage
      variant="shortcuts"
      shortcuts={appShortcuts}
      loading={!appShortcutsLoaded}
      refreshing={isRefreshingApps}
      onSave={saveAppShortcut}
      onHotkeyError={setHotkeyError}
    />
  );

  // Render Advanced section
  const renderAdvancedSection = () => {
    const solidEffect = settings.appearance.windowEffect === 'solid';
    const effectLabel = (effect: string) =>
      t(
        `advanced.windowEffect${effect
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join('')}`
      );
    return (
      <div className="settings-page">
        <SettingsPageHeader category="advanced" />
        <SettingsBody>
          <RegistrySection sectionId="advanced.window">
            <SettingsRow rowId="advanced.window.position" htmlFor="advanced-position">
              <SettingsSelect
                id="advanced-position"
                label={t('advanced.showVoltOn')}
                value={String(settings.appearance.windowPosition)}
                onValueChange={(value) => {
                  const position = value as WindowPosition;
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
                options={[
                  { value: 'center', label: t('advanced.positions.center') },
                  { value: 'topCenter', label: t('advanced.positions.topCenter') },
                  { value: 'topLeft', label: t('advanced.positions.topLeft') },
                  { value: 'topRight', label: t('advanced.positions.topRight') },
                ]}
              />
            </SettingsRow>
            <SettingsRow rowId="advanced.window.monitor" htmlFor="advanced-monitor">
              <SettingsSelect
                id="advanced-monitor"
                label={t('advanced.showOnScreen')}
                value={String(settings.general.showOnScreen ?? 'cursor')}
                onValueChange={(selected) => {
                  const value = selected as ShowOnScreen;
                  updateSettings('general', 'showOnScreen', value);
                  void (async () => {
                    try {
                      await invoke<void>('update_show_on_screen', { value });
                    } catch (err) {
                      logger.error('Failed to update show_on_screen state:', err);
                    }
                  })();
                }}
                options={[
                  { value: 'cursor', label: t('advanced.screenOptions.cursor') },
                  { value: 'focusedWindow', label: t('advanced.screenOptions.focusedWindow') },
                  { value: 'primaryScreen', label: t('advanced.screenOptions.primaryScreen') },
                ]}
              />
            </SettingsRow>
            <SettingsRow rowId="advanced.window.maxResults" htmlFor="advanced-max-results">
              <SettingsSelect
                id="advanced-max-results"
                label={t('advanced.maxResults')}
                value={String(settings.general.maxResults)}
                onValueChange={(value) =>
                  updateSettings('general', 'maxResults', parseInt(value, 10))
                }
                options={[5, 8, 10, 15].map((count) => ({
                  value: String(count),
                  label: t('advanced.results', { count }),
                }))}
              />
            </SettingsRow>
          </RegistrySection>
          <RegistrySection sectionId="advanced.appearance">
            <SettingsRow rowId="advanced.appearance.windowEffect" stacked>
              <div className="settings-choice-grid grid-cols-2 sm:grid-cols-4">
                {(['volt-glass', 'mica', 'acrylic', 'solid'] as const).map((effectOption) => (
                  <button
                    type="button"
                    key={effectOption}
                    className="settings-choice"
                    aria-pressed={settings.appearance.windowEffect === effectOption}
                    onClick={() => handleWindowEffectChange(effectOption)}
                  >
                    <div
                      className={cn(
                        'h-[52px] w-full overflow-hidden rounded-md border border-white/10',
                        effectOption === 'volt-glass' &&
                          'bg-[rgba(20,20,30,0.85)] backdrop-blur-md',
                        effectOption === 'mica' &&
                          'bg-gradient-to-br from-indigo-500/25 via-[rgba(20,20,30,0.45)] to-purple-500/15',
                        effectOption === 'acrylic' &&
                          'bg-gradient-to-br from-white/15 via-[rgba(30,30,45,0.5)] to-white/10 backdrop-blur-sm',
                        effectOption === 'solid' && 'bg-surface'
                      )}
                    />
                    <span className="text-center">{effectLabel(effectOption)}</span>
                  </button>
                ))}
              </div>
            </SettingsRow>
            <SettingsRow
              rowId="advanced.appearance.transparency"
              description={
                solidEffect ? t('advanced.transparencySolidHint') : t('advanced.transparencyDesc')
              }
            >
              {({ labelId }) => (
                <div className="flex items-center gap-3">
                  <Slider
                    value={[settings.appearance.transparency]}
                    min={TRANSPARENCY_MIN}
                    max={TRANSPARENCY_MAX}
                    step={TRANSPARENCY_STEP}
                    aria-labelledby={labelId}
                    className="w-36 min-w-24 data-horizontal:w-36"
                    onValueChange={(next) => {
                      handleTransparencyChange(typeof next === 'number' ? next : next[0]);
                    }}
                    disabled={solidEffect}
                  />
                  <span className="min-w-[44px] text-right text-[13px] tabular-nums text-muted-foreground">
                    {solidEffect
                      ? '100%'
                      : `${Math.round(settings.appearance.transparency * 100)}%`}
                  </span>
                </div>
              )}
            </SettingsRow>
            <SettingsRow rowId="advanced.appearance.theme" stacked>
              <div className="settings-choice-grid grid-cols-3">
                {(['light', 'dark', 'auto'] as const).map((themeOption) => (
                  <button
                    type="button"
                    key={themeOption}
                    className="settings-choice"
                    aria-pressed={settings.appearance.theme === themeOption}
                    onClick={() => handleThemeChange(themeOption)}
                  >
                    <div
                      className={cn(
                        'flex h-[52px] w-full flex-col overflow-hidden rounded-md',
                        themeOption === 'light' && 'bg-[#f3f4f6]',
                        themeOption === 'dark' && 'bg-[#1f2937]',
                        themeOption === 'auto' && 'bg-gradient-to-br from-[#f3f4f6] to-[#1f2937]'
                      )}
                    >
                      <div
                        className={cn(
                          'h-2.5',
                          themeOption === 'light' ? 'bg-black/10' : 'bg-white/10'
                        )}
                      />
                      <div
                        className={cn(
                          'm-1.5 flex-1 rounded-xs',
                          themeOption === 'light' ? 'bg-black/5' : 'bg-white/5'
                        )}
                      />
                    </div>
                    <span className="text-center">
                      {t(
                        `advanced.theme${themeOption.charAt(0).toUpperCase() + themeOption.slice(1)}`
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </SettingsRow>
          </RegistrySection>
        </SettingsBody>
      </div>
    );
  };

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

    const stats = indexStats
      ? [
          {
            label: t('fileSearch.stats.indexedFiles'),
            value: indexStats.indexedCount.toLocaleString(),
          },
          {
            label: t('fileSearch.stats.dbSize'),
            value:
              indexStats.dbSizeBytes > 0 ? `${(indexStats.dbSizeBytes / 1024).toFixed(1)} KB` : '—',
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
          {
            label: t('fileSearch.stats.catchupCount'),
            value: indexStats.staleCatchupCount.toLocaleString(),
          },
          {
            label: t('fileSearch.scanMedian'),
            value:
              indexStats.scanDurationMedianMs != null
                ? `${indexStats.scanDurationMedianMs.toLocaleString()} ms`
                : '—',
          },
          {
            label: t('fileSearch.scanRecent'),
            value:
              indexStats.scanDurationRecentMs != null
                ? `${indexStats.scanDurationRecentMs.toLocaleString()} ms`
                : '—',
          },
          {
            label: t('fileSearch.stats.lastCatchup'),
            value:
              indexStats.lastStaleCatchup > 0
                ? new Date(indexStats.lastStaleCatchup * 1000).toLocaleString()
                : t('fileSearch.stats.never'),
          },
        ]
      : [];

    const toggleRows = [
      'indexOnStartup',
      'deepSearch',
      'respectIgnoreFiles',
      'excludeGeneratedDirs',
    ] as const;

    return (
      <div className="settings-page">
        <SettingsPageHeader category="file-search" />
        <SettingsBody>
          <RegistrySection sectionId="file-search.indexing">
            {toggleRows.map((key) => (
              <SettingsRow key={key} rowId={`file-search.indexing.${key}`}>
                <Switch
                  checked={settings.indexing[key]}
                  onCheckedChange={(checked) => updateSettings('indexing', key, checked)}
                />
              </SettingsRow>
            ))}
            <SettingsRow rowId="file-search.indexing.staleThreshold" htmlFor="file-search-stale">
              <SettingsSelect
                id="file-search-stale"
                label={t('fileSearch.staleThreshold')}
                value={String(settings.indexing.staleThresholdSecs)}
                onValueChange={(value) =>
                  updateSettings('indexing', 'staleThresholdSecs', parseInt(value, 10))
                }
                options={[
                  { value: '900', label: t('fileSearch.staleOptions.15m') },
                  { value: '1800', label: t('fileSearch.staleOptions.30m') },
                  { value: '3600', label: t('fileSearch.staleOptions.1h') },
                  { value: '21600', label: t('fileSearch.staleOptions.6h') },
                  { value: '86400', label: t('fileSearch.staleOptions.24h') },
                  { value: '0', label: t('fileSearch.staleOptions.off') },
                ]}
              />
            </SettingsRow>
          </RegistrySection>

          <RegistrySection sectionId="file-search.scope">
            <SettingsRow rowId="file-search.scope.folders">
              <Button variant="secondary" onClick={() => void addFolder()}>
                <FolderPlus size={14} aria-hidden="true" /> {t('fileSearch.addFolder')}
              </Button>
            </SettingsRow>
            {settings.indexing.folders.length > 0 && (
              <SettingsList label={t('fileSearch.foldersToIndex')}>
                {settings.indexing.folders.map((folder, index) => (
                  <SettingsListItem
                    key={folder}
                    icon={
                      <Folder
                        size={15}
                        className="shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    }
                    label={folder}
                    title={folder}
                    removeLabel={t('fileSearch.removeFolder', { path: folder })}
                    onRemove={() => removeFolder(index)}
                  />
                ))}
              </SettingsList>
            )}
            <SettingsRow rowId="file-search.scope.extensions">
              <Input
                type="text"
                className="w-64"
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
            </SettingsRow>
            <SettingsRow rowId="file-search.scope.excludedPaths">
              <Button variant="secondary" onClick={() => void addExcludedPath()}>
                <Plus size={14} aria-hidden="true" /> {t('fileSearch.addPath')}
              </Button>
            </SettingsRow>
            {settings.indexing.excludedPaths.length > 0 && (
              <SettingsList label={t('fileSearch.excludedPaths')}>
                {settings.indexing.excludedPaths.map((path, index) => (
                  <SettingsListItem
                    key={path}
                    icon={
                      <FolderX
                        size={15}
                        className="shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    }
                    label={path}
                    title={path}
                    removeLabel={t('fileSearch.removeExcludedPath', { path })}
                    onRemove={() => removeExcludedPath(index)}
                  />
                ))}
              </SettingsList>
            )}
          </RegistrySection>

          <RegistrySection sectionId="file-search.status">
            {indexStatsLoadState === 'error' && (
              <div className="p-2.5">
                <SettingsStatus
                  kind="error"
                  title={t('fileSearch.statsLoadFailed')}
                  action={
                    <Button variant="secondary" onClick={() => void fetchIndexStats()}>
                      {t('navigation.retry')}
                    </Button>
                  }
                >
                  {indexStats
                    ? t('fileSearch.statsRefreshFailedDesc')
                    : t('fileSearch.statsLoadFailedDesc')}
                </SettingsStatus>
              </div>
            )}
            {indexStats ? (
              <div className="settings-stat-grid" aria-busy={indexStatsLoadState === 'loading'}>
                {stats.map(({ label, value, accent }) => (
                  <div key={label} className="settings-stat">
                    <span className="settings-stat__label">{label}</span>
                    <span className={cn('settings-stat__value', accent)}>{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              indexStatsLoadState !== 'error' && (
                <SettingsNote>
                  <span role="status">{t('fileSearch.loadingStats')}</span>
                </SettingsNote>
              )
            )}
            <SettingsRow rowId="file-search.status.diagnostics">
              <Switch
                checked={settings.indexing.diagnosticsEnabled}
                onCheckedChange={(checked) =>
                  updateSettings('indexing', 'diagnosticsEnabled', checked)
                }
              />
            </SettingsRow>
            <SettingsRow rowId="file-search.status.report">
              <Button
                variant="secondary"
                disabled={!indexStats}
                onClick={() => {
                  void (async () => {
                    try {
                      const latest = await invoke<IndexDiagnostics>('get_db_index_stats');
                      setIndexStats(latest);
                      setIndexStatsLoadState('ready');
                      await navigator.clipboard.writeText(formatIndexDiagnostics(latest));
                      setIndexReportCopied(true);
                      window.setTimeout(() => setIndexReportCopied(false), 1500);
                    } catch (error) {
                      logger.error('Failed to copy index diagnostics:', error);
                    }
                  })();
                }}
              >
                {indexReportCopied ? t('about.copied') : t('fileSearch.copyReport')}
              </Button>
            </SettingsRow>
            <SettingsRow rowId="file-search.status.rebuild">
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
                            const status = await invoke<{ isIndexing: boolean }>(
                              'get_index_status'
                            );
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
            </SettingsRow>
          </RegistrySection>
        </SettingsBody>
      </div>
    );
  };

  // Render Applications section (list + aliases/hotkeys; filled by the launch-time scan)
  const renderApplicationsSection = () => (
    <ShortcutsPage
      variant="applications"
      shortcuts={appShortcuts}
      loading={!appShortcutsLoaded}
      refreshing={isRefreshingApps}
      onSave={saveAppShortcut}
      onHotkeyError={setHotkeyError}
    />
  );

  // Render Clipboard section
  const renderClipboardSection = () => {
    const disabledApps = settings.plugins.clipboardDisabledApps;
    const persistDisabledApps = (apps: string[]) => {
      updateSettings('plugins', 'clipboardDisabledApps', apps);
      void invoke<void>('set_clipboard_disabled_apps', { apps }).catch((err) => {
        logger.error('Failed to update clipboard disabled apps:', err);
        setError(t('errors.saveFailed'));
      });
    };
    const closeAppForm = () => {
      setShowClipboardAppForm(false);
      setClipboardAppDraft('');
    };
    return (
      <div className="settings-page">
        <SettingsPageHeader category="clipboard" />
        <SettingsBody>
          <SettingsPluginSection
            page="clipboard"
            state={pluginStateFor('clipboard')}
            description={t('clipboard.pluginNote')}
          />
          <RegistrySection sectionId="clipboard.capture">
            <SettingsNote>
              {t('clipboard.infoText')} <kbd>cb</kbd> {t('clipboard.infoTextSuffix')}
            </SettingsNote>
            <SettingsRow rowId="clipboard.capture.monitoring">
              <Switch
                checked={settings.plugins.clipboardMonitoring}
                onCheckedChange={(checked) => void handleClipboardMonitoringToggle(checked)}
              />
            </SettingsRow>
            <SettingsRow rowId="clipboard.capture.retention" htmlFor="clipboard-retention">
              <SettingsSelect
                id="clipboard-retention"
                label={t('clipboard.retention')}
                value={String(settings.plugins.clipboardRetentionDays)}
                onValueChange={(value) => {
                  const days = parseInt(value, 10);
                  updateSettings('plugins', 'clipboardRetentionDays', days);
                  void invoke<void>('set_clipboard_retention_days', { days }).catch((err) => {
                    logger.error('Failed to update clipboard retention:', err);
                  });
                }}
                options={[
                  { value: '7', label: t('clipboard.retentionOptions.week') },
                  { value: '14', label: t('clipboard.retentionOptions.twoWeeks') },
                  { value: '30', label: t('clipboard.retentionOptions.month') },
                  { value: '90', label: t('clipboard.retentionOptions.threeMonths') },
                  { value: '0', label: t('clipboard.retentionOptions.forever') },
                ]}
              />
            </SettingsRow>
            <SettingsRow rowId="clipboard.capture.disabledApps">
              <Button variant="secondary" onClick={() => setShowClipboardAppForm(true)}>
                <Plus size={14} aria-hidden="true" /> {t('clipboard.addApp')}
              </Button>
            </SettingsRow>
            {showClipboardAppForm && (
              <form
                className="flex flex-wrap items-end gap-2 px-3 py-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!normalizeClipboardAppName(clipboardAppDraft)) return;
                  persistDisabledApps(addClipboardAppExclusion(disabledApps, clipboardAppDraft));
                  closeAppForm();
                }}
              >
                <label
                  htmlFor="clipboard-excluded-app"
                  className="w-full text-xs text-muted-foreground"
                >
                  {t('clipboard.appExecutable')}
                </label>
                <Input
                  id="clipboard-excluded-app"
                  autoFocus
                  value={clipboardAppDraft}
                  aria-describedby="clipboard-excluded-app-hint"
                  className="min-w-0 flex-1"
                  onChange={(event) => setClipboardAppDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      closeAppForm();
                    }
                  }}
                  placeholder="1password"
                  maxLength={260}
                  autoComplete="off"
                />
                <Button type="submit" disabled={!normalizeClipboardAppName(clipboardAppDraft)}>
                  {t('clipboard.addApp')}
                </Button>
                <Button type="button" variant="secondary" onClick={closeAppForm}>
                  {t('navigation.cancel')}
                </Button>
                <p
                  id="clipboard-excluded-app-hint"
                  className="m-0 w-full text-[11px] text-muted-foreground"
                >
                  {t('clipboard.appExecutableHint')}
                </p>
              </form>
            )}
            <SettingsList label={t('clipboard.disabledApps')} empty={t('clipboard.noExcludedApps')}>
              {disabledApps.map((app) => (
                <SettingsListItem
                  key={app}
                  label={app}
                  removeLabel={t('clipboard.removeApp', { app })}
                  onRemove={() =>
                    persistDisabledApps(disabledApps.filter((candidate) => candidate !== app))
                  }
                />
              ))}
            </SettingsList>
          </RegistrySection>
          <RegistrySection sectionId="clipboard.data">
            <SettingsRow rowId="clipboard.data.clearHistory">
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
            </SettingsRow>
          </RegistrySection>
        </SettingsBody>
      </div>
    );
  };

  // Render Shell Commands section
  const renderShellSection = () => (
    <div className="settings-page">
      <SettingsPageHeader category="shell" />
      <SettingsBody>
        <SettingsPluginSection page="shell" state={pluginStateFor('shell')} />
        <SettingsGate enabled={pluginStateFor('shell').enabled}>
          <RegistrySection sectionId="shell.execution">
            <SettingsNote>
              {t('shell.infoText')} <kbd>&gt;</kbd> {t('shell.infoTextSuffix')}
            </SettingsNote>
            <SettingsRow rowId="shell.execution.enabled">
              <Switch
                checked={settings.shell?.enabled ?? true}
                onCheckedChange={(enabled) => updateSettings('shell', 'enabled', enabled)}
              />
            </SettingsRow>
            <SettingsRow rowId="shell.execution.defaultShell">
              <Input
                type="text"
                placeholder={t('shell.defaultShellPlaceholder')}
                value={settings.shell?.defaultShell ?? ''}
                onChange={(e) => updateSettings('shell', 'defaultShell', e.target.value || null)}
              />
            </SettingsRow>
            <SettingsRow rowId="shell.execution.workingDir">
              <Input
                type="text"
                placeholder={t('shell.workingDirPlaceholder')}
                value={settings.shell?.workingDir ?? ''}
                onChange={(e) => updateSettings('shell', 'workingDir', e.target.value || null)}
              />
            </SettingsRow>
            <SettingsRow rowId="shell.execution.timeout">
              <Input
                type="number"
                min={1000}
                max={300000}
                step={1000}
                value={settings.shell?.timeoutMs ?? 30000}
                onChange={(e) =>
                  updateSettings('shell', 'timeoutMs', Math.max(1000, Number(e.target.value)))
                }
              />
            </SettingsRow>
            <SettingsRow rowId="shell.execution.historySize">
              <Input
                type="number"
                min={0}
                max={5000}
                step={50}
                value={settings.shell?.historySize ?? 500}
                onChange={(e) =>
                  updateSettings('shell', 'historySize', Math.max(0, Number(e.target.value)))
                }
              />
            </SettingsRow>
            <SettingsRow rowId="shell.execution.clearHistory">
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
            </SettingsRow>
          </RegistrySection>
        </SettingsGate>
      </SettingsBody>
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
      case 'launcher':
        return (
          <LauncherPage
            launcher={settings.launcher}
            onLauncherChange={(patch) => patchSettings('launcher', patch)}
            commands={settings.fallbacks.commands}
            onCommandsChange={(commands) => updateSettings('fallbacks', 'commands', commands)}
          />
        );
      case 'keyboard':
        return (
          <KeyboardPage
            keyboard={settings.keyboard}
            onKeyboardChange={(patch) => patchSettings('keyboard', patch)}
            openSettingsHotkey={settings.hotkeys.openSettings}
            onOpenSettingsHotkeyChange={handleOpenSettingsHotkeyChange}
          />
        );
      case 'system-monitor':
        return (
          <SystemMonitorPage
            pluginState={pluginStateFor('system-monitor')}
            plugins={settings.plugins}
            onChange={(patch) => patchSettings('plugins', patch)}
          />
        );
      case 'timer':
        return (
          <TimerPage
            pluginState={pluginStateFor('timer')}
            plugins={settings.plugins}
            onChange={(patch) => patchSettings('plugins', patch)}
          />
        );
      case 'window-management':
        return (
          <WindowManagementPage
            pluginState={pluginStateFor('window-management')}
            plugins={settings.plugins}
            onChange={(patch) => patchSettings('plugins', patch)}
          />
        );
      case 'quicklinks':
        return (
          <QuicklinksPage
            pluginState={pluginStateFor('quicklinks')}
            plugins={settings.plugins}
            onChange={(patch) => patchSettings('plugins', patch)}
            browserConfigured={settings.webSearch.preferredBrowserId !== null}
            onOpenWebSearch={() => navigate('web-search')}
          />
        );
      case 'shortcuts':
        return renderShortcutsSection();
      case 'extensions':
        return (
          <div className="settings-page">
            <SettingsPageHeader category="extensions" />
            {/* The store scrolls on its own: the section id is only a deep-link anchor. */}
            <div id={settingsSectionDomId('extensions.store')} className="settings-page">
              <ExtensionsStore embedded />
            </div>
          </div>
        );
      case 'account':
        return (
          <div className="settings-page">
            <SettingsPageHeader category="account" />
            <SettingsBody>
              <AccountSection />
            </SettingsBody>
          </div>
        );
      case 'integrations':
        return <IntegrationsPanel />;
      case 'sync':
        return <SyncPanel />;
      case 'advanced':
        return renderAdvancedSection();
      case 'about':
        return (
          <AboutPage
            version={appVersion}
            general={settings.general}
            onGeneralChange={handleGeneralChange}
            update={update}
            onSettingsImported={setSettings}
          />
        );
      case 'applications':
        return renderApplicationsSection();
      case 'plugins':
        return (
          <PluginsPage
            enabledPlugins={settings.plugins.enabledPlugins}
            onToggle={handlePluginToggle}
            onOpenPage={navigate}
          />
        );
      case 'file-search':
        return renderFileSearchSection();
      case 'web-search':
        return (
          <WebSearchSettingsPanel
            settings={settings.webSearch}
            rememberHistory={settings.fallbacks.rememberWebSearchHistory}
            onSettingsUpdated={handleWebSearchSettingsUpdated}
            onRememberHistoryChange={(checked) => {
              webSearchHistory.setEnabled(checked);
              if (!checked) webSearchHistory.clear();
              updateSettings('fallbacks', 'rememberWebSearchHistory', checked);
            }}
            pluginState={pluginStateFor('web-search')}
          />
        );
      case 'clipboard':
        return renderClipboardSection();
      case 'shell':
        return renderShellSection();
      case 'snippets':
        return (
          <SnippetsPage
            pluginState={pluginStateFor('snippets')}
            expansion={settings.snippetExpansion}
            onExpansionChange={(patch) => patchSettings('snippetExpansion', patch)}
          />
        );
      case 'emoji':
        return <EmojiPage pluginState={pluginStateFor('emoji')} />;
      case 'ai':
        return <AiSettingsView />;
      case 'notes':
        return <NotesSettingsPanel pluginState={pluginStateFor('notes')} />;
      case 'calculator':
        return <CalculatorPage pluginState={pluginStateFor('calculator')} />;
      case 'games':
        return <GamesPage pluginState={pluginStateFor('games')} />;
      default:
        return renderGeneralSection();
    }
  };

  return (
    <div className="volt-settings flex h-screen flex-col overflow-hidden">
      <SettingsTitleBar
        canGoBack={history.canGoBack}
        canGoForward={history.canGoForward}
        onBack={history.back}
        onForward={history.forward}
        onMinimize={() => void handleMinimize()}
        onClose={() => void handleClose()}
      />

      <div className="flex flex-1 overflow-hidden">
        {renderSidebar()}

        <main className="settings-main">
          {error && (
            <div
              role="alert"
              className="flex items-center justify-between px-4 py-2.5 bg-accent-red/10 border-b border-accent-red/20 text-accent-red text-[13px]"
            >
              <span>{error}</span>
              <Button
                variant="outline"
                className="w-6 h-6 rounded-sm bg-transparent border-none text-accent-red text-lg cursor-pointer hover:bg-accent-red/20"
                aria-label={t('navigation.dismissError')}
                onClick={() => setError(null)}
              >
                ×
              </Button>
            </div>
          )}

          <SettingsPageContext.Provider value={activeCategory}>
            <div key={activeCategory} className="settings-page-transition">
              {renderContent()}
            </div>
          </SettingsPageContext.Provider>

          {hasChanges && (
            <div className="settings-save-bar">
              <span role="status" className="text-xs font-medium text-foreground">
                {t('saveBar.unsavedChanges')}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    void loadSettings();
                  }}
                  disabled={isSaving}
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
