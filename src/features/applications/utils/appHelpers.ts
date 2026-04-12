/**
 * Utility functions for working with applications
 */

import type { AppInfo } from '../../../shared/types/common.types';
import { AppCategory } from '../../../shared/types/common.types';

/**
 * Sort applications by usage count (most used first)
 * @param apps - Applications to sort
 * @returns Sorted applications array
 */
export function sortAppsByUsage(apps: AppInfo[]): AppInfo[] {
  return [...apps].sort((a, b) => b.usageCount - a.usageCount);
}

/**
 * Sort applications by last used (most recent first)
 * @param apps - Applications to sort
 * @returns Sorted applications array
 */
export function sortAppsByLastUsed(apps: AppInfo[]): AppInfo[] {
  return [...apps].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
}

/**
 * Sort applications alphabetically by name
 * @param apps - Applications to sort
 * @returns Sorted applications array
 */
export function sortAppsByName(apps: AppInfo[]): AppInfo[] {
  return [...apps].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Filter applications by category
 * @param apps - Applications to filter
 * @param category - Category to filter by
 * @returns Filtered applications array
 */
export function filterAppsByCategory(apps: AppInfo[], category: AppCategory | string): AppInfo[] {
  return apps.filter((app) => app.category === category);
}

/**
 * Filter applications that have been used at least once
 * @param apps - Applications to filter
 * @returns Applications that have been used
 */
export function filterRecentlyUsed(apps: AppInfo[]): AppInfo[] {
  return apps.filter((app) => app.usageCount > 0 || app.lastUsed);
}

/**
 * Get the most frequently used applications
 * @param apps - Applications to filter
 * @param limit - Maximum number of apps to return (default: 5)
 * @returns Top used applications
 */
export function getTopUsedApps(apps: AppInfo[], limit = 5): AppInfo[] {
  return sortAppsByUsage(apps).slice(0, limit);
}

/**
 * Get the most recently used applications
 * @param apps - Applications to filter
 * @param limit - Maximum number of apps to return (default: 5)
 * @returns Most recently used applications
 */
export function getRecentApps(apps: AppInfo[], limit = 5): AppInfo[] {
  return sortAppsByLastUsed(filterRecentlyUsed(apps)).slice(0, limit);
}

/**
 * Format an application path for display (shorter version)
 * @param path - Full application path
 * @returns Formatted path string
 */
export function formatAppPath(path: string): string {
  // Replace common directories with shorter versions
  const replacements: [RegExp, string][] = [
    [/^C:\\Program Files\\/, 'C:\\...\\'],
    [/^C:\\Program Files \(x86\)\\/, 'C:\\...\\'],
    [/^C:\\Users\\[^\\]+\\AppData\\Local\\Programs\\/, '%LOCAL%\\'],
    [/^C:\\Users\\[^\\]+\\AppData\\Roaming\\/, '%APPDATA%\\'],
    [/^C:\\Users\\[^\\]+\\/, '~\\'],
  ];

  let formatted = path;
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(formatted)) {
      formatted = formatted.replace(pattern, replacement);
      break;
    }
  }

  return formatted;
}

/**
 * Get display icon for an app category
 * @param category - Application category
 * @returns Icon name or emoji
 */
export function getCategoryIcon(category: AppCategory | string | undefined): string {
  const icons: Record<string, string> = {
    [AppCategory.Development]: '💻',
    [AppCategory.Productivity]: '📊',
    [AppCategory.Media]: '🎬',
    [AppCategory.Gaming]: '🎮',
    [AppCategory.System]: '⚙️',
    [AppCategory.Other]: '📁',
  };

  return icons[category || AppCategory.Other] || '📁';
}

/**
 * Get a human-readable category name
 * @param category - Application category
 * @returns Human-readable category name
 */
export function getCategoryName(category: AppCategory | string | undefined): string {
  const names: Record<string, string> = {
    [AppCategory.Development]: 'Development',
    [AppCategory.Productivity]: 'Productivity',
    [AppCategory.Media]: 'Media & Entertainment',
    [AppCategory.Gaming]: 'Games',
    [AppCategory.System]: 'System Tools',
    [AppCategory.Other]: 'Other',
  };

  return names[category || AppCategory.Other] || 'Other';
}

/**
 * Extract file name from a path
 * @param path - Full file path
 * @returns File name without extension
 */
export function getAppNameFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() || path;
  return fileName.replace(/\.(exe|lnk|msi)$/i, '');
}

/**
 * Check if an app path is valid and exists
 * @param path - Application path to check
 * @returns Whether the path looks valid (basic check, not filesystem check)
 */
export function isValidAppPath(path: string): boolean {
  if (!path || path.trim() === '') return false;

  // Check for valid Windows path format
  const windowsPathRegex = /^[A-Za-z]:\\[\w\s\-.\\]+$/;
  return windowsPathRegex.test(path);
}

/**
 * Group applications by category
 * @param apps - Applications to group
 * @returns Map of category to applications
 */
export function groupAppsByCategory(apps: AppInfo[]): Map<string, AppInfo[]> {
  const groups = new Map<string, AppInfo[]>();

  apps.forEach((app) => {
    const category = app.category || AppCategory.Other;
    const existing = groups.get(category) || [];
    groups.set(category, [...existing, app]);
  });

  return groups;
}

/**
 * Calculate time since last use
 * @param lastUsed - Timestamp of last use
 * @returns Human-readable time string
 */
export function getTimeSinceLastUsed(lastUsed: number | undefined): string {
  if (!lastUsed) return 'Never used';

  const now = Date.now();
  const diff = now - lastUsed;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
