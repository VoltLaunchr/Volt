import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Typography } from '@tiptap/extension-typography';
import { CharacterCount } from '@tiptap/extension-character-count';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Markdown } from 'tiptap-markdown';
import { common, createLowlight } from 'lowlight';
import { useEffect, useMemo, useRef } from 'react';

import { createSlashCommandExtension } from '../extensions/slashCommand';
import { createSlashSuggestionRenderer } from '../extensions/slashSuggestionRenderer';
import './NoteEditor.css';

// `debounce` from ../utils/debounce is intentionally NOT used here. The util
// exists for sibling features and tests; inside this component we hand-roll
// the timer because the closure has to read the latest `onChange` without
// passing a ref to `debounce` (react-hooks/refs forbids that pattern).

/**
 * NoteEditor — TipTap v3 WYSIWYG markdown editor for Volt Notes.
 *
 * Why TipTap v3?
 * - Latest stable line (3.23.x) and tiptap-markdown@0.9 requires `@tiptap/core ^3.0.1`.
 * - In v3, Placeholder/CharacterCount technically live in `@tiptap/extensions`, but
 *   the standalone packages (`@tiptap/extension-placeholder`, etc.) are kept as
 *   thin re-exports for back-compat — we use those to match the task spec.
 *
 * Security notes:
 * - `Markdown` runs with `html: false` so raw HTML in the markdown source is
 *   serialized as text, preventing XSS via pasted/saved content.
 * - `Link.isAllowedUri` enforces an allowlist of protocols (http/https/mailto/volt).
 *   In v3 the v2-era `validate` option was renamed `isAllowedUri`.
 * - `Image.allowBase64` is on for paste-friendliness; if you persist these notes to
 *   a remote backend, consider stripping base64 before save.
 *
 * Lazy-loading:
 * - This component is intentionally heavy (~250 KB gzipped). It must be reached via
 *   `React.lazy(() => import('@/features/notes/components/NoteEditor'))` from the
 *   notes window, never from the main launcher entry. The module-level
 *   `createLowlight(common)` call only fires on dynamic import.
 */
const lowlight = createLowlight(common);

const ALLOWED_LINK_PROTOCOLS = ['http', 'https', 'mailto', 'volt'] as const;

/**
 * v3 `isAllowedUri` callback. The default validator handles edge cases like
 * relative URLs; we add a strict protocol allowlist on top.
 */
interface IsAllowedUriContext {
  defaultValidate: (url: string) => boolean;
  protocols: Array<string | { scheme: string; optionalSlashes?: boolean }>;
  defaultProtocol: string;
}

function isAllowedLinkUri(url: string, ctx: IsAllowedUriContext): boolean {
  if (!ctx.defaultValidate(url)) return false;
  try {
    const parsed = new URL(url);
    const scheme = parsed.protocol.replace(/:$/, '');
    return (ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(scheme);
  } catch {
    // Fragment-only or otherwise unparseable hrefs — reject defensively.
    return false;
  }
}

export interface NoteEditorProps {
  /** Markdown content. */
  value: string;
  /** Called debounced (300ms) with the latest markdown. */
  onChange: (markdown: string) => void;
  placeholder?: string;
  autofocus?: boolean;
  readOnly?: boolean;
}

interface MarkdownStorageShape {
  getMarkdown: () => string;
}

interface CharacterCountStorageShape {
  characters: () => number;
  words: () => number;
}

/**
 * TipTap's `Storage` is a declaration-mergeable empty interface — extensions
 * can extend it to register their own storage shapes, but the base type has no
 * index signature. We treat it as an opaque dictionary so we can probe for the
 * storage entries we registered via the extension list above. This is safer
 * than `as any` because the cast is contained to a single, well-named accessor.
 */
function readStorageEntry<T>(editor: Editor, key: string): T | undefined {
  const bag = editor.storage as unknown as Record<string, T | undefined>;
  return bag[key];
}

function getMarkdownFromEditor(editor: Editor | null): string {
  if (!editor || editor.isDestroyed) return '';
  const md = readStorageEntry<MarkdownStorageShape>(editor, 'markdown');
  return md?.getMarkdown() ?? '';
}

function getCharacterCount(editor: Editor | null): number {
  if (!editor || editor.isDestroyed) return 0;
  const cc = readStorageEntry<CharacterCountStorageShape>(editor, 'characterCount');
  return cc?.characters() ?? 0;
}

export function NoteEditor({
  value,
  onChange,
  placeholder,
  autofocus,
  readOnly,
}: NoteEditorProps): React.JSX.Element {
  // Single shared timer. We rebuild the debounced emitter whenever `onChange`
  // changes so the closure always captures the latest prop directly — no ref
  // read inside the deferred callback (which would trip react-hooks/refs).
  // Cleanup runs both on prop change and unmount, so trailing edits are not
  // dropped on parent re-render either.
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const debouncedEmit = useMemo(() => {
    return (md: string): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        onChange(md);
      }, 300);
    };
  }, [onChange]);

  // Cancel any pending emit when `onChange` swaps or the component unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [debouncedEmit]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Replaced by CodeBlockLowlight for syntax highlighting.
        codeBlock: false,
        // Override the bundled Link to apply our protocol allowlist.
        link: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto', { scheme: 'volt', optionalSlashes: true }],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        isAllowedUri: isAllowedLinkUri,
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Start writing…',
      }),
      Typography,
      CharacterCount.configure({ limit: 1_000_000 }),
      CodeBlockLowlight.configure({ lowlight }),
      Markdown.configure({
        html: false, // CRITICAL: drop raw HTML on parse (XSS hardening).
        tightLists: true,
        bulletListMarker: '-',
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      createSlashCommandExtension({ render: createSlashSuggestionRenderer() }),
    ],
    content: value,
    autofocus: autofocus ? 'end' : false,
    editable: !readOnly,
    onUpdate: ({ editor: instance }) => {
      const md = getMarkdownFromEditor(instance);
      debouncedEmit(md);
    },
  });

  // Sync external `value` changes (e.g. loading a different note) into the editor
  // without echoing back through onChange. v3 setContent options object replaces
  // the v2 boolean second argument.
  //
  // CRITICAL: `editor.commands` becomes `null` after the editor is destroyed.
  // React StrictMode double-invokes effects on mount, so an effect may run on
  // an editor instance that has just been torn down. Guard with `isDestroyed`
  // (and don't call `destroy()` manually — `useEditor()` owns that lifecycle).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = getMarkdownFromEditor(editor);
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  // Toggle editability when the prop changes (initial value already wired above).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isEditable === !readOnly) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Character count is intentionally read inside render via the storage helper;
  // it's a pure read on a stable getter (no Date.now / Math.random / ref.current
  // — react-hooks/purity safe).
  const characterCount = getCharacterCount(editor);

  return (
    <div className="note-editor" data-readonly={readOnly ? 'true' : 'false'}>
      <EditorContent editor={editor} className="note-editor__content" />
      <div className="note-editor__footer" aria-live="polite">
        {characterCount.toLocaleString()} characters
      </div>
    </div>
  );
}
