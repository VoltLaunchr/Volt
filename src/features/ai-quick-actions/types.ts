/**
 * AI Quick Action — a user-configured global hotkey that runs a preset AI prompt
 * against whatever text is in the clipboard. Mirrors the Rust struct
 * (camelCase via serde rename_all).
 */
export interface AiQuickAction {
  id: string;
  label: string;
  systemPrompt: string;
  /** Tauri-format hotkey string (e.g., "Ctrl+Alt+I"); undefined = unbound. */
  hotkey?: string | null;
  enabled: boolean;
  provider?: string | null;
  icon?: string | null;
}

/** Payload emitted on the `volt://ai-quick-action` event when a hotkey fires. */
export interface AiQuickActionEvent {
  actionId: string;
  label: string;
  systemPrompt: string;
  provider?: string | null;
}

/** Per-action status returned by `ai_quick_actions_apply_all`. */
export type AiQuickActionsReport = Record<string, string>;
