import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginRegistry } from './registry';
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../types';

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    description: 'A test plugin',
    enabled: true,
    canHandle: () => true,
    match: () => [
      {
        id: 'r1',
        type: PluginResultType.Info,
        title: 'Result 1',
        score: 50,
      },
    ],
    execute: vi.fn(),
    ...overrides,
  };
}

const ctx: PluginContext = { query: 'hello' };

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('register', () => {
    it('registers a new plugin', () => {
      const p = makePlugin({ id: 'a' });
      registry.register(p);
      expect(registry.isRegistered('a')).toBe(true);
      expect(registry.getPlugin('a')).toBe(p);
    });

    it('silently skips duplicate registration (StrictMode safe)', () => {
      const p1 = makePlugin({ id: 'dup', name: 'First' });
      const p2 = makePlugin({ id: 'dup', name: 'Second' });
      registry.register(p1);
      registry.register(p2);
      expect(registry.getPlugin('dup')?.name).toBe('First');
      expect(registry.getAllPlugins().length).toBe(1);
    });

    it('allows multiple distinct plugins', () => {
      registry.register(makePlugin({ id: 'a' }));
      registry.register(makePlugin({ id: 'b' }));
      registry.register(makePlugin({ id: 'c' }));
      expect(registry.getAllPlugins().length).toBe(3);
    });
  });

  describe('unregister', () => {
    it('removes a registered plugin', () => {
      registry.register(makePlugin({ id: 'x' }));
      registry.unregister('x');
      expect(registry.isRegistered('x')).toBe(false);
    });

    it('is a no-op for unknown ids', () => {
      expect(() => registry.unregister('missing')).not.toThrow();
    });
  });

  describe('initialization state', () => {
    it('starts as not initialized', () => {
      expect(registry.isInitialized()).toBe(false);
    });

    it('can be marked initialized', () => {
      registry.markInitialized();
      expect(registry.isInitialized()).toBe(true);
    });
  });

  describe('getEnabledPlugins', () => {
    it('returns only enabled plugins', () => {
      registry.register(makePlugin({ id: 'on', enabled: true }));
      registry.register(makePlugin({ id: 'off', enabled: false }));
      const enabled = registry.getEnabledPlugins();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe('on');
    });
  });

  describe('query', () => {
    it('returns empty array when no plugins', async () => {
      const results = await registry.query(ctx);
      expect(results).toEqual([]);
    });

    it('skips disabled plugins', async () => {
      registry.register(
        makePlugin({
          id: 'disabled',
          enabled: false,
          match: () => [
            { id: 'd1', type: PluginResultType.Info, title: 'Disabled', score: 100 },
          ],
        })
      );
      const results = await registry.query(ctx);
      expect(results).toEqual([]);
    });

    it('skips plugins whose canHandle returns false', async () => {
      registry.register(
        makePlugin({
          id: 'nope',
          canHandle: () => false,
          match: () => [{ id: 'n1', type: PluginResultType.Info, title: 'No', score: 50 }],
        })
      );
      const results = await registry.query(ctx);
      expect(results).toEqual([]);
    });

    it('aggregates results from multiple plugins', async () => {
      registry.register(
        makePlugin({
          id: 'a',
          match: () => [{ id: 'a1', type: PluginResultType.Info, title: 'A', score: 50 }],
        })
      );
      registry.register(
        makePlugin({
          id: 'b',
          match: () => [{ id: 'b1', type: PluginResultType.Info, title: 'B', score: 70 }],
        })
      );
      const results = await registry.query(ctx);
      expect(results).toHaveLength(2);
    });

    it('sorts results by score descending', async () => {
      registry.register(
        makePlugin({
          id: 'lo',
          match: () => [{ id: 'lo1', type: PluginResultType.Info, title: 'Lo', score: 10 }],
        })
      );
      registry.register(
        makePlugin({
          id: 'hi',
          match: () => [{ id: 'hi1', type: PluginResultType.Info, title: 'Hi', score: 99 }],
        })
      );
      registry.register(
        makePlugin({
          id: 'mid',
          match: () => [{ id: 'mid1', type: PluginResultType.Info, title: 'Mid', score: 50 }],
        })
      );
      const results = await registry.query(ctx);
      expect(results.map((r) => r.score)).toEqual([99, 50, 10]);
    });

    it('stamps pluginId on every returned result', async () => {
      registry.register(
        makePlugin({
          id: 'stamper',
          match: () => [
            { id: 'r1', type: PluginResultType.Info, title: 'R1', score: 50 },
            { id: 'r2', type: PluginResultType.Info, title: 'R2', score: 40 },
          ],
        })
      );
      const results = await registry.query(ctx);
      expect(results.every((r) => r.pluginId === 'stamper')).toBe(true);
    });

    it('isolates errors: a throwing plugin does not kill the query', async () => {
      registry.register(
        makePlugin({
          id: 'boom',
          match: () => {
            throw new Error('kaboom');
          },
        })
      );
      registry.register(
        makePlugin({
          id: 'good',
          match: () => [{ id: 'g1', type: PluginResultType.Info, title: 'Good', score: 80 }],
        })
      );
      const results = await registry.query(ctx);
      expect(results).toHaveLength(1);
      expect(results[0].pluginId).toBe('good');
    });

    it('isolates async rejections', async () => {
      registry.register(
        makePlugin({
          id: 'reject',
          match: async () => {
            throw new Error('async fail');
          },
        })
      );
      registry.register(
        makePlugin({
          id: 'ok',
          match: () => [{ id: 'ok1', type: PluginResultType.Info, title: 'Ok', score: 50 }],
        })
      );
      const results = await registry.query(ctx);
      expect(results.map((r) => r.pluginId)).toEqual(['ok']);
    });

    it('times out slow plugins (>500ms) without blocking the pipeline', async () => {
      vi.useFakeTimers();
      try {
        registry.register(
          makePlugin({
            id: 'slow',
            match: () =>
              new Promise<PluginResult[]>((resolve) => {
                setTimeout(
                  () =>
                    resolve([{ id: 's1', type: PluginResultType.Info, title: 'Slow', score: 50 }]),
                  5000
                );
              }),
          })
        );
        registry.register(
          makePlugin({
            id: 'fast',
            match: () => [{ id: 'f1', type: PluginResultType.Info, title: 'Fast', score: 50 }],
          })
        );

        const promise = registry.query(ctx);
        await vi.advanceTimersByTimeAsync(600);
        const results = await promise;
        expect(results.map((r) => r.pluginId)).toEqual(['fast']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores plugins that return null', async () => {
      registry.register(makePlugin({ id: 'nil', match: () => null }));
      registry.register(
        makePlugin({
          id: 'real',
          match: () => [{ id: 'r', type: PluginResultType.Info, title: 'R', score: 50 }],
        })
      );
      const results = await registry.query(ctx);
      expect(results.map((r) => r.pluginId)).toEqual(['real']);
    });

    it('ignores plugins that return non-array values', async () => {
      registry.register(
        makePlugin({
          id: 'bad',
          // @ts-expect-error - intentionally wrong shape
          match: () => ({ id: 'x', type: PluginResultType.Info, title: 'bad', score: 10 }),
        })
      );
      const results = await registry.query(ctx);
      expect(results).toEqual([]);
    });
  });
});
