/**
 * SlashCommand — TipTap v3 extension powering the "/" command palette.
 *
 * Built on `@tiptap/suggestion`. The popover UI and keyboard handling live in
 * `SlashCommandMenu.tsx`; this module declares the static command catalog and
 * wires the Suggestion plugin into the editor.
 */

import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';

export interface SlashCommandItem {
  id: string;
  title: string;
  description: string;
  /** Single-character or short text glyph rendered in the menu. */
  icon: string;
  /** Lowercase substrings the user can type after `/` to match this item. */
  aliases: string[];
  /** Mutation to apply against the editor. The range covers `/query`. */
  command: (editor: Editor, range: Range) => void;
}

/**
 * The catalog. Order here is the default display order when the user types
 * just `/` with no filter.
 */
export const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    aliases: ['h1', 'heading', 'title'],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H2',
    aliases: ['h2', 'subheading'],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading',
    icon: 'H3',
    aliases: ['h3'],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bullet',
    title: 'Bullet list',
    description: 'Unordered list of items',
    icon: '•',
    aliases: ['ul', 'bullet', 'list'],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    title: 'Numbered list',
    description: 'Ordered list of items',
    icon: '1.',
    aliases: ['ol', 'numbered', 'ordered'],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'task',
    title: 'Task list',
    description: 'Checklist with checkboxes',
    icon: '☐',
    aliases: ['todo', 'task', 'checkbox', 'check'],
    command: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'code',
    title: 'Code block',
    description: 'Syntax-highlighted code',
    icon: '</>',
    aliases: ['code', 'pre', 'codeblock'],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('codeBlock').run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Blockquote',
    icon: '"',
    aliases: ['quote', 'blockquote'],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Horizontal rule',
    icon: '—',
    aliases: ['divider', 'hr', 'rule', 'separator'],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: 'date',
    title: 'Date',
    description: 'Insert today’s date (YYYY-MM-DD)',
    icon: '📅',
    aliases: ['date', 'today'],
    command: (editor, range) => {
      const text = formatDateToday();
      editor.chain().focus().deleteRange(range).insertContent(text).run();
    },
  },
  {
    id: 'time',
    title: 'Time',
    description: 'Insert the current time (HH:MM)',
    icon: '🕒',
    aliases: ['time', 'now'],
    command: (editor, range) => {
      const text = formatTimeNow();
      editor.chain().focus().deleteRange(range).insertContent(text).run();
    },
  },
] as const;

/** Match items by aliases or title (case-insensitive substring). */
export function filterSlashCommands(query: string, max = 8): SlashCommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SLASH_COMMANDS].slice(0, max);
  return SLASH_COMMANDS.filter((item) => {
    if (item.aliases.some((a) => a.startsWith(q))) return true;
    if (item.title.toLowerCase().includes(q)) return true;
    return false;
  }).slice(0, max);
}

export type SlashSuggestionOptions = Partial<Omit<SuggestionOptions<SlashCommandItem>, 'editor'>>;

/**
 * Options object held by the Extension. Typed explicitly so `this.options`
 * inside `addProseMirrorPlugins` isn't `any` (which trips ESLint's
 * no-unsafe-* rules).
 */
interface SlashCommandExtensionOptions {
  suggestion: SlashSuggestionOptions;
}

/**
 * Build the TipTap Extension. Pass a `suggestion.render` factory from the
 * React layer so the popover renders with `ReactRenderer` (kept out of this
 * file to avoid pulling React into a "pure extension" module if it ever gets
 * reused server-side).
 */
export function createSlashCommandExtension(
  options: SlashSuggestionOptions,
): Extension<SlashCommandExtensionOptions> {
  return Extension.create<SlashCommandExtensionOptions>({
    name: 'slashCommand',

    addOptions() {
      // The Suggestion plugin injects `editor` itself at addProseMirrorPlugins
      // time, so the options object stored here is intentionally a partial of
      // SuggestionOptions (no `editor` field). We assert on the full type at
      // the call site below to keep callers honest.
      return {
        suggestion: {
          char: '/',
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }: { query: string }) => filterSlashCommands(query),
          command: ({
            editor,
            range,
            props,
          }: {
            editor: Editor;
            range: Range;
            props: SlashCommandItem;
          }) => {
            props.command(editor, range);
          },
          ...options,
        },
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommandItem>({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });
}

// --- helpers ---

function formatDateToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTimeNow(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
