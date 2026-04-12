import { create } from 'zustand';
import { SearchResult } from '../shared/types/common.types';

export type ActiveView =
  | { type: 'search' }
  | { type: 'clipboard' }
  | { type: 'emoji'; initialQuery?: string }
  | { type: 'files' }
  | { type: 'calculator' }
  | { type: 'games' }
  | { type: 'changelog' };

export interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  result: SearchResult | null;
}

interface UiState {
  activeView: ActiveView;
  contextMenu: ContextMenuState;
  isPropertiesOpen: boolean;
  propertiesResult: SearchResult | null;
  isHelpOpen: boolean;
}

interface UiActions {
  setActiveView: (view: ActiveView) => void;
  openContextMenu: (position: { x: number; y: number }, result: SearchResult) => void;
  closeContextMenu: () => void;
  openProperties: (result: SearchResult) => void;
  closeProperties: () => void;
  toggleHelp: () => void;
}

export const useUiStore = create<UiState & UiActions>()((set) => ({
  activeView: { type: 'search' } as ActiveView,
  contextMenu: { isOpen: false, position: { x: 0, y: 0 }, result: null },
  isPropertiesOpen: false,
  propertiesResult: null,
  isHelpOpen: false,

  setActiveView: (view) => set({ activeView: view }),
  openContextMenu: (position, result) =>
    set({ contextMenu: { isOpen: true, position, result } }),
  closeContextMenu: () =>
    set({ contextMenu: { isOpen: false, position: { x: 0, y: 0 }, result: null } }),
  openProperties: (result) => set({ isPropertiesOpen: true, propertiesResult: result }),
  closeProperties: () => set({ isPropertiesOpen: false }),
  toggleHelp: () => set((state) => ({ isHelpOpen: !state.isHelpOpen })),
}));
