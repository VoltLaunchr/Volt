import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Note } from '../types/notes.types';
import { useNotesSearch } from '../hooks/useNotesSearch';
import { NoteListItem } from './NoteListItem';
import './NotesSidebar.css';

export interface NotesSidebarProps {
  notes: Note[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function NotesSidebar({
  notes,
  selectedId,
  loading,
  error,
  onSelect,
  onCreate,
}: NotesSidebarProps): React.JSX.Element {
  const { t } = useTranslation('notes');
  const [query, setQuery] = useState<string>('');
  // Stable "now" timestamp for relative date formatting, refreshed every
  // minute. Avoids reading Date.now() during render (react-hooks/purity).
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const search = useNotesSearch(query, 30);

  // When searching, render the hits ordered by score; when idle, fall back to
  // the unfiltered list from useNotes (already sorted pinned + accessed_at).
  const visibleNotes = useMemo<Note[]>(() => {
    const q = query.trim();
    if (!q) return notes;
    return search.hits.map((h) => h.note);
  }, [query, notes, search.hits]);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setQuery(e.target.value);
  }, []);

  const handleClear = useCallback((): void => {
    setQuery('');
  }, []);

  return (
    <aside className="notes-sidebar" aria-label={t('title')}>
      <div className="notes-sidebar__head">
        <input
          type="search"
          className="notes-sidebar__search"
          value={query}
          onChange={handleQueryChange}
          placeholder={t('search')}
          aria-label={t('search')}
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className="notes-sidebar__clear"
            onClick={handleClear}
            aria-label={t('clearSearch')}
            tabIndex={-1}
          >
            ×
          </button>
        )}
        <button
          type="button"
          className="notes-sidebar__new"
          onClick={onCreate}
          aria-label={t('newNote')}
          title={t('newNote')}
        >
          +
        </button>
      </div>

      <div className="notes-sidebar__list" role="listbox" aria-label={t('title')}>
        {loading && <div className="notes-sidebar__hint">{t('loading')}</div>}
        {!loading && error && <div className="notes-sidebar__error">{error}</div>}
        {!loading && !error && visibleNotes.length === 0 && (
          <div className="notes-sidebar__hint">{query ? t('noResults') : t('empty')}</div>
        )}
        {!loading &&
          !error &&
          visibleNotes.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              selected={note.id === selectedId}
              now={now}
              onSelect={onSelect}
            />
          ))}
      </div>
    </aside>
  );
}
