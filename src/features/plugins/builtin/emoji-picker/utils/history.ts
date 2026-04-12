/**
 * Emoji usage history management
 * Tracks frequently used emojis in localStorage
 */

import { logger } from '../../../../../shared/utils/logger';
import type { FrequentEmoji } from '../types';

const STORAGE_KEY = 'volt_emoji_history';
const MAX_HISTORY_ITEMS = 50;

/**
 * Get emoji usage history from localStorage
 */
export function getHistory(): FrequentEmoji[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const history = JSON.parse(stored);
    return Array.isArray(history) ? history : [];
  } catch (error) {
    logger.error('Failed to load emoji history:', error);
    return [];
  }
}

/**
 * Add or update emoji in history
 */
export function addToHistory(emoji: string): void {
  try {
    const history = getHistory();

    // Find existing entry
    const existingIndex = history.findIndex((item) => item.emoji === emoji);

    if (existingIndex >= 0) {
      // Update existing entry
      history[existingIndex].count++;
      history[existingIndex].lastUsed = Date.now();
    } else {
      // Add new entry
      history.push({
        emoji,
        count: 1,
        lastUsed: Date.now(),
      });
    }

    // Sort by count (descending), then by lastUsed (descending)
    history.sort((a, b) => {
      if (a.count === b.count) {
        return b.lastUsed - a.lastUsed;
      }
      return b.count - a.count;
    });

    // Keep only top MAX_HISTORY_ITEMS
    const trimmed = history.slice(0, MAX_HISTORY_ITEMS);

    // Save back to localStorage
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    logger.error('Failed to save to emoji history:', error);
  }
}

/**
 * Get list of frequently used emojis (emoji strings only)
 */
export function getFrequentEmojis(limit: number = 20): string[] {
  const history = getHistory();
  return history.slice(0, limit).map((item) => item.emoji);
}

/**
 * Clear all history
 */
export function clearHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    logger.error('Failed to clear emoji history:', error);
  }
}
