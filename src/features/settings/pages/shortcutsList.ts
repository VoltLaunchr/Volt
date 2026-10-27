import type { AppShortcut } from '../types/settings.types';

/** Fixed row height (px): windowing needs it to be known without measuring. */
export const ROW_HEIGHT = 46;
export const SHORTCUT_ICON_PREFETCH_LIMIT = 96;

export const shortcutCategory = (shortcut: AppShortcut): string =>
  shortcut.category || 'Applications';

/** Distinct categories in first-seen order. */
export function listShortcutCategories(shortcuts: readonly AppShortcut[]): string[] {
  const names = new Set<string>();
  for (const shortcut of shortcuts) names.add(shortcutCategory(shortcut));
  return [...names];
}

/**
 * Applies the in-list search (name or alias) and category filter, and sorts by name so the list
 * is stable between refreshes.
 */
export function filterShortcuts(
  shortcuts: readonly AppShortcut[],
  query: string,
  categoryFilter: string
): AppShortcut[] {
  const needle = query.trim().toLowerCase();
  const filter = categoryFilter.toLowerCase();
  return shortcuts
    .filter((shortcut) => {
      if (filter !== 'all' && shortcutCategory(shortcut).toLowerCase() !== filter) return false;
      if (!needle) return true;
      return (
        shortcut.name.toLowerCase().includes(needle) ||
        (shortcut.alias?.toLowerCase().includes(needle) ?? false)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Slice `[start, end)` of fixed-height rows to mount for the scroll window. */
export function visibleRange(
  count: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan: number
): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + viewportHeight) / rowHeight);
  return {
    start: Math.min(count, Math.max(0, first - overscan)),
    end: Math.min(count, last + overscan),
  };
}
