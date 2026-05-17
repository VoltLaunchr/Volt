/**
 * useNotes — owns the active notes list for the Notes window.
 *
 * Pattern: refetch-on-mutate (simple, predictable). For the size of the local
 * SQLite notes DB this is cheaper than maintaining optimistic state and avoids
 * subtle drift between frontend and backend ordering (pinned + frecency).
 *
 * If we hit a real perf wall later we can swap to optimistic patches without
 * changing the call sites.
 */

import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { notesService } from '../services/notesService';
import type { Note, NotePatch } from '../types/notes.types';
import { logger } from '../../../shared/utils/logger';

export interface UseNotesResult {
  notes: Note[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createNote: (input?: { title?: string; content?: string; tags?: string[] }) => Promise<Note>;
  updateNote: (id: string, patch: NotePatch) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  togglePin: (id: string, pinned: boolean) => Promise<Note>;
}

/**
 * Cross-window sync event emitted by `open_notes_window` / future backend
 * notifications when a note is touched in another window. The handler is a
 * no-op if the event payload is missing — we just refetch.
 */
const SYNC_EVENT = 'volt:notes:changed';

export function useNotes(): UseNotesResult {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await notesService.list();
      setNotes(list);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('useNotes.refresh failed:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + cross-window sync listener. The listener fires on every
  // mutation from any Volt window (main launcher quick-edit, sticky pop-out,
  // etc.) so the dedicated Notes window stays consistent without polling.
  useEffect(() => {
    void refresh();

    let unlisten: (() => void) | undefined;
    void listen(SYNC_EVENT, () => {
      void refresh();
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err: unknown) => {
        logger.warn('useNotes: failed to subscribe to sync event:', err);
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [refresh]);

  const createNote = useCallback(
    async (input?: { title?: string; content?: string; tags?: string[] }): Promise<Note> => {
      const note = await notesService.create(input ?? {});
      await refresh();
      return note;
    },
    [refresh],
  );

  const updateNote = useCallback(
    async (id: string, patch: NotePatch): Promise<Note> => {
      const note = await notesService.update(id, patch);
      // Patch in place to avoid a full refetch on every keystroke save. The
      // sidebar ordering can drift slightly (accessed_at didn't change) but the
      // user won't notice — and we refetch on focus changes / hard mutations.
      setNotes((prev) => prev.map((n) => (n.id === id ? note : n)));
      return note;
    },
    [],
  );

  const deleteNote = useCallback(
    async (id: string): Promise<void> => {
      await notesService.delete(id);
      await refresh();
    },
    [refresh],
  );

  const togglePin = useCallback(
    async (id: string, pinned: boolean): Promise<Note> => {
      const note = await notesService.update(id, { pinned });
      await refresh();
      return note;
    },
    [refresh],
  );

  return { notes, loading, error, refresh, createNote, updateNote, deleteNote, togglePin };
}
