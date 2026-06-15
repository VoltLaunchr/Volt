import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, type Mock } from 'vitest';
import type { ClipboardItem } from '../../shared/types/clipboard';
import { ClipboardPlugin } from './clipboardPlugin';

const mockedInvoke = invoke as unknown as Mock<(command: string) => Promise<unknown>>;

describe('ClipboardPlugin', () => {
  it('returns a real image asset for image history results', async () => {
    const item: ClipboardItem = {
      id: 1,
      contentType: 'image',
      content: 'base64-image',
      preview: 'Image (12/06/2026 20:25:43)',
      timestamp: 1_749_759_943,
      pinned: false,
      contentHash: 'hash',
    };
    mockedInvoke.mockResolvedValue([item]);

    const results = await new ClipboardPlugin().match({ query: 'clip' });

    expect(results).toHaveLength(1);
    expect(results[0].icon).toBe('/icons/image-03-stroke-rounded.svg');
  });
});
