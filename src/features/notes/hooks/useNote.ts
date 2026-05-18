/**
 * useNote — manages a single selected note with debounced autosave.
 *
 * Contract:
 * - Caller passes a noteId (or null when nothing is selected).
 * - We load the note once on id change and expose a `draft` (title + content +
 *   tags) which the editor mutates freely. Each mutation triggers an autosave
 *   debounced to 500ms (configurable). The autosave persists via
 *   `notesService.update` and notifies the caller via `onSaved` once the
 *   backend confirms.
 * - `saveState` exposes 'idle' | 'saving' | 'saved' | 'error' for status UIs.
 * - Pending edits are flushed on unmount and on noteId swap so we never drop a
 *   trailing keystroke.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notesService } from '../services/notesService';
import type { Note, NotePatch, SaveState } from '../types/notes.types';
import { logger } from '../../../shared/utils/logger';

const AUTOSAVE_DEBOUNCE_MS = 500;
const SAVED_INDICATOR_MS = 1200;

export interface NoteDraft {
  title: string;
  content: string;
  tags: string[];
}

export interface UseNoteResult {
  note: Note | null;
  draft: NoteDraft | null;
  saveState: SaveState;
  error: string | null;
  updateDraft: (patch: Partial<NoteDraft>) => void;
  flushNow: () => Promise<void>;
}

export interface UseNoteOptions {
  /** Notified after a successful autosave with the latest backend snapshot. */
  onSaved?: (note: Note) => void;
}

export function useNote(noteId: string | null, options: UseNoteOptions = {}): UseNoteResult {
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  // Pending patch accumulator. We coalesce all mutations between debounce ticks
  // into a single backend call so rapid typing fires at most one save per 500ms.
  const pendingRef = useRef<NotePatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedIndicatorRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentIdRef = useRef<string | null>(null);

  // Keep `onSaved` accessible inside the deferred timer without violating
  // react-hooks/refs — we only read it from event handlers / async paths,
  // never during render.
  const onSavedRef = useRef<UseNoteOptions['onSaved']>(options.onSaved);
  useEffect(() => {
    onSavedRef.current = options.onSaved;
  }, [options.onSaved]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (savedIndicatorRef.current) {
      clearTimeout(savedIndicatorRef.current);
      savedIndicatorRef.current = undefined;
    }
  }, []);

  const performSave = useCallback(async (id: string, patch: NotePatch): Promise<void> => {
    if (Object.keys(patch).length === 0) return;
    setSaveState('saving');
    try {
      const updated = await notesService.update(id, patch);
      // Drop the saved keys; new mutations may have piled up while in flight.
      pendingRef.current = stripSavedKeys(pendingRef.current, patch);
      if (currentIdRef.current === id) {
        setNote(updated);
        setSaveState('saved');
        onSavedRef.current?.(updated);
        if (savedIndicatorRef.current) clearTimeout(savedIndicatorRef.current);
        savedIndicatorRef.current = setTimeout(() => {
          setSaveState('idle');
          savedIndicatorRef.current = undefined;
        }, SAVED_INDICATOR_MS);
      }
    } catch (err) {
      logger.error('useNote.performSave failed:', err);
      if (currentIdRef.current === id) {
        setError(err instanceof Error ? err.message : String(err));
        setSaveState('error');
      }
    }
  }, []);

  const flushNow = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const id = currentIdRef.current;
    if (!id) return;
    const patch = pendingRef.current;
    pendingRef.current = {};
    await performSave(id, patch);
  }, [performSave]);

  // Load on noteId change. Always flush pending edits from the previous note
  // before swapping so we don't lose data when the user switches selection.
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      // Flush prior note's pending edits synchronously-ish first.
      if (currentIdRef.current && currentIdRef.current !== noteId) {
        await flushNow();
      }
      clearTimers();
      pendingRef.current = {};
      currentIdRef.current = noteId;
      setError(null);
      setSaveState('idle');

      if (!noteId) {
        setNote(null);
        setDraft(null);
        return;
      }

      try {
        const fresh = await notesService.get(noteId);
        if (cancelled) return;
        if (!fresh) {
          setNote(null);
          setDraft(null);
          return;
        }
        setNote(fresh);
        setDraft({ title: fresh.title, content: fresh.content, tags: fresh.tags });
      } catch (err) {
        if (cancelled) return;
        logger.error('useNote.load failed:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
    // `flushNow` is stable (depends only on `performSave` which has no deps).
  }, [noteId, flushNow, clearTimers]);

  // Flush on unmount.
  useEffect(() => {
    return () => {
      void flushNow();
      clearTimers();
    };
  }, [flushNow, clearTimers]);

  const updateDraft = useCallback(
    (patch: Partial<NoteDraft>): void => {
      const id = currentIdRef.current;
      if (!id) return;
      setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

      // Coalesce into the pending patch. Only fields that actually changed end
      // up on the wire; the editor calls this on every keystroke for content.
      const accum: NotePatch = { ...pendingRef.current };
      if (patch.title !== undefined) accum.title = patch.title;
      if (patch.content !== undefined) accum.content = patch.content;
      if (patch.tags !== undefined) accum.tags = patch.tags;
      pendingRef.current = accum;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        const toSave = pendingRef.current;
        pendingRef.current = {};
        void performSave(id, toSave);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [performSave],
  );

  return useMemo(
    () => ({ note, draft, saveState, error, updateDraft, flushNow }),
    [note, draft, saveState, error, updateDraft, flushNow],
  );
}

function stripSavedKeys(remaining: NotePatch, saved: NotePatch): NotePatch {
  const next: NotePatch = { ...remaining };
  for (const key of Object.keys(saved) as Array<keyof NotePatch>) {
    if (next[key] === saved[key]) {
      delete next[key];
    }
  }
  return next;
}
