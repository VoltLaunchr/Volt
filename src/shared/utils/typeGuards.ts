/**
 * Type guards for common data types in Volt
 * These functions provide runtime type checking with proper TypeScript type predicates
 */

import type { AppInfo, FileInfo, SearchResult } from '../types/common.types';
import type { ClipboardItem } from '../types/clipboard';
import type { LaunchRecord } from '../../features/applications/types/launcher.types';
import type { PluginResult } from '../../features/plugins/types';

/**
 * Type guard for PluginResult data
 * Checks if a value has the required PluginResult properties: type, title
 */
export function isPluginResultData(value: unknown): value is PluginResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'title' in value &&
    typeof (value as { type: unknown }).type === 'string' &&
    typeof (value as { title: unknown }).title === 'string'
  );
}

/**
 * Type guard for ClipboardItem
 * Checks if a value has the required ClipboardItem properties: id, content
 */
export function isClipboardItem(value: unknown): value is ClipboardItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'content' in value &&
    typeof (value as { id: unknown }).id === 'number' &&
    typeof (value as { content: unknown }).content === 'string'
  );
}

/**
 * Type guard for LaunchRecord
 * Checks if a value has the required LaunchRecord properties: path, launchCount
 */
export function isLaunchRecord(value: unknown): value is LaunchRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    'launchCount' in value &&
    typeof (value as { path: unknown }).path === 'string' &&
    typeof (value as { launchCount: unknown }).launchCount === 'number'
  );
}

/**
 * Type guard for SearchResult
 * Checks if a value has the required SearchResult properties: id, title, score
 */
export function isSearchResult(value: unknown): value is SearchResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'title' in value &&
    'score' in value &&
    typeof (value as { id: unknown }).id === 'string' &&
    typeof (value as { title: unknown }).title === 'string' &&
    typeof (value as { score: unknown }).score === 'number'
  );
}

/**
 * Type guard for AppInfo
 * Checks if a value has the required AppInfo properties: name, path
 */
export function isAppInfo(value: unknown): value is AppInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'path' in value &&
    typeof (value as { name: unknown }).name === 'string' &&
    typeof (value as { path: unknown }).path === 'string'
  );
}

/**
 * Type guard for FileInfo
 * Checks if a value has the required FileInfo properties: name, path
 */
export function isFileInfo(value: unknown): value is FileInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'path' in value &&
    typeof (value as { name: unknown }).name === 'string' &&
    typeof (value as { path: unknown }).path === 'string'
  );
}
