import type { EscapeBehavior, ListNavigationPreset } from '../types/settings.types';

export const ESCAPE_BEHAVIOR_OPTIONS: readonly EscapeBehavior[] = [
  'close',
  'clearThenClose',
  'backToRoot',
];

export const LIST_NAVIGATION_OPTIONS: readonly ListNavigationPreset[] = ['arrows', 'emacs', 'vim'];

/** What Escape does in the search bar. */
export type EscapeAction =
  /** Clear the query and results, then hide the launcher. */
  | 'hide'
  /** Clear the query and results; the launcher stays open. */
  | 'clear'
  /** Same as `clear`, and leave any sub-view for the root search. */
  | 'root';

export function resolveEscapeAction(
  behavior: EscapeBehavior | undefined,
  query: string
): EscapeAction {
  switch (behavior) {
    case 'clearThenClose':
      return query.length > 0 ? 'clear' : 'hide';
    case 'backToRoot':
      return 'root';
    case 'close':
    default:
      return 'hide';
  }
}

/** The part of a keyboard event the navigation helpers look at. */
export interface NavigationKeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type ListMove = 'up' | 'down';

/** Extra (non-arrow) bindings of each preset: Ctrl + key. */
const PRESET_KEYS: Readonly<Record<ListNavigationPreset, { up: string; down: string } | null>> = {
  arrows: null,
  emacs: { up: 'p', down: 'n' },
  vim: { up: 'k', down: 'j' },
};

/**
 * Move requested by an alternative binding of the preset (`Ctrl+N/P` emacs, `Ctrl+J/K` vim).
 * Arrow keys are not handled here: they always work and keep their own code path. Returns
 * `null` for every other key, for modified chords and for the arrows-only preset.
 */
export function resolveListNavigation(
  preset: ListNavigationPreset | undefined,
  event: NavigationKeyEvent
): ListMove | null {
  const keys = PRESET_KEYS[preset ?? 'emacs'];
  if (!keys) return null;
  if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === keys.down) return 'down';
  if (key === keys.up) return 'up';
  return null;
}

/**
 * Key name a list handler should switch on: the arrow equivalent of an alternative binding, or
 * the key itself. Lets simple `switch (e.key)` list views gain the preset without other changes.
 */
export function navigationKey(
  preset: ListNavigationPreset | undefined,
  event: NavigationKeyEvent
): string {
  const move = resolveListNavigation(preset, event);
  if (move === 'down') return 'ArrowDown';
  if (move === 'up') return 'ArrowUp';
  return event.key;
}

/**
 * Whether the event opens the actions menu of the selected result. It is `Ctrl+K`, except in
 * the vim preset where `Ctrl+K` moves up and the menu moves to `Ctrl+Shift+K`.
 */
export function isActionsMenuShortcut(
  preset: ListNavigationPreset | undefined,
  event: NavigationKeyEvent
): boolean {
  if (!event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.key.toLowerCase() !== 'k') return false;
  return preset === 'vim' ? event.shiftKey : !event.shiftKey;
}
