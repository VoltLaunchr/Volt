import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { authService } from '../../auth/services/authService';
import type { UserProfile } from '../../auth/types';
import { logger } from '../../../shared/utils/logger';

export interface AccountSummary {
  signedIn: boolean;
  /** Display name: username, else the part of the email before `@`. */
  name: string | null;
  email: string | null;
  tier: UserProfile['tier'] | null;
  loaded: boolean;
}

const ANONYMOUS: AccountSummary = {
  signedIn: false,
  name: null,
  email: null,
  tier: null,
  loaded: false,
};

/**
 * Read-only account snapshot for the sidebar card. It deliberately does not reuse `useAuth`:
 * that hook owns token refresh and must stay a single instance (the Account page).
 */
export function useAccountSummary(): AccountSummary {
  const [summary, setSummary] = useState<AccountSummary>(ANONYMOUS);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const load = async () => {
      try {
        const session = await authService.getSession();
        const profile = session ? await authService.getProfile() : null;
        if (cancelled) return;
        setSummary(
          profile
            ? {
                signedIn: true,
                name: profile.username || profile.email.split('@')[0] || null,
                email: profile.email,
                tier: profile.tier,
                loaded: true,
              }
            : { ...ANONYMOUS, loaded: true }
        );
      } catch (err) {
        logger.warn('[settings] Failed to load account summary:', err);
        if (!cancelled) setSummary({ ...ANONYMOUS, loaded: true });
      }
    };

    void load();
    void listen('auth:session-updated', () => void load())
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Event bus unavailable (tests / browser preview): the snapshot just stays static.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return summary;
}
