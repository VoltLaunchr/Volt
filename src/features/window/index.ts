/**
 * Window feature barrel export
 * Provides window management functionality for Volt
 */

// Types
export type {
  CustomPosition,
  DragRegionProps,
  ScreenInfo,
  WindowCoordinates,
  WindowDimensions,
  WindowEvent,
  WindowEventType,
  WindowPosition,
  WindowState,
} from './types';
export { INITIAL_WINDOW_STATE } from './types';

// Services
export { windowService } from './services/windowService';

// Hooks
export { useWindowState } from './hooks';
export type { UseWindowStateReturn } from './hooks';

// Utils
export {
  calculateCenterPosition,
  calculateDistance,
  clampToScreen,
  DEFAULT_WINDOW_DIMENSIONS,
  getAvailablePositions,
  getEstimatedScreenInfo,
  getPositionDisplayName,
  isValidPosition,
  positionsEqual,
  positionToCoordinates,
} from './utils/windowHelpers';
