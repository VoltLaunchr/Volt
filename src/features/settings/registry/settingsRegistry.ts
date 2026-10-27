import { MANAGED_PLUGINS } from '../../plugins/builtin/manifest';
import { PLUGIN_PAGE_IDS, type SettingsCategory } from '../constants/settingsCategories';
import type { SettingsAvailability } from './platform';

/**
 * Declarative description of the Settings window: page -> section -> row.
 *
 * This single definition feeds the in-sidebar search, the deep-link scroll target and the
 * rendering primitives (`SettingsSection` / `SettingsRow` resolve their texts from it), so a
 * label is never declared twice. Texts are i18n keys of the `settings` namespace.
 *
 * Ids are stable and dot-separated (`page.section.row`): they are used as DOM anchors and must
 * never be renamed once shipped.
 */
export interface SettingsRowDef {
  readonly id: string;
  readonly titleKey: string;
  readonly descriptionKey?: string;
  /** Extra search terms (plain words, any language) that are not part of the visible texts. */
  readonly keywords?: readonly string[];
  /** Platforms the setting works on; elsewhere it shows a badge and leaves the search. */
  readonly availability?: SettingsAvailability;
}

export interface SettingsSectionDef {
  readonly id: string;
  readonly titleKey: string;
  readonly descriptionKey?: string;
  readonly keywords?: readonly string[];
  readonly rows: readonly SettingsRowDef[];
}

export interface SettingsPageDef {
  readonly id: SettingsCategory;
  readonly sections: readonly SettingsSectionDef[];
}

/** Managed plugins whose backend only exists on some platforms (others show a badge). */
const PLUGIN_AVAILABILITY: Readonly<Record<string, SettingsAvailability>> = {
  'window-management': { platforms: ['windows', 'linux'] },
};

/** Key of the `plugins.enable.*` text for a plugin runtime id (ids use `-` and `_`). */
export const pluginEnableKey = (pluginId: string): string => `plugins.enable.${pluginId}`;

/**
 * Header section of a plugin page: the activation switch of the plugin the page configures.
 * Ids are derived from the page id (`<page>.plugin.enabled`) so they stay stable.
 */
function pluginStateSection(page: SettingsCategory): SettingsSectionDef {
  const pluginId = PLUGIN_PAGE_IDS[page];
  if (!pluginId) throw new Error(`Settings page "${page}" is not tied to a managed plugin`);
  return {
    id: `${page}.plugin`,
    titleKey: 'layout.pluginState',
    rows: [
      {
        id: `${page}.plugin.enabled`,
        titleKey: pluginEnableKey(pluginId),
        descriptionKey: 'plugins.enableDesc',
        keywords: ['enable', 'disable', 'toggle', 'activate', 'turn on', 'turn off', 'plugin'],
      },
    ],
  };
}

/**
 * Every page of the Settings window except the ones that are a single rich list (Shortcuts and
 * Applications are described by one row each). A page absent from this list is still reachable
 * through its category entry in the search.
 */
