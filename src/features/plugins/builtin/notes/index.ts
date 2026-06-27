/**
 * Notes Plugin — builtin launcher integration for the Notes feature.
 *
 * Triggers (case-insensitive; `note`/`notes` are accepted as synonyms for `n`):
 *   - `n` / `note` / `notes` alone → show the most-recently-touched notes + "Open Notes" action
 *   - `n <query>` / `note <query>` / `notes <query>` → full-text search via the backend (FTS5) + "Create" action
 *
 * All results route to the dedicated Notes window via the `open_notes_window`
 * Tauri command. Creating a new note here calls `create_note` then opens the
 * window focused on the fresh note.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Plugin, PluginActivation, PluginContext, PluginResult } from '../../types';
import { PluginResultType } from '../../types';
import { resolveActivation } from '../../core/activation';
import { logger } from '../../../../shared/utils/logger';

// Mirrors `Note` from `src/features/notes/types/notes.types.ts`. Duplicated
// (rather than imported) so the launcher bundle doesn't pull the Notes UI
// chunk for users who never type the `n` prefix.
interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  accessedAt: number;
  accessCount: number;
  deletedAt: number | null;
}

interface NoteHit {
  note: Note;
  score: number;
  /** HTML excerpt with `<mark>…</mark>` — DO NOT render as HTML. */
  snippet: string;
}

const MAX_RESULTS = 6;
const PLUGIN_ID = 'notes';

const NOTE_ICON = '/icons/app/volt_note_icons.svg';
const CREATE_NOTE_ICON = '/icons/app/create_note_icons.svg';
const SEARCH_NOTE_ICON = '/icons/app/search_note_icons.svg';

// Result `data` payload shapes — discriminated by `action`.
type NotesAction = 'open' | 'create' | 'open-window';
interface NotesActionData extends Record<string, unknown> {
  action: NotesAction;
  noteId?: string;
  draftTitle?: string;
}

export class NotesPlugin implements Plugin {
  id = PLUGIN_ID;
  name = 'Notes';
  description = 'Search, open, and create markdown notes';
  enabled = true;

  // `n`/`note`/`notes` (the name auto-adds `notes`) trigger note browsing/search.
  activation: PluginActivation = {
    keywords: ['n', 'note'],
  };

  canHandle(context: PluginContext): boolean {
    return resolveActivation(this, context).matched;
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = resolveActivation(this, context).stripped;
    const results: PluginResult[] = [];

    if (query.length === 0) {
      // Browse mode: top recent active notes.
      let notes: Note[] = [];
      try {
        notes = await invoke<Note[]>('get_notes');
      } catch (err) {
        logger.warn('NotesPlugin: get_notes failed', err);
      }
      notes.slice(0, MAX_RESULTS).forEach((note, idx) => {
        results.push(buildNoteResult(note, 90 - idx));
      });
    } else {
      // Search mode: FTS5 hits.
      let hits: NoteHit[] = [];
      try {
        hits = await invoke<NoteHit[]>('search_notes', {
          query,
          limit: MAX_RESULTS,
        });
      } catch (err) {
        logger.warn('NotesPlugin: search_notes failed', err);
      }
      hits.forEach((hit, idx) => {
        // Search hits use the magnifier-overlay variant so users can visually
        // distinguish FTS5 results from the "all notes" browse list.
        results.push(buildNoteResult(hit.note, 85 - idx, hit.snippet, SEARCH_NOTE_ICON));
      });

      // "Create" action is offered whenever the query has actual content.
      // Score below the top hit but above the "Open window" footer.
      results.push({
        id: 'notes-create',
        type: PluginResultType.Info,
        pluginId: PLUGIN_ID,
        title: `Create note: ${query}`,
        subtitle: 'Press Enter to create and open in Notes',
        icon: CREATE_NOTE_ICON,
        badge: 'New',
        score: 55,
        data: { action: 'create', draftTitle: query } satisfies NotesActionData,
      });
    }

    // Always offer "Open Notes window" as a low-score footer entry.
    results.push({
      id: 'notes-open-window',
      type: PluginResultType.Info,
      pluginId: PLUGIN_ID,
      title: 'Open Notes',
      subtitle: 'Open the dedicated Notes window',
      icon: NOTE_ICON,
      badge: 'Window',
      score: 30,
      data: { action: 'open-window' } satisfies NotesActionData,
    });

    return results;
  }

  async execute(result: PluginResult): Promise<void> {
    const data = result.data as NotesActionData | undefined;
    if (!data) return;

    switch (data.action) {
      case 'open':
        if (!data.noteId) return;
        await openWindow(data.noteId);
        break;
      case 'create': {
        let created: Note;
        try {
          created = await invoke<Note>('create_note', {
            title: data.draftTitle ?? null,
            content: null,
            tags: null,
          });
        } catch (err) {
          logger.error('NotesPlugin: create_note failed', err);
          return;
        }
        await openWindow(created.id);
        break;
      }
      case 'open-window':
        await openWindow(null);
        break;
    }
  }
}

function buildNoteResult(
  note: Note,
  score: number,
  snippet?: string,
  icon: string = NOTE_ICON,
): PluginResult {
  const title = note.title.trim() || 'Untitled';
  const subtitle = snippet ? stripMarks(snippet) : previewOf(note.content);
  const badge = note.pinned ? '★ Pinned' : 'Note';
  return {
    id: `note-${note.id}`,
    type: PluginResultType.Info,
    pluginId: PLUGIN_ID,
    title,
    subtitle: subtitle || 'Empty note',
    icon,
    badge,
    score,
    data: { action: 'open', noteId: note.id } satisfies NotesActionData,
  };
}

/** Strip the `<mark>…</mark>` tags from FTS5 snippets — we don't render HTML. */
function stripMarks(snippet: string): string {
  return snippet.replace(/<\/?mark>/g, '').replace(/\s+/g, ' ').trim();
}

/** Tiny markdown stripper for the inline preview — same logic as NoteListItem. */
function previewOf(content: string, max = 80): string {
  const cleaned = content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

async function openWindow(noteId: string | null): Promise<void> {
  try {
    await invoke<void>('open_notes_window', { noteId });
  } catch (err) {
    logger.error('NotesPlugin: open_notes_window failed', err);
  }
}
