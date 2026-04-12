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
  type LucideIcon,
} from 'lucide-react';

export type SettingsCategory =
  | 'general'
  | 'shortcuts'
  | 'advanced'
  | 'about'
  | 'extensions'
  | 'applications'
  | 'plugins'
  | 'file-search'
  | 'clipboard';

export interface CategoryItem {
  id: SettingsCategory;
  label: string;
  icon: LucideIcon;
  section?: string;
}

export const SETTINGS_CATEGORIES: CategoryItem[] = [
  // Main settings
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'extensions', label: 'Extensions', icon: Store },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
  { id: 'about', label: 'About', icon: Info },
  // Built-in Features
  { id: 'applications', label: 'Applications', icon: Package, section: 'BUILT-IN' },
  { id: 'plugins', label: 'Plugins', icon: Puzzle, section: 'BUILT-IN' },
  { id: 'file-search', label: 'File Search', icon: Search, section: 'BUILT-IN' },
  { id: 'clipboard', label: 'Clipboard History', icon: Clipboard, section: 'BUILT-IN' },
];
