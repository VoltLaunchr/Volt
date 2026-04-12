/**
 * Window types for the window feature
 */

// Re-export position types from settings
export type { CustomPosition, WindowPosition } from '../../settings/types/settings.types';

/**
 * Window visibility and focus state
 */
export interface WindowState {
  /** Whether the window is currently visible */
  isVisible: boolean;
  /** Whether the window is currently focused */
  isFocused: boolean;
  /** Current window position setting */
  position: import('../../settings/types/settings.types').WindowPosition;
  /** Custom coordinates if position is 'custom' */
  customPosition?: import('../../settings/types/settings.types').CustomPosition;
}

/**
 * Window dimensions
 */
export interface WindowDimensions {
  /** Window width in pixels */
  width: number;
  /** Window height in pixels */
  height: number;
}

/**
 * Screen information for positioning calculations
 */
export interface ScreenInfo {
  /** Screen width in pixels */
  width: number;
  /** Screen height in pixels */
  height: number;
  /** Available width (excluding taskbar, etc.) */
  availableWidth: number;
  /** Available height (excluding taskbar, etc.) */
  availableHeight: number;
  /** Scale factor (DPI) */
  scaleFactor: number;
}

/**
 * Coordinates for window positioning
 */
export interface WindowCoordinates {
  x: number;
  y: number;
}

/**
 * Props for drag region component
 */
export interface DragRegionProps {
  /** Additional CSS classes */
  className?: string;
  /** Children to render inside drag region */
  children?: React.ReactNode;
  /** Whether dragging is enabled */
  enabled?: boolean;
}

/**
 * Window event types
 */
export type WindowEventType = 'show' | 'hide' | 'focus' | 'blur' | 'move' | 'resize' | 'close';

/**
 * Window event payload
 */
export interface WindowEvent {
  type: WindowEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * Initial window state
 */
export const INITIAL_WINDOW_STATE: WindowState = {
  isVisible: true,
  isFocused: true,
  position: 'center',
  customPosition: undefined,
};
