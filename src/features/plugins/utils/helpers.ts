import { logger } from '../../../shared/utils/logger';

/**
 * Fuzzy match scoring utility for plugins
 * Returns a score between 0 and 100
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact match
  if (q === t) return 100;

  // Starts with query
  if (t.startsWith(q)) return 90;

  // Contains query as substring
  if (t.includes(q)) return 70;

  // Fuzzy character-by-character matching
  let score = 0;
  let queryIndex = 0;
  let lastMatchIndex = -1;

  for (let i = 0; i < t.length && queryIndex < q.length; i++) {
    if (t[i] === q[queryIndex]) {
      score += 10;
      // Bonus for consecutive matches
      if (lastMatchIndex === i - 1) {
        score += 5;
      }
      lastMatchIndex = i;
      queryIndex++;
    }
  }

  // Only return score if all query characters were matched
  if (queryIndex === q.length) {
    return Math.min(score, 60); // Cap fuzzy matches at 60
  }

  return 0;
}

/**
 * Parse a simple math expression
 * Returns result or null if invalid
 */
export function evaluateExpression(expr: string): number | null {
  try {
    // Clean the expression
    const cleaned = expr.trim().replace(/\s+/g, '');

    // Only allow safe characters: digits, operators, parentheses, and decimal point
    if (!/^[\d+\-*/.()%^]+$/.test(cleaned)) {
      return null;
    }

    // Prevent dangerous patterns
    if (cleaned.includes('//') || cleaned.includes('/*')) {
      return null;
    }

    // Replace ^ with ** for exponentiation
    const normalized = cleaned.replace(/\^/g, '**');

    // Use Function constructor for safe evaluation (better than eval)
    const result = new Function(`'use strict'; return (${normalized})`)();

    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return result;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Format a number for display
 */
export function formatNumber(num: number): string {
  // For very large or very small numbers, use exponential notation
  if (Math.abs(num) >= 1e9 || (Math.abs(num) < 1e-6 && num !== 0)) {
    return num.toExponential(6);
  }

  // Round to 10 decimal places to avoid floating point issues
  const rounded = Math.round(num * 1e10) / 1e10;

  // Remove trailing zeros
  return rounded.toString();
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    logger.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Open URL in default browser
 */
export async function openUrl(url: string): Promise<void> {
  try {
    // Use Tauri plugin-opener to open URL in default browser
    const { openUrl: tauriOpenUrl } = await import('@tauri-apps/plugin-opener');
    await tauriOpenUrl(url);
  } catch (error) {
    logger.error('Failed to open URL via Tauri:', error);
    // Fallback to window.open
    window.open(url, '_blank');
  }
}
