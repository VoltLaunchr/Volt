/**
 * Hook for managing window state
 * Provides window visibility, position, and control functions
 */

import { useCallback, useEffect, useState } from 'react';
import { windowService } from '../services/windowService';
import { logger } from '../../../shared/utils';
import type { CustomPosition, WindowPosition, WindowState } from '../types';
import { INITIAL_WINDOW_STATE } from '../types';

export interface UseWindowStateReturn {
  /** Current window state */
  state: WindowState;
  /** Whether the window is visible */
  isVisible: boolean;
  /** Whether the window is focused */
  isFocused: boolean;
  /** Current window position */
  position: WindowPosition;
  /** Show the window */
  show: () => Promise<void>;
  /** Hide the window */
  hide: () => Promise<void>;
  /** Toggle window visibility */
  toggle: () => Promise<void>;
  /** Center the window */
  center: () => Promise<void>;
  /** Set window position */
  setPosition: (position: WindowPosition, customX?: number, customY?: number) => Promise<void>;
  /** Start dragging the window */
  startDragging: () => Promise<void>;
  /** Refresh window state from system */
  refreshState: () => Promise<void>;
}

/**
 * Hook for managing window state and controls
 * Tracks visibility, focus, and position of the application window
 *
 * @returns Window state and control functions
 *
 * @example
 * ```tsx
 * const { isVisible, show, hide, toggle, startDragging } = useWindowState();
 *
 * return (
 *   <div onMouseDown={startDragging}>
 *     <button onClick={toggle}>
 *       {isVisible ? 'Hide' : 'Show'} Window
 *     </button>
 *   </div>
 * );
 * ```
 */
export function useWindowState(): UseWindowStateReturn {
  const [state, setState] = useState<WindowState>(INITIAL_WINDOW_STATE);

  const refreshState = useCallback(async () => {
    try {
      const [isVisible, isFocused, positionData] = await Promise.all([
        windowService.isVisible(),
        windowService.isFocused(),
        windowService.getPosition(),
      ]);

      setState({
        isVisible,
        isFocused,
        position: positionData.position,
        customPosition: positionData.customPosition,
      });
    } catch (error) {
      logger.error('Failed to refresh window state:', error);
    }
  }, []);

  const show = useCallback(async () => {
    await windowService.show();
    setState((prev) => ({ ...prev, isVisible: true, isFocused: true }));
  }, []);

  const hide = useCallback(async () => {
    await windowService.hide();
    setState((prev) => ({ ...prev, isVisible: false, isFocused: false }));
  }, []);

  const toggle = useCallback(async () => {
    await windowService.toggle();
    setState((prev) => ({
      ...prev,
      isVisible: !prev.isVisible,
      isFocused: !prev.isVisible, // If showing, also focus
    }));
  }, []);

  const center = useCallback(async () => {
    await windowService.center();
    setState((prev) => ({
      ...prev,
      position: 'center' as WindowPosition,
      customPosition: undefined,
    }));
  }, []);

  const setPosition = useCallback(
    async (position: WindowPosition, customX?: number, customY?: number) => {
      await windowService.setPosition(position, customX, customY);

      const customPosition: CustomPosition | undefined =
        position === 'custom' && customX !== undefined && customY !== undefined
          ? { x: customX, y: customY }
          : undefined;

      setState((prev) => ({
        ...prev,
        position,
        customPosition,
      }));
    },
    []
  );

  const startDragging = useCallback(async () => {
    await windowService.startDragging();
  }, []);

  // Load initial state on mount
  useEffect(() => {
    refreshState();
  }, [refreshState]);

  return {
    state,
    isVisible: state.isVisible,
    isFocused: state.isFocused,
    position: state.position,
    show,
    hide,
    toggle,
    center,
    setPosition,
    startDragging,
    refreshState,
  };
}

export default useWindowState;
