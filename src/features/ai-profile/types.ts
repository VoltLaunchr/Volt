/**
 * Persisted AI Profile — a free-form user-context string injected as a system
 * prompt prefix into every AI Chat conversation (but NOT into AI Commands /
 * Quick Actions). Mirrors the Rust struct (camelCase via serde rename_all).
 */
export interface AiProfile {
  profile: string;
  /** ISO 8601 timestamp of the last save, or empty string if never saved. */
  updatedAt: string;
}
