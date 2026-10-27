import type { SettingsCategory } from '../constants/settingsCategories';
import { isAvailableOn, type SettingsPlatform } from './platform';
import type { SettingsPageDef } from './settingsRegistry';

export type SettingsSearchKind = 'page' | 'section' | 'row';

export interface SettingsSearchEntry {
  readonly kind: SettingsSearchKind;
  /** Page id, section id or row id depending on `kind`. */
  readonly id: string;
  readonly pageId: SettingsCategory;
  readonly title: string;
  readonly description: string;
  /** Localized "Page > Section" trail, empty for pages. */
  readonly trail: string;
  readonly keywords: string;
}

export interface SettingsSearchResult extends SettingsSearchEntry {
  readonly score: number;
}

export interface SettingsSearchPage {
  readonly id: SettingsCategory;
  readonly title: string;
  readonly description: string;
}

/** Lowercases and strips accents so that `Fenetre` matches `Fenêtre`. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
}

/** True when every character of `needle` appears in `haystack` in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

/**
 * Builds the flat, localized index searched by the sidebar. `translate` resolves an i18n key of
 * the settings namespace; `pages` lists every navigable category (migrated or not). Rows that
 * only work on other platforms than `platform` are left out (an unknown platform keeps them).
 */
export function buildSettingsSearchIndex(
  pages: readonly SettingsSearchPage[],
  registry: readonly SettingsPageDef[],
  translate: (key: string) => string,
  platform: SettingsPlatform | null = null
): SettingsSearchEntry[] {
  const entries: SettingsSearchEntry[] = [];
  const pageTitles = new Map(pages.map((page) => [page.id, page.title]));

  for (const page of pages) {
    entries.push({
      kind: 'page',
      id: page.id,
      pageId: page.id,
      title: page.title,
      description: page.description,
      trail: '',
      keywords: '',
    });
  }

  for (const page of registry) {
    const pageTitle = pageTitles.get(page.id) ?? page.id;
    for (const section of page.sections) {
      const sectionTitle = translate(section.titleKey);
      entries.push({
        kind: 'section',
        id: section.id,
        pageId: page.id,
        title: sectionTitle,
        description: section.descriptionKey ? translate(section.descriptionKey) : '',
        trail: pageTitle,
        keywords: (section.keywords ?? []).join(' '),
      });
      for (const row of section.rows) {
        if (!isAvailableOn(row.availability, platform)) continue;
        entries.push({
          kind: 'row',
          id: row.id,
          pageId: page.id,
          title: translate(row.titleKey),
          description: row.descriptionKey ? translate(row.descriptionKey) : '',
          trail: `${pageTitle} › ${sectionTitle}`,
          keywords: (row.keywords ?? []).join(' '),
        });
      }
    }
  }
  return entries;
}

const KIND_ORDER: Record<SettingsSearchKind, number> = { page: 0, section: 1, row: 2 };

/** Score of one query word against one entry; 0 means "no match". */
function scoreWord(word: string, entry: SettingsSearchEntry): number {
  const title = normalizeSearchText(entry.title);
  const titleWords = title.split(/\s+/);
  if (title.startsWith(word)) return 4;
  if (titleWords.some((candidate) => candidate.startsWith(word))) return 3;
  if (title.includes(word)) return 2;
  if (normalizeSearchText(entry.keywords).includes(word)) return 1.5;
  if (normalizeSearchText(entry.description).includes(word)) return 1;
  if (normalizeSearchText(entry.trail).includes(word)) return 0.5;
  if (word.length >= 3 && isSubsequence(word, title)) return 0.4;
  return 0;
}

/**
 * Simple fuzzy search over titles, keywords and descriptions. Every word of the query must match
 * the entry; results are ordered by score, then pages before sections before rows, then by index
 * order. An empty query returns no result.
 */
export function searchSettings(
  index: readonly SettingsSearchEntry[],
  query: string,
  limit = 12
): SettingsSearchResult[] {
  const words = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const results: { result: SettingsSearchResult; position: number }[] = [];
  index.forEach((entry, position) => {
    let total = 0;
    for (const word of words) {
      const score = scoreWord(word, entry);
      if (score === 0) return;
      total += score;
    }
    results.push({ result: { ...entry, score: total }, position });
  });

  return results
    .sort(
      (a, b) =>
        b.result.score - a.result.score ||
        KIND_ORDER[a.result.kind] - KIND_ORDER[b.result.kind] ||
        a.position - b.position
    )
    .slice(0, limit)
    .map(({ result }) => result);
}
