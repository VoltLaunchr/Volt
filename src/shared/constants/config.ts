/**
 * Application-wide configuration constants
 */

export const APP_CONFIG = {
  NAME: 'Volt',
  VERSION: '0.1.0',
  AUTHOR: 'Volt Team',
} as const;

export const SEARCH_CONFIG = {
  DEBOUNCE_MS: 300,
  MIN_QUERY_LENGTH: 0,
  MAX_RESULTS: 10,
  FUZZY_THRESHOLD: 0.3,
} as const;

export const WINDOW_CONFIG = {
  DEFAULT_WIDTH: 600,
  DEFAULT_HEIGHT: 400,
  MIN_WIDTH: 400,
  MIN_HEIGHT: 300,
  MAX_RESULTS_VISIBLE: 8,
} as const;

export const CACHE_CONFIG = {
  ICON_CACHE_SIZE: 100,
  SEARCH_CACHE_SIZE: 50,
  TTL_MS: 3600000, // 1 hour
} as const;

export const PERFORMANCE_CONFIG = {
  VIRTUALIZATION_THRESHOLD: 20,
  LAZY_LOAD_THRESHOLD: 50,
  MAX_SEARCH_TIME_MS: 50,
  MAX_LAUNCH_TIME_MS: 100,
} as const;
