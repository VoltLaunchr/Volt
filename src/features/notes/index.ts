// NOTE: `NoteEditor` is intentionally NOT re-exported here. It is dynamically
// imported by `NoteEditorPane` (Suspense + React.lazy) so it lives in its own
// chunk — re-exporting it from this barrel would pull it back into the eagerly
// loaded entry chunk and defeat code-splitting.
export { NotesView } from './components/NotesView';
export { NotesSidebar } from './components/NotesSidebar';
export { NoteEditorPane } from './components/NoteEditorPane';

export * from './hooks';
export { notesService } from './services/notesService';
export type { Note, NoteHit, NotePatch, SaveState } from './types/notes.types';
