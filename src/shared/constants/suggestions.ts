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
  type LucideIcon,
} from 'lucide-react';

export interface Suggestion {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  category: 'suggestion' | 'command';
  action: () => void;
  shortcut?: string;
}

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
        subtitle: 'v0.0.5.2',
        icon: Newspaper,
        category: 'suggestion',
        shortcut: 'Changelog',
      },
      {
        id: 'settings',
        title: 'Settings',
        subtitle: 'Application Settings',
        icon: Settings,
        category: 'suggestion',
        shortcut: 'Command',
      },
      {
        id: 'clipboard-history',
        title: 'Clipboard History',
        subtitle: 'View Clipboard',
        icon: Clipboard,
        category: 'suggestion',
        shortcut: 'Command',
      },
      {
        id: 'search-files',
        title: 'Search Files',
        subtitle: 'File Search',
        icon: Search,
        category: 'suggestion',
        shortcut: 'Command',
      },
      {
        id: 'search-emoji',
        title: 'Search Emoji & Symbols',
        subtitle: 'Emoji Picker',
        icon: Smile,
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
        category: 'command',
        shortcut: 'Command',
      },
      {
        id: 'account',
        title: 'Account',
        subtitle: 'User Settings',
        icon: User,
        category: 'command',
        shortcut: 'Command',
      },
      {
        id: 'system-monitor',
        title: 'System Monitor',
        subtitle: 'View Performance',
        icon: Activity,
        category: 'command',
      },
      {
        id: 'calculator',
        title: 'Calculator',
        subtitle: 'Quick Math',
        icon: Calculator,
        category: 'command',
      },
      {
        id: 'timer',
        title: 'Timer',
        subtitle: 'Set Timer',
        icon: Clock,
        category: 'command',
      },
      {
        id: 'web-search',
        title: 'Web Search',
        subtitle: 'Search Online',
        icon: Globe,
        category: 'command',
      },
      {
        id: 'steam-games',
        title: 'Games',
        subtitle: 'Launch Games',
        icon: Gamepad2,
        category: 'command',
      },
    ],
  },
];
