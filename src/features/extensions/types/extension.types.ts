/**
 * Extension types for Volt Extension Store
 */

import type { LucideIcon } from 'lucide-react';
import {
  Package,
  Zap,
  Wrench,
  Code,
  Music,
  MessageCircle,
  DollarSign,
  Gamepad2,
  Folder,
} from 'lucide-react';

export interface ExtensionAuthor {
  name: string;
  github?: string;
  email?: string;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: ExtensionAuthor;
  icon?: string;
  keywords?: string[];
  /** Trigger prefix for Worker sandbox canHandle (e.g., "pass" matches queries starting with "pass") */
  prefix?: string;
  category?: ExtensionCategory;
  repository?: string;
  homepage?: string;
  license?: string;
  minVoltVersion?: string;
  permissions?: ExtensionPermission[];
  /** Entry point file for the extension (e.g., "index.js" or "src/plugin.ts") */
  main?: string;
}

export type ExtensionCategory =
  | 'productivity'
  | 'utilities'
  | 'development'
  | 'media'
  | 'social'
  | 'finance'
  | 'games'
  | 'other';

export type ExtensionPermission =
  | 'clipboard'
  | 'filesystem'
  | 'network'
  | 'shell'
  | 'notifications';

export interface ExtensionInfo {
  manifest: ExtensionManifest;
  downloadUrl: string;
  downloads: number;
  stars: number;
  verified: boolean;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InstalledExtension {
  manifest: ExtensionManifest;
  installedAt: string;
  enabled: boolean;
  path: string;
  /** Permissions granted by the user at install/first-load time */
  grantedPermissions?: ExtensionPermission[];
}

/**
 * Dev extension - linked from local folder for development
 */
export interface DevExtension {
  manifest: ExtensionManifest;
  path: string;
  linkedAt: string;
  enabled: boolean;
  /** Always true for dev extensions */
  isDev: boolean;
  /** Permissions granted by the user */
  grantedPermissions?: ExtensionPermission[];
}

export interface ExtensionRegistry {
  version: string;
  lastUpdated: string;
  extensions: ExtensionInfo[];
}

export interface ExtensionStoreState {
  available: ExtensionInfo[];
  installed: InstalledExtension[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  categoryFilter: ExtensionCategory | 'all';
}

export const EXTENSION_CATEGORIES: {
  id: ExtensionCategory | 'all';
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'all', label: 'All', icon: Package },
  { id: 'productivity', label: 'Productivity', icon: Zap },
  { id: 'utilities', label: 'Utilities', icon: Wrench },
  { id: 'development', label: 'Development', icon: Code },
  { id: 'media', label: 'Media', icon: Music },
  { id: 'social', label: 'Social', icon: MessageCircle },
  { id: 'finance', label: 'Finance', icon: DollarSign },
  { id: 'games', label: 'Games', icon: Gamepad2 },
  { id: 'other', label: 'Other', icon: Folder },
];
