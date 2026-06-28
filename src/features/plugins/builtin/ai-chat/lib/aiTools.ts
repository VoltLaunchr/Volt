/**
 * Sprint 3 — J1. Volt tools exposed to the chat assistant.
 *
 * Each tool's `execute` calls an existing Tauri command via `invoke` — no new
 * backend command is introduced, and every command used here is already gated in
 * `src-tauri/capabilities/main.json`. Results are trimmed to compact, model-
 * friendly shapes (capped counts, no icons/blobs) to keep token cost bounded.
 *
 * Two tiers:
 *  - Read-only tools run with no confirmation.
 *  - Side-effecting tools (`launch_application`, `copy_to_clipboard`,
 *    `open_quicklink`) await {@link requestToolApproval} before touching the OS,
 *    so the user explicitly approves each effect (see `aiToolApproval.ts`).
 *
 * Security: `execute` never reads or returns secrets; the keyring-backed API key
 * stays in Rust. The tool-loop is bounded by `stopWhen: stepCountIs(...)` in the
 * transport, so a misbehaving model cannot loop indefinitely.
 */

import { invoke } from '@tauri-apps/api/core';
import { jsonSchema, tool, type ToolSet } from 'ai';
import type { AppInfo } from '@/shared/types/generated/AppInfo';
import type { FileInfo } from '@/shared/types/generated/FileInfo';
import type { SystemMetrics } from '@/shared/types/generated/SystemMetrics';
import { requestToolApproval } from './aiToolApproval';

type FileSearchResult = FileInfo & { score: number };

interface ClipboardItemLite {
  preview: string;
  timestamp: number;
  pinned: boolean;
}

interface Quicklink {
  id: string;
  name: string;
  shortcut: string;
  target: string;
  type: string;
  icon: string | null;
}

const DENIED = { ok: false, reason: 'The user denied this action.' } as const;

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/**
 * Build the tool set handed to `streamText`. Created once and reused; the tools
 * are stateless apart from the shared approval store.
 */
