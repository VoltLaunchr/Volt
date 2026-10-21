import { describe, it, expect } from 'vitest';
import {
  MANAGED_PLUGIN_IDS,
  isManagedPluginId,
  normalizeEnabledPlugins,
} from './manifest';

describe('normalizeEnabledPlugins', () => {
  it('returns all managed plugins for undefined input (fresh install)', () => {
    expect(normalizeEnabledPlugins(undefined)).toEqual(MANAGED_PLUGIN_IDS);
  });

  it('maps legacy display ids to canonical runtime ids', () => {
    const migrated = normalizeEnabledPlugins([
      'calculator',
      'web-search',
      'system-commands',
      'system-monitor',
      'steam-games',
      'clipboard-manager',
    ]);
    expect(migrated).toContain('websearch');
    expect(migrated).toContain('systemcommands');
    expect(migrated).toContain('system_monitor');
    expect(migrated).toContain('games');
    expect(migrated).toContain('clipboard');
    // Legacy ids must not survive.
    expect(migrated).not.toContain('web-search');
    expect(migrated).not.toContain('steam-games');
  });

  it('surfaces newly-managed plugins when migrating a legacy array', () => {
    // A legacy array (contains 'web-search') gains the new toggles enabled.
    const migrated = normalizeEnabledPlugins(['calculator', 'web-search']);
    expect(migrated).toContain('notes');
    expect(migrated).toContain('emoji-picker');
    expect(migrated).toContain('shellcommand');
    expect(migrated).toContain('snippets');
    expect(migrated).toContain('developer-tools');
  });

  it('preserves explicit disables in an already-canonical array', () => {
    // Canonical array (no legacy id) with notes intentionally removed.
    const canonical = MANAGED_PLUGIN_IDS.filter((id) => id !== 'notes');
    const result = normalizeEnabledPlugins(canonical);
    expect(result).not.toContain('notes');
    expect(result).toContain('calculator');
  });

  it('drops stale / unknown ids', () => {
    const result = normalizeEnabledPlugins(['calculator', 'totally-unknown-plugin']);
    expect(result).not.toContain('totally-unknown-plugin');
    expect(result).toContain('calculator');
  });

  it('is idempotent on canonical input', () => {
    const once = normalizeEnabledPlugins(MANAGED_PLUGIN_IDS);
    const twice = normalizeEnabledPlugins(once);
    expect(twice).toEqual(once);
  });

  it('preserves the manifest ordering', () => {
    const shuffled = [...MANAGED_PLUGIN_IDS].reverse();
    expect(normalizeEnabledPlugins(shuffled)).toEqual(MANAGED_PLUGIN_IDS);
  });
});

describe('isManagedPluginId', () => {
  it('recognizes managed ids and rejects unmanaged ones', () => {
    expect(isManagedPluginId('notes')).toBe(true);
    expect(isManagedPluginId('ai-chat')).toBe(false);
    expect(isManagedPluginId('developer')).toBe(false);
  });
});
