/**
 * Extension Service
 * Handles communication with the Rust backend for extension management
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../shared/utils/logger';
import type {
  DevExtension,
  ExtensionInfo,
  ExtensionRegistry,
  InstalledExtension,
} from '../types/extension.types';

const REGISTRY_URL =
  'https://raw.githubusercontent.com/VoltLaunchr/volt-extensions/main/registry.json';

class ExtensionService {
  /**
   * Fetch the extension registry from GitHub
   */
  async fetchRegistry(): Promise<ExtensionRegistry> {
    try {
      const registry = await invoke<ExtensionRegistry>('fetch_extension_registry', {
        url: REGISTRY_URL,
      });
      return registry;
    } catch (error) {
      logger.error('Failed to fetch extension registry:', error);
      throw error;
    }
  }

  /**
   * Get list of installed extensions
   */
  async getInstalledExtensions(): Promise<InstalledExtension[]> {
    try {
      const extensions = await invoke<InstalledExtension[]>('get_installed_extensions');
      return extensions;
    } catch (error) {
      logger.error('Failed to get installed extensions:', error);
      throw error;
    }
  }

  /**
   * Install an extension
   */
  async installExtension(extensionId: string, downloadUrl: string): Promise<InstalledExtension> {
    try {
      const installed = await invoke<InstalledExtension>('install_extension', {
        extensionId,
        downloadUrl,
      });
      return installed;
    } catch (error) {
      logger.error('Failed to install extension:', error);
      throw error;
    }
  }

  /**
   * Uninstall an extension
   */
  async uninstallExtension(extensionId: string): Promise<void> {
    try {
      await invoke('uninstall_extension', { extensionId });
    } catch (error) {
      logger.error('Failed to uninstall extension:', error);
      throw error;
    }
  }

  /**
   * Enable/disable an extension
   */
  async toggleExtension(extensionId: string, enabled: boolean): Promise<void> {
    try {
      await invoke('toggle_extension', { extensionId, enabled });
    } catch (error) {
      logger.error('Failed to toggle extension:', error);
      throw error;
    }
  }

  /**
   * Check for extension updates
   */
  async checkForUpdates(): Promise<
    { extensionId: string; currentVersion: string; newVersion: string }[]
  > {
    try {
      const updates = await invoke<
        { extensionId: string; currentVersion: string; newVersion: string }[]
      >('check_extension_updates', { registryUrl: REGISTRY_URL });
      return updates;
    } catch (error) {
      logger.error('Failed to check for updates:', error);
      throw error;
    }
  }

  /**
   * Update an extension
   */
  async updateExtension(extensionId: string, downloadUrl: string): Promise<InstalledExtension> {
    try {
      const updated = await invoke<InstalledExtension>('update_extension', {
        extensionId,
        downloadUrl,
      });
      return updated;
    } catch (error) {
      logger.error('Failed to update extension:', error);
      throw error;
    }
  }

  /**
   * Get extension details (for both installed and available)
   */
  async getExtensionDetails(
    extensionId: string
  ): Promise<ExtensionInfo | InstalledExtension | null> {
    try {
      const details = await invoke<ExtensionInfo | InstalledExtension | null>(
        'get_extension_details',
        {
          extensionId,
        }
      );
      return details;
    } catch (error) {
      logger.error('Failed to get extension details:', error);
      throw error;
    }
  }

  // ============================================================================
  // DEV EXTENSIONS - Development mode for extension developers
  // ============================================================================

  /**
   * Get list of linked dev extensions
   */
  async getDevExtensions(): Promise<DevExtension[]> {
    try {
      const extensions = await invoke<DevExtension[]>('get_dev_extensions');
      return extensions;
    } catch (error) {
      logger.error('Failed to get dev extensions:', error);
      throw error;
    }
  }

  /**
   * Link a dev extension from a local folder
   * This is like `npm link` - it creates a symbolic reference to the local folder
   */
  async linkDevExtension(path: string): Promise<DevExtension> {
    try {
      const extension = await invoke<DevExtension>('link_dev_extension', { path });
      return extension;
    } catch (error) {
      logger.error('Failed to link dev extension:', error);
      throw error;
    }
  }

  /**
   * Unlink a dev extension
   */
  async unlinkDevExtension(extensionId: string): Promise<void> {
    try {
      await invoke('unlink_dev_extension', { extensionId });
    } catch (error) {
      logger.error('Failed to unlink dev extension:', error);
      throw error;
    }
  }

  /**
   * Toggle a dev extension enabled/disabled
   */
  async toggleDevExtension(extensionId: string, enabled: boolean): Promise<void> {
    try {
      await invoke('toggle_dev_extension', { extensionId, enabled });
    } catch (error) {
      logger.error('Failed to toggle dev extension:', error);
      throw error;
    }
  }

  /**
   * Get the dev extensions directory path
   */
  async getDevExtensionsPath(): Promise<string> {
    try {
      const path = await invoke<string>('get_dev_extensions_path');
      return path;
    } catch (error) {
      logger.error('Failed to get dev extensions path:', error);
      throw error;
    }
  }

  /**
   * Refresh a dev extension (re-read from disk)
   */
  async refreshDevExtension(extensionId: string): Promise<DevExtension> {
    try {
      const extension = await invoke<DevExtension>('refresh_dev_extension', {
        extensionId,
      });
      return extension;
    } catch (error) {
      logger.error('Failed to refresh dev extension:', error);
      throw error;
    }
  }
}

export const extensionService = new ExtensionService();
