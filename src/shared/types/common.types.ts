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
 * Application categories for better organization.
 *
 * [SYNC: src-tauri/src/commands/apps.rs::detect_app_category]
 * Every value here MUST be produced by the Rust detector, and the Rust
 * detector MUST only produce values listed here. See `appCategoryStrings.test.ts`
 * for the regression guard.
 */
export enum AppCategory {
  Development = 'development',
  Browsers = 'browsers',
  Communication = 'communication',
  Media = 'media',
  Graphics = 'graphics',
  Office = 'office',
  System = 'system',
  Gaming = 'gaming',
  FileManagement = 'fileManagement',
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
  /** Raycast-style right-side accessories passed through from PluginResult */
  accessories?: PluginResultAccessory[];
  /** Sub-section label for grouping plugin results (e.g. "Open", "Review Requested") */
  section?: string;
  /** Grid layout hint — render this result as a grid card instead of a list row */
  layout?: 'grid';
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
  Url = 'url',
  GridItem = 'grid',
  AiChat = 'aichat',
}

/**
 * File category — mirrors `FileCategory` in `src-tauri/src/indexer/types.rs`.
 * Rust serializes with `rename_all = "lowercase"`.
 *
 * [SYNC: src-tauri/src/indexer/types.rs::FileCategory]
 */
export type FileCategory =
  | 'application'
  | 'game'
  | 'executable'
  | 'folder'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'other';

/**
 * File information for file search results.
 *
 * [SYNC: src-tauri/src/indexer/types.rs::FileInfo]
 * Rust struct uses `#[serde(rename_all = "camelCase")]`. Optional fields below
 * mirror `Option<i64>` / `Option<String>` on the Rust side. The trio
 * `created`/`accessed`/`category` was historically missing from the TS
 * interface even though Rust serializes them — adding them so highlight UI
 * and category-aware filters can consume the full payload without casts.
 */
export interface FileInfo {
  id: string;
  name: string;
  path: string;
  extension: string;
  size: number;
  modified: number;
  created?: number;
  accessed?: number;
  icon?: string;
  category?: FileCategory;
}

/**
 * Search result wrapper returned by `search_files` Tauri command.
 *
 * [SYNC: src-tauri/src/commands/files.rs::FileSearchResult]
 * Rust uses `#[serde(flatten)]` on the inner `FileInfo` so the wire format is
 * flat: every `FileInfo` field plus `score` and `matchedIndices`. The TS type
 * mirrors the flattened shape.
 */
export interface FileSearchResult extends FileInfo {
  score: number;
  matchedIndices: number[];
}

/**
 * First-class action attached to a plugin result (e.g. "Open URL", "Copy").
 * [SYNC: src/features/plugins/types/index.ts::PluginResultAction]
 */
export interface PluginResultAction {
  id: string;
  title: string;
  icon?: string;
  shortcut?: string;
  handler: 'openUrl' | 'copyToClipboard' | 'openFile' | 'runCommand' | 'custom';
  data?: Record<string, unknown>;
}

/**
 * Raycast-style right-side accessory for a plugin result.
 * Renders as small chips: [icon] [text] or a colored pill when tag=true.
 * [SYNC: src/features/plugins/types/index.ts::PluginResultAccessory]
 */
export interface PluginResultAccessory {
  /** Emoji or short glyph rendered as an icon */
  icon?: string;
  /** Label text shown next to the icon */
  text?: string;
  /** CSS hex color applied to text (and translucent bg when tag=true) */
  color?: string;
  /** Render as a colored pill badge instead of plain inline text */
  tag?: boolean;
}

/**
 * Plugin result data — generic plugin result from the plugins system.
 *
 * [SYNC: src/features/plugins/types/index.ts::PluginResult]
 * Kept structurally compatible with `PluginResult`; `pluginId` and `badge`
 * are optional so existing producers without them remain valid.
 */
export interface PluginResultData {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  pluginId?: string;
  score: number;
  data?: Record<string, unknown>;
  actions?: PluginResultAction[];
  /** Raycast-style right-side accessories: CI state, review decision, date, stars… */
  accessories?: PluginResultAccessory[];
  /** Optional sub-section label for grouping within a result bucket */
  section?: string;
  /** Grid layout hint — render this result as a grid card */
  layout?: 'grid';
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
