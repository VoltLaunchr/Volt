import i18n from 'i18next';
import {
  Newspaper,
  Settings,
  Clipboard,
  Search,
  Smile,
  Zap,
  User,
  Activity,
  Calculator,
  Clock,
  Globe,
  Gamepad2,
  Code,
  Package,
  StickyNote,
  FilePlus,
  type LucideIcon,
} from 'lucide-react';

export interface Suggestion {
  id: string;
  title: string;
  subtitle: string;
  /** Lucide icon used as fallback when no SVG asset is available. */
  icon: LucideIcon;
  /** Path (relative to /public) to a tile-style SVG icon. Takes precedence over `icon`. */
  iconSrc?: string;
  category: 'suggestion' | 'command';
  action: () => void;
  shortcut?: string;
}

const APP_ICON = '/icons/app';

export interface SuggestionCategory {
  title: string;
  items: Omit<Suggestion, 'action'>[];
}

export interface SuggestionBadge {
  text: string;
  type?: 'default' | 'version' | 'shortcut';
}

/**
 * Get translated suggestion title, falling back to the hardcoded English.
 */
export function getSuggestionTitle(id: string, fallback: string): string {
  const key = `suggestions.${id}.title`;
  const translated = i18n.t(key, { ns: 'common' });
  return translated === key ? fallback : translated;
}

/**
 * Get translated suggestion subtitle, falling back to the hardcoded English.
 */
export function getSuggestionSubtitle(id: string, fallback: string): string {
  const key = `suggestions.${id}.subtitle`;
  const translated = i18n.t(key, { ns: 'common' });
  return translated === key ? fallback : translated;
}

export const defaultSuggestions: SuggestionCategory[] = [
  {
    title: 'Suggestions',
    items: [
      {
        id: 'whats-new',
        title: "See what's new",
        // The actual version comes from the i18n string "v{{version}}",
        // interpolated in SuggestionsView from the Tauri runtime. This
        // hardcoded subtitle is only used as a defaultValue when i18n is
        // unavailable; we don't pin a number here to avoid drift.
        subtitle: '',
        icon: Newspaper,
        iconSrc: `${APP_ICON}/about_news_icon.svg`,
        category: 'suggestion',
        shortcut: 'Changelog',
      },
      {
        id: 'settings',
        title: 'Settings',
        subtitle: 'Application Settings',
        icon: Settings,
        iconSrc: `${APP_ICON}/settings_icon.svg`,
        category: 'suggestion',
        shortcut: 'Command',
      },
      {
        id: 'clipboard-history',
        title: 'Clipboard History',
        subtitle: 'View Clipboard',
        icon: Clipboard,
        iconSrc: `${APP_ICON}/clipboard_history_icon.svg`,
        category: 'suggestion',
        shortcut: 'Command',
      },
      {
        id: 'search-files',
        title: 'Search Files',
        subtitle: 'File Search',
        icon: Search,
        iconSrc: `${APP_ICON}/file_search_icon.svg`,
        category: 'suggestion',
        shortcut: 'Command',
      },
      {
        id: 'search-emoji',
        title: 'Search Emoji & Symbols',
        subtitle: 'Emoji Picker',
        icon: Smile,
        iconSrc: `${APP_ICON}/emojis_icon.svg`,
        category: 'suggestion',
        shortcut: 'Command',
      },
      {
        id: 'notes',
        title: 'Notes',
        subtitle: 'Open Notes',
        icon: StickyNote,
        category: 'suggestion',
        shortcut: 'Command',
      },
    ],
  },
  {
    title: 'Commands',
    items: [
      {
        id: 'about',
        title: 'About',
        subtitle: 'Volt Information',
        icon: Zap,
        iconSrc: `${APP_ICON}/about-settings_icon.svg`,
        category: 'command',
        shortcut: 'Command',
      },
      {
        id: 'account',
        title: 'Account',
        subtitle: 'User Settings',
        icon: User,
        iconSrc: `${APP_ICON}/account_icon.svg`,
        category: 'command',
        shortcut: 'Command',
      },
      {
        id: 'system-monitor',
        title: 'System Monitor',
        subtitle: 'View Performance',
        icon: Activity,
        iconSrc: `${APP_ICON}/system_monitor_icon.svg`,
        category: 'command',
      },
      {
        id: 'calculator',
        title: 'Calculator',
        subtitle: 'Quick Math',
        icon: Calculator,
        iconSrc: `${APP_ICON}/calculator_icon.svg`,
        category: 'command',
      },
      {
        id: 'timer',
        title: 'Timer',
        subtitle: 'Set Timer',
        icon: Clock,
        iconSrc: `${APP_ICON}/pomodoro_icon.svg`,
        category: 'command',
      },
      {
        id: 'web-search',
        title: 'Web Search',
        subtitle: 'Search Online',
        icon: Globe,
        iconSrc: `${APP_ICON}/web_search_icon.svg`,
        category: 'command',
      },
      {
        id: 'steam-games',
        title: 'Games',
        subtitle: 'Launch Games',
        icon: Gamepad2,
        iconSrc: `${APP_ICON}/games_icon.svg`,
        category: 'command',
      },
      {
        id: 'create-note',
        title: 'Create Note',
        subtitle: 'New Markdown Note',
        icon: FilePlus,
        category: 'command',
        shortcut: 'Command',
      },
      {
        id: 'search-notes',
        title: 'Search Notes',
        subtitle: 'Full-text search',
        icon: StickyNote,
        category: 'command',
        shortcut: 'Command',
      },
      {
        id: 'create-extension',
        title: 'Create Extension',
        subtitle: 'Developer',
        icon: Code,
        category: 'command',
        shortcut: 'Command',
      },
      {
        id: 'manage-extensions',
        title: 'Manage Extensions',
        subtitle: 'Developer',
        icon: Package,
        category: 'command',
        shortcut: 'Command',
      },
    ],
  },
];
