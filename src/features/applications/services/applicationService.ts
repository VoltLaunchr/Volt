/**
 * Application service for interacting with the Tauri backend
 * Provides methods for scanning, searching, and launching applications
 */

import { invoke } from '@tauri-apps/api/core';
import type { AppCategory, AppInfo } from '../../../shared/types/common.types';
import { extractErrorMessage } from '../../../shared/utils/error';
import { logger } from '../../../shared/utils/logger';
import type { AppLaunchResult, AppSearchOptions } from '../types';

/**
 * Service for managing applications
 */
export const applicationService = {
  /**
   * Scan the system for installed applications
   * This scans common Windows locations for executables and shortcuts
   * @returns Promise resolving to array of found applications
   */
  async scanApplications(): Promise<AppInfo[]> {
    try {
      const apps = await invoke<AppInfo[]>('scan_applications');
      return apps;
    } catch (error) {
      logger.error('Failed to scan applications:', error);
      const msg = extractErrorMessage(error);
      throw new Error(`Failed to scan applications: ${msg}`, { cause: error });
    }
  },

  /**
   * Search through applications based on query
   * @param options - Search options including query and filters
   * @param apps - Array of applications to search through
   * @returns Promise resolving to filtered and sorted applications
   */
  async searchApplications(options: AppSearchOptions, apps: AppInfo[]): Promise<AppInfo[]> {
    const { query, limit, sortBy = 'score', sortDirection = 'desc' } = options;

    if (!query.trim()) {
      return [];
    }

    try {
      let results = await invoke<AppInfo[]>('search_applications', {
        query,
        apps,
      });

      // Apply additional sorting if needed
      if (sortBy !== 'score') {
        results = this.sortApplications(results, sortBy, sortDirection);
      }

      // Apply limit if specified
      if (limit && limit > 0) {
        results = results.slice(0, limit);
      }

      return results;
    } catch (error) {
      logger.error('Failed to search applications:', error);
      const msg = extractErrorMessage(error);
      throw new Error(`Failed to search applications: ${msg}`, { cause: error });
    }
  },

  /**
   * Launch an application by its path.
   *
   * Routes through the canonical `launch_application` Tauri command which
   * records the launch in history (frecency stays accurate) and supports
   * elevated launches via `asAdmin`.
   *
   * @param path - Path to the application executable
   * @param asAdmin - Run elevated (Shift+Enter on Windows). Default false.
   * @returns Promise resolving to launch result
   */
  async launchApplication(path: string, asAdmin = false): Promise<AppLaunchResult> {
    const launchedAt = Date.now();

    try {
      await invoke<void>('launch_application', { path, asAdmin });
      return {
        success: true,
        path,
        launchedAt,
      };
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error('Failed to launch application:', errorMessage);
      return {
        success: false,
        error: errorMessage,
        path,
        launchedAt,
      };
    }
  },

  /**
   * Sort applications by a specific field
   * @param apps - Applications to sort
   * @param field - Field to sort by
   * @param direction - Sort direction
   * @returns Sorted applications array
   */
  sortApplications(
    apps: AppInfo[],
    field: 'name' | 'lastUsed' | 'usageCount' | 'score',
    direction: 'asc' | 'desc' = 'desc'
  ): AppInfo[] {
    const sorted = [...apps].sort((a, b) => {
      let comparison: number;

      switch (field) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'lastUsed':
          comparison = (a.lastUsed || 0) - (b.lastUsed || 0);
          break;
        case 'usageCount':
          comparison = a.usageCount - b.usageCount;
          break;
        default:
          comparison = 0;
      }

      return direction === 'desc' ? -comparison : comparison;
    });

    return sorted;
  },

  /**
   * Filter applications by category
   * @param apps - Applications to filter
   * @param category - Category to filter by
   * @returns Filtered applications array
   */
  filterByCategory(apps: AppInfo[], category: AppCategory): AppInfo[] {
    return apps.filter((app) => app.category === category);
  },

  /**
   * Get unique categories from applications
   * @param apps - Applications to extract categories from
   * @returns Array of unique category names
   */
  getCategories(apps: AppInfo[]): string[] {
    const categories = new Set<string>();
    apps.forEach((app) => {
      if (app.category) {
        categories.add(app.category);
      }
    });
    return Array.from(categories).sort();
  },
};

export default applicationService;
