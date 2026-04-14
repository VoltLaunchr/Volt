
import { logger } from '../../../../shared/utils/logger';
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';
import { copyToClipboard } from '../../utils/helpers';
import { loadEmojiData } from './utils/emojiData';
import { searchEmojis, getDefaultEmojis } from './utils/search';
import { applyPreferredSkinTone } from './utils/skinTones';
import { addToHistory, getFrequentEmojis } from './utils/history';
import type { SearchableEmoji } from './types';

export { EmojiPickerView } from './components/EmojiPickerView';

export class EmojiPickerPlugin implements Plugin {
  id = 'emoji-picker';
  name = 'Emoji Picker';
  description = 'Search and insert emojis, symbols, and special characters';
  enabled = true;

  private emojisLoaded = false;
  private emojis: SearchableEmoji[] = [];
  private loadingPromise: Promise<void> | null = null;

  constructor() {
    // Pre-load emoji data in background to avoid delays
    this.preloadEmojis();
  }

  /**
   * Pre-load emoji data in background
   */
  private async preloadEmojis(): Promise<void> {
    if (!this.loadingPromise) {
      this.loadingPromise = loadEmojiData().then((data) => {
        this.emojis = data;
        this.emojisLoaded = true;
      });
    }
    return this.loadingPromise;
  }

  /**
   * Check if query is an emoji search (starts with :)
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.trim();
    return query.startsWith(':');
  }

  /**
   * Search and return emoji results
   */
  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.trim();

    // Remove the ':' prefix
    const searchQuery = query.substring(1).trim();

    // If emojis aren't loaded yet, return loading message
    if (!this.emojisLoaded) {
      return [
        {
          id: 'emoji-loading',
          type: PluginResultType.Info,
          title: 'Loading emojis...',
          subtitle: 'Please wait while emoji data is being loaded',
          score: 50,
        },
      ];
    }

    let results: SearchableEmoji[];

    if (!searchQuery) {
      // Show frequently used or default emojis when query is empty
      const frequentEmojis = getFrequentEmojis(20);
      results = getDefaultEmojis(this.emojis, frequentEmojis);
    } else {
      // Search emojis
      results = searchEmojis(this.emojis, searchQuery);
    }

    // If no results, show message
    if (results.length === 0) {
      return [
        {
          id: 'emoji-no-results',
          type: PluginResultType.Info,
          title: 'No emojis found',
          subtitle: `Try searching for "${searchQuery}" with different keywords`,
          score: 50,
        },
      ];
    }

    // Convert to plugin results
    return results.map((emoji, index) => {
      // Apply user's preferred skin tone
      const displayEmoji = applyPreferredSkinTone(emoji);

      return {
        id: `emoji-${emoji.hexcode}-${index}`,
        type: PluginResultType.Emoji,
        title: `${displayEmoji}  ${emoji.label}`,
        subtitle: emoji.tags.length > 0 ? emoji.tags.join(', ') : emoji.group,
        score: 90 - index, // Higher score for better matches
        icon: displayEmoji,
        data: {
          emoji: displayEmoji,
          originalEmoji: emoji.emoji,
          label: emoji.label,
          tags: emoji.tags,
          group: emoji.group,
          hasSkinTones: emoji.hasSkinTones,
        },
      };
    });
  }

  /**
   * Execute when user selects an emoji
   */
  async execute(result: PluginResult): Promise<void> {
    const emoji = result.data?.emoji as string;

    if (!emoji) {
      logger.error('No emoji data found in result');
      return;
    }

    // Copy to clipboard
    const success = await copyToClipboard(emoji);

    if (success) {
      console.log(`✓ Copied emoji to clipboard: ${emoji}`);

      // Add to history for frequently used tracking
      addToHistory(emoji);
    }
  }
}
