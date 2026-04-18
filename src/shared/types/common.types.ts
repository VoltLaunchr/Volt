/**
 * Common type definitions shared across the application
 */

/**
 * Discriminated union matching the serialized shape of `VoltError` on the Rust
 * backend (`src-tauri/src/core/error.rs`). Tauri commands that fail now return
 * this structured payload instead of an opaque string, so call sites can
 * branch on `kind` to decide how to react (e.g. show a "file not found" state
 * vs. a generic error toast).
 *
 * The Rust enum is serialized with `#[serde(tag = "kind", content = "message",
 * rename_all = "camelCase")]`, which produces objects in the shape below.
 */
export type VoltError =
  | { kind: 'fileSystem'; message: string }
  | { kind: 'notFound'; message: string }
  | { kind: 'permissionDenied'; message: string }
  | { kind: 'invalidConfig'; message: string }
  | { kind: 'plugin'; message: string }
  | { kind: 'search'; message: string }
  | { kind: 'launch'; message: string }
  | { kind: 'serialization'; message: string }
  | { kind: 'unknown'; message: string };

/**
 * Type guard to narrow an `unknown` caught error into a structured `VoltError`.
 * Useful for `catch` blocks that receive errors from Tauri `invoke()` calls.
 */
export function isVoltError(value: unknown): value is VoltError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as { kind: unknown }).kind === 'string' &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

/**
 * Represents an application that can be launched
 */
export interface AppInfo {
  id: string;
  name: string;
  path: string;
  icon?: string;
  description?: string;
  keywords?: string[];
  lastUsed?: number;
  usageCount: number;
  category?: AppCategory;
}

/**
 * Application categories for better organization
 */
export enum AppCategory {
  Development = 'development',
  Productivity = 'productivity',
  Media = 'media',
  Gaming = 'gaming',
  System = 'system',
  Other = 'other',
}

/**
 * Search result item
 */
export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: string; // Badge text displayed on the right (e.g., "Game", "App")
  score: number;
  data: AppInfo | FileInfo | PluginResultData;
}

/**
 * Type of search result
 */
export enum SearchResultType {
  Application = 'application',
  File = 'file',
  Plugin = 'plugin',
  Command = 'command',
  Calculator = 'calculator',
  WebSearch = 'websearch',
  SystemCommand = 'systemcommand',
  Timer = 'timer',
  SystemMonitor = 'systemmonitor',
  Game = 'game',
  ShellCommand = 'shellcommand',
}

/**
 * File information for file search results
 */
export interface FileInfo {
  id: string;
  name: string;
  path: string;
  extension: string;
  size: number;
  modified: number;
  icon?: string;
}

/**
 * Plugin result data - Generic plugin result from the plugins system
 */
export interface PluginResultData {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  icon?: string;
  score: number;
  data?: Record<string, unknown>;
}

/**
 * Application settings
 */
export interface Settings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  hotkeys: HotkeySettings;
  indexing: IndexingSettings;
}

export interface GeneralSettings {
  startWithWindows: boolean;
  maxResults: number;
  closeOnLaunch: boolean;
  language: 'auto' | 'en' | 'fr';
}

export interface AppearanceSettings {
  theme: 'light' | 'dark' | 'auto';
  transparency: number;
  windowPosition: 'center' | 'top' | 'custom';
  customPosition?: { x: number; y: number };
}

export interface HotkeySettings {
  toggleWindow: string;
  openSettings: string;
}

export interface IndexingSettings {
  folders: string[];
  excludedPaths: string[];
  fileExtensions: string[];
  indexOnStartup: boolean;
}
