/**
 * useNotesSearch — debounced FTS5 search over the backend.
 *
 * For empty queries we return an empty hit list and let the caller fall back
 * to the unfiltered list from `useNotes`. The debounce keeps backend round-
 * trips reasonable while typing.
 */

import { useEffect, useRef, useState } from 'react';
import { notesService } from '../services/notesService';
import type { NoteHit } from '../types/notes.types';
import { logger } from '../../../shared/utils/logger';

const SEARCH_DEBOUNCE_MS = 150;

export interface UseNotesSearchResult {
  hits: NoteHit[];
  loading: boolean;
  error: string | null;
}

export function useNotesSearch(query: string, limit = 20): UseNotesSearchResult {
  const [hits, setHits] = useState<NoteHit[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef<number>(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    const myReq = reqIdRef.current + 1;
    reqIdRef.current = myReq;

    const timer = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const results = await notesService.search(trimmed, limit);
          if (reqIdRef.current !== myReq) return;
          setHits(results);
          setError(null);
        } catch (err) {
          if (reqIdRef.current !== myReq) return;
          logger.error('useNotesSearch failed:', err);
          setError(err instanceof Error ? err.message : String(err));
          setHits([]);
        } finally {
          if (reqIdRef.current === myReq) setLoading(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [query, limit]);

  return { hits, loading, error };
}
