import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { logger } from '../../../shared/utils/logger';
import { useNotes } from '../hooks/useNotes';
import { useNote } from '../hooks/useNote';
import { NotesSidebar } from './NotesSidebar';
import { NoteEditorPane } from './NoteEditorPane';
import './NotesView.css';

/**
 * NotesView — root layout for the dedicated Notes window.
 *
 * Layout:
 *   - 40px draggable header
 *   - 300px sidebar (search + list + new note)
 *   - flex-1 editor pane (title + TipTap editor + autosave indicator)
 *
 * State ownership:
 *   - `useNotes` owns the active list + CRUD wrappers (refetch-on-mutate).
 *   - `useNote(selectedId)` owns the editor's draft + debounced autosave.
 *   - Selection is kept here (`selectedId`) so the sidebar and editor stay in
 *     sync without prop drilling through extra hooks.
 */

const HEADER_HEIGHT = 40;
const SIDEBAR_WIDTH = 300;

export function NotesView(): React.JSX.Element {
  const { t } = useTranslation('notes');
  const { notes, loading, error, createNote, updateNote, deleteNote, togglePin } = useNotes();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-select the first note once the list arrives so the editor isn't
  // empty on a non-empty DB. We only do this once per id-presence change,
  // never on every refresh (would fight the user).
  useEffect(() => {
    if (selectedId !== null) return;
    if (notes.length === 0) return;
    setSelectedId(notes[0].id);
  }, [notes, selectedId]);

  // If the currently-selected note disappears from the list (deleted in another
  // window, or trashed here), clear the selection so the editor unmounts.
  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) {
      setSelectedId(null);
    }
  }, [notes, selectedId]);

  const { note, draft, saveState, updateDraft } = useNote(selectedId);

  const handleSelect = useCallback((id: string): void => {
    setSelectedId(id);
  }, []);

  const handleCreate = useCallback(async (): Promise<void> => {
    try {
      const fresh = await createNote();
      setSelectedId(fresh.id);
    } catch (err) {
      logger.error('NotesView.handleCreate failed:', err);
    }
  }, [createNote]);

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        await deleteNote(id);
        setSelectedId(null);
      } catch (err) {
        logger.error('NotesView.handleDelete failed:', err);
      }
    },
    [deleteNote],
  );

  const handleTogglePin = useCallback(
    async (id: string, pinned: boolean): Promise<void> => {
      try {
        await togglePin(id, pinned);
      } catch (err) {
        logger.error('NotesView.handleTogglePin failed:', err);
      }
    },
    [togglePin],
  );

  // Wrap the async actions for child components that expect void-returning
  // callbacks. Errors are already logged inside the async wrappers.
  const onCreate = useCallback((): void => {
    void handleCreate();
  }, [handleCreate]);

  const onDelete = useCallback(
    (id: string): void => {
      void handleDelete(id);
    },
    [handleDelete],
  );

  const onTogglePin = useCallback(
    (id: string, pinned: boolean): void => {
      void handleTogglePin(id, pinned);
    },
    [handleTogglePin],
  );

  const handleTitlebarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button, input, [role="textbox"]')) return;
      void (async (): Promise<void> => {
        try {
          if (e.detail === 2) {
            await getCurrentWindow().toggleMaximize();
          } else {
            await getCurrentWindow().startDragging();
          }
        } catch (err) {
          logger.error('NotesView: startDragging failed:', err);
        }
      })();
    },
    [],
  );

  // Cmd/Ctrl+N — create a new note from anywhere in the window.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        void handleCreate();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [handleCreate]);

  // Update the saved snapshot inline so the sidebar reflects title changes
  // without waiting for the next full refresh. We hook onSaved via useNote's
  // optional callback (no extra invoke).
  const updateNoteRef = React.useRef(updateNote);
  useEffect(() => {
    updateNoteRef.current = updateNote;
  }, [updateNote]);

  return (
    <div className="notes-view">
      <div
        className="notes-view__titlebar"
        onMouseDown={handleTitlebarMouseDown}
        style={{ height: HEADER_HEIGHT }}
      >
        <span className="notes-view__title">{t('title')}</span>
      </div>

      <div className="notes-view__body">
        <div className="notes-view__sidebar" style={{ width: SIDEBAR_WIDTH }}>
          <NotesSidebar
            notes={notes}
            selectedId={selectedId}
            loading={loading}
            error={error}
            onSelect={handleSelect}
            onCreate={onCreate}
          />
        </div>

        <div className="notes-view__pane">
          {note && draft ? (
            <NoteEditorPane
              note={note}
              draft={draft}
              saveState={saveState}
              onDraftChange={updateDraft}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
            />
          ) : (
            <div className="notes-view__empty">
              <p className="notes-view__empty-title">
                {notes.length === 0 ? t('empty') : t('selectOrCreate')}
              </p>
              <p className="notes-view__empty-hint">{t('createFirst')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
