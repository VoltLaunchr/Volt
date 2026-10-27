import { describe, expect, it } from 'vitest';
import { PluginResultType, type PluginResult } from '../features/plugins/types';
import { SearchResultType, type SearchResult } from '../shared/types/common.types';
import { getStableResultIdentity } from './searchResultIdentity';

function pluginResult(
  type: SearchResultType,
  id: string,
  pluginId: string | undefined,
  overrides: Partial<SearchResult> = {}
): SearchResult {
  const data: PluginResult = {
    id,
    type: PluginResultType.Info,
    title: id,
    score: 90,
    pluginId,
  };
  return { id, type, title: id, score: 190, data, ...overrides };
}

describe('getStableResultIdentity', () => {
  it('uses the filesystem path for applications and files', () => {
    expect(
      getStableResultIdentity({
        id: 'app-hash',
        type: SearchResultType.Application,
        title: 'Code',
        score: 1150,
        data: { id: 'app-hash', name: 'Code', path: 'C:/Apps/code.exe', usageCount: 0 },
      })
    ).toBe('C:/Apps/code.exe');

    expect(
      getStableResultIdentity({
        id: 'file-hash',
        type: SearchResultType.File,
        title: 'report.pdf',
        score: 1000,
        data: {
          id: 'file-hash',
          name: 'report.pdf',
          path: 'C:/Docs/report.pdf',
          extension: 'pdf',
          size: 1,
          modified: 0,
          category: 'document',
        },
      })
    ).toBe('C:/Docs/report.pdf');
  });

  it('returns null for an application or file without a usable path', () => {
    expect(
      getStableResultIdentity({
        id: 'app',
        type: SearchResultType.Application,
        title: 'Broken',
        score: 1,
        data: { id: 'app', name: 'Broken', path: '  ', usageCount: 0 },
      })
    ).toBeNull();
  });

  it('namespaces stable plugin ids with the plugin id', () => {
    expect(
      getStableResultIdentity(
        pluginResult(SearchResultType.SystemCommand, 'syscmd-lock', 'systemcommands')
      )
    ).toBe('systemcommands:syscmd-lock');
    expect(getStableResultIdentity(pluginResult(SearchResultType.Game, 'game_42', 'games'))).toBe(
      'games:game_42'
    );
    expect(
      getStableResultIdentity(pluginResult(SearchResultType.Plugin, 'quicklink-gh', 'quicklinks'))
    ).toBe('quicklinks:quicklink-gh');
  });

  it('ignores fallback commands even when their type looks stable', () => {
    expect(
      getStableResultIdentity(
        pluginResult(SearchResultType.WebSearch, 'fallback-fallback-google-17', 'websearch', {
          badge: 'Fallback',
        })
      )
    ).toBeNull();
    expect(
      getStableResultIdentity(
        pluginResult(SearchResultType.Plugin, 'fallback-custom-3', 'custom', { badge: 'Fallback' })
      )
    ).toBeNull();
    expect(
      getStableResultIdentity(pluginResult(SearchResultType.Plugin, 'fallback-custom-3', 'custom'))
    ).toBeNull();
  });

  it('ignores URL detection, web results and other ephemeral result types', () => {
    expect(
      getStableResultIdentity(pluginResult(SearchResultType.Url, 'open-url-https://a.b', undefined))
    ).toBeNull();
    expect(
      getStableResultIdentity(
        pluginResult(SearchResultType.WebSearch, 'web-result-brave-0', 'websearch')
      )
    ).toBeNull();
    for (const type of [
      SearchResultType.Calculator,
      SearchResultType.Timer,
      SearchResultType.ShellCommand,
      SearchResultType.SystemMonitor,
      SearchResultType.AiChat,
    ]) {
      expect(getStableResultIdentity(pluginResult(type, 'stable-looking', 'whatever'))).toBeNull();
    }
  });

  it('ignores per-query ids from volatile plugins and timestamp-based ids', () => {
    expect(
      getStableResultIdentity(
        pluginResult(SearchResultType.Plugin, 'emoji-1F600-3', 'emoji-picker')
      )
    ).toBeNull();
    expect(
      getStableResultIdentity(
        pluginResult(SearchResultType.Plugin, 'ext-result-1760000000000', 'my-extension')
      )
    ).toBeNull();
  });

  it('ignores plugin-like results without a plugin id', () => {
    expect(
      getStableResultIdentity(pluginResult(SearchResultType.Plugin, 'orphan', undefined))
    ).toBeNull();
    expect(
      getStableResultIdentity({
        id: 'raw',
        type: SearchResultType.Plugin,
        title: 'raw',
        score: 1,
        data: { id: 'raw', name: 'raw', path: 'x', usageCount: 0 },
      })
    ).toBeNull();
  });
});
