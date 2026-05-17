/**
 * Notes service — typed wrappers around the Tauri `notes` commands.
 *
 * Mirrors the public surface declared in `src-tauri/src/commands/notes.rs`.
 * All errors are normalized via `extractErrorMessage` and re-thrown with a
 * predictable prefix so the UI can display them without further mapping.
 */

import { invoke } from '@tauri-apps/api/core';
import { extractErrorMessage } from '../../../shared/utils/error';
import { logger } from '../../../shared/utils/logger';
import type { Note, NoteHit, NotePatch } from '../types/notes.types';

function wrap<T>(label: string, run: () => Promise<T>): Promise<T> {
  return run().catch((error: unknown) => {
    logger.error(`notesService.${label} failed:`, error);
    throw new Error(`${label}: ${extractErrorMessage(error)}`);
  });
}

export const notesService = {
  list(): Promise<Note[]> {
    return wrap('list', () => invoke<Note[]>('get_notes'));
  },

  get(id: string): Promise<Note | null> {
    return wrap('get', () => invoke<Note | null>('get_note', { id }));
  },

  trash(): Promise<Note[]> {
    return wrap('trash', () => invoke<Note[]>('get_trash'));
  },

  create(input: { title?: string; content?: string; tags?: string[] } = {}): Promise<Note> {
    return wrap('create', () =>
      invoke<Note>('create_note', {
        title: input.title ?? null,
        content: input.content ?? null,
        tags: input.tags ?? null,
      }),
    );
  },

  update(id: string, patch: NotePatch): Promise<Note> {
    return wrap('update', () =>
      invoke<Note>('update_note', {
        id,
        title: patch.title ?? null,
        content: patch.content ?? null,
        tags: patch.tags ?? null,
        pinned: patch.pinned ?? null,
        color: patch.color ?? null,
      }),
    );
  },

  delete(id: string): Promise<void> {
    return wrap('delete', () => invoke<void>('delete_note', { id }));
  },

  restore(id: string): Promise<Note> {
    return wrap('restore', () => invoke<Note>('restore_note', { id }));
  },

  emptyTrash(): Promise<number> {
    return wrap('emptyTrash', () => invoke<number>('empty_trash'));
  },

  search(query: string, limit?: number): Promise<NoteHit[]> {
    return wrap('search', () =>
      invoke<NoteHit[]>('search_notes', { query, limit: limit ?? null }),
    );
  },

  export(): Promise<string> {
    return wrap('export', () => invoke<string>('export_notes'));
  },

  import(json: string): Promise<number> {
    return wrap('import', () => invoke<number>('import_notes', { json }));
  },
};
