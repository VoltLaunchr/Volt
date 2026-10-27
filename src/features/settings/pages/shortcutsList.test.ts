import { describe, expect, it } from 'vitest';
import type { AppShortcut } from '../types/settings.types';
import { ROW_HEIGHT, filterShortcuts, listShortcutCategories, visibleRange } from './shortcutsList';

const app = (id: string, name: string, category: string, alias?: string): AppShortcut => ({
  id,
  name,
  category,
  path: `C:\apps\${id}.exe`,
  alias,
  enabled: true,
});

const sample = [
  app('1', 'Caméra', 'system'),
  app('2', 'Notepad', 'Applications'),
  app('3', 'Calculator', 'Applications', 'calc'),
  app('4', 'Excel', 'office'),
];

describe('filterShortcuts', () => {
  it('sorts by name and keeps every app without a filter', () => {
    expect(filterShortcuts(sample, '', 'all').map((item) => item.name)).toEqual([
      'Calculator',
      'Caméra',
      'Excel',
      'Notepad',
    ]);
  });

  it('matches names and aliases case-insensitively', () => {
    expect(filterShortcuts(sample, ' CALC ', 'all').map((item) => item.id)).toEqual(['3']);
    expect(filterShortcuts(sample, 'zzz', 'all')).toEqual([]);
  });

  it('filters by category case-insensitively and lists categories once', () => {
    expect(filterShortcuts(sample, '', 'OFFICE').map((item) => item.id)).toEqual(['4']);
    expect(listShortcutCategories(sample)).toEqual(['system', 'Applications', 'office']);
  });
});

describe('visibleRange', () => {
  it('mounts only the rows around the scroll offset', () => {
    expect(visibleRange(100, ROW_HEIGHT, ROW_HEIGHT * 50, ROW_HEIGHT * 10, 2)).toEqual({
      start: 48,
      end: 62,
    });
  });

  it('clamps at both ends and handles an empty list', () => {
    expect(visibleRange(100, ROW_HEIGHT, -300, 100, 3)).toEqual({ start: 0, end: 6 });
    expect(visibleRange(100, ROW_HEIGHT, ROW_HEIGHT * 99, 600, 5)).toEqual({ start: 94, end: 100 });
    expect(visibleRange(0, ROW_HEIGHT, 0, 100, 3)).toEqual({ start: 0, end: 0 });
  });
});
