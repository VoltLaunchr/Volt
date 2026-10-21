/**
 * Launcher service for interacting with the Tauri launcher backend
 * Provides methods for launching apps with history tracking and managing favorites
 */

import { invoke } from '@tauri-apps/api/core';
import { extractErrorMessage, logger } from '../../../shared/utils';
import type { LaunchRecord } from '../types/launcher.types';

const errorMessage = extractErrorMessage;

/**
 * Service for launching applications and managing history
 */
export const launcherService = {
  /**
   * Launch an application with history tracking.
   * @param path - Path to the application
   * @param asAdmin - Run elevated (Windows ShellExecuteW "runas" verb).
   *                 Falls back to a normal launch on platforms where elevation
   *                 is not yet implemented.
   */
  async launchApp(path: string, asAdmin = false): Promise<void> {
    try {
      await invoke<void>('launch_app', { path, asAdmin });
    } catch (error) {
      logger.error('Failed to launch app:', error);
      throw new Error(`Failed to launch application: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Get recently launched applications
   * @param limit - Maximum number of apps to return (default: 10)
   */
  async getRecentApps(limit = 10): Promise<LaunchRecord[]> {
    try {
      return await invoke<LaunchRecord[]>('get_recent_apps', { limit });
    } catch (error) {
      logger.error('Failed to get recent apps:', error);
      return [];
    }
  },

  /**
   * Get most frequently launched applications
   * @param limit - Maximum number of apps to return (default: 10)
   */
  async getFrequentApps(limit = 10): Promise<LaunchRecord[]> {
    try {
      return await invoke<LaunchRecord[]>('get_frequent_apps', { limit });
    } catch (error) {
      logger.error('Failed to get frequent apps:', error);
      return [];
    }
  },

  /**
   * Get pinned/favorite applications
   */
  async getPinnedApps(): Promise<LaunchRecord[]> {
    try {
      return await invoke<LaunchRecord[]>('get_pinned_apps');
    } catch (error) {
      logger.error('Failed to get pinned apps:', error);
      return [];
    }
  },

  /**
   * Pin an application to favorites
   * @param path - Application path
   */
  async pinApp(path: string): Promise<void> {
    try {
      await invoke<void>('pin_app', { path });
    } catch (error) {
      logger.error('Failed to pin app:', error);
      throw new Error(`Failed to pin application: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Unpin an application from favorites
   * @param path - Application path
   */
  async unpinApp(path: string): Promise<void> {
    try {
      await invoke<void>('unpin_app', { path });
    } catch (error) {
      logger.error('Failed to unpin app:', error);
      throw new Error(`Failed to unpin application: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Add a tag to an application
   * @param path - Application path
   * @param tag - Tag to add
   */
  async addTag(path: string, tag: string): Promise<void> {
    try {
      await invoke<void>('add_app_tag', { path, tag });
    } catch (error) {
      logger.error('Failed to add tag:', error);
      throw new Error(`Failed to add tag: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Remove a tag from an application
   * @param path - Application path
   * @param tag - Tag to remove
   */
  async removeTag(path: string, tag: string): Promise<void> {
    try {
      await invoke<void>('remove_app_tag', { path, tag });
    } catch (error) {
      logger.error('Failed to remove tag:', error);
      throw new Error(`Failed to remove tag: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Get applications with a specific tag
   * @param tag - Tag to filter by
   */
  async getAppsByTag(tag: string): Promise<LaunchRecord[]> {
    try {
      return await invoke<LaunchRecord[]>('get_apps_by_tag', { tag });
    } catch (error) {
      logger.error('Failed to get apps by tag:', error);
      return [];
    }
  },

  /**
   * Get all tags used in history
   */
  async getAllTags(): Promise<string[]> {
    try {
      return await invoke<string[]>('get_all_tags');
    } catch (error) {
      logger.error('Failed to get tags:', error);
      return [];
    }
  },

  /**
   * Get history record for a specific app
   * @param path - Application path
   */
  async getAppHistory(path: string): Promise<LaunchRecord | null> {
    try {
      return await invoke<LaunchRecord | null>('get_app_history', { path });
    } catch (error) {
      logger.error('Failed to get app history:', error);
      return null;
    }
  },

  /**
   * Clear all launch history
   */
  async clearHistory(): Promise<void> {
    try {
      await invoke<void>('clear_launch_history');
    } catch (error) {
      logger.error('Failed to clear history:', error);
      throw new Error(`Failed to clear history: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Remove a specific app from history
   * @param path - Application path
   */
  async removeFromHistory(path: string): Promise<void> {
    try {
      await invoke<void>('remove_from_history', { path });
    } catch (error) {
      logger.error('Failed to remove from history:', error);
      throw new Error(`Failed to remove from history: ${errorMessage(error)}`, { cause: error });
    }
  },

  /**
   * Get total count of apps in history
   */
  async getHistoryCount(): Promise<number> {
    try {
      return await invoke<number>('get_history_count');
    } catch (error) {
      logger.error('Failed to get history count:', error);
      return 0;
    }
  },
};

export default launcherService;
