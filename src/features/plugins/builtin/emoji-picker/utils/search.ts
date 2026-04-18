/**
 * Emoji search utilities
 */

import type { SearchableEmoji } from '../types';

/**
 * Search emojis by query
 * Matches against label and tags with scoring
 */
export function searchEmojis(emojis: SearchableEmoji[], query: string): SearchableEmoji[] {
  const normalizedQuery = query.toLowerCase().trim();

  if (!normalizedQuery) {
    return [];
  }

  // Compile regex once per search call (not once per emoji)
  const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(normalizedQuery)}`, 'i');

  const results = emojis
    .map((emoji) => {
      const score = calculateScore(emoji, normalizedQuery, wordBoundaryRegex);
      return { emoji, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((result) => result.emoji);

  // Limit to top 50 results for performance
  return results.slice(0, 50);
}

/**
 * Calculate match score for an emoji
 */
function calculateScore(
  emoji: SearchableEmoji,
  query: string,
  wordBoundaryRegex: RegExp
): number {
  const label = emoji.label.toLowerCase();
  const tags = emoji.tags.map((tag) => tag.toLowerCase());

  // Exact match on label
  if (label === query) {
    return 100;
  }

  // Exact match on any tag
  if (tags.some((tag) => tag === query)) {
    return 95;
  }

  // Label starts with query
  if (label.startsWith(query)) {
    return 90;
  }

  // Any tag starts with query
  if (tags.some((tag) => tag.startsWith(query))) {
    return 85;
  }

  // Label contains query
  if (label.includes(query)) {
    return 70;
  }

  // Any tag contains query
  if (tags.some((tag) => tag.includes(query))) {
    return 60;
  }

  // Word boundary match (e.g., "cat" matches "cat face" but not "scatter")
  if (wordBoundaryRegex.test(label)) {
    return 80;
  }

  if (tags.some((tag) => wordBoundaryRegex.test(tag))) {
    return 75;
  }

  // No match
  return 0;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get emoji suggestions when query is empty
 * Returns frequently used emojis or popular defaults
 */
export function getDefaultEmojis(
  allEmojis: SearchableEmoji[],
  frequentEmojis: string[]
): SearchableEmoji[] {
  // If we have frequent emojis, show those first
  if (frequentEmojis.length > 0) {
    const frequent = frequentEmojis
      .map((emoji) => allEmojis.find((e) => e.emoji === emoji))
      .filter((e): e is SearchableEmoji => e !== undefined)
      .slice(0, 20);

    if (frequent.length > 0) {
      return frequent;
    }
  }

  // Otherwise show popular emojis
  const popularEmojis = [
    '😀',
    '😃',
    '😄',
    '😁',
    '😅',
    '😂',
    '🤣',
    '😊',
    '😇',
    '🙂',
    '🙃',
    '😉',
    '😌',
    '😍',
    '🥰',
    '😘',
    '😗',
    '😙',
    '😚',
    '😋',
    '👍',
    '👎',
    '👏',
    '🙌',
    '👌',
    '✌️',
    '🤞',
    '🤟',
    '🤘',
    '👋',
    '❤️',
    '🧡',
    '💛',
    '💚',
    '💙',
    '💜',
    '🖤',
    '🤍',
    '🤎',
    '💔',
  ];

  return popularEmojis
    .map((emoji) => allEmojis.find((e) => e.emoji === emoji))
    .filter((e): e is SearchableEmoji => e !== undefined);
}
