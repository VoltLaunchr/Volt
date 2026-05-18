import { invoke } from '@tauri-apps/api/core';
import type { CustomEmoji } from './types';

export const customEmojisService = {
  /** Generate a new emoji. Blocks while the chosen provider runs the model
   *  (HuggingFace ~10–60 s, Replicate ~15–90 s with cold start, Pollinations
   *  ~5–20 s as the free fallback). */
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

  /** Quick check whether any provider is reachable. In dev the chain always
   *  includes Pollinations (free, no token), so this returns `true` unless
   *  the release-build gate is active. */
  async hasToken(): Promise<boolean> {
    return invoke<boolean>('custom_emojis_has_token');
  },
};
