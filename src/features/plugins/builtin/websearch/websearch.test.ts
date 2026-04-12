import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSearchPlugin } from './index';
import { PluginResultType } from '../../types';

describe('WebSearchPlugin', () => {
  let plugin: WebSearchPlugin;

  beforeEach(() => {
    plugin = new WebSearchPlugin();
  });

  describe('canHandle', () => {
    it('accepts queries starting with "?"', () => {
      expect(plugin.canHandle({ query: '?openai' })).toBe(true);
    });

    it('accepts queries starting with "web "', () => {
      expect(plugin.canHandle({ query: 'web something' })).toBe(true);
    });

    it('accepts queries starting with "search "', () => {
      expect(plugin.canHandle({ query: 'search cats' })).toBe(true);
    });

    it('accepts queries starting with "google "', () => {
      expect(plugin.canHandle({ query: 'google claude' })).toBe(true);
    });

    it('accepts queries starting with "bing "', () => {
      expect(plugin.canHandle({ query: 'bing rust' })).toBe(true);
    });

    it('accepts queries starting with "ddg "', () => {
      expect(plugin.canHandle({ query: 'ddg privacy' })).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(plugin.canHandle({ query: 'GOOGLE something' })).toBe(true);
    });

    it('rejects queries without trigger prefix', () => {
      expect(plugin.canHandle({ query: 'firefox' })).toBe(false);
      expect(plugin.canHandle({ query: '' })).toBe(false);
    });
  });

  describe('match', () => {
    it('defaults to google for "?" prefix', () => {
      const results = plugin.match({ query: '?tauri docs' });
      expect(results).not.toBeNull();
      expect(results![0].data?.engine).toBe('google');
      expect((results![0].data?.url as string)).toContain('google.com/search');
      expect((results![0].data?.url as string)).toContain(encodeURIComponent('tauri docs'));
    });

    it('uses bing for "bing " prefix', () => {
      const results = plugin.match({ query: 'bing rust book' });
      expect(results![0].data?.engine).toBe('bing');
      expect((results![0].data?.url as string)).toContain('bing.com/search');
    });

    it('uses duckduckgo for "ddg " prefix', () => {
      const results = plugin.match({ query: 'ddg privacy' });
      expect(results![0].data?.engine).toBe('duckduckgo');
      expect((results![0].data?.url as string)).toContain('duckduckgo.com');
    });

    it('strips the prefix from the search term', () => {
      const results = plugin.match({ query: 'google hello world' });
      expect(results![0].data?.query).toBe('hello world');
      expect(results![0].title).toContain('hello world');
    });

    it('returns null when the query is only the trigger', () => {
      expect(plugin.match({ query: '?' })).toBe(null);
      expect(plugin.match({ query: '? ' })).toBe(null);
    });

    it('returns a WebSearch result type', () => {
      const results = plugin.match({ query: '?cats' });
      expect(results![0].type).toBe(PluginResultType.WebSearch);
      expect(results![0].score).toBeGreaterThan(0);
    });

    it('url-encodes special chars in the query', () => {
      const results = plugin.match({ query: '?hello & goodbye' });
      const url = results![0].data?.url as string;
      expect(url).toContain(encodeURIComponent('hello & goodbye'));
    });
  });

  describe('execute', () => {
    it('opens the URL via openUrl helper', async () => {
      const mod = await import('../../utils/helpers');
      const spy = vi.spyOn(mod, 'openUrl').mockResolvedValue();
      await plugin.execute({
        id: 'x',
        type: PluginResultType.WebSearch,
        title: 'Search',
        score: 90,
        data: { url: 'https://example.com/q?x=1' },
      });
      expect(spy).toHaveBeenCalledWith('https://example.com/q?x=1');
    });

    it('is a no-op without a url', async () => {
      const mod = await import('../../utils/helpers');
      const spy = vi.spyOn(mod, 'openUrl').mockResolvedValue();
      await plugin.execute({
        id: 'x',
        type: PluginResultType.WebSearch,
        title: 'Search',
        score: 90,
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
