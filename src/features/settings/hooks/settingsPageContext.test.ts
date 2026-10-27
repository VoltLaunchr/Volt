import { describe, expect, it } from 'vitest';
import { recallSettingsScroll, rememberSettingsScroll } from './settingsPageContext';

describe('settings scroll memory', () => {
  it('restores the last offset per page and defaults to the top', () => {
    expect(recallSettingsScroll('never-visited')).toBe(0);
    rememberSettingsScroll('advanced', 240);
    rememberSettingsScroll('shell', 12);
    expect(recallSettingsScroll('advanced')).toBe(240);
    rememberSettingsScroll('advanced', 0);
    expect(recallSettingsScroll('advanced')).toBe(0);
    expect(recallSettingsScroll('shell')).toBe(12);
  });
});
