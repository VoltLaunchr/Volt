import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { pluginRegistry } from '../features/plugins/core';
import { WebSearchPlugin } from '../features/plugins/builtin/websearch';
import { CalculatorPlugin } from '../features/plugins/builtin/calculator';
import { applicationService } from '../features/applications/services/applicationService';
import type { AppInfo, FileInfo } from '../shared/types/common.types';

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const fakeApps: AppInfo[] = [
  {
    id: 'app-firefox',
    name: 'Firefox',
    path: 'C:/Programs/Firefox.exe',
    icon: undefined,
    usageCount: 0,
  },
];

const fakeFiles: FileInfo[] = [
  {
    id: 'file-readme',
    name: 'README.md',
    path: 'C:/repo/README.md',
    extension: 'md',
    size: 100,
    modified: Date.now(),
  },
];

async function performSearch(query: string) {
  const [searchedApps, searchedFiles, pluginResults] = await Promise.all([
    applicationService.searchApplications({ query }, fakeApps),
    invoke<FileInfo[]>('search_files', { query, limit: 8 }).catch(() => [] as FileInfo[]),
    pluginRegistry.query({ query }).catch(() => []),
  ]);

  const merged = [
    ...searchedApps.map((app) => ({
      kind: 'app' as const,
      id: app.id,
      title: app.name,
      score: 200,
    })),
    ...searchedFiles.map((file) => ({
      kind: 'file' as const,
      id: file.id,
      title: file.name,
      score: 80,
    })),
    ...pluginResults.map((r) => ({
      kind: 'plugin' as const,
      id: r.id,
      title: r.title,
      score: r.score,
      pluginId: r.pluginId,
    })),
  ];

  merged.sort((a, b) => b.score - a.score);
  return merged;
}

describe('performSearch pipeline (integration)', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    // Reset registry
    for (const p of [...pluginRegistry.plugins.values()]) {
      pluginRegistry.unregister(p.id);
    }
    pluginRegistry.register(new WebSearchPlugin());
    pluginRegistry.register(new CalculatorPlugin());
  });

  it('returns empty array for empty query', async () => {
    mockedInvoke.mockResolvedValue([]);
    const results = await performSearch('');
    expect(results).toEqual([]);
  });

  it('apps appear above files when both match', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'search_applications') return fakeApps;
      if (cmd === 'search_files') return fakeFiles;
      return [];
    });
    const results = await performSearch('fire');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kind).toBe('app');
  });

  it('calculator plugin produces a result for a math query', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'search_applications') return [];
      if (cmd === 'search_files') return [];
      return [];
    });
    const results = await performSearch('2+2');
    const calc = results.find((r) => r.kind === 'plugin');
    expect(calc).toBeDefined();
    expect(calc!.title).toBe('4');
  });

  it('websearch plugin produces a result for "?" query', async () => {
    mockedInvoke.mockImplementation(async () => []);
    const results = await performSearch('?tauri');
    const ws = results.find((r) => r.kind === 'plugin' && r.pluginId === 'websearch');
    expect(ws).toBeDefined();
  });

  it('plugin errors do not break the pipeline', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'search_files') throw new Error('boom');
      if (cmd === 'search_applications') return fakeApps;
      return [];
    });
    const results = await performSearch('fire');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kind).toBe('app');
  });

  it('merges plugin + apps + files in score order', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'search_applications') return fakeApps;
      if (cmd === 'search_files') return fakeFiles;
      return [];
    });
    const results = await performSearch('2+2');
    // App (200) > Calculator (95) > File (80)
    expect(results[0].kind).toBe('app');
    const calc = results.find((r) => r.kind === 'plugin');
    const file = results.find((r) => r.kind === 'file');
    expect(calc).toBeDefined();
    expect(file).toBeDefined();
    expect(results.indexOf(calc!)).toBeLessThan(results.indexOf(file!));
  });
});
