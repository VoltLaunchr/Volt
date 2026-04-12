import { describe, it, expect, beforeEach } from 'vitest';
import { SystemCommandsPlugin } from './index';
import { PluginResultType } from '../../types';

describe('SystemCommandsPlugin', () => {
  let plugin: SystemCommandsPlugin;

  beforeEach(() => {
    plugin = new SystemCommandsPlugin();
  });

  describe('canHandle', () => {
    it('matches partial trigger prefix', () => {
      expect(plugin.canHandle({ query: 'set' })).toBe(true);
      expect(plugin.canHandle({ query: 'rel' })).toBe(true);
      expect(plugin.canHandle({ query: 'qu' })).toBe(true);
    });

    it('matches alias prefix', () => {
      expect(plugin.canHandle({ query: 'exi' })).toBe(true);
      expect(plugin.canHandle({ query: 'conf' })).toBe(true);
    });

    it('rejects empty query', () => {
      expect(plugin.canHandle({ query: '' })).toBe(false);
      expect(plugin.canHandle({ query: '   ' })).toBe(false);
    });

    it('rejects unrelated queries', () => {
      expect(plugin.canHandle({ query: 'firefox' })).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(plugin.canHandle({ query: 'SETTINGS' })).toBe(true);
    });
  });

  describe('match', () => {
    it('returns a result for exact trigger match with score 100', () => {
      const results = plugin.match({ query: 'settings' });
      expect(results).not.toBeNull();
      const settings = results!.find((r) => r.data?.action === 'settings');
      expect(settings).toBeDefined();
      expect(settings!.score).toBe(100);
    });

    it('scores prefix-matching triggers at 85', () => {
      const results = plugin.match({ query: 'set' });
      const settings = results!.find((r) => r.data?.action === 'settings');
      expect(settings!.score).toBe(85);
    });

    it('scores exact alias match at 95', () => {
      const results = plugin.match({ query: 'exit' });
      const quit = results!.find((r) => r.data?.action === 'quit');
      expect(quit).toBeDefined();
      expect(quit!.score).toBe(95);
    });

    it('scores alias prefix match at 80', () => {
      const results = plugin.match({ query: 'pref' });
      const settings = results!.find((r) => r.data?.action === 'settings');
      expect(settings!.score).toBe(80);
    });

    it('returns null when no command matches', () => {
      expect(plugin.match({ query: 'zzzzzzzz' })).toBeNull();
    });

    it('returns all commands sharing a short prefix', () => {
      const results = plugin.match({ query: 'a' });
      expect(results).not.toBeNull();
      const actions = results!.map((r) => r.data?.action).sort();
      expect(actions).toContain('about');
      expect(actions).toContain('account');
    });

    it('results are typed as SystemCommand', () => {
      const results = plugin.match({ query: 'settings' });
      expect(results![0].type).toBe(PluginResultType.SystemCommand);
    });

    it('every result has an action in data', () => {
      const results = plugin.match({ query: 're' });
      for (const r of results!) {
        expect(typeof r.data?.action).toBe('string');
      }
    });
  });
});
