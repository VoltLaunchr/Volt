/**
 * Snippets Plugin — builtin plugin for text expansion
 *
 * Trigger: `;` prefix (e.g., `;email`, `;sig`)
 * Shows matching snippets as results, copies expanded content on execute.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Plugin, PluginContext, PluginResult } from '../../types';
import { PluginResultType } from '../../types';

interface Snippet {
  id: string;
  trigger: string;
  content: string;
  category: string | null;
  description: string | null;
  enabled: boolean;
}

export class SnippetsPlugin implements Plugin {
  id = 'snippets';
  name = 'Snippets';
  description = 'Text expansion snippets';
  enabled = true;

  canHandle(context: PluginContext): boolean {
    const q = context.query.toLowerCase().trim();
    return (
      q.startsWith(';') ||
      q === 'snippet' ||
      q === 'snippets' ||
      q.startsWith('snippet ') ||
      q.startsWith('snippets ')
    );
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    // Accept both the `;` prefix and the `snippet(s)` keyword for discoverability.
    const raw = context.query.trim();
    const lower = raw.toLowerCase();
    let query = '';
    if (lower.startsWith(';')) {
      query = raw.slice(1).trim().toLowerCase();
    } else if (lower.startsWith('snippets')) {
      query = raw.slice('snippets'.length).trim().toLowerCase();
    } else if (lower.startsWith('snippet')) {
      query = raw.slice('snippet'.length).trim().toLowerCase();
    }

    let snippets: Snippet[];
    try {
      snippets = await invoke<Snippet[]>('get_snippets');
    } catch {
      return [];
    }

    return snippets
      .filter((s) => s.enabled)
      .filter((s) => {
        if (!query) return true; // show all snippets when just `;`
        return (
          s.trigger.toLowerCase().includes(query) ||
          s.content.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query)
        );
      })
      .slice(0, 8)
      .map((s, i) => ({
        id: `snippet-${s.id}`,
        type: PluginResultType.Info,
        title: s.trigger,
        subtitle: s.description || s.content.substring(0, 80),
        badge: s.category || 'Snippet',
        score: 100 - i,
        data: { snippetId: s.id, trigger: s.trigger },
      }));
  }

  async execute(result: PluginResult): Promise<void> {
    const trigger = (result.data as { trigger?: string })?.trigger;
    if (!trigger) return;

    try {
      const expanded = await invoke<string | null>('expand_snippet', {
        trigger,
        clipboard: null,
      });

      if (expanded) {
        await navigator.clipboard.writeText(expanded);
      }
    } catch {
      // silently fail
    }
  }
}
