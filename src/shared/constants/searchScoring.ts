/**
 * Search scoring and limit constants
 * Centralized configuration for search behavior, scoring weights, and timeouts
 */

import type { SearchSensitivity } from '../../features/settings/types/settings.types';

/**
 * Minimum score thresholds per search sensitivity level.
 * - low:    strict — only exact and starts-with matches survive (score >= 70)
 * - medium: balanced — current default behaviour (no filtering)
 * - high:   permissive — even weak fuzzy matches are shown
 */
export const SEARCH_SENSITIVITY_THRESHOLDS: Record<SearchSensitivity, number> = {
  low: 70,
  medium: 1,
  high: 1,
} as const;

/**
 * Multiplier applied to fuzzy match scores per sensitivity level.
 * - low:    fuzzy results are discarded (multiplier 0)
 * - medium: no change (multiplier 1)
 * - high:   fuzzy results get a small boost (multiplier 1.3)
 */
export const SEARCH_SENSITIVITY_FUZZY_MULTIPLIER: Record<SearchSensitivity, number> = {
  low: 0,
  medium: 1,
  high: 1.3,
} as const;

export const SEARCH_SCORING = {
  // Base scoring for different match types
  EXACT_MATCH: 100,
  STARTS_WITH: 90,
  CONTAINS: 80,
  FUZZY: 50,

  // Result type priority scores
  APPLICATION: 200,
  FILE: 80,
  PLUGIN_BASE: 100,

  // Boost factors
  PLUGIN_KEYWORD_BOOST: 300, // Boost plugins when query matches their keywords exactly
  GAME_BOOST: 500, // Push games above everything when query is game-related
  FRECENCY_SUPPLEMENT: 40, // High score for supplementary frecency results, offset from APPLICATION

  // Decay and aging
  RECENCY_DECAY: 0.95,
  FRECENCY_ORDER_DECAY: 1, // Preserve order: 1000 - index
} as const;

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
