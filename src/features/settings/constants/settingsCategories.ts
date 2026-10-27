import {
  Settings as SettingsIcon,
  Keyboard,
  Wrench,
  Info,
  Package,
  Puzzle,
  Search,
  Globe2,
  Clipboard,
  Store,
  Link as LinkIcon,
  Terminal,
  User,
  RefreshCw,
  Smile,
  StickyNote,
  Scissors,
  Sparkles,
  Zap,
  Calculator,
  Gamepad2,
  Activity,
  Timer,
  LayoutPanelLeft,
  type LucideIcon,
} from 'lucide-react';
import type { VoltIconName } from '@/shared/icons/glyphs';

export type SettingsCategory =
  | 'general'
  | 'shortcuts'
  | 'advanced'
  | 'about'
  | 'extensions'
  | 'integrations'
  | 'account'
  | 'sync'
  | 'applications'
  | 'plugins'
  | 'file-search'
  | 'web-search'
  | 'clipboard'
  | 'shell'
  | 'emoji'
  | 'ai'
  | 'notes'
  | 'snippets'
  | 'launcher'
  | 'keyboard'
  | 'system-monitor'
  | 'timer'
  | 'window-management'
  | 'quicklinks'
  | 'calculator'
  | 'games';

/** Original Volt glyph per Settings category (sidebar tile). */
export const SETTINGS_CATEGORY_GLYPHS: Record<SettingsCategory, VoltIconName> = {
  general: 'sliders',
  account: 'user',
  sync: 'sync',
  shortcuts: 'keyboard',
  advanced: 'gauge',
  about: 'info',
  extensions: 'cube',
  integrations: 'nodes',
  applications: 'app-grid',
  plugins: 'puzzle',
  'file-search': 'file-search',
  'web-search': 'globe',
  clipboard: 'clipboard',
  shell: 'terminal',
  emoji: 'smile',
  ai: 'sparkle',
  notes: 'note',
  snippets: 'braces',
  launcher: 'bolt',
  keyboard: 'command',
  'system-monitor': 'pulse',
  timer: 'timer',
  'window-management': 'window-grid',
  quicklinks: 'link',
  calculator: 'calculator',
  games: 'gamepad',
};

export interface CategoryItem {
  id: SettingsCategory;
  label: string;
  /** Lucide icon used as fallback when no SVG asset is available. */
  icon: LucideIcon;
  /** Path (relative to /public) to a tile-style SVG icon. Takes precedence over `icon`. */
  iconSrc?: string;
  section?: string;
}

const APP_ICON = '/icons/app';

