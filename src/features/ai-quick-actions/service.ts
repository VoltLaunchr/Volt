import { invoke } from '@tauri-apps/api/core';
import type { AiQuickAction, AiQuickActionsReport } from './types';

export const aiQuickActionsService = {
  async list(): Promise<AiQuickAction[]> {
    return invoke<AiQuickAction[]>('ai_quick_actions_get');
  },

  async save(actions: AiQuickAction[]): Promise<void> {
    await invoke<void>('ai_quick_actions_save', { actions });
  },

  async applyAll(): Promise<AiQuickActionsReport> {
    return invoke<AiQuickActionsReport>('ai_quick_actions_apply_all');
  },

  async readClipboard(): Promise<string> {
    return invoke<string>('ai_quick_actions_read_clipboard');
  },
};
