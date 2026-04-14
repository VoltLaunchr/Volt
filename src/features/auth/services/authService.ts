/**
 * Auth service — thin wrapper around Tauri invoke calls.
 * The Rust backend handles all token storage, browser opening, and deep link processing.
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../shared/utils/logger';
import type { AuthSession, UserProfile } from '../types';

export const authService = {
  /** Opens browser to website login page */
  async login(): Promise<void> {
    try {
      await invoke('auth_login');
    } catch (err) {
      logger.error('[auth] login failed:', err);
      throw err;
    }
  },

  /** Get current session (null if not authenticated) */
  async getSession(): Promise<AuthSession | null> {
    try {
      return await invoke<AuthSession | null>('auth_get_session');
    } catch (err) {
      logger.warn('[auth] getSession failed:', err);
      return null;
    }
  },

  /** Get user profile (null if not authenticated) */
  async getProfile(): Promise<UserProfile | null> {
    try {
      return await invoke<UserProfile | null>('auth_get_profile');
    } catch (err) {
      logger.warn('[auth] getProfile failed:', err);
      return null;
    }
  },

  /** Refresh the access token using the refresh token */
  async refreshToken(): Promise<AuthSession> {
    try {
      return await invoke<AuthSession>('auth_refresh_token');
    } catch (err) {
      logger.error('[auth] refreshToken failed:', err);
      throw err;
    }
  },

  /** Log out and clear stored tokens */
  async logout(): Promise<void> {
    try {
      await invoke('auth_logout');
    } catch (err) {
      logger.error('[auth] logout failed:', err);
      throw err;
    }
  },
};
