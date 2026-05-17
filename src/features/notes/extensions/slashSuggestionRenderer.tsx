/**
 * slashSuggestionRenderer — glue between TipTap's Suggestion plugin and our
 * React-rendered `SlashCommandMenu`. The plugin calls `render()` once per
 * suggestion session, getting back an object with `onStart` / `onUpdate` /
 * `onKeyDown` / `onExit` handlers. We use `ReactRenderer` to mount the menu
 * into a DOM node and tippy.js to position it next to the caret.
 *
 * Lives in `.tsx` because `ReactRenderer` needs JSX. Kept separate from the
 * TipTap `Extension` declaration so the extension itself stays framework-free.
 */

import { ReactRenderer } from '@tiptap/react';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance, type GetReferenceClientRect } from 'tippy.js';
import {
  SlashCommandMenu,
  type SlashCommandMenuHandle,
  type SlashCommandMenuProps,
} from '../components/SlashCommandMenu';
import type { SlashCommandItem } from './slashCommand';

export interface SlashRenderHandlers {
  onStart: (props: SuggestionProps<SlashCommandItem>) => void;
  onUpdate: (props: SuggestionProps<SlashCommandItem>) => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  onExit: () => void;
}

export function createSlashSuggestionRenderer(): () => SlashRenderHandlers {
  return () => {
    let component: ReactRenderer<SlashCommandMenuHandle, SlashCommandMenuProps> | undefined;
    let popup: TippyInstance | undefined;

    return {
      onStart(props): void {
        component = new ReactRenderer<SlashCommandMenuHandle, SlashCommandMenuProps>(
          SlashCommandMenu,
          {
            props: toMenuProps(props),
            editor: props.editor,
          },
        );
        if (!props.clientRect) return;
        const instances = tippy('body', {
          getReferenceClientRect: props.clientRect as GetReferenceClientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          theme: 'volt-slash',
          arrow: false,
          duration: 0,
          // tippy renders its own padding box; we don't want it on a custom UI
          offset: [0, 6],
        });
        popup = Array.isArray(instances) ? instances[0] : instances;
      },

      onUpdate(props): void {
        component?.updateProps(toMenuProps(props));
        if (!props.clientRect) return;
        popup?.setProps({
          getReferenceClientRect: props.clientRect as GetReferenceClientRect,
        });
      },

      onKeyDown(props): boolean {
        if (props.event.key === 'Escape') {
          popup?.hide();
          return true;
        }
        return component?.ref?.onKeyDown({ event: props.event }) ?? false;
      },

      onExit(): void {
        popup?.destroy();
        component?.destroy();
        popup = undefined;
        component = undefined;
      },
    };
  };
}

function toMenuProps(props: SuggestionProps<SlashCommandItem>): SlashCommandMenuProps {
  return {
    items: props.items,
    command: (item) => {
      props.command(item);
    },
    editor: props.editor,
    range: props.range,
    query: props.query,
  };
}
