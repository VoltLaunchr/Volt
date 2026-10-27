import { useCallback, useMemo, useReducer } from 'react';

/** Back/forward stack of visited pages, like a browser history (pure, unit-tested). */
export interface SettingsHistoryState<T> {
  readonly stack: readonly T[];
  readonly index: number;
}

export type SettingsHistoryAction<T> =
  { type: 'navigate'; page: T } | { type: 'back' } | { type: 'forward' };

export const SETTINGS_HISTORY_LIMIT = 50;

export function createSettingsHistory<T>(initial: T): SettingsHistoryState<T> {
  return { stack: [initial], index: 0 };
}

export function settingsHistoryReducer<T>(
  state: SettingsHistoryState<T>,
  action: SettingsHistoryAction<T>
): SettingsHistoryState<T> {
  switch (action.type) {
    case 'navigate': {
      if (state.stack[state.index] === action.page) return state;
      // Visiting a new page drops the forward entries, as a browser does.
      const kept = [...state.stack.slice(0, state.index + 1), action.page];
      const trimmed = kept.slice(Math.max(0, kept.length - SETTINGS_HISTORY_LIMIT));
      return { stack: trimmed, index: trimmed.length - 1 };
    }
    case 'back':
      return state.index > 0 ? { ...state, index: state.index - 1 } : state;
    case 'forward':
      return state.index < state.stack.length - 1 ? { ...state, index: state.index + 1 } : state;
  }
}

export interface SettingsHistory<T> {
  current: T;
  canGoBack: boolean;
  canGoForward: boolean;
  navigate: (page: T) => void;
  back: () => void;
  forward: () => void;
}

export function useSettingsHistory<T>(initial: T | (() => T)): SettingsHistory<T> {
  const [state, dispatch] = useReducer(
    settingsHistoryReducer<T>,
    initial,
    (seed): SettingsHistoryState<T> =>
      createSettingsHistory(typeof seed === 'function' ? (seed as () => T)() : seed)
  );
  const navigate = useCallback((page: T) => dispatch({ type: 'navigate', page }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const forward = useCallback(() => dispatch({ type: 'forward' }), []);
  return useMemo(
    () => ({
      current: state.stack[state.index],
      canGoBack: state.index > 0,
      canGoForward: state.index < state.stack.length - 1,
      navigate,
      back,
      forward,
    }),
    [state, navigate, back, forward]
  );
}