export function createVoltTools(): ToolSet {
  return {
    search_files: tool({
      description:
        'Search the local indexed files by name or fragment. Read-only. Returns matching file names and absolute paths.',
      inputSchema: jsonSchema<{ query: string; limit?: number }>({
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Filename or fragment to search for.' },
          limit: { type: 'number', description: 'Maximum results (default 10, max 25).' },
        },
        required: ['query'],
      }),
      execute: async ({ query, limit }) => {
        const capped = clamp(limit, 10, 25);
        const results = await invoke<FileSearchResult[]>('search_files', { query, limit: capped });
        return {
          count: results.length,
          files: results.map((f) => ({
            name: f.name,
            path: f.path,
            extension: f.extension,
            size: f.size,
          })),
        };
      },
    }),

    search_applications: tool({
      description:
        'Search installed applications by name. Read-only. Returns app names and their executable paths (use the path with launch_application).',
      inputSchema: jsonSchema<{ query: string; limit?: number }>({
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Application name or fragment.' },
          limit: { type: 'number', description: 'Maximum results (default 8, max 20).' },
        },
        required: ['query'],
      }),
      execute: async ({ query, limit }) => {
        const capped = clamp(limit, 8, 20);
        const matches = await invoke<AppInfo[]>('search_applications', { query });
        return {
          count: matches.length,
          applications: matches.slice(0, capped).map((a) => ({
            name: a.name,
            path: a.path,
            description: a.description,
          })),
        };
      },
    }),

    get_clipboard_history: tool({
      description:
        'Read the most recent clipboard history entries. Read-only. Returns short text previews, not full content.',
      inputSchema: jsonSchema<{ limit?: number }>({
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'number', description: 'Maximum entries (default 10, max 25).' },
        },
      }),
      execute: async ({ limit }) => {
        const capped = clamp(limit, 10, 25);
        const items = await invoke<ClipboardItemLite[]>('get_clipboard_history', { limit: capped });
        return {
          count: items.length,
          entries: items.map((i) => ({
            preview: i.preview,
            timestamp: i.timestamp,
            pinned: i.pinned,
          })),
        };
      },
    }),

    get_system_metrics: tool({
      description:
        'Get a snapshot of current system metrics (CPU, memory and disk usage). Read-only.',
      inputSchema: jsonSchema<Record<string, never>>({
        type: 'object',
        additionalProperties: false,
        properties: {},
      }),
      execute: async () => {
        const m = await invoke<SystemMetrics>('get_system_metrics');
        return {
          cpuUsagePercent: Math.round(m.cpuUsage),
          memoryUsagePercent: Math.round(m.memoryUsage),
          diskUsagePercent: Math.round(m.diskUsage),
          memoryUsedGb: m.memoryUsedGb,
          memoryTotalGb: m.memoryTotalGb,
          diskUsedGb: m.diskUsedGb,
          diskTotalGb: m.diskTotalGb,
        };
      },
    }),

    list_quicklinks: tool({
      description:
        'List the user\u2019s configured quicklinks (named URLs, folders or commands). Read-only.',
      inputSchema: jsonSchema<Record<string, never>>({
        type: 'object',
        additionalProperties: false,
        properties: {},
      }),
      execute: async () => {
        const links = await invoke<Quicklink[]>('get_quicklinks');
        return {
          count: links.length,
          quicklinks: links.map((q) => ({ name: q.name, target: q.target, type: q.type })),
        };
      },
    }),

    launch_application: tool({
      description:
        'Launch an installed application by its executable path. Requires user approval. Get the path from search_applications first.',
      inputSchema: jsonSchema<{ path: string; name?: string }>({
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Absolute executable path from search_applications.' },
          name: { type: 'string', description: 'Human-readable app name for the confirmation prompt.' },
        },
        required: ['path'],
      }),
      execute: async ({ path, name }) => {
        const approved = await requestToolApproval({
          toolName: 'launch_application',
          title: 'Launch application',
          summary: name ? `Launch \u201c${name}\u201d` : `Launch ${path}`,
          input: { path, name },
        });
        if (!approved) return DENIED;
        await invoke('launch_application', { path });
        return { ok: true, launched: path };
      },
    }),

    copy_to_clipboard: tool({
      description:
        'Write text to the system clipboard. Requires user approval. Use this to hand a result back to the user for pasting.',
      inputSchema: jsonSchema<{ content: string }>({
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', description: 'The text to place on the clipboard.' },
        },
        required: ['content'],
      }),
      execute: async ({ content }) => {
        const approved = await requestToolApproval({
          toolName: 'copy_to_clipboard',
          title: 'Copy to clipboard',
          summary: `Copy ${content.length} character(s) to the clipboard`,
          input: { preview: content.slice(0, 200) },
        });
        if (!approved) return DENIED;
        await invoke('copy_to_clipboard', { content });
        return { ok: true, copiedLength: content.length };
      },
    }),

    open_quicklink: tool({
      description:
        'Open a configured quicklink by its name. Requires user approval. Use list_quicklinks first to discover available names.',
      inputSchema: jsonSchema<{ name: string }>({
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'The quicklink name (case-insensitive).' },
        },
        required: ['name'],
      }),
      execute: async ({ name }) => {
        const links = await invoke<Quicklink[]>('get_quicklinks');
        const match = links.find((q) => q.name.toLowerCase() === name.toLowerCase());
        if (!match) return { ok: false, reason: `No quicklink named \u201c${name}\u201d.` };
        const approved = await requestToolApproval({
          toolName: 'open_quicklink',
          title: 'Open quicklink',
          summary: `Open quicklink \u201c${match.name}\u201d \u2192 ${match.target}`,
          input: { name: match.name, target: match.target, type: match.type },
        });
        if (!approved) return DENIED;
        await invoke('open_quicklink', { quicklink: match });
        return { ok: true, opened: match.name };
      },
    }),
  };
}
