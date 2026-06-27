import { describe, expect, it, vi } from 'vitest';
import { EmojiPickerPlugin } from './index';
import { PluginResultType, type PluginContext } from '../../types';
import type { SearchableEmoji } from './types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../../../shared/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const sampleEmojis: SearchableEmoji[] = [
  {
    emoji: '😀',
    label: 'grinning face',
    tags: ['face', 'grin', 'smile'],
    group: 'smileys-emotion',
    hexcode: '1F600',
    hasSkinTones: false,
  },
];

function loadedPlugin(): EmojiPickerPlugin {
  const plugin = new EmojiPickerPlugin();
  const writable = plugin as unknown as {
    emojisLoaded: boolean;
    emojis: SearchableEmoji[];
  };
  writable.emojisLoaded = true;
  writable.emojis = sampleEmojis;
  return plugin;
}

describe('EmojiPickerPlugin', () => {
  it('uses the bare emoji keyword as an entry point to the full picker', () => {
    const plugin = loadedPlugin();
    const context: PluginContext = {
      query: 'emojis',
      activation: {
        matched: true,
        kind: 'keyword',
        stripped: '',
        token: 'emojis',
      },
    };

    const results = plugin.match(context);

    expect(results).toHaveLength(1);
    expect(results?.[0]).toMatchObject({
      id: 'emoji-open-picker',
      type: PluginResultType.Info,
      title: 'Open Emoji Picker',
      badge: 'Emoji',
      data: { action: 'open-picker', initialQuery: '' },
    });
  });

  it('keeps inline emoji results readable by putting the emoji in the icon only', () => {
    const plugin = loadedPlugin();
    const context: PluginContext = {
      query: 'emoji grin',
      activation: {
        matched: true,
        kind: 'keyword',
        stripped: 'grin',
        token: 'emoji',
      },
    };

    const results = plugin.match(context);

    expect(results?.[0]).toMatchObject({
      type: PluginResultType.Emoji,
      title: 'grinning face',
      icon: '😀',
      badge: 'Emoji',
    });
  });
});
