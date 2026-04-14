/**
 * Credentials Service
 * Handles secure storage and encryption of API tokens for integrations
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../shared/utils/logger';

export interface StoredCredential {
  service: 'github' | 'notion';
  token: string;
  savedAt: string;
  enabled: boolean;
}

class CredentialsService {
  /**
   * Save API token securely (encrypted by Tauri)
   */
  async saveToken(service: 'github' | 'notion', token: string): Promise<boolean> {
    try {
      if (!token || token.trim().length === 0) {
        throw new Error('Token cannot be empty');
      }

      // Validate token format
      if (service === 'github' && !token.startsWith('ghp_') && !token.startsWith('gho_')) {
        logger.warn('GitHub token does not start with expected prefix');
      }

      if (service === 'notion' && !token.startsWith('secret_')) {
        logger.warn('Notion token does not start with expected prefix');
      }

      await invoke('save_credential', {
        service,
        token: token.trim(),
      });

      logger.info(`${service} token saved securely`);
      return true;
    } catch (error) {
      logger.error(`Failed to save ${service} token:`, error);
      throw error;
    }
  }

  /**
   * Load API token from secure storage
   */
  async loadToken(service: 'github' | 'notion'): Promise<string | null> {
    try {
      const token = await invoke<string | null>('load_credential', { service });
      return token || null;
    } catch (error) {
      logger.error(`Failed to load ${service} token:`, error);
      return null;
    }
  }

  /**
   * Check if token exists
   */
  async hasToken(service: 'github' | 'notion'): Promise<boolean> {
    try {
      const token = await this.loadToken(service);
      return !!token;
    } catch {
      return false;
    }
  }

  /**
   * Delete stored token
   */
  async deleteToken(service: 'github' | 'notion'): Promise<boolean> {
    try {
      await invoke('delete_credential', { service });
      logger.info(`${service} token deleted`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete ${service} token:`, error);
      throw error;
    }
  }

  /**
   * Test token validity
   */
  async testToken(service: 'github' | 'notion', token: string): Promise<boolean> {
    try {
      if (service === 'github') {
        // Test GitHub API
        const response = await globalThis.fetch('https://api.github.com/user', {
          headers: {
            Authorization: `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Volt',
          },
        });
        return response.status === 200;
      }

      if (service === 'notion') {
        // Test Notion API
        const response = await globalThis.fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2024-02-15',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: '', page_size: 1 }),
        });
        return response.status === 200;
      }

      return false;
    } catch (error) {
      logger.error(`Token test failed for ${service}:`, error);
      return false;
    }
  }

  /**
   * Get credential metadata without exposing token
   */
  async getCredentialInfo(service: 'github' | 'notion'): Promise<StoredCredential | null> {
    try {
      const info = await invoke<StoredCredential | null>('get_credential_info', { service });
      return info;
    } catch (error) {
      logger.error(`Failed to get credential info for ${service}:`, error);
      return null;
    }
  }
}

export const credentialsService = new CredentialsService();
