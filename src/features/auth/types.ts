/**
 * Auth types — must match Rust backend (camelCase via serde rename_all)
 */

/** Session status returned by the backend IPC. Tokens stay in the backend. */
export interface AuthSession {
  expiresAt: number; // Unix timestamp (seconds)
  userId: string;
}

export interface UserProfile {
  id: string;
  email: string;
  tier: UserTier;
  username: string | null;
  avatarUrl: string | null;
}

export type UserTier = 'free' | 'premium' | 'developer' | 'admin';

/** Ordered from lowest to highest privilege */
export const TIER_HIERARCHY: readonly UserTier[] = ['free', 'premium', 'developer', 'admin'] as const;
