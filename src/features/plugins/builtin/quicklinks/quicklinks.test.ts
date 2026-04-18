import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuicklinksPlugin, Quicklink } from './index';
import { PluginResultType } from '../../types';

const mockQuicklinks: Quicklink[] = [
  { id: '1', name: 'gh', shortcut: 'gh', target: 'https://github.com', type: 'url' },
  { id: '2', name: 'docs', shortcut: 'docs', target: 'C:\\Docs', type: 'folder' },
  { id: '3', name: 'build', shortcut: 'build', target: 'npm run build', type: 'command' },
];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'get_quicklinks') return Promise.resolve([...mockQuicklinks]);
    if (cmd === 'save_quicklink') return Promise.resolve();
    if (cmd === 'delete_quicklink') return Promise.resolve();
    if (cmd === 'open_quicklink') return Promise.resolve();
    return Promise.resolve();
  }),
}));

vi.mock('../../../../shared/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../utils/helpers', () => ({
  fuzzyScore: (query: string, target: string) => {
    if (!query) return 0;
    return target.toLowerCase().includes(query.toLowerCase()) ? 80 : 0;
  },
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

describe('QuicklinksPlugin', () => {
  let plugin: QuicklinksPlugin;

  beforeEach(() => {
    plugin = new QuicklinksPlugin();
  });

  // ── canHandle ──────────────────────────────────────────────────────────

  describe('canHandle', () => {
    it('accepts "ql:add"', () => {
      expect(plugin.canHandle({ query: 'ql:add gh https://github.com' })).toBe(true);
    });

    it('accepts "ql:list"', () => {
      expect(plugin.canHandle({ query: 'ql:list' })).toBe(true);
    });

    it('accepts "ql:remove"', () => {
      expect(plugin.canHandle({ query: 'ql:remove gh' })).toBe(true);
    });

    it('accepts "quicklink" keyword', () => {
      expect(plugin.canHandle({ query: 'quicklink' })).toBe(true);
    });

    it('accepts "link" keyword', () => {
      expect(plugin.canHandle({ query: 'link' })).toBe(true);
    });

    it('accepts "ql" keyword', () => {
      expect(plugin.canHandle({ query: 'ql' })).toBe(true);
    });

    it('rejects empty query', () => {
      expect(plugin.canHandle({ query: '' })).toBe(false);
    });

    it('rejects single character', () => {
      expect(plugin.canHandle({ query: 'a' })).toBe(false);
    });
  });

  // ── match: keyword listing ─────────────────────────────────────────────

  describe('match — keyword listing', () => {
    it('shows all quicklinks for "quicklink" keyword', async () => {
      const results = await plugin.match({ query: 'quicklink' });
      expect(results.length).toBe(3);
    });

    it('shows all quicklinks for "ql" keyword with space-search', async () => {
      const results = await plugin.match({ query: 'link gh' });
      expect(results.length).toBe(1);
      expect(results[0].title).toContain('gh');
    });
  });

  // ── match: ql:add ──────────────────────────────────────────────────────

  describe('match — ql:add', () => {
    it('shows usage when no args', async () => {
      const results = await plugin.match({ query: 'ql:add' });
      expect(results.length).toBe(1);
      expect(results[0].subtitle).toContain('Usage');
    });

    it('shows incomplete hint for single arg', async () => {
      const results = await plugin.match({ query: 'ql:add mylink' });
      expect(results.length).toBe(1);
      expect(results[0].subtitle).toContain('Provide a target');
    });

    it('creates a URL quicklink with confirmation', async () => {
      const results = await plugin.match({ query: 'ql:add google https://google.com' });
      expect(results.length).toBe(1);
      expect(results[0].title).toContain('google');
      expect(results[0].title).toContain('https://google.com');
      const data = results[0].data as Record<string, unknown>;
      expect(data.action).toBe('save');
    });

    it('rejects invalid URL targets', async () => {
      // "http://..." prefix triggers URL type detection, but this is malformed
      const results = await plugin.match({ query: 'ql:add bad http://' });
      expect(results.length).toBe(1);
      expect(results[0].title).toContain('Invalid URL');
    });

    it('rejects duplicate shortcuts', async () => {
      const results = await plugin.match({ query: 'ql:add gh https://gitlab.com' });
      expect(results.length).toBe(1);
      expect(results[0].title).toContain('already exists');
    });

    it('detects folder type for paths', async () => {
      const results = await plugin.match({ query: 'ql:add projects C:\\Projects' });
      expect(results.length).toBe(1);
      expect(results[0].subtitle).toContain('folder');
    });

    it('detects command type for non-url non-path', async () => {
      const results = await plugin.match({ query: 'ql:add mybuild npm run build' });
      expect(results.length).toBe(1);
      expect(results[0].subtitle).toContain('command');
    });
  });

  // ── match: ql:list ─────────────────────────────────────────────────────

  describe('match — ql:list', () => {
    it('lists all quicklinks', async () => {
      const results = await plugin.match({ query: 'ql:list' });
      expect(results.length).toBe(3);
      expect(results[0].title).toContain('gh');
      expect(results[0].title).toContain('https://github.com');
    });
  });

  // ── match: ql:remove ───────────────────────────────────────────────────

  describe('match — ql:remove', () => {
    it('shows usage when no args', async () => {
      const results = await plugin.match({ query: 'ql:remove' });
      expect(results.length).toBe(1);
      expect(results[0].subtitle).toContain('Usage');
    });

    it('finds matching quicklinks for removal', async () => {
      const results = await plugin.match({ query: 'ql:remove gh' });
      expect(results.length).toBe(1);
      expect(results[0].title).toContain('Remove');
      expect(results[0].title).toContain('gh');
      expect(results[0].subtitle).toContain('confirm deletion');
      expect(results[0].badge).toBe('Delete');
    });

    it('shows not-found for non-existing shortcut', async () => {
      const results = await plugin.match({ query: 'ql:remove nonexistent' });
      expect(results.length).toBe(1);
      expect(results[0].title).toContain('No matching');
    });
  });

  // ── execute ────────────────────────────────────────────────────────────

  describe('execute', () => {
    it('opens a quicklink', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await plugin.execute({
        id: 'quicklink-1',
        type: PluginResultType.Info,
        title: 'gh',
        score: 90,
        data: { quicklink: mockQuicklinks[0], action: 'open' },
      });
      expect(invoke).toHaveBeenCalledWith('open_quicklink', { quicklink: mockQuicklinks[0] });
    });

    it('saves a quicklink', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const ql: Quicklink = {
        id: 'new',
        name: 'test',
        shortcut: 'test',
        target: 'https://test.com',
        type: 'url',
      };
      await plugin.execute({
        id: 'quicklink-add',
        type: PluginResultType.Info,
        title: 'Create',
        score: 95,
        data: { quicklink: ql, action: 'save' },
      });
      expect(invoke).toHaveBeenCalledWith('save_quicklink', { quicklink: ql });
    });

    it('deletes a quicklink', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await plugin.execute({
        id: 'quicklink-remove-1',
        type: PluginResultType.Info,
        title: 'Remove',
        score: 90,
        data: { quicklink: mockQuicklinks[0], action: 'delete' },
      });
      expect(invoke).toHaveBeenCalledWith('delete_quicklink', { id: '1' });
    });

    it('does nothing for create-hint action', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      vi.mocked(invoke).mockClear();
      await plugin.execute({
        id: 'hint',
        type: PluginResultType.Info,
        title: 'Hint',
        score: 70,
        data: { action: 'create-hint' },
      });
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});
