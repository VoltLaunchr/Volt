import { SETTINGS_CATEGORIES, type SettingsCategory } from '../constants/settingsCategories';
import type { SettingsLinkTarget } from './settingsHash';
import { SETTINGS_REGISTRY } from './settingsRegistry';

export interface ResolvedSettingsTarget {
  readonly pageId: SettingsCategory;
  /** What to scroll to once the page is shown; `page` means "just open the page". */
  readonly kind: 'page' | 'section' | 'row';
  readonly id: string;
}

/**
 * Turns a deep-link value into a page and an optional scroll target. The value may be a page id,
 * a section id or a row id; anything unknown resolves to `null`.
 */
export function resolveSettingsTarget(link: SettingsLinkTarget): ResolvedSettingsTarget | null {
  const value = link.row ?? link.section;
  if (!value) return null;
  for (const page of SETTINGS_REGISTRY) {
    for (const section of page.sections) {
      if (section.id === value) return { pageId: page.id, kind: 'section', id: value };
      if (section.rows.some((row) => row.id === value)) {
        return { pageId: page.id, kind: 'row', id: value };
      }
    }
  }
  const category = SETTINGS_CATEGORIES.find((candidate) => candidate.id === value);
  return category ? { pageId: category.id, kind: 'page', id: value } : null;
}
