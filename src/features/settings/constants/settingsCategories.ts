import {
  Settings as SettingsIcon,
  Keyboard,
  Wrench,
  Info,
  Package,
  Puzzle,
  Search,
  Clipboard,
  Store,
  Link as LinkIcon,
  Terminal,
  User,
  RefreshCw,
  Smile,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';

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
  | 'clipboard'
  | 'shell'
  | 'emoji'
  | 'ai'
  | 'notes';

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
  { id: 'account', label: 'Account', icon: User, iconSrc: `${APP_ICON}/account_icon.svg` },
  { id: 'sync', label: 'Sync', icon: RefreshCw, iconSrc: `${APP_ICON}/sync_icon.svg` },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, iconSrc: `${APP_ICON}/short_cut_icon.svg` },
  { id: 'advanced', label: 'Advanced', icon: Wrench, iconSrc: `${APP_ICON}/advanced_settings_icon.svg` },
  { id: 'about', label: 'About', icon: Info, iconSrc: `${APP_ICON}/about-settings_icon.svg` },
  // Built-in Features
  { id: 'applications', label: 'Applications', icon: Package, section: 'BUILT-IN', iconSrc: `${APP_ICON}/app_icon.svg` },
  { id: 'plugins', label: 'Plugins', icon: Puzzle, section: 'BUILT-IN', iconSrc: `${APP_ICON}/plugin_icon.svg` },
  { id: 'extensions', label: 'Extensions', icon: Store, section: 'BUILT-IN', iconSrc: `${APP_ICON}/extension_icon.svg` },
  { id: 'integrations', label: 'Integrations', icon: LinkIcon, section: 'BUILT-IN', iconSrc: `${APP_ICON}/integration_icon.svg` },
  { id: 'file-search', label: 'File Search', icon: Search, section: 'BUILT-IN', iconSrc: `${APP_ICON}/file_search_icon.svg` },
  { id: 'clipboard', label: 'Clipboard History', icon: Clipboard, section: 'BUILT-IN', iconSrc: `${APP_ICON}/clipboard_history_icon.svg` },
  { id: 'shell', label: 'Shell Commands', icon: Terminal, section: 'BUILT-IN', iconSrc: `${APP_ICON}/shell_icon.svg` },
  { id: 'emoji', label: 'Emoji & Symbols', icon: Smile, section: 'BUILT-IN', iconSrc: `${APP_ICON}/emojis_icon.svg` },
  { id: 'ai', label: 'AI', icon: Package, section: 'BUILT-IN', iconSrc: `${APP_ICON}/ai_icon.svg` },
  { id: 'notes', label: 'Notes', icon: StickyNote, section: 'BUILT-IN', iconSrc: `${APP_ICON}/volt_note_icons.svg` },
];
