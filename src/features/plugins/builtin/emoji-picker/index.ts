
import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../../shared/utils/logger';
import {
  Plugin,
  PluginActivation,
  PluginContext,
  PluginResult,
  PluginResultType,
} from '../../types';
import { resolveActivation } from '../../core/activation';
import { copyToClipboard } from '../../utils/helpers';
import { loadEmojiData } from './utils/emojiData';
import { searchEmojis, getDefaultEmojis } from './utils/search';
import { applyPreferredSkinTone } from './utils/skinTones';
import { addToHistory, getFrequentEmojis } from './utils/history';
import { getEmojiPrimaryAction } from './utils/emojiSettings';
import type { SearchableEmoji } from './types';

export { EmojiPickerView } from './components/EmojiPickerView';

export class EmojiPickerPlugin implements Plugin {
  id = 'emoji-picker';
  name = 'Emoji Picker';
  description = 'Search and insert emojis, symbols, and special characters';
  enabled = true;

  // `:` prefix or the `emoji`/`emojis` keyword open the emoji search.
  activation: PluginActivation = {
    prefixes: [':'],
    keywords: ['emoji', 'emojis'],
  };

  private emojisLoaded = false;
  private emojis: SearchableEmoji[] = [];
  private loadingPromise: Promise<void> | null = null;

  constructor() {
    // Pre-load emoji data in background to avoid delays
    void this.preloadEmojis();
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
   * Check if query is an emoji search — `:` prefix or `emoji`/`emojis` keyword.
   */
  canHandle(context: PluginContext): boolean {
    return resolveActivation(this, context).matched;
  }

  /**
   * Search and return emoji results
   */
  match(context: PluginContext): PluginResult[] | null {
    const activation = resolveActivation(this, context);
    const searchQuery = activation.stripped;

    if (!searchQuery && activation.kind === 'keyword') {
      return [
        {
          id: 'emoji-open-picker',
          type: PluginResultType.Info,
          title: 'Open Emoji Picker',
          subtitle: 'Browse emojis, symbols, and custom AI emojis',
          score: 95,
          icon: '/icons/app/emojis_icon.svg',
          badge: 'Emoji',
          data: {
            action: 'open-picker',
            initialQuery: '',
          },
        },
      ];
    }

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
        title: emoji.label,
        subtitle: emoji.tags.length > 0 ? emoji.tags.join(', ') : emoji.group,
        score: 90 - index, // Higher score for better matches
        icon: displayEmoji,
        badge: 'Emoji',
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

    const action = getEmojiPrimaryAction();

    if (action === 'paste') {
      try {
        await invoke<void>('paste_text', { text: emoji });
        logger.info(`✓ Pasted emoji: ${emoji}`);
        addToHistory(emoji);
        return;
      } catch {
        // Fallback to copy if paste not available
      }
    }

    const success = await copyToClipboard(emoji);
    if (success) {
      logger.info(`✓ Copied emoji to clipboard: ${emoji}`);
      addToHistory(emoji);
    }
  }
}
