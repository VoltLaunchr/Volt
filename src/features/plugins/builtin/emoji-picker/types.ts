/**
 * Emoji picker types
 */

export interface EmojiData {
  emoji: string;
  hexcode: string;
  label: string;
  tags: string[];
  group: number;
  subgroup: number;
  skins?: EmojiSkin[];
  version: number;
}

export interface EmojiSkin {
  emoji: string;
  hexcode: string;
  tone: number;
}

export interface SearchableEmoji {
  emoji: string;
  label: string;
  tags: string[];
  group: string;
  hexcode: string;
  hasSkinTones: boolean;
  skins?: EmojiSkin[];
}

export interface FrequentEmoji {
  emoji: string;
  count: number;
  lastUsed: number;
}

export type SkinTone = 'none' | 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark';

export const SKIN_TONE_MAP: Record<SkinTone, number | null> = {
  none: null,
  light: 1,
  'medium-light': 2,
  medium: 3,
  'medium-dark': 4,
  dark: 5,
};

export const EMOJI_GROUPS: Record<number, string> = {
  0: 'smileys-emotion',
  1: 'people-body',
  2: 'animals-nature',
  3: 'food-drink',
  4: 'travel-places',
  5: 'activities',
  6: 'objects',
  7: 'symbols',
  8: 'flags',
};
