import { describe, it, expect } from 'vitest';
import { matchActivation, resolveActivation } from './activation';
import type { Plugin, PluginActivation } from '../types';

describe('matchActivation', () => {
  describe('prefixes', () => {
    const activation: PluginActivation = { prefixes: [':'], keywords: ['emoji'] };

    it('matches a prefix and strips it', () => {
      const r = matchActivation(':smile', activation, 'Emoji Picker');
      expect(r.matched).toBe(true);
      expect(r.kind).toBe('prefix');
      expect(r.stripped).toBe('smile');
      expect(r.token).toBe(':');
    });

    it('matches a bare prefix with empty stripped', () => {
      const r = matchActivation(':', activation, 'Emoji Picker');
      expect(r.matched).toBe(true);
      expect(r.stripped).toBe('');
    });

    it('prefers the longest prefix', () => {
      const r = matchActivation('ql:add foo', { prefixes: ['ql:', 'q'] }, 'Quicklinks');
      expect(r.token).toBe('ql:');
      expect(r.stripped).toBe('add foo');
    });
  });

  describe('keywords', () => {
    const activation: PluginActivation = { keywords: ['note'] };

    it('matches an exact keyword with empty stripped', () => {
      const r = matchActivation('note', activation, 'Notes');
      expect(r.matched).toBe(true);
      expect(r.kind).toBe('keyword');
      expect(r.stripped).toBe('');
    });

    it('matches keyword + separator and strips it', () => {
      expect(matchActivation('note groceries', activation, 'Notes').stripped).toBe('groceries');
      expect(matchActivation('note: groceries', activation, 'Notes').stripped).toBe('groceries');
    });

    it('auto-injects the plugin name as a keyword', () => {
      // 'Notes' name → keyword 'notes'
      const r = matchActivation('notes', { keywords: [] }, 'Notes');
      expect(r.matched).toBe(true);
      expect(r.kind).toBe('keyword');
    });

    it('requires a separator (no false prefix match)', () => {
      // 'notebook' must NOT match keyword 'note'
      expect(matchActivation('notebook', activation, 'Notes').matched).toBe(false);
    });

    it('prefers the longest keyword', () => {
      const r = matchActivation('note', { keywords: ['n', 'note', 'notes'] }, 'X');
      expect(r.token).toBe('note');
      expect(r.stripped).toBe('');
    });

    it('is case-insensitive', () => {
      expect(matchActivation('NOTE foo', activation, 'Notes').matched).toBe(true);
    });
  });

  describe('always mode', () => {
    const activation: PluginActivation = { mode: 'always', keywords: ['game'] };

    it('matches any query of sufficient length', () => {
      const r = matchActivation('witcher', activation, 'Games');
      expect(r.matched).toBe(true);
      expect(r.kind).toBe('always');
      expect(r.stripped).toBe('witcher');
    });

    it('keyword match takes precedence over always', () => {
      const r = matchActivation('game', activation, 'Games');
      expect(r.kind).toBe('keyword');
    });

    it('respects minLength', () => {
      expect(matchActivation('a', { mode: 'always', minLength: 2 }, 'X').matched).toBe(false);
      expect(matchActivation('ab', { mode: 'always', minLength: 2 }, 'X').matched).toBe(true);
    });
  });

  describe('no match', () => {
    it('returns none for an empty query', () => {
      expect(matchActivation('', { keywords: ['x'] }, 'X').matched).toBe(false);
    });

    it('returns none when no prefix/keyword matches', () => {
      expect(matchActivation('firefox', { keywords: ['note'] }, 'Notes').matched).toBe(false);
    });

    it('returns none for an undefined activation', () => {
      expect(matchActivation('anything', undefined, 'X').matched).toBe(false);
    });
  });
});

describe('resolveActivation', () => {
  const plugin = {
    id: 'notes',
    name: 'Notes',
    activation: { keywords: ['note'] },
  } as unknown as Plugin;

  it('reuses a pre-computed context.activation', () => {
    const precomputed = { matched: true, kind: 'keyword' as const, stripped: 'cached' };
    const r = resolveActivation(plugin, { query: 'note xyz', activation: precomputed });
    expect(r.stripped).toBe('cached');
  });

  it('recomputes when context.activation is absent (direct test path)', () => {
    const r = resolveActivation(plugin, { query: 'note todo' });
    expect(r.matched).toBe(true);
    expect(r.stripped).toBe('todo');
  });
});
