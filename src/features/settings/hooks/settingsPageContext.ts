import { createContext } from 'react';

/** Page currently rendered in the content area; `SettingsBody` keys its scroll memory on it. */
export const SettingsPageContext = createContext<string | null>(null);

/** Last scroll offset per page, kept for the lifetime of the window (never persisted). */
const scrollMemory = new Map<string, number>();

export function rememberSettingsScroll(pageId: string, offset: number): void {
  scrollMemory.set(pageId, offset);
}

export function recallSettingsScroll(pageId: string): number {
  return scrollMemory.get(pageId) ?? 0;
}
