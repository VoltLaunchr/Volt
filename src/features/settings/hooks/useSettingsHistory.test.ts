import { describe, expect, it } from 'vitest';
import {
  SETTINGS_HISTORY_LIMIT,
  createSettingsHistory,
  settingsHistoryReducer,
} from './useSettingsHistory';

const nav = (state: ReturnType<typeof createSettingsHistory<string>>, page: string) =>
  settingsHistoryReducer(state, { type: 'navigate', page });

describe('settings history', () => {
  it('walks back and forward through visited pages', () => {
    let state = createSettingsHistory('general');
    state = nav(nav(state, 'advanced'), 'shell');
    state = settingsHistoryReducer(state, { type: 'back' });
    expect(state.stack[state.index]).toBe('advanced');
    state = settingsHistoryReducer(state, { type: 'forward' });
    expect(state.stack[state.index]).toBe('shell');
  });

  it('ignores back/forward at the ends and repeated navigation to the same page', () => {
    const start = createSettingsHistory('general');
    expect(settingsHistoryReducer(start, { type: 'back' })).toBe(start);
    expect(settingsHistoryReducer(start, { type: 'forward' })).toBe(start);
    expect(nav(start, 'general')).toBe(start);
  });

  it('drops forward entries when navigating after going back', () => {
    let state = nav(nav(createSettingsHistory('general'), 'advanced'), 'shell');
    state = settingsHistoryReducer(state, { type: 'back' });
    state = nav(state, 'clipboard');
    expect(state.stack).toEqual(['general', 'advanced', 'clipboard']);
    expect(settingsHistoryReducer(state, { type: 'forward' })).toBe(state);
  });

  it('caps the stack length', () => {
    let state = createSettingsHistory('p0');
    for (let i = 1; i < SETTINGS_HISTORY_LIMIT + 20; i += 1) state = nav(state, `p${i}`);
    expect(state.stack.length).toBe(SETTINGS_HISTORY_LIMIT);
    expect(state.index).toBe(SETTINGS_HISTORY_LIMIT - 1);
  });
});