export const SETTINGS_REGISTRY: readonly SettingsPageDef[] = [
  {
    id: 'general',
    sections: [
      {
        id: 'general.personalization',
        titleKey: 'layout.personalization',
        descriptionKey: 'general.personalizationDesc',
        rows: [
          {
            id: 'general.personalization.language',
            titleKey: 'general.language',
            keywords: ['locale', 'translation', 'english', 'french', 'francais'],
          },
          {
            id: 'general.personalization.followSystemAppearance',
            titleKey: 'general.followSystemAppearance',
            descriptionKey: 'general.followSystemAppearanceDesc',
            keywords: ['theme', 'dark', 'light', 'mode', 'auto'],
          },
        ],
      },
      {
        id: 'general.startup',
        titleKey: 'layout.startup',
        descriptionKey: 'general.startupDesc',
        rows: [
          {
            id: 'general.startup.openAtLogin',
            titleKey: 'general.openAtLogin',
            keywords: ['autostart', 'boot', 'startup', 'login', 'session'],
          },
          {
            id: 'general.startup.closeOnLaunch',
            titleKey: 'general.closeOnLaunch',
            descriptionKey: 'general.closeOnLaunchDesc',
            keywords: ['hide', 'dismiss', 'window'],
          },
        ],
      },
      {
        id: 'general.search',
        titleKey: 'layout.search',
        descriptionKey: 'general.searchPreferencesDesc',
        rows: [
          {
            id: 'general.search.sensitivity',
            titleKey: 'general.searchSensitivity',
            descriptionKey: 'general.searchSensitivityDesc',
            keywords: ['fuzzy', 'strict', 'matching', 'typo'],
          },
          {
            id: 'general.search.hotkey',
            titleKey: 'general.voltHotkey',
            descriptionKey: 'general.hotkeyDesc',
            keywords: ['shortcut', 'keyboard', 'global', 'toggle', 'keybinding'],
          },
        ],
      },
      {
        id: 'general.setup',
        titleKey: 'layout.setup',
        rows: [
          {
            id: 'general.setup.featurePreview',
            titleKey: 'general.featurePreview',
            descriptionKey: 'general.featurePreviewDesc',
            keywords: ['experimental', 'beta', 'labs'],
          },
          {
            id: 'general.setup.restartOnboarding',
            titleKey: 'general.restartOnboarding',
            descriptionKey: 'general.restartOnboardingDesc',
            keywords: ['wizard', 'welcome', 'tour', 'setup'],
          },
        ],
      },
    ],
  },
  {
    id: 'advanced',
    sections: [
      {
        id: 'advanced.window',
        titleKey: 'layout.window',
        rows: [
          {
            id: 'advanced.window.position',
            titleKey: 'advanced.showVoltOn',
            keywords: ['placement', 'top', 'center', 'corner', 'location'],
          },
          {
            id: 'advanced.window.monitor',
            titleKey: 'advanced.showOnScreen',
            descriptionKey: 'advanced.showOnScreenDesc',
            keywords: ['display', 'screen', 'multi', 'cursor'],
          },
          {
            id: 'advanced.window.maxResults',
            titleKey: 'advanced.maxResults',
            descriptionKey: 'advanced.maxResultsDesc',
            keywords: ['limit', 'count', 'list', 'size'],
          },
        ],
      },
      {
        id: 'advanced.appearance',
        titleKey: 'layout.appearance',
        rows: [
          {
            id: 'advanced.appearance.windowEffect',
            titleKey: 'advanced.windowEffect',
            descriptionKey: 'advanced.windowEffectDesc',
            keywords: ['glass', 'mica', 'acrylic', 'solid', 'blur', 'material', 'backdrop'],
          },
          {
            id: 'advanced.appearance.transparency',
            titleKey: 'advanced.windowTransparency',
            descriptionKey: 'advanced.transparencyDesc',
            keywords: ['opacity', 'tint', 'see-through'],
          },
          {
            id: 'advanced.appearance.theme',
            titleKey: 'advanced.theme',
            keywords: ['dark', 'light', 'auto', 'mode', 'color'],
          },
        ],
      },
    ],
  },
  {
    id: 'shortcuts',
    sections: [
      {
        id: 'shortcuts.list',
        titleKey: 'shortcuts.title',
        rows: [
          {
            id: 'shortcuts.list.apps',
            titleKey: 'applications.aliasesHotkeys',
            descriptionKey: 'applications.aliasesHotkeysDesc',
            keywords: ['alias', 'hotkey', 'shortcut', 'keyboard', 'launch', 'enable', 'disable'],
          },
        ],
      },
    ],
  },
  {
    id: 'applications',
    sections: [
      {
        id: 'applications.list',
        titleKey: 'applications.title',
        rows: [
          {
            id: 'applications.list.apps',
            titleKey: 'applications.aliasesHotkeys',
            descriptionKey: 'applications.aliasesHotkeysDesc',
            keywords: ['alias', 'hotkey', 'installed', 'programs', 'enable', 'disable', 'hide'],
          },
        ],
      },
    ],
  },
  {
    id: 'file-search',
    sections: [
      {
        id: 'file-search.indexing',
        titleKey: 'layout.indexing',
        rows: [
          {
            id: 'file-search.indexing.indexOnStartup',
            titleKey: 'fileSearch.indexOnStartup',
            descriptionKey: 'fileSearch.indexOnStartupDesc',
            keywords: ['launch', 'boot', 'scan'],
          },
          {
            id: 'file-search.indexing.deepSearch',
            titleKey: 'fileSearch.deepSearch',
            descriptionKey: 'fileSearch.deepSearchDesc',
            keywords: ['depth', 'nested', 'recursive', 'subfolders'],
          },
          {
            id: 'file-search.indexing.respectIgnoreFiles',
            titleKey: 'fileSearch.respectIgnoreFiles',
            descriptionKey: 'fileSearch.respectIgnoreFilesDesc',
            keywords: ['gitignore', 'voltignore', 'ignore'],
          },
          {
            id: 'file-search.indexing.excludeGeneratedDirs',
            titleKey: 'fileSearch.excludeGeneratedDirs',
            descriptionKey: 'fileSearch.excludeGeneratedDirsDesc',
            keywords: ['node_modules', 'build', 'cache', 'target', 'dependencies'],
          },
          {
            id: 'file-search.indexing.staleThreshold',
            titleKey: 'fileSearch.staleThreshold',
            descriptionKey: 'fileSearch.staleThresholdDesc',
            keywords: ['offline', 'catch-up', 'rescan', 'stale'],
          },
        ],
      },
      {
        id: 'file-search.scope',
        titleKey: 'layout.scope',
        rows: [
          {
            id: 'file-search.scope.folders',
            titleKey: 'fileSearch.foldersToIndex',
            descriptionKey: 'fileSearch.foldersToIndexDesc',
            keywords: ['directory', 'path', 'documents', 'downloads', 'add'],
          },
          {
            id: 'file-search.scope.extensions',
            titleKey: 'fileSearch.fileExtensions',
            descriptionKey: 'fileSearch.fileExtensionsDesc',
            keywords: ['type', 'pdf', 'docx', 'filter'],
          },
          {
            id: 'file-search.scope.excludedPaths',
            titleKey: 'fileSearch.excludedPaths',
            descriptionKey: 'fileSearch.excludedPathsDesc',
            keywords: ['skip', 'ignore', 'exclude', 'private'],
          },
        ],
      },
      {
        id: 'file-search.status',
        titleKey: 'fileSearch.indexStatus',
        descriptionKey: 'fileSearch.indexStatusDesc',
        rows: [
          {
            id: 'file-search.status.diagnostics',
            titleKey: 'fileSearch.diagnosticsEnabled',
            descriptionKey: 'fileSearch.diagnosticsEnabledDesc',
            keywords: ['measure', 'durations', 'telemetry', 'local'],
          },
          {
            id: 'file-search.status.report',
            titleKey: 'fileSearch.copyReport',
            descriptionKey: 'fileSearch.reportDesc',
            keywords: ['diagnostics', 'copy', 'stats'],
          },
          {
            id: 'file-search.status.rebuild',
            titleKey: 'fileSearch.stats.rebuild',
            descriptionKey: 'fileSearch.stats.rebuildDesc',
            keywords: ['reset', 'reindex', 'database', 'repair'],
          },
        ],
      },
    ],
  },
  {
    id: 'clipboard',
    sections: [
      pluginStateSection('clipboard'),
      {
        id: 'clipboard.capture',
        titleKey: 'layout.clipboardCapture',
        rows: [
          {
            id: 'clipboard.capture.monitoring',
            titleKey: 'clipboard.monitoring',
            descriptionKey: 'clipboard.monitoringDesc',
            keywords: ['track', 'watch', 'record', 'history'],
          },
          {
            id: 'clipboard.capture.retention',
            titleKey: 'clipboard.retention',
            descriptionKey: 'clipboard.retentionDesc',
            keywords: ['days', 'keep', 'expire', 'duration'],
          },
          {
            id: 'clipboard.capture.disabledApps',
            titleKey: 'clipboard.disabledApps',
            descriptionKey: 'clipboard.disabledAppsDesc',
            keywords: ['exclude', 'password', 'manager', 'private', 'blocklist'],
          },
        ],
      },
      {
        id: 'clipboard.data',
        titleKey: 'layout.clipboardData',
        rows: [
          {
            id: 'clipboard.data.clearHistory',
            titleKey: 'clipboard.clearHistory',
            descriptionKey: 'clipboard.clearHistoryDesc',
            keywords: ['delete', 'erase', 'wipe', 'reset'],
          },
        ],
      },
    ],
  },
  {
    id: 'shell',
    sections: [
      pluginStateSection('shell'),
      {
        id: 'shell.execution',
        titleKey: 'layout.shellPreferences',
        rows: [
          {
            id: 'shell.execution.enabled',
            titleKey: 'shell.enabled',
            descriptionKey: 'shell.enabledDesc',
            keywords: ['terminal', 'command', 'prefix'],
          },
          {
            id: 'shell.execution.defaultShell',
            titleKey: 'shell.defaultShell',
            descriptionKey: 'shell.defaultShellDesc',
            keywords: ['powershell', 'bash', 'cmd', 'zsh', 'interpreter'],
          },
          {
            id: 'shell.execution.workingDir',
            titleKey: 'shell.workingDir',
            descriptionKey: 'shell.workingDirDesc',
            keywords: ['directory', 'folder', 'cwd', 'path'],
          },
          {
            id: 'shell.execution.timeout',
            titleKey: 'shell.timeout',
            descriptionKey: 'shell.timeoutDesc',
            keywords: ['duration', 'limit', 'kill'],
          },
          {
            id: 'shell.execution.historySize',
            titleKey: 'shell.historySize',
            descriptionKey: 'shell.historySizeDesc',
            keywords: ['entries', 'remember'],
          },
          {
            id: 'shell.execution.clearHistory',
            titleKey: 'shell.clearHistory',
            descriptionKey: 'shell.clearHistoryDesc',
            keywords: ['reset', 'erase', 'delete'],
          },
        ],
      },
    ],
  },
  {
    id: 'plugins',
    sections: [
      {
        id: 'plugins.builtin',
        titleKey: 'plugins.builtin',
        descriptionKey: 'plugins.builtinDesc',
        rows: MANAGED_PLUGINS.map((plugin) => ({
          id: `plugins.builtin.${plugin.id}`,
          titleKey: plugin.nameKey,
          descriptionKey: `plugins.descriptions.${plugin.id}`,
          keywords: ['plugin', 'built-in', ...plugin.hint.split(/\s*·\s*/)],
          availability: PLUGIN_AVAILABILITY[plugin.id],
        })),
      },
    ],
  },
  {
    id: 'launcher',
    sections: [
      {
        id: 'launcher.root',
        titleKey: 'launcher.rootTitle',
        descriptionKey: 'launcher.rootDesc',
        rows: [
          {
            id: 'launcher.root.popToRoot',
            titleKey: 'launcher.popToRoot',
            descriptionKey: 'launcher.popToRootDesc',
            keywords: [
              'reset',
              'reopen',
              'clear query',
              'idle',
              'delay',
              'timeout',
              'back to root',
            ],
          },
          {
            id: 'launcher.root.includeFiles',
            titleKey: 'launcher.includeFiles',
            descriptionKey: 'launcher.includeFilesDesc',
            keywords: ['documents', 'file search', 'results', 'index'],
          },
          {
            id: 'launcher.root.includeGames',
            titleKey: 'launcher.includeGames',
            descriptionKey: 'launcher.includeGamesDesc',
            keywords: ['steam', 'epic', 'gaming', 'results'],
          },
        ],
      },
      {
        id: 'launcher.fallbacks',
        titleKey: 'fallbacks.title',
        descriptionKey: 'fallbacks.description',
        keywords: ['no results', 'nothing found', 'web search', 'actions'],
        rows: [
          {
            id: 'launcher.fallbacks.list',
            titleKey: 'fallbacks.listTitle',
            descriptionKey: 'fallbacks.listDesc',
            keywords: ['google', 'duckduckgo', 'youtube', 'chatgpt', 'perplexity', 'url', 'order'],
          },
        ],
      },
      {
        id: 'launcher.history',
        titleKey: 'launcher.historyTitle',
        descriptionKey: 'launcher.historyDesc',
        rows: [
          {
            id: 'launcher.history.launches',
            titleKey: 'launcher.clearLaunches',
            descriptionKey: 'launcher.clearLaunchesDesc',
            keywords: ['frecency', 'usage', 'ranking', 'suggestions', 'reset', 'forget', 'learned'],
          },
          {
            id: 'launcher.history.files',
            titleKey: 'launcher.clearFiles',
            descriptionKey: 'launcher.clearFilesDesc',
            keywords: ['recent', 'opened', 'reset', 'forget', 'history'],
          },
        ],
      },
    ],
  },
  {
    id: 'keyboard',
    sections: [
      {
        id: 'keyboard.escape',
        titleKey: 'keyboard.escapeTitle',
        rows: [
          {
            id: 'keyboard.escape.behavior',
            titleKey: 'keyboard.escapeBehavior',
            descriptionKey: 'keyboard.escapeBehaviorDesc',
            keywords: ['esc', 'close', 'hide', 'clear', 'query', 'dismiss'],
          },
          {
            id: 'keyboard.escape.secondaryWindows',
            titleKey: 'keyboard.escapeSecondary',
            descriptionKey: 'keyboard.escapeSecondaryDesc',
            keywords: ['esc', 'settings window', 'notes window', 'close window'],
          },
        ],
      },
      {
        id: 'keyboard.navigation',
        titleKey: 'keyboard.navigationTitle',
        rows: [
          {
            id: 'keyboard.navigation.preset',
            titleKey: 'keyboard.listNavigation',
            descriptionKey: 'keyboard.listNavigationDesc',
            keywords: [
              'vim',
              'emacs',
              'ctrl+n',
              'ctrl+p',
              'ctrl+j',
              'ctrl+k',
              'arrows',
              'up',
              'down',
            ],
          },
        ],
      },
      {
        id: 'keyboard.global',
        titleKey: 'keyboard.globalTitle',
        rows: [
          {
            id: 'keyboard.global.openSettings',
            titleKey: 'keyboard.openSettingsHotkey',
            descriptionKey: 'keyboard.openSettingsHotkeyDesc',
            keywords: ['hotkey', 'shortcut', 'global', 'preferences', 'settings window'],
          },
        ],
      },
    ],
  },
  {
    id: 'system-monitor',
    sections: [
      pluginStateSection('system-monitor'),
      {
        id: 'system-monitor.refresh',
        titleKey: 'systemMonitor.refreshTitle',
        rows: [
          {
            id: 'system-monitor.refresh.interval',
            titleKey: 'systemMonitor.refreshInterval',
            descriptionKey: 'systemMonitor.refreshIntervalDesc',
            keywords: ['polling', 'update', 'seconds', 'frequency', 'cpu', 'memory', 'live'],
          },
        ],
      },
    ],
  },
  {
    id: 'timer',
    sections: [
      pluginStateSection('timer'),
      {
        id: 'timer.durations',
        titleKey: 'timer.durationsTitle',
        descriptionKey: 'timer.durationsDesc',
        rows: [
          {
            id: 'timer.durations.work',
            titleKey: 'timer.work',
            descriptionKey: 'timer.workDesc',
            keywords: ['pomodoro', 'focus', 'minutes', 'session'],
          },
          {
            id: 'timer.durations.shortBreak',
            titleKey: 'timer.shortBreak',
            descriptionKey: 'timer.shortBreakDesc',
            keywords: ['pomodoro', 'rest', 'minutes'],
          },
          {
            id: 'timer.durations.longBreak',
            titleKey: 'timer.longBreak',
            descriptionKey: 'timer.longBreakDesc',
            keywords: ['pomodoro', 'rest', 'minutes'],
          },
        ],
      },
    ],
  },
  {
    id: 'window-management',
    sections: [
      pluginStateSection('window-management'),
      {
        id: 'window-management.layout',
        titleKey: 'windowManagement.layoutTitle',
        rows: [
          {
            id: 'window-management.layout.gap',
            titleKey: 'windowManagement.gap',
            descriptionKey: 'windowManagement.gapDesc',
            keywords: ['margin', 'spacing', 'padding', 'pixels', 'snap', 'tile', 'gutter'],
            availability: { platforms: ['windows', 'linux'] },
          },
        ],
      },
    ],
  },
  {
    id: 'quicklinks',
    sections: [
      pluginStateSection('quicklinks'),
      {
        id: 'quicklinks.browser',
        titleKey: 'quicklinks.browserTitle',
        rows: [
          {
            id: 'quicklinks.browser.preferred',
            titleKey: 'quicklinks.usePreferredBrowser',
            descriptionKey: 'quicklinks.usePreferredBrowserDesc',
            keywords: ['browser', 'chrome', 'firefox', 'edge', 'url', 'open', 'default'],
          },
        ],
      },
    ],
  },
  {
    id: 'web-search',
    sections: [
      pluginStateSection('web-search'),
      {
        id: 'web-search.defaults',
        titleKey: 'webSearch.searchDefaults',
        descriptionKey: 'webSearch.description',
        rows: [
          {
            id: 'web-search.defaults.engine',
            titleKey: 'webSearch.defaultEngine',
            descriptionKey: 'webSearch.defaultEngineDesc',
            keywords: ['google', 'bing', 'duckduckgo', 'provider', 'search engine'],
          },
          {
            id: 'web-search.defaults.browser',
            titleKey: 'webSearch.browser',
            descriptionKey: 'webSearch.browserDesc',
            keywords: ['chrome', 'firefox', 'edge', 'brave', 'link', 'open', 'url'],
          },
        ],
      },
      {
        id: 'web-search.history',
        titleKey: 'webSearch.historyTitle',
        rows: [
          {
            id: 'web-search.history.remember',
            titleKey: 'webSearch.rememberHistory',
            descriptionKey: 'webSearch.rememberHistoryDesc',
            keywords: ['suggestions', 'privacy', 'queries', 'save'],
          },
          {
            id: 'web-search.history.clear',
            titleKey: 'webSearch.clearHistory',
            descriptionKey: 'webSearch.clearHistoryDesc',
            keywords: ['erase', 'delete', 'reset', 'forget'],
          },
        ],
      },
      {
        id: 'web-search.brave',
        titleKey: 'fallbacks.brave.title',
        descriptionKey: 'fallbacks.brave.description',
        rows: [
          {
            id: 'web-search.brave.key',
            titleKey: 'fallbacks.brave.apiKey',
            descriptionKey: 'fallbacks.brave.storageNotice',
            keywords: ['brave', 'api', 'token', 'credential', 'live results', 'suggestions'],
          },
        ],
      },
    ],
  },
  {
    id: 'emoji',
    sections: [
      pluginStateSection('emoji'),
      {
        id: 'emoji.preferences',
        titleKey: 'layout.emojiPreferences',
        rows: [
          {
            id: 'emoji.preferences.primaryAction',
            titleKey: 'emoji.primaryAction',
            descriptionKey: 'emoji.primaryActionDesc',
            keywords: ['copy', 'paste', 'select', 'enter', 'clipboard'],
          },
          {
            id: 'emoji.preferences.columns',
            titleKey: 'emoji.columns',
            descriptionKey: 'emoji.columnsHint',
            keywords: ['grid', 'size', 'layout', 'row'],
          },
          {
            id: 'emoji.preferences.skinTone',
            titleKey: 'emoji.skinTone',
            descriptionKey: 'emoji.skinToneDesc',
            keywords: ['color', 'hand', 'modifier', 'fitzpatrick'],
          },
        ],
      },
      {
        id: 'emoji.data',
        titleKey: 'layout.emojiData',
        rows: [
          {
            id: 'emoji.data.clearRecent',
            titleKey: 'emoji.clearRecent',
            descriptionKey: 'emoji.clearRecentDesc',
            keywords: ['history', 'frequent', 'recent', 'reset', 'erase'],
          },
        ],
      },
    ],
  },
  {
    id: 'snippets',
    sections: [
      pluginStateSection('snippets'),
      {
        id: 'snippets.library',
        titleKey: 'snippetsManager.title',
        descriptionKey: 'snippetsManager.subtitle',
        keywords: ['text', 'expansion', 'template', 'abbreviation'],
        rows: [
          {
            id: 'snippets.library.new',
            titleKey: 'snippetsManager.add',
            descriptionKey: 'snippetsManager.newDesc',
            keywords: ['create', 'add', 'trigger', 'content', 'variable'],
          },
        ],
      },
      {
        id: 'snippets.global',
        titleKey: 'snippetExpansion.globalSectionTitle',
        descriptionKey: 'snippetExpansion.globalDesc',
        keywords: ['system-wide', 'keyboard hook', 'any application'],
        rows: [
          {
            id: 'snippets.global.enabled',
            titleKey: 'snippetExpansion.enabled',
            descriptionKey: 'snippetExpansion.enabledDesc',
            keywords: ['expand', 'anywhere', 'global', 'hook'],
            availability: { platforms: ['windows'] },
          },
          {
            id: 'snippets.global.maxTriggerLen',
            titleKey: 'snippetExpansion.maxTriggerLen',
            descriptionKey: 'snippetExpansion.maxTriggerLenDesc',
            keywords: ['length', 'characters', 'trigger'],
            availability: { platforms: ['windows'] },
          },
          {
            id: 'snippets.global.excludedApps',
            titleKey: 'snippetExpansion.excludedApps',
            descriptionKey: 'snippetExpansion.excludedAppsDesc',
            keywords: ['exclude', 'password', 'manager', 'blocklist', 'private'],
            availability: { platforms: ['windows'] },
          },
        ],
      },
    ],
  },
  {
    id: 'notes',
    sections: [
      pluginStateSection('notes'),
      {
        id: 'notes.library',
        titleKey: 'notes.headline',
        descriptionKey: 'notes.tagline',
        rows: [
          {
            id: 'notes.library.open',
            titleKey: 'notes.openWindow',
            descriptionKey: 'notes.cmd.openDesc',
            keywords: ['window', 'markdown', 'editor'],
          },
          {
            id: 'notes.library.create',
            titleKey: 'notes.create',
            descriptionKey: 'notes.cmd.createDesc',
            keywords: ['new', 'write', 'add'],
          },
        ],
      },
      {
        id: 'notes.commands',
        titleKey: 'notes.commandsTitle',
        rows: [
          {
            id: 'notes.commands.open',
            titleKey: 'notes.cmd.open',
            descriptionKey: 'notes.cmd.openDesc',
            keywords: ['shortcut', 'prefix', 'launcher'],
          },
          {
            id: 'notes.commands.create',
            titleKey: 'notes.cmd.create',
            descriptionKey: 'notes.cmd.createDesc',
            keywords: ['shortcut', 'new'],
          },
          {
            id: 'notes.commands.search',
            titleKey: 'notes.cmd.search',
            descriptionKey: 'notes.cmd.searchDesc',
            keywords: ['find', 'full-text', 'query'],
          },
        ],
      },
      {
        id: 'notes.trash',
        titleKey: 'notes.trashTitle',
        descriptionKey: 'notes.trashDesc',
        rows: [
          {
            id: 'notes.trash.empty',
            titleKey: 'notes.emptyTrash',
            descriptionKey: 'notes.emptyTrashDesc',
            keywords: ['delete', 'permanently', 'bin', 'deleted'],
          },
        ],
      },
    ],
  },
  {
    id: 'calculator',
    sections: [
      pluginStateSection('calculator'),
      {
        id: 'calculator.history',
        titleKey: 'calculator.historyTitle',
        descriptionKey: 'calculator.infoText',
        rows: [
          {
            id: 'calculator.history.clear',
            titleKey: 'calculator.clearHistory',
            descriptionKey: 'calculator.clearHistoryDesc',
            keywords: ['results', 'math', 'conversion', 'erase', 'reset', 'forget'],
          },
        ],
      },
    ],
  },
  {
    id: 'games',
    sections: [
      pluginStateSection('games'),
      {
        id: 'games.library',
        titleKey: 'games.libraryTitle',
        descriptionKey: 'games.libraryDesc',
        keywords: ['steam', 'epic', 'gog', 'launcher', 'library'],
        rows: [
          {
            id: 'games.library.platforms',
            titleKey: 'games.platforms',
            descriptionKey: 'games.platformsDesc',
            keywords: ['steam', 'epic', 'gog', 'xbox', 'detected', 'installed'],
          },
          {
            id: 'games.library.rescan',
            titleKey: 'games.rescan',
            descriptionKey: 'games.rescanDesc',
            keywords: ['refresh', 'scan', 'detect', 'update'],
          },
        ],
      },
    ],
  },
  {
    id: 'ai',
    sections: [
      {
        id: 'ai.providers',
        titleKey: 'ai.apiKeys',
        descriptionKey: 'ai.description',
        keywords: ['api key', 'provider', 'token', 'keyring'],
        rows: [
          {
            id: 'ai.providers.openai',
            titleKey: 'ai.providerNames.openai',
            descriptionKey: 'ai.providerDesc',
            keywords: ['gpt', 'chatgpt', 'api key'],
          },
          {
            id: 'ai.providers.anthropic',
            titleKey: 'ai.providerNames.anthropic',
            descriptionKey: 'ai.providerDesc',
            keywords: ['claude', 'api key'],
          },
          {
            id: 'ai.providers.groq',
            titleKey: 'ai.providerNames.groq',
            descriptionKey: 'ai.providerDesc',
            keywords: ['llama', 'api key'],
          },
          {
            id: 'ai.providers.huggingface',
            titleKey: 'ai.providerNames.huggingface',
            descriptionKey: 'ai.providerDesc',
            keywords: ['deepseek', 'inference', 'api key'],
          },
        ],
      },
      {
        id: 'ai.local',
        titleKey: 'ai.local.title',
        descriptionKey: 'ai.local.description',
        keywords: ['ollama', 'lm studio', 'offline', 'private'],
        rows: [
          {
            id: 'ai.local.baseUrl',
            titleKey: 'ai.local.baseUrl',
            descriptionKey: 'ai.local.hint',
            keywords: ['endpoint', 'localhost', 'openai-compatible', 'server'],
          },
          {
            id: 'ai.local.model',
            titleKey: 'ai.local.model',
            descriptionKey: 'ai.local.modelDesc',
            keywords: ['llama', 'name'],
          },
          {
            id: 'ai.local.save',
            titleKey: 'ai.local.saveTitle',
            descriptionKey: 'ai.local.saveDesc',
            keywords: ['remove', 'configure', 'connect'],
          },
        ],
      },
      {
        id: 'ai.profile',
        titleKey: 'ai.profile.title',
        descriptionKey: 'ai.profile.description',
        rows: [
          {
            id: 'ai.profile.context',
            titleKey: 'ai.profile.contextTitle',
            descriptionKey: 'ai.profile.contextDesc',
            keywords: ['about me', 'instructions', 'system prompt', 'persona', 'chat'],
          },
        ],
      },
      {
        id: 'ai.quickActions',
        titleKey: 'ai.quickActions.title',
        descriptionKey: 'ai.quickActions.description',
        keywords: ['hotkey', 'clipboard', 'prompt'],
        rows: [
          {
            id: 'ai.quickActions.add',
            titleKey: 'ai.quickActions.newAction',
            descriptionKey: 'ai.quickActions.addDesc',
            keywords: ['create', 'custom', 'shortcut', 'prompt', 'rewrite', 'translate'],
          },
        ],
      },
    ],
  },
  {
    id: 'integrations',
    sections: [
      {
        id: 'integrations.github',
        titleKey: 'integrations.github.name',
        descriptionKey: 'integrations.github.description',
        keywords: ['repositories', 'issues', 'pull requests', 'gist', 'git'],
        rows: [
          {
            id: 'integrations.github.connect',
            titleKey: 'integrations.connectOAuth',
            descriptionKey: 'integrations.pasteManually',
            keywords: ['oauth', 'sign in', 'authorize', 'login'],
          },
          {
            id: 'integrations.github.token',
            titleKey: 'integrations.apiToken',
            descriptionKey: 'integrations.tokenDesc',
            keywords: ['personal access token', 'pat', 'secret', 'credential'],
          },
          {
            id: 'integrations.github.actions',
            titleKey: 'integrations.tokenActions',
            descriptionKey: 'integrations.tokenActionsDesc',
            keywords: ['test', 'save', 'remove', 'delete', 'verify'],
          },
        ],
      },
      {
        id: 'integrations.notion',
        titleKey: 'integrations.notion.name',
        descriptionKey: 'integrations.notion.description',
        keywords: ['workspace', 'pages', 'database'],
        rows: [
          {
            id: 'integrations.notion.connect',
            titleKey: 'integrations.connectOAuth',
            descriptionKey: 'integrations.pasteManually',
            keywords: ['oauth', 'sign in', 'authorize', 'login'],
          },
          {
            id: 'integrations.notion.token',
            titleKey: 'integrations.apiToken',
            descriptionKey: 'integrations.tokenDesc',
            keywords: ['integration secret', 'secret', 'credential'],
          },
          {
            id: 'integrations.notion.actions',
            titleKey: 'integrations.tokenActions',
            descriptionKey: 'integrations.tokenActionsDesc',
            keywords: ['test', 'save', 'remove', 'delete', 'verify'],
          },
        ],
      },
      {
        id: 'integrations.security',
        titleKey: 'integrations.security.title',
        keywords: ['encrypted', 'keyring', 'privacy', 'tokens'],
        rows: [],
      },
    ],
  },
  {
    id: 'sync',
    sections: [
      {
        id: 'sync.cloud',
        titleKey: 'sync.title',
        descriptionKey: 'sync.description',
        keywords: ['backup', 'cloud', 'devices', 'premium', 'snippets', 'quicklinks'],
        rows: [
          {
            id: 'sync.cloud.push',
            titleKey: 'sync.push.title',
            descriptionKey: 'sync.push.description',
            keywords: ['upload', 'send', 'backup'],
          },
          {
            id: 'sync.cloud.pull',
            titleKey: 'sync.pull.title',
            descriptionKey: 'sync.pull.description',
            keywords: ['download', 'restore', 'merge'],
          },
        ],
      },
    ],
  },
  {
    id: 'extensions',
    sections: [
      {
        id: 'extensions.store',
        titleKey: 'extensions.storeTitle',
        descriptionKey: 'extensions.storeDesc',
        keywords: ['marketplace', 'install', 'uninstall', 'community', 'browse', 'installed'],
        rows: [],
      },
    ],
  },
  {
    id: 'account',
    sections: [
      {
        id: 'account.profile',
        titleKey: 'account.title',
        keywords: ['profile', 'subscription', 'plan', 'premium'],
        rows: [
          {
            id: 'account.profile.status',
            titleKey: 'account.statusTitle',
            descriptionKey: 'account.statusDesc',
            keywords: ['tier', 'email', 'username', 'free', 'premium'],
          },
          {
            id: 'account.profile.session',
            titleKey: 'account.sessionTitle',
            descriptionKey: 'account.sessionDesc',
            keywords: ['sign in', 'sign out', 'login', 'logout', 'log in', 'log out'],
          },
        ],
      },
    ],
  },
  {
    id: 'about',
    sections: [
      {
        id: 'about.links',
        titleKey: 'about.resourcesTitle',
        rows: [
          {
            id: 'about.links.website',
            titleKey: 'about.officialWebsite',
            descriptionKey: 'about.websiteDesc',
            keywords: ['voltlaunchr', 'homepage', 'site'],
          },
          {
            id: 'about.links.github',
            titleKey: 'about.githubRepo',
            descriptionKey: 'about.githubDesc',
            keywords: ['source', 'code', 'repository', 'open source'],
          },
          {
            id: 'about.links.issue',
            titleKey: 'about.reportIssue',
            descriptionKey: 'about.reportIssueDesc',
            keywords: ['bug', 'feedback', 'problem', 'support'],
          },
          {
            id: 'about.links.releaseNotes',
            titleKey: 'about.releaseNotes',
            descriptionKey: 'about.releaseNotesDesc',
            keywords: ['changelog', 'what is new', 'version history'],
          },
        ],
      },
      {
        id: 'about.updates',
        titleKey: 'about.updates',
        keywords: ['version', 'upgrade'],
        rows: [
          {
            id: 'about.updates.auto',
            titleKey: 'about.autoCheck',
            descriptionKey: 'about.autoCheckDesc',
            keywords: ['automatic', 'background', 'startup', 'notify'],
          },
          {
            id: 'about.updates.channel',
            titleKey: 'about.channelTitle',
            descriptionKey: 'about.channelDesc',
            keywords: ['stable', 'beta', 'preview', 'release'],
          },
          {
            id: 'about.updates.check',
            titleKey: 'about.checkForUpdates',
            descriptionKey: 'about.checkDesc',
            keywords: ['install', 'download', 'upgrade', 'new version', 'restart'],
          },
        ],
      },
      {
        id: 'about.diagnostics',
        titleKey: 'about.diagnosticsTitle',
        rows: [
          {
            id: 'about.diagnostics.logs',
            titleKey: 'about.openLogs',
            descriptionKey: 'about.openLogsDesc',
            keywords: ['log file', 'folder', 'debug', 'troubleshoot'],
          },
          {
            id: 'about.diagnostics.copy',
            titleKey: 'about.copyDiagnostics',
            descriptionKey: 'about.copyDiagnosticsDesc',
            keywords: ['report', 'support', 'system information', 'clipboard'],
          },
        ],
      },
      {
        id: 'about.backup',
        titleKey: 'about.backupTitle',
        descriptionKey: 'about.backupDesc',
        rows: [
          {
            id: 'about.backup.export',
            titleKey: 'about.exportSettings',
            descriptionKey: 'about.exportDesc',
            keywords: ['save', 'json', 'backup', 'file'],
          },
          {
            id: 'about.backup.import',
            titleKey: 'about.importSettings',
            descriptionKey: 'about.importDesc',
            keywords: ['load', 'restore', 'json', 'file'],
          },
        ],
      },
    ],
  },
];

export const settingsRowDomId = (rowId: string): string => `settings-row-${rowId}`;
export const settingsSectionDomId = (sectionId: string): string => `settings-section-${sectionId}`;

export function getSettingsPage(pageId: SettingsCategory): SettingsPageDef | undefined {
  return SETTINGS_REGISTRY.find((page) => page.id === pageId);
}

export function getSettingsSection(sectionId: string): SettingsSectionDef | undefined {
  for (const page of SETTINGS_REGISTRY) {
    const section = page.sections.find((candidate) => candidate.id === sectionId);
    if (section) return section;
  }
  return undefined;
}

export function getSettingsRow(rowId: string): SettingsRowDef | undefined {
  for (const page of SETTINGS_REGISTRY) {
    for (const section of page.sections) {
      const row = section.rows.find((candidate) => candidate.id === rowId);
      if (row) return row;
    }
  }
  return undefined;
}
