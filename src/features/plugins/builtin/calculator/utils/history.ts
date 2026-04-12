/**
 * Calculation history management
 * Stores last 50 calculations in localStorage
 */

import { logger } from '../../../../../shared/utils/logger';

export interface CalculationHistoryItem {
  id: string;
  query: string;
  result: string;
  type: 'math' | 'unit' | 'date' | 'timezone';
  timestamp: number;
}

const STORAGE_KEY = 'volt_calculator_history';
const MAX_HISTORY_ITEMS = 50;

/**
 * Get calculation history from localStorage
 */
export function getHistory(): CalculationHistoryItem[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const history = JSON.parse(stored);
    return Array.isArray(history) ? history : [];
  } catch (error) {
    logger.error('Failed to load calculation history:', error);
    return [];
  }
}

/**
 * Add item to calculation history
 */
export function addToHistory(item: Omit<CalculationHistoryItem, 'id' | 'timestamp'>): void {
  try {
    const history = getHistory();

    // Create new item with ID and timestamp
    const newItem: CalculationHistoryItem = {
      ...item,
      id: `calc-history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    // Add to beginning of array
    history.unshift(newItem);

    // Keep only last MAX_HISTORY_ITEMS
    const trimmed = history.slice(0, MAX_HISTORY_ITEMS);

    // Save back to localStorage
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    logger.error('Failed to save to calculation history:', error);
  }
}

/**
 * Clear all history
 */
export function clearHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    logger.error('Failed to clear calculation history:', error);
  }
}

/**
 * Search history by query
 */
export function searchHistory(query: string): CalculationHistoryItem[] {
  const history = getHistory();
  const lowerQuery = query.toLowerCase();

  return history.filter(
    (item) =>
      item.query.toLowerCase().includes(lowerQuery) ||
      item.result.toLowerCase().includes(lowerQuery)
  );
}
