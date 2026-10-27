/**
 * Deep-link payload of the Settings window: a page (category id) or a registry section/row id.
 * Kept dependency-free so the launcher window can build links without loading the registry.
 *
 * Hash format: `#<target>` where `<target>` is a page id, a section id or a row id
 * (each URI-encoded). The Tauri event `volt://settings-navigate` carries the same value as
 * `{ section }`; `row` is accepted as an explicit alias for a row id.
 */
export interface SettingsLinkTarget {
  /** A category id (`general`), a section id (`general.startup`) or a row id. */
  section?: string;
  /** A row id, when the caller knows it is a row. */
  row?: string;
}

export function buildSettingsHash(target: SettingsLinkTarget): string {
  const value = target.row ?? target.section;
  return value ? `#${encodeURIComponent(value)}` : '';
}

export function parseSettingsHash(hash: string): SettingsLinkTarget {
  const raw = hash.replace(/^#/, '');
  if (!raw) return {};
  try {
    return { section: decodeURIComponent(raw) };
  } catch {
    return {};
  }
}
