import { describe, expect, it, vi } from 'vitest';
import { BraveSearchProvider } from './braveSearchProvider';

describe('BraveSearchProvider', () => {
  it('delegates to the credential-safe Tauri command without a renderer key', async () => {
    const invokeImplementation = vi.fn().mockResolvedValue([
      {
        title: 'Volt Launcher',
        url: 'https://voltlaunchr.com',
        description: 'Fast launcher',
        favicon: 'https://voltlaunchr.com/favicon.ico',
      },
    ]);
    const provider = new BraveSearchProvider({
      invokeImplementation,
      country: 'FR',
      language: 'fr',
    });
    const controller = new AbortController();

    await expect(
      provider.search('volt launcher', {
        signal: controller.signal,
        limit: 3,
        freshness: 'pm',
      })
    ).resolves.toEqual([
      {
        title: 'Volt Launcher',
        url: 'https://voltlaunchr.com',
        description: 'Fast launcher',
        age: undefined,
        favicon: 'https://voltlaunchr.com/favicon.ico',
        providerId: 'brave',
      },
    ]);

    expect(invokeImplementation).toHaveBeenCalledWith('web_search_brave', {
      query: 'volt launcher',
      count: 3,
      country: 'FR',
      searchLang: 'fr',
      freshness: 'pm',
    });
  });

  it('is inert when disabled or already aborted', async () => {
    const invokeImplementation = vi.fn();
    const disabled = new BraveSearchProvider({ enabled: false, invokeImplementation });
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      disabled.search('query', { signal: new AbortController().signal, limit: 5 })
    ).resolves.toEqual([]);
    await expect(
      new BraveSearchProvider({ invokeImplementation }).search('query', {
        signal: aborted.signal,
        limit: 5,
      })
    ).resolves.toEqual([]);
    expect(invokeImplementation).not.toHaveBeenCalled();
  });

  it('absorbs missing credentials and malformed backend responses', async () => {
    const missingCredential = new BraveSearchProvider({
      invokeImplementation: vi.fn().mockRejectedValue(new Error('InvalidConfig')),
    });
    const malformed = new BraveSearchProvider({
      invokeImplementation: vi.fn().mockResolvedValue([{ title: 'missing URL' }, null]),
    });
    const context = { signal: new AbortController().signal, limit: 5 };

    await expect(missingCredential.search('query', context)).resolves.toEqual([]);
    await expect(malformed.search('query', context)).resolves.toEqual([]);
  });

  it('maps backend hits into coordinator suggestions', async () => {
    const provider = new BraveSearchProvider({
      invokeImplementation: vi
        .fn()
        .mockResolvedValue([{ title: 'Volt', url: 'https://voltlaunchr.com' }]),
    });

    await expect(
      provider.suggest('volt', { signal: new AbortController().signal, limit: 5 })
    ).resolves.toEqual([
      {
        id: 'brave:https://voltlaunchr.com',
        text: 'Volt',
        source: 'remote',
        providerId: 'brave',
      },
    ]);
  });
});
