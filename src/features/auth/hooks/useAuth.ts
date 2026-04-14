/**
 * useAuth — manages auth state, listens to deep link events, auto-refreshes tokens.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '../../../shared/utils/logger';
import { authService } from '../services/authService';
import type { AuthSession, UserProfile, UserTier } from '../types';

/** Refresh token 5 minutes before expiry */
const REFRESH_MARGIN_SECONDS = 5 * 60;

interface AuthState {
  session: AuthSession | null;
  profile: UserProfile | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseAuthReturn {
  session: AuthSession | null;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  tier: UserTier;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    session: null,
    profile: null,
    isLoading: true,
    error: null,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Load session + profile from backend */
  const loadAuthState = useCallback(async () => {
    try {
      const session = await authService.getSession();
      let profile: UserProfile | null = null;

      if (session) {
        profile = await authService.getProfile();
      }

      setState({ session, profile, isLoading: false, error: null });
      return session;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[useAuth] Failed to load auth state:', msg);
      setState((prev) => ({ ...prev, isLoading: false, error: msg }));
      return null;
    }
  }, []);

  /** Schedule a token refresh before expiry */
  const scheduleRefresh = useCallback(
    (session: AuthSession) => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const refreshAt = session.expiresAt - REFRESH_MARGIN_SECONDS;
      const delaySec = Math.max(refreshAt - nowSec, 0);

      if (delaySec <= 0) {
        // Token already near-expiry, refresh immediately
        authService
          .refreshToken()
          .then(() => loadAuthState())
          .catch((err) => logger.warn('[useAuth] Auto-refresh failed:', err));
        return;
      }

      refreshTimerRef.current = setTimeout(async () => {
        try {
          await authService.refreshToken();
          await loadAuthState();
        } catch (err) {
          logger.warn('[useAuth] Scheduled refresh failed:', err);
        }
      }, delaySec * 1000);
    },
    [loadAuthState]
  );

  // Initial load
  useEffect(() => {
    loadAuthState().then((session) => {
      if (session) {
        scheduleRefresh(session);
      }
    });
  }, [loadAuthState, scheduleRefresh]);

  // Listen for deep link callback event from Rust backend
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<AuthSession>('auth:session-updated', async () => {
      logger.info('[useAuth] Session updated via deep link');
      const session = await loadAuthState();
      if (session) {
        scheduleRefresh(session);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [loadAuthState, scheduleRefresh]);

  // Cleanup refresh timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const login = useCallback(async () => {
    setState((prev) => ({ ...prev, error: null }));
    try {
      await authService.login();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: msg }));
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
      setState({ session: null, profile: null, isLoading: false, error: null });
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: msg }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await authService.refreshToken();
      const session = await loadAuthState();
      if (session) {
        scheduleRefresh(session);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: msg }));
    }
  }, [loadAuthState, scheduleRefresh]);

  return {
    session: state.session,
    profile: state.profile,
    isAuthenticated: state.session !== null,
    isLoading: state.isLoading,
    error: state.error,
    tier: state.profile?.tier ?? 'free',
    login,
    logout,
    refresh,
  };
}
