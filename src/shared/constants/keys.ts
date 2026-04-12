/**
 * Keyboard key constants for consistent key handling
 */

export const KEYS = {
  ESCAPE: 'Escape',
  ENTER: 'Enter',
  TAB: 'Tab',
  SPACE: ' ',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete',
  HOME: 'Home',
  END: 'End',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
} as const;

export const MODIFIERS = {
  CTRL: 'ctrl',
  SHIFT: 'shift',
  ALT: 'alt',
  META: 'meta',
} as const;

/**
 * Default keyboard shortcuts (per documentation: /docs/user-guide/shortcuts)
 */
export const DEFAULT_SHORTCUTS = {
  // Global shortcuts
  TOGGLE_WINDOW: 'Ctrl+Space',
  TOGGLE_COMMAND_MODE: 'Ctrl+Shift+Space',

  // View Control
  OPEN_SETTINGS: 'Ctrl+,',
  RELOAD_VOLT: 'Ctrl+R',
  QUIT_VOLT: 'Ctrl+Q',
  SHOW_HELP: 'F1',

  // Input Control
  CLEAR_INPUT: 'Ctrl+K',
  SELECT_ALL: 'Ctrl+A',
  COPY_RESULT: 'Ctrl+C',
  PASTE_SEARCH: 'Ctrl+V',
  DELETE_WORD: 'Ctrl+Backspace',

  // Actions
  EXECUTE: 'Enter',
  EXECUTE_BACKGROUND: 'Ctrl+Enter',
  EXECUTE_ADMIN: 'Shift+Enter',
  CLOSE_VOLT: 'Escape',
  AUTOCOMPLETE: 'Tab',

  // Result Actions
  PREVIEW_ITEM: 'Space',
  OPEN_FOLDER: 'Ctrl+O',
  SHOW_ITEM_INFO: 'Ctrl+I',
  ADD_TO_FAVORITES: 'Ctrl+D',
  REMOVE_FROM_HISTORY: 'Ctrl+Delete',

  // Quick Select (Alt+1-9)
  QUICK_SELECT_1: 'Alt+1',
  QUICK_SELECT_2: 'Alt+2',
  QUICK_SELECT_3: 'Alt+3',
  QUICK_SELECT_4: 'Alt+4',
  QUICK_SELECT_5: 'Alt+5',
  QUICK_SELECT_6: 'Alt+6',
  QUICK_SELECT_7: 'Alt+7',
  QUICK_SELECT_8: 'Alt+8',
  QUICK_SELECT_9: 'Alt+9',
} as const;
