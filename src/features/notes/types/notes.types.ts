/**
 * TypeScript types mirroring the Rust `Note` / `NoteHit` structs in
 * `src-tauri/src/commands/notes.rs`. The Rust side uses
 * `#[serde(rename_all = "camelCase")]` so we match field names exactly.
 */

export interface Note {
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
  /** `null` for active notes, millis since epoch when soft-deleted. */
  deletedAt: number | null;
}

export interface NoteHit {
  note: Note;
  /** Higher = more relevant. Backend negates the FTS5 bm25 rank for us. */
  score: number;
  /** HTML-marked excerpt with `<mark>…</mark>` around match spans. */
  snippet: string;
}

/** Partial patch payload accepted by `update_note`. */
export interface NotePatch {
  title?: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
  color?: string;
}

/** Save state for a single note in the editor. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
