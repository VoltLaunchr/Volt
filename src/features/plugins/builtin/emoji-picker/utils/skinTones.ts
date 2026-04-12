/**
 * Skin tone management
 * Handles skin tone modifications for emojis that support them
 */

import { logger } from '../../../../../shared/utils/logger';
import type { SearchableEmoji, EmojiSkin, SkinTone } from '../types';
import { SKIN_TONE_MAP } from '../types';

const STORAGE_KEY = 'volt_emoji_skin_tone';

/**
 * Get user's preferred skin tone from localStorage
 */
export function getPreferredSkinTone(): SkinTone {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && isValidSkinTone(stored)) {
      return stored as SkinTone;
    }
  } catch (error) {
    logger.error('Failed to load skin tone preference:', error);
  }
  return 'none';
}

/**
 * Save user's preferred skin tone to localStorage
 */
export function setPreferredSkinTone(tone: SkinTone): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, tone);
  } catch (error) {
    logger.error('Failed to save skin tone preference:', error);
  }
}

/**
 * Apply skin tone to an emoji
 * Returns the modified emoji or the original if skin tones aren't supported
 */
export function applyPreferredSkinTone(emoji: SearchableEmoji): string {
  const preferredTone = getPreferredSkinTone();

  // If no preference or emoji doesn't support skin tones, return original
  if (preferredTone === 'none' || !emoji.hasSkinTones || !emoji.skins) {
    return emoji.emoji;
  }

  // Find the skin with the matching tone
  const toneValue = SKIN_TONE_MAP[preferredTone];
  if (toneValue === null) {
    return emoji.emoji;
  }

  const skin = emoji.skins.find((s: EmojiSkin) => s.tone === toneValue);
  return skin ? skin.emoji : emoji.emoji;
}

/**
 * Get all available skin tone variants for an emoji
 */
export function getSkinToneVariants(emoji: SearchableEmoji): Array<{
  tone: SkinTone;
  emoji: string;
}> {
  const variants: Array<{ tone: SkinTone; emoji: string }> = [{ tone: 'none', emoji: emoji.emoji }];

  if (!emoji.hasSkinTones || !emoji.skins) {
    return variants;
  }

  // Map each skin to a tone variant
  for (const [toneName, toneValue] of Object.entries(SKIN_TONE_MAP)) {
    if (toneValue === null) continue;

    const skin = emoji.skins.find((s: EmojiSkin) => s.tone === toneValue);
    if (skin) {
      variants.push({
        tone: toneName as SkinTone,
        emoji: skin.emoji,
      });
    }
  }

  return variants;
}

/**
 * Check if a value is a valid skin tone
 */
function isValidSkinTone(value: string): boolean {
  return Object.keys(SKIN_TONE_MAP).includes(value);
}

/**
 * Get display name for a skin tone
 */
export function getSkinToneDisplayName(tone: SkinTone): string {
  const names: Record<SkinTone, string> = {
    none: 'Default',
    light: 'Light',
    'medium-light': 'Medium Light',
    medium: 'Medium',
    'medium-dark': 'Medium Dark',
    dark: 'Dark',
  };
  return names[tone];
}
