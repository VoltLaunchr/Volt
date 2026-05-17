import { invoke } from '@tauri-apps/api/core';
import type { CustomEmoji } from './types';

export const customEmojisService = {
  /** Generate a new emoji. Blocks for ~5–60 s while Replicate runs the model. */
  async generate(prompt: string): Promise<CustomEmoji> {
    return invoke<CustomEmoji>('custom_emojis_generate', { prompt });
  },

  /** List all previously-generated emojis (newest first). */
  async list(): Promise<CustomEmoji[]> {
    return invoke<CustomEmoji[]>('custom_emojis_list');
  },

  /** Delete an emoji by id. */
  async remove(id: string): Promise<void> {
    await invoke<void>('custom_emojis_delete', { id });
  },

  /** Quick check whether REPLICATE_TOKEN is present in the backend env. */
  async hasToken(): Promise<boolean> {
    return invoke<boolean>('custom_emojis_has_token');
  },
};
