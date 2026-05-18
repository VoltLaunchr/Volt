const COLUMNS_KEY = 'volt_emoji_columns';
const PRIMARY_ACTION_KEY = 'volt_emoji_primary_action';

export type EmojiPrimaryAction = 'copy' | 'paste';

export function getEmojiColumns(): number {
  try {
    const stored = window.localStorage.getItem(COLUMNS_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= 4 && n <= 12) return n;
    }
  } catch {
    // ignore
  }
  return 7;
}

export function setEmojiColumns(columns: number): void {
  try {
    window.localStorage.setItem(COLUMNS_KEY, String(columns));
  } catch {
    // ignore
  }
}

export function getEmojiPrimaryAction(): EmojiPrimaryAction {
  try {
    const stored = window.localStorage.getItem(PRIMARY_ACTION_KEY);
    if (stored === 'paste' || stored === 'copy') return stored;
  } catch {
    // ignore
  }
  return 'copy';
}

export function setEmojiPrimaryAction(action: EmojiPrimaryAction): void {
  try {
    window.localStorage.setItem(PRIMARY_ACTION_KEY, action);
  } catch {
    // ignore
  }
}
