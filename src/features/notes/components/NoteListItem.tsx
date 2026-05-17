import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Note } from '../types/notes.types';

/**
 * Strip markdown syntax for the preview snippet. We keep this naive on purpose
 * — full markdown parsing is overkill for a 1-line preview, and we never
 * render this as HTML (it goes through React text nodes).
 */
function previewOf(content: string, max = 80): string {
  const cleaned = content
    .replace(/^#{1,6}\s+/gm, '') // strip leading heading hashes
    .replace(/[*_`~]+/g, '') // strip bold/italic/code/strike markers
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](link) -> text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // ![alt](img) -> drop
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function formatRelative(ts: number, now: number, locale: string): string {
  const diff = Math.max(0, now - ts);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (diff < minute) return locale.startsWith('fr') ? "à l'instant" : 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < week) return `${Math.floor(diff / day)}d`;

  return new Date(ts).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export interface NoteListItemProps {
  note: Note;
  selected: boolean;
  /** Stable timestamp injected by the parent — never `Date.now()` in render. */
  now: number;
  onSelect: (id: string) => void;
}

function NoteListItemImpl({ note, selected, now, onSelect }: NoteListItemProps): React.JSX.Element {
  const { i18n, t } = useTranslation('notes');
  const title = note.title.trim() || t('untitled');
  const preview = previewOf(note.content);
  const relative = formatRelative(note.updatedAt, now, i18n.language || 'en');

  const handleClick = useCallback((): void => {
    onSelect(note.id);
  }, [note.id, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(note.id);
      }
    },
    [note.id, onSelect],
  );

  return (
    <button
      type="button"
      className="notes-list-item"
      data-selected={selected ? 'true' : 'false'}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="notes-list-item__row">
        <span className="notes-list-item__title">{title}</span>
        {note.pinned && (
          <span className="notes-list-item__pin" aria-label={t('pinned')}>
            ★
          </span>
        )}
      </div>
      {preview && <div className="notes-list-item__preview">{preview}</div>}
      <div className="notes-list-item__meta">
        <time className="notes-list-item__time" dateTime={new Date(note.updatedAt).toISOString()}>
          {relative}
        </time>
        {note.tags.length > 0 && (
          <span className="notes-list-item__tags">
            {note.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="notes-list-item__tag">
                #{tag}
              </span>
            ))}
          </span>
        )}
      </div>
    </button>
  );
}

export const NoteListItem = memo(NoteListItemImpl);
