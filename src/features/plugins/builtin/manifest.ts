/**
 * Canonical built-in plugin manifest — the single source of truth that ties the
 * runtime registry, the persisted `enabledPlugins` setting, and the Settings UI
 * together. Before this existed, those three carried *different* ids
 * (`websearch` vs `web-search` vs `web-search`), the default list omitted half
 * the plugins, and the registry ignored the setting entirely.
 *
 * `id` here is always the canonical runtime id (matches `Plugin.id`).
 */

export interface ManagedPluginMeta {
  /** Canonical runtime plugin id (matches the registered `Plugin.id`). */
  id: string;
  /** i18n key under `settings:plugins.names.*` for the display name. */
  nameKey: string;
  /** Short activation hint shown in Settings (the prefix/keyword the user types). */
  hint: string;
}

/**
 * User-toggleable built-in plugins, in display order. The registry treats only
 * these ids as gate-able via `enabledPlugins`; plugins absent from this list
 * (e.g. `ai-chat`, `developer`) are always active.
 */
export const MANAGED_PLUGINS: ManagedPluginMeta[] = [
  { id: 'calculator', nameKey: 'plugins.names.calculator', hint: 'calc · =' },
  { id: 'websearch', nameKey: 'plugins.names.webSearch', hint: '? · google' },
  { id: 'systemcommands', nameKey: 'plugins.names.systemCommands', hint: 'settings · quit' },
  { id: 'timer', nameKey: 'plugins.names.timer', hint: 'timer · pomodoro' },
  { id: 'system_monitor', nameKey: 'plugins.names.systemMonitor', hint: 'cpu · ram' },
  { id: 'games', nameKey: 'plugins.names.games', hint: 'game · steam' },
  { id: 'clipboard', nameKey: 'plugins.names.clipboardHistory', hint: 'clipboard' },
  { id: 'emoji-picker', nameKey: 'plugins.names.emoji', hint: ': · emoji' },
  { id: 'notes', nameKey: 'plugins.names.notes', hint: 'note' },
  { id: 'snippets', nameKey: 'plugins.names.snippets', hint: '; · snippet' },
  { id: 'shellcommand', nameKey: 'plugins.names.shell', hint: '> · shell' },
  { id: 'quicklinks', nameKey: 'plugins.names.quicklinks', hint: 'ql' },
  { id: 'window-management', nameKey: 'plugins.names.windowManagement', hint: 'window · snap' },
  { id: 'developer-tools', nameKey: 'plugins.names.developerTools', hint: 'uuid · hash' },
];

/** Canonical ids of all managed plugins — the default `enabledPlugins` value. */
export const MANAGED_PLUGIN_IDS: string[] = MANAGED_PLUGINS.map((p) => p.id);

/** Fast membership test for "is this id a managed (toggle-able) plugin?". */
const MANAGED_ID_SET = new Set(MANAGED_PLUGIN_IDS);

export function isManagedPluginId(id: string): boolean {
  return MANAGED_ID_SET.has(id);
}

/**
 * Legacy (pre-canonicalization) settings ids → canonical runtime ids. These are
 * the mismatched ids the old `DEFAULT_SETTINGS.enabledPlugins` and Settings UI
 * used before the registry/settings/UI were unified.
 */
const LEGACY_ID_MAP: Record<string, string> = {
  'web-search': 'websearch',
  'system-commands': 'systemcommands',
  'system-monitor': 'system_monitor',
  'steam-games': 'games',
  'clipboard-manager': 'clipboard',
};

/**
 * Managed plugins that did not exist as toggles in the legacy schema. When a
 * legacy `enabledPlugins` array is migrated, these are forced enabled so the
 * upgrade surfaces them (rather than leaving them silently off). After the
 * first save the array is canonical and they can be freely toggled off.
 */
const NEWLY_MANAGED_IDS = ['emoji-picker', 'notes', 'snippets', 'shellcommand', 'developer-tools'];

/**
 * Normalize a persisted `enabledPlugins` array to canonical ids.
 *
 * - `undefined` → all managed plugins enabled (fresh install / fallback).
 * - A legacy array (contains any legacy id) → map ids to canonical and force
 *   the newly-managed plugins on (one-time upgrade surfacing).
 * - An already-canonical array → mapped defensively, stale entries dropped,
 *   explicit disables preserved (idempotent on repeat loads).
 *
 * Output order follows `MANAGED_PLUGIN_IDS`.
 */
export function normalizeEnabledPlugins(stored: string[] | undefined): string[] {
  if (!stored) return [...MANAGED_PLUGIN_IDS];

  const isLegacy = stored.some((id) => id in LEGACY_ID_MAP);
  const mapped = new Set(stored.map((id) => LEGACY_ID_MAP[id] ?? id));

  if (isLegacy) {
    for (const id of NEWLY_MANAGED_IDS) mapped.add(id);
  }

  return MANAGED_PLUGIN_IDS.filter((id) => mapped.has(id));
}
