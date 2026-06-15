import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { Editor, Range } from '@tiptap/core';
import {
  CalendarDays,
  Clock3,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  type LucideIcon,
} from 'lucide-react';
import './SlashCommandMenu.css';
import type { SlashCommandItem } from '../extensions/slashCommand';

const COMMAND_ICONS: Record<string, LucideIcon> = {
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  ordered: ListOrdered,
  task: ListChecks,
  code: Code2,
  quote: Quote,
  divider: Minus,
  date: CalendarDays,
  time: Clock3,
};

/**
 * SlashCommandMenu — React component for the "/" popover. Driven by TipTap's
 * Suggestion plugin: the parent (`slashSuggestionRenderer`) feeds it `items`,
 * `query`, `command`, `range`, and the editor instance, and proxies keyboard
 * events through the imperative `onKeyDown` handle.
 */

export interface SlashCommandMenuProps {
  items: SlashCommandItem[];
  /** Called by the Suggestion plugin when the user picks an item. */
  command: (item: SlashCommandItem) => void;
  /** Provided by the Suggestion plugin; we don't read it but it's part of the contract. */
  editor: Editor;
  range: Range;
  query: string;
}

export interface SlashCommandMenuHandle {
  /**
   * Return `true` if the event was consumed (TipTap will stop propagation).
   * `false` lets the keystroke flow through to ProseMirror.
   */
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(
  function SlashCommandMenu({ items, command }, ref): React.JSX.Element {
    const [selected, setSelected] = useState<number>(0);

    // Clamp selection when items shrink (e.g., query becomes more specific).
    useEffect(() => {
      if (selected >= items.length) {
        setSelected(items.length === 0 ? 0 : items.length - 1);
      }
    }, [items.length, selected]);

    // Reset selection to top each time the list identity changes — TipTap
    // recreates the items array per query so length OR contents may shift.
    useEffect(() => {
      setSelected(0);
    }, [items]);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown({ event }) {
          if (items.length === 0) return false;
          if (event.key === 'ArrowUp') {
            setSelected((i) => (i - 1 + items.length) % items.length);
            return true;
          }
          if (event.key === 'ArrowDown') {
            setSelected((i) => (i + 1) % items.length);
            return true;
          }
          if (event.key === 'Tab') {
            setSelected((i) => (i + 1) % items.length);
            return true;
          }
          if (event.key === 'Enter') {
            const item = items[selected];
            if (item) command(item);
            return true;
          }
          return false;
        },
      }),
      [items, selected, command]
    );

    if (items.length === 0) {
      return <div className="slash-menu slash-menu--empty">No commands</div>;
    }

    return (
      <div className="slash-menu" role="listbox" aria-label="Slash commands">
        {items.map((item, idx) => {
          const CommandIcon = COMMAND_ICONS[item.id] ?? Code2;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={idx === selected}
              className="slash-menu__item"
              data-selected={idx === selected ? 'true' : 'false'}
              onMouseEnter={() => {
                setSelected(idx);
              }}
              onMouseDown={(e) => {
                // Prevent the editor from losing focus before the command runs.
                e.preventDefault();
                command(item);
              }}
            >
              <span className="slash-menu__icon" aria-hidden="true">
                <CommandIcon size={16} />
              </span>
              <span className="slash-menu__text">
                <span className="slash-menu__title">{item.title}</span>
                <span className="slash-menu__desc">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }
);
