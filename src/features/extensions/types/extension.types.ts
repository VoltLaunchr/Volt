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
  Monitor,
} from 'lucide-react';

export interface ExtensionAuthor {
  name: string;
  github?: string;
  email?: string;
}

export type ExtensionPreferenceType =
  | 'text'
  | 'secret'
  | 'number'
  | 'boolean'
  | 'select'
  | 'file'
  | 'directory'
  | 'oauth';

export interface ExtensionPreference {
  name: string;
  type: ExtensionPreferenceType;
  title: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  /** For type 'select' — list of valid values */
  options?: string[];
  /** For type 'number' */
  min?: number;
  max?: number;
  /** For type 'oauth' — PKCE OAuth connection config */
  oauthProvider?: string;
  oauthAuthUrl?: string;
  oauthTokenUrl?: string;
  oauthClientId?: string;
  oauthScopes?: string[];
}

/** A single named command exposed by the extension (Raycast-style multi-command). */
export interface ExtensionCommand {
  /** Unique name within this extension (snake_case, used as a sub-id) */
  name: string;
  /** Human-readable title shown in search results */
  title: string;
  /** Short subtitle / description shown below the title */
  description?: string;
  /** Entry point file relative to the extension root (overrides manifest.main) */
  main?: string;
  /** Trigger prefix for this specific command (overrides manifest.prefix) */
  prefix?: string;
  /** Extra keywords for matching this command */
  keywords?: string[];
  /** Icon override for this command (URL or data-URI) */
  icon?: string;
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
  /** Declarative preferences (API keys, toggles, selects) shown in extension settings */
  preferences?: ExtensionPreference[];
  /** Multiple named commands — each gets its own search result and entry point */
  commands?: ExtensionCommand[];
  /**
   * Background refresh — Volt will call match('') on the extension at the given interval
   * and cache results for instant display. Format: "30s", "5m", "1h".
   */
  backgroundRefresh?: { interval: string };
}

export type ExtensionCategory =
  | 'productivity'
  | 'utilities'
  | 'developer'
  | 'media'
  | 'social'
  | 'finance'
  | 'games'
  | 'system'
  | 'other';

/**
 * Canonical list of extension permissions.
 *
 * This is the single source of truth for both the TS type and the runtime
 * validator used by the loader and the consent dialog. To add a new permission,
 * add it here and provide a matching entry in `PERMISSION_INFO` in
 * `components/PermissionDialog.tsx`.
 */
export const EXTENSION_PERMISSIONS = [
  'clipboard',
  'network',
  'notifications',
  'openUrl',
  'oauth',
  'ai',
  'system',
] as const;

export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number];

/**
 * Runtime guard: true iff `value` is a known `ExtensionPermission`.
 * Narrows the type for downstream consumers (no `as` needed).
 */
export function isExtensionPermission(value: unknown): value is ExtensionPermission {
  return (
    typeof value === 'string' &&
    (EXTENSION_PERMISSIONS as readonly string[]).includes(value)
  );
}

export interface ExtensionInfo {
  manifest: ExtensionManifest;
  downloadUrl: string;
  downloads: number;
  stars: number;
  verified: boolean;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  /** URLs of screenshot images (800×500 recommended) */
  screenshots?: string[];
  /** Path or URL to a Markdown description file */
  readmeUrl?: string;
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
 * Dev extension - linked from local folder for development.
 *
 * Dev extensions always re-prompt on reload; granted perms are not persisted.
 * Use the full install flow for persistent grants.
 *
 * FOLLOW-UP: to persist grants across dev reloads, add `granted_permissions: Vec<String>`
 * to Rust `DevExtension` struct + expose via a `get_dev_extensions_with_grants` IPC
 * + update `getGrantedPermissions` to merge both sources.
 */
export interface DevExtension {
  manifest: ExtensionManifest;
  path: string;
  linkedAt: string;
  enabled: boolean;
  /** Always true for dev extensions */
  isDev: boolean;
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
  { id: 'developer', label: 'Developer', icon: Code },
  { id: 'media', label: 'Media', icon: Music },
  { id: 'social', label: 'Social', icon: MessageCircle },
  { id: 'finance', label: 'Finance', icon: DollarSign },
  { id: 'games', label: 'Games', icon: Gamepad2 },
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'other', label: 'Other', icon: Folder },
];
