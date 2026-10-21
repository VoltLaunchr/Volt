import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSearchStore } from '../../stores/searchStore';
import { useGlobalHotkey } from './useGlobalHotkey';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function createOptions() {
  return {
    closeOnLaunch: true,
    hideWindow: vi.fn(() => Promise.resolve()),
    onLaunch: vi.fn(),
    onActivateSuggestion: vi.fn(),
    onShowProperties: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenCalculator: vi.fn(),
    onOpenHelp: vi.fn(),
    onTogglePreview: vi.fn(),
    onOpenActionsMenu: vi.fn(),
  };
}

function createKeyboardEvent(key: string) {
  const preventDefault = vi.fn();
  const event = {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: key === '?',
    preventDefault,
  } as unknown as React.KeyboardEvent<HTMLInputElement>;
  return { event, preventDefault };
}

describe('useGlobalHotkey', () => {
  beforeEach(() => {
    useSearchStore.setState({
      searchQuery: '',
      results: [],
      selectedIndex: 0,
      searchError: null,
      showSnowEffect: false,
      isSearching: false,
    });
  });

  it('leaves printable question-mark prefixes to the search and plugin pipeline', () => {
    const options = createOptions();
    const { result } = renderHook(() => useGlobalHotkey(options));
    const { event, preventDefault } = createKeyboardEvent('?');

    act(() => result.current.handleKeyDown(event));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(options.onOpenHelp).not.toHaveBeenCalled();
  });

  it('keeps F1 as the dedicated help shortcut', () => {
    const options = createOptions();
    const { result } = renderHook(() => useGlobalHotkey(options));
    const { event, preventDefault } = createKeyboardEvent('F1');

    act(() => result.current.handleKeyDown(event));

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(options.onOpenHelp).toHaveBeenCalledOnce();
  });
});
