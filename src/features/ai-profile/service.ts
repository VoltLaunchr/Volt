import { invoke } from '@tauri-apps/api/core';
import type { AiProfile } from './types';

export const aiProfileService = {
  async get(): Promise<AiProfile> {
    return invoke<AiProfile>('ai_profile_get');
  },

  async set(profile: string): Promise<void> {
    await invoke<void>('ai_profile_set', { profile });
  },
};
