/**
 * Credentials Service
 * Handles secure storage and encryption of API tokens for integrations
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../shared/utils/logger';

export type CredentialServiceId = 'github' | 'notion' | 'brave-search';

export interface StoredCredential {
  service: CredentialServiceId;
  token: string;
  savedAt: string;
  enabled: boolean;
}

class CredentialsService {
  /**
   * Save API token securely (encrypted by Tauri)
   */
  async saveToken(service: CredentialServiceId, token: string): Promise<boolean> {
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

      await invoke<void>('save_credential', {
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
  async loadToken(service: CredentialServiceId): Promise<string | null> {
    try {
      const token = await invoke<string | null>('load_credential', { service });
      return token || null;
    } catch (error) {
      logger.error(`Failed to load ${service} token:`, error);
      return null;
    }
  }

  /**
   * Check if token exists.
   *
   * Uses the `has_credential` IPC command rather than `load_credential` so
   * the bare token never crosses the renderer boundary just for an existence
   * check (audit M2). `load_credential` is no longer exposed via IPC.
   */
  async hasToken(service: CredentialServiceId): Promise<boolean> {
    try {
      return await invoke<boolean>('has_credential', { service });
    } catch {
      return false;
    }
  }

  /**
   * Delete stored token
   */
  async deleteToken(service: CredentialServiceId): Promise<boolean> {
    try {
      await invoke<void>('delete_credential', { service });
      logger.info(`${service} token deleted`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete ${service} token:`, error);
      throw error;
    }
  }

  /**
   * Test that the stored credential for a service is valid. The backend reads
   * the token directly from the OS keyring — no token crosses the IPC boundary.
   */
  async testToken(service: CredentialServiceId): Promise<boolean> {
    try {
      return await invoke<boolean>('test_credential', { service });
    } catch (error) {
      logger.error(`Token test failed for ${service}:`, error);
      return false;
    }
  }

  /**
   * Get credential metadata without exposing token
   */
  async getCredentialInfo(service: CredentialServiceId): Promise<StoredCredential | null> {
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
