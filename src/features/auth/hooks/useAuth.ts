/**
 * useAuth — manages auth state, listens to deep link events, auto-refreshes tokens.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { extractErrorMessage } from '../../../shared/utils/error';
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
  const authLoadIdRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authLoadIdRef.current += 1;
    };
  }, []);

  /** Load session + profile from backend */
  const loadAuthState = useCallback(async () => {
    const loadId = ++authLoadIdRef.current;
    try {
      const session = await authService.getSession();
      let profile: UserProfile | null = null;

      if (session) {
        profile = await authService.getProfile();
      }

      if (!mountedRef.current || loadId !== authLoadIdRef.current) return null;
      setState({ session, profile, isLoading: false, error: null });
      return session;
    } catch (err) {
      const msg = extractErrorMessage(err);
      logger.error('[useAuth] Failed to load auth state:', msg);
      if (mountedRef.current && loadId === authLoadIdRef.current) {
        setState((prev) => ({ ...prev, isLoading: false, error: msg }));
      }
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

      refreshTimerRef.current = setTimeout(() => {
        void (async () => {
          try {
            await authService.refreshToken();
            await loadAuthState();
          } catch (err) {
            logger.warn('[useAuth] Scheduled refresh failed:', err);
          }
        })();
      }, delaySec * 1000);
    },
    [loadAuthState]
  );

  // Initial load
  useEffect(() => {
    void loadAuthState();
  }, [loadAuthState]);

  // Every new session expiry arms the next refresh. The previous code only
  // scheduled once on mount, so a successful refresh was never followed by
  // another scheduled refresh.
  useEffect(() => {
    if (state.session) scheduleRefresh(state.session);
  }, [state.session, scheduleRefresh]);

  // Listen for deep link callback event from Rust backend
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    void listen<AuthSession>('auth:session-updated', () => {
      void (async () => {
        logger.info('[useAuth] Session updated via deep link');
        await loadAuthState();
      })();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadAuthState]);

  // Refetch on window focus. Defence-in-depth for the multi-window case:
  // if the deep-link event somehow doesn't reach this webview (e.g. the
  // Settings window's listener wasn't yet attached when the broadcast
  // fired), the user merely needs to click back into the window — we
  // re-read the stored session and update the UI.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .listen('tauri://focus', () => {
        void (async () => {
          await loadAuthState();
        })();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadAuthState]);

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
      const msg = extractErrorMessage(err);
      setState((prev) => ({ ...prev, error: msg }));
    }
  }, []);

  const logout = useCallback(async () => {
    // Invalidate reads that started before logout.
    authLoadIdRef.current += 1;
    try {
      await authService.logout();
      // Also invalidate focus/deep-link reads that started while logout was
      // waiting on the backend session-operation lock.
      authLoadIdRef.current += 1;
      setState({ session: null, profile: null, isLoading: false, error: null });
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    } catch (err) {
      const msg = extractErrorMessage(err);
      setState((prev) => ({ ...prev, error: msg }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await authService.refreshToken();
      await loadAuthState();
    } catch (err) {
      const msg = extractErrorMessage(err);
      setState((prev) => ({ ...prev, error: msg }));
    }
  }, [loadAuthState]);

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
