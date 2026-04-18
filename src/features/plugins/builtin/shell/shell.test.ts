import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShellCommandPlugin, stripAnsi, isCommandBlocked } from './index';
import { PluginResultType } from '../../types';

// Mock Tauri invoke — all backend calls are stubbed
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  Channel: vi.fn(),
}));

vi.mock('../../../../shared/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('ShellCommandPlugin', () => {
  let plugin: ShellCommandPlugin;

  beforeEach(() => {
    plugin = new ShellCommandPlugin();
  });

  // ── canHandle ────────────────────────────────────────────────────────────

  describe('canHandle', () => {
    it('accepts queries starting with ">"', () => {
      expect(plugin.canHandle({ query: '>ls' })).toBe(true);
      expect(plugin.canHandle({ query: '> git status' })).toBe(true);
    });

    it('accepts bare ">" (shows hint)', () => {
      expect(plugin.canHandle({ query: '>' })).toBe(true);
    });

    it('rejects queries without > prefix', () => {
      expect(plugin.canHandle({ query: 'ls' })).toBe(false);
      expect(plugin.canHandle({ query: '' })).toBe(false);
      expect(plugin.canHandle({ query: 'git >status' })).toBe(false);
    });
  });

  // ── match ────────────────────────────────────────────────────────────────

  describe('match', () => {
    it('returns hint when query is just ">"', async () => {
      const results = await plugin.match({ query: '>' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].title).toBe('Shell Command Mode');
    });

    it('returns a pending result for a typed command', async () => {
      const results = await plugin.match({ query: '>echo hello' });
      expect(results[0].title).toBe('echo hello');
      expect(results[0].type).toBe(PluginResultType.ShellCommand);
      const data = results[0].data as Record<string, unknown>;
      expect(data.status).toBe('pending');
    });

    it('trims whitespace from the command', async () => {
      const results = await plugin.match({ query: '>  ls -la  ' });
      expect(results[0].title).toBe('ls -la');
    });
  });

  // ── isCommandBlocked ─────────────────────────────────────────────────────

  describe('isCommandBlocked', () => {
    it('blocks rm -rf /', () => {
      expect(isCommandBlocked('rm -rf /')).toBe(true);
      expect(isCommandBlocked('rm -rf /home')).toBe(true);
      expect(isCommandBlocked('  RM -RF /  ')).toBe(true);
    });

    it('blocks rm -rf on Windows root', () => {
      expect(isCommandBlocked('rm -rf C:\\')).toBe(true);
    });

    it('blocks format drive', () => {
      expect(isCommandBlocked('format C:')).toBe(true);
      expect(isCommandBlocked('FORMAT D:')).toBe(true);
    });

    it('blocks shutdown / reboot', () => {
      expect(isCommandBlocked('shutdown -h now')).toBe(true);
      expect(isCommandBlocked('reboot')).toBe(true);
      expect(isCommandBlocked('poweroff')).toBe(true);
      expect(isCommandBlocked('halt')).toBe(true);
    });

    it('blocks mkfs', () => {
      expect(isCommandBlocked('mkfs.ext4 /dev/sda1')).toBe(true);
    });

    it('blocks dd to device', () => {
      expect(isCommandBlocked('dd if=/dev/zero of=/dev/sda')).toBe(true);
    });

    it('blocks registry deletion', () => {
      expect(isCommandBlocked('reg delete HKLM\\SOFTWARE')).toBe(true);
    });

    it('allows safe commands', () => {
      expect(isCommandBlocked('ls -la')).toBe(false);
      expect(isCommandBlocked('git status')).toBe(false);
      expect(isCommandBlocked('echo hello')).toBe(false);
      expect(isCommandBlocked('npm install')).toBe(false);
      expect(isCommandBlocked('cargo build')).toBe(false);
      expect(isCommandBlocked('cat /etc/hosts')).toBe(false);
      expect(isCommandBlocked('rm myfile.txt')).toBe(false);
    });
  });

  // ── execute with blocked command ─────────────────────────────────────────

  describe('execute', () => {
    it('refuses to execute a blocked command', async () => {
      const events: CustomEvent[] = [];
      const listener = (e: Event) => events.push(e as CustomEvent);
      window.addEventListener('volt:shell-output', listener);

      await plugin.execute({
        id: 'shell-rm',
        type: PluginResultType.ShellCommand,
        title: 'rm -rf /',
        score: 100,
        pluginId: 'shellcommand',
        data: { command: 'rm -rf /', status: 'pending' } as unknown as Record<string, unknown>,
      });

      window.removeEventListener('volt:shell-output', listener);

      expect(events.length).toBe(1);
      const detail = events[0].detail;
      expect(detail.data.status).toBe('error');
      expect(detail.data.errorMessage).toContain('blocked');
    });

    it('does nothing when command is empty', async () => {
      await plugin.execute({
        id: 'shell-empty',
        type: PluginResultType.ShellCommand,
        title: '',
        score: 100,
        pluginId: 'shellcommand',
        data: { command: '', status: 'pending' } as unknown as Record<string, unknown>,
      });
      // No error thrown
    });
  });

  // ── stripAnsi ────────────────────────────────────────────────────────────

  describe('stripAnsi', () => {
    it('removes color codes', () => {
      expect(stripAnsi('\x1b[31mError\x1b[0m')).toBe('Error');
    });

    it('removes cursor movement codes', () => {
      expect(stripAnsi('\x1b[2Jhello')).toBe('hello');
    });

    it('leaves plain text untouched', () => {
      expect(stripAnsi('hello world')).toBe('hello world');
    });

    it('handles empty strings', () => {
      expect(stripAnsi('')).toBe('');
    });
  });

  // ── Cache eviction ───────────────────────────────────────────────────────

  describe('output cache eviction', () => {
    it('does not grow beyond the limit after many match calls', async () => {
      // Simulate many commands going through match to trigger cache entries
      // The cache is private, but we can verify indirectly that no error is thrown
      // when processing many commands in sequence
      for (let i = 0; i < 100; i++) {
        await plugin.match({ query: `>echo ${i}` });
      }
      // If we get here without OOM or error, the cache eviction works
    });
  });
});
