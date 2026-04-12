/**
 * Emoji data loader and processor
 * Uses emojibase for cross-platform Unicode emoji support
 */

import type { Emoji } from 'emojibase';
import { logger } from '../../../../../shared/utils/logger';
import type { SearchableEmoji } from '../types';
import { EMOJI_GROUPS } from '../types';

let cachedEmojis: SearchableEmoji[] | null = null;

/**
 * Load and process emoji data
 * This is lazy-loaded on first search to avoid blocking app startup
 */
export async function loadEmojiData(): Promise<SearchableEmoji[]> {
  if (cachedEmojis) {
    return cachedEmojis;
  }

  try {
    // Dynamically import emoji data (reduces initial bundle size)
    const { default: emojiData } = await import('emojibase-data/en/data.json');

    // Process and normalize emoji data
    const processed = (emojiData as Emoji[])
      .filter((emoji) => {
        // Filter out emojis without necessary data
        return (
          emoji.version && // Must have a version (released emoji)
          emoji.label && // Must have a label
          emoji.emoji // Must have an emoji character
        );
      })
      .map((emoji) => {
        // Map skins to our format
        const skins = emoji.skins?.map((skin) => ({
          emoji: skin.emoji,
          hexcode: skin.hexcode,
          tone: skin.tone as number,
        }));

        return {
          emoji: emoji.emoji,
          label: emoji.label || '',
          tags: emoji.tags || [],
          group: emoji.group !== undefined ? EMOJI_GROUPS[emoji.group] || 'other' : 'other',
          hexcode: emoji.hexcode,
          hasSkinTones: !!(skins && skins.length > 0),
          skins,
        };
      });

    cachedEmojis = processed;
    return processed;
  } catch (error) {
    logger.error('Failed to load emoji data:', error);
    return [];
  }
}

/**
 * Get emojis by group/category
 */
export function getEmojisByGroup(emojis: SearchableEmoji[], group: string): SearchableEmoji[] {
  return emojis.filter((emoji) => emoji.group === group);
}

/**
 * Get all available groups
 */
export function getAvailableGroups(): string[] {
  return Object.values(EMOJI_GROUPS);
}
