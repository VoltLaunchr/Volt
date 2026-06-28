import { describe, it, expect, vi } from 'vitest';

// Plugins call invoke() in match(), but discoverability only exercises
// canHandle (synchronous, no IPC). Stub the Tauri core so constructing the
// plugins in jsdom never touches a real backend.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  Channel: class {},
}));

import { NotesPlugin } from './notes';
import { ShellCommandPlugin } from './shell';
import { WebSearchPlugin } from './websearch';
import { SnippetsPlugin } from './snippets';
import { TimerPlugin } from './timer';

/**
 * Regression guard for the original bug: typing a built-in feature's *name*
 * surfaced nothing because each plugin only triggered on a symbolic prefix.
 * Every declarative plugin must now activate on its natural-language keyword.
 */
describe('built-ins are discoverable by name', () => {
  const cases: Array<{ name: string; plugin: { canHandle: (c: { query: string }) => boolean }; query: string }> = [
    { name: 'Notes', plugin: new NotesPlugin(), query: 'note' },
    { name: 'Notes (plural)', plugin: new NotesPlugin(), query: 'notes' },
    { name: 'Shell', plugin: new ShellCommandPlugin(), query: 'shell' },
    { name: 'Web Search', plugin: new WebSearchPlugin(), query: 'search openai' },
    { name: 'Snippets', plugin: new SnippetsPlugin(), query: 'snippet' },
    { name: 'Timer', plugin: new TimerPlugin(), query: 'timer' },
  ];

  it.each(cases)('$name activates on "$query"', ({ plugin, query }) => {
    expect(plugin.canHandle({ query })).toBe(true);
  });

  it('still honours symbolic prefixes', () => {
    expect(new ShellCommandPlugin().canHandle({ query: '>git status' })).toBe(true);
    expect(new SnippetsPlugin().canHandle({ query: ';email' })).toBe(true);
    expect(new WebSearchPlugin().canHandle({ query: '?weather' })).toBe(true);
  });

  it('does not over-trigger on unrelated words', () => {
    // "notebook" must not be read as a note search (separator required).
    expect(new NotesPlugin().canHandle({ query: 'notebook' })).toBe(false);
  });
});
