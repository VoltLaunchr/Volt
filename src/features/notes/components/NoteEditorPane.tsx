import { Suspense, lazy, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteDraft, UseNoteResult } from '../hooks/useNote';
import type { Note, SaveState } from '../types/notes.types';
import './NoteEditorPane.css';

// Lazy load TipTap on-demand. The Notes window can render the shell + sidebar
// while the editor chunk (~250 KB) downloads. Suspense keeps the UX coherent.
const NoteEditor = lazy(() =>
  import('./NoteEditor').then((m) => ({ default: m.NoteEditor })),
);

export interface NoteEditorPaneProps {
  note: Note;
  draft: NoteDraft;
  saveState: SaveState;
  onDraftChange: UseNoteResult['updateDraft'];
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}

export function NoteEditorPane({
  note,
  draft,
  saveState,
  onDraftChange,
  onTogglePin,
  onDelete,
}: NoteEditorPaneProps): React.JSX.Element {
  const { t } = useTranslation('notes');

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      onDraftChange({ title: e.target.value });
    },
    [onDraftChange],
  );

  const handleContentChange = useCallback(
    (markdown: string): void => {
      onDraftChange({ content: markdown });
    },
    [onDraftChange],
  );

  const handleTogglePin = useCallback((): void => {
    onTogglePin(note.id, !note.pinned);
  }, [note.id, note.pinned, onTogglePin]);

  const handleDelete = useCallback((): void => {
    if (window.confirm(t('deleteConfirm'))) {
      onDelete(note.id);
    }
  }, [note.id, onDelete, t]);

  const saveLabel = saveStatusLabel(saveState, t);

  return (
    <section className="note-editor-pane" aria-label={t('title')}>
      <header className="note-editor-pane__head">
        <input
          type="text"
          className="note-editor-pane__title"
          value={draft.title}
          onChange={handleTitleChange}
          placeholder={t('titlePlaceholder')}
          aria-label={t('titlePlaceholder')}
          spellCheck="false"
          autoComplete="off"
        />
        <div className="note-editor-pane__actions">
          <span
            className="note-editor-pane__status"
            data-state={saveState}
            role="status"
            aria-live="polite"
          >
            {saveLabel}
          </span>
          <button
            type="button"
            className="note-editor-pane__btn"
            onClick={handleTogglePin}
            aria-pressed={note.pinned}
            title={note.pinned ? t('unpin') : t('pin')}
          >
            {note.pinned ? '★' : '☆'}
          </button>
          <button
            type="button"
            className="note-editor-pane__btn note-editor-pane__btn--danger"
            onClick={handleDelete}
            title={t('delete')}
            aria-label={t('delete')}
          >
            ⌫
          </button>
        </div>
      </header>

      <div className="note-editor-pane__body">
        <Suspense fallback={<div className="note-editor-pane__loading">{t('loading')}</div>}>
          <NoteEditor
            value={draft.content}
            onChange={handleContentChange}
            placeholder={t('writePlaceholder')}
          />
        </Suspense>
      </div>
    </section>
  );
}

function saveStatusLabel(state: SaveState, t: (key: string) => string): string {
  switch (state) {
    case 'saving':
      return t('saveStatus.saving');
    case 'saved':
      return t('saveStatus.saved');
    case 'error':
      return t('saveStatus.error');
    case 'idle':
    default:
      return t('saveStatus.idle');
  }
}
