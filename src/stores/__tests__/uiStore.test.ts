import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState());
  });

  it('has correct initial state', () => {
    const state = useUiStore.getState();
    expect(state.activeView).toEqual({ type: 'search' });
    expect(state.contextMenu.isOpen).toBe(false);
    expect(state.isPropertiesOpen).toBe(false);
    expect(state.propertiesResult).toBeNull();
    expect(state.isHelpOpen).toBe(false);
  });

  it('setActiveView updates view', () => {
    useUiStore.getState().setActiveView({ type: 'calculator' });
    expect(useUiStore.getState().activeView).toEqual({ type: 'calculator' });
  });

  it('openContextMenu sets position and result', () => {
    const result = { id: '1', type: 0, title: 'Test', subtitle: '', icon: '', score: 100, data: {} } as any;
    useUiStore.getState().openContextMenu({ x: 10, y: 20 }, result);
    const state = useUiStore.getState();
    expect(state.contextMenu.isOpen).toBe(true);
    expect(state.contextMenu.position).toEqual({ x: 10, y: 20 });
  });

  it('closeContextMenu resets context menu', () => {
    useUiStore.getState().openContextMenu({ x: 10, y: 20 }, {} as any);
    useUiStore.getState().closeContextMenu();
    expect(useUiStore.getState().contextMenu.isOpen).toBe(false);
  });

  it('openProperties sets result and flag', () => {
    const result = { id: '1', type: 0, title: 'Test', subtitle: '', icon: '', score: 100, data: {} } as any;
    useUiStore.getState().openProperties(result);
    expect(useUiStore.getState().isPropertiesOpen).toBe(true);
    expect(useUiStore.getState().propertiesResult).toBe(result);
  });

  it('closeProperties resets flag', () => {
    useUiStore.getState().openProperties({} as any);
    useUiStore.getState().closeProperties();
    expect(useUiStore.getState().isPropertiesOpen).toBe(false);
  });

  it('toggleHelp flips isHelpOpen', () => {
    expect(useUiStore.getState().isHelpOpen).toBe(false);
    useUiStore.getState().toggleHelp();
    expect(useUiStore.getState().isHelpOpen).toBe(true);
    useUiStore.getState().toggleHelp();
    expect(useUiStore.getState().isHelpOpen).toBe(false);
  });
});