export const SETTINGS_CATEGORIES: CategoryItem[] = [
  // Main settings
  { id: 'general', label: 'General', icon: SettingsIcon, iconSrc: `${APP_ICON}/settings_icon.svg` },
  { id: 'launcher', label: 'Launcher', icon: Zap, iconSrc: `${APP_ICON}/launcher_icon.svg` },
  {
    id: 'keyboard',
    label: 'Keyboard',
    icon: Keyboard,
    iconSrc: `${APP_ICON}/keyboard_settings_icon.svg`,
  },
  { id: 'account', label: 'Account', icon: User, iconSrc: `${APP_ICON}/account_icon.svg` },
  { id: 'sync', label: 'Sync', icon: RefreshCw, iconSrc: `${APP_ICON}/sync_icon.svg` },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: Keyboard,
    iconSrc: `${APP_ICON}/short_cut_icon.svg`,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: Wrench,
    iconSrc: `${APP_ICON}/advanced_settings_icon.svg`,
  },
  { id: 'about', label: 'About', icon: Info, iconSrc: `${APP_ICON}/about-settings_icon.svg` },
  // Built-in Features
  {
    id: 'applications',
    label: 'Applications',
    icon: Package,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/app_icon.svg`,
  },
  {
    id: 'plugins',
    label: 'Plugins',
    icon: Puzzle,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/plugin_icon.svg`,
  },
  {
    id: 'extensions',
    label: 'Extensions',
    icon: Store,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/extension_icon.svg`,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: LinkIcon,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/integration_icon.svg`,
  },
  {
    id: 'file-search',
    label: 'File Search',
    icon: Search,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/file_search_icon.svg`,
  },
  {
    id: 'web-search',
    label: 'Web Search',
    icon: Globe2,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/web_search_icon.svg`,
  },
  {
    id: 'clipboard',
    label: 'Clipboard History',
    icon: Clipboard,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/clipboard_history_icon.svg`,
  },
  {
    id: 'shell',
    label: 'Shell Commands',
    icon: Terminal,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/shell_icon.svg`,
  },
  {
    id: 'emoji',
    label: 'Emoji & Symbols',
    icon: Smile,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/emojis_icon.svg`,
  },
  {
    id: 'ai',
    label: 'AI',
    icon: Sparkles,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/ai_icon.svg`,
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: StickyNote,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/volt_note_icons.svg`,
  },
  {
    id: 'snippets',
    label: 'Snippets',
    icon: Scissors,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/snippets_icon.svg`,
  },
  {
    id: 'calculator',
    label: 'Calculator',
    icon: Calculator,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/calculator_icon.svg`,
  },
  {
    id: 'games',
    label: 'Games',
    icon: Gamepad2,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/games_icon.svg`,
  },
  {
    id: 'system-monitor',
    label: 'System Monitor',
    icon: Activity,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/system_monitor_icon.svg`,
  },
  {
    id: 'timer',
    label: 'Timer',
    icon: Timer,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/pomodoro_icon.svg`,
  },
  {
    id: 'window-management',
    label: 'Window Management',
    icon: LayoutPanelLeft,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/window_management_icon.svg`,
  },
  {
    id: 'quicklinks',
    label: 'Quicklinks',
    icon: LinkIcon,
    section: 'BUILT-IN',
    iconSrc: `${APP_ICON}/quicklinks_icon.svg`,
  },
];

export const SETTINGS_GROUPS: { id: string; categories: SettingsCategory[] }[] = [
  { id: 'preferences', categories: ['general', 'launcher', 'keyboard', 'advanced', 'shortcuts'] },
  { id: 'search', categories: ['applications', 'file-search', 'web-search', 'plugins'] },
  {
    id: 'tools',
    categories: [
      'clipboard',
      'ai',
      'notes',
      'snippets',
      'emoji',
      'shell',
      'calculator',
      'games',
      'system-monitor',
      'timer',
      'window-management',
      'quicklinks',
    ],
  },
  { id: 'connections', categories: ['account', 'sync', 'integrations', 'extensions'] },
  { id: 'volt', categories: ['about'] },
];

export function categoryTranslationKey(category: SettingsCategory): string {
  return `sections.${category === 'file-search' ? 'fileSearch' : category === 'web-search' ? 'webSearch' : category}`;
}

/** Search only navigation labels/descriptions; accents and word order do not block a match. */
export function matchesSettingsQuery(query: string, values: string[]): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase();
  const haystack = normalize(values.join(' '));
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/**
 * Settings pages that belong to one managed built-in plugin. Those pages show the plugin's
 * activation switch in their header and are greyed out while the plugin is disabled. The ids
 * are runtime plugin ids from `MANAGED_PLUGINS`.
 */
export const PLUGIN_PAGE_IDS: Partial<Record<SettingsCategory, string>> = {
  'web-search': 'websearch',
  clipboard: 'clipboard',
  shell: 'shellcommand',
  emoji: 'emoji-picker',
  notes: 'notes',
  snippets: 'snippets',
  calculator: 'calculator',
  games: 'games',
  'system-monitor': 'system_monitor',
  timer: 'timer',
  'window-management': 'window-management',
  quicklinks: 'quicklinks',
};

/** Inverse of `PLUGIN_PAGE_IDS`: the Settings page that configures a plugin, when it has one. */
export function settingsPageForPlugin(pluginId: string): SettingsCategory | undefined {
  return (Object.keys(PLUGIN_PAGE_IDS) as SettingsCategory[]).find(
    (page) => PLUGIN_PAGE_IDS[page] === pluginId
  );
}
