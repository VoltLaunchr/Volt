/**
 * Search limit constants
 * Centralized configuration for search limits and timeouts
 */

// Ranking is not configured with numeric weights any more: every result is
// ordered by the unified comparator in src/app/searchRanking.ts on the tier
// ladder generated from Rust (src-tauri/src/search/tiers.rs). Search
// sensitivity (low / medium / high) is enforced by the Rust ranker — see
// `SearchSensitivity` in src-tauri/src/search/mod.rs.

export const SEARCH_LIMITS = {
  MAX_RESULTS: 20,
  MAX_RESULTS_BUFFER: 4, // slice(0, maxResults + 4)
  FRECENCY_TOP_LIMIT: 5, // Number of top frecency apps to prepend
  FRECENCY_SUGGESTIONS_LIMIT: 20, // For app browse query frecency reordering
  PLUGIN_TIMEOUT_MS: 500,
  DEBOUNCE_MS: 150,
  FILE_SEARCH_MULTIPLIER: 2, // Search for maxResults * 2 files
  SEARCH_ORDER_BASE: 1000, // Base score for preserving search order (1000 - index)
} as const;
