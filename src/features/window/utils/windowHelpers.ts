/**
 * Utility functions for window management
 */

import type { WindowCoordinates, WindowDimensions, WindowPosition, ScreenInfo } from '../types';

/**
 * Default window dimensions for Volt
 */
export const DEFAULT_WINDOW_DIMENSIONS: WindowDimensions = {
  width: 600,
  height: 400,
};

/**
 * Calculate center position for a window on screen
 * @param screen - Screen dimensions
 * @param window - Window dimensions
 * @returns Coordinates for centered position
 */
export function calculateCenterPosition(
  screen: ScreenInfo,
  window: WindowDimensions = DEFAULT_WINDOW_DIMENSIONS
): WindowCoordinates {
  return {
    x: Math.round((screen.width - window.width) / 2),
    y: Math.round((screen.height - window.height) / 2),
  };
}

/**
 * Convert a position preset to screen coordinates
 * @param position - Position preset
 * @param screen - Screen information
 * @param window - Window dimensions
 * @param padding - Padding from screen edges (default: 20)
 * @returns Coordinates for the position
 */
export function positionToCoordinates(
  position: WindowPosition,
  screen: ScreenInfo,
  window: WindowDimensions = DEFAULT_WINDOW_DIMENSIONS,
  padding = 20
): WindowCoordinates {
  const maxX = screen.availableWidth - window.width - padding;
  const maxY = screen.availableHeight - window.height - padding;
  const centerX = Math.round((screen.availableWidth - window.width) / 2);
  const centerY = Math.round((screen.availableHeight - window.height) / 2);

  const positions: Record<WindowPosition, WindowCoordinates> = {
    center: { x: centerX, y: centerY },
    topLeft: { x: padding, y: padding },
    topCenter: { x: centerX, y: padding },
    topRight: { x: maxX, y: padding },
    bottomLeft: { x: padding, y: maxY },
    bottomCenter: { x: centerX, y: maxY },
    bottomRight: { x: maxX, y: maxY },
    leftCenter: { x: padding, y: centerY },
    rightCenter: { x: maxX, y: centerY },
    custom: { x: 0, y: 0 }, // Custom position uses provided coordinates
  };

  return positions[position] || positions.center;
}

/**
 * Check if a position preset is valid
 * @param position - Position to check
 * @returns Whether the position is valid
 */
export function isValidPosition(position: string): position is WindowPosition {
  const validPositions: WindowPosition[] = [
    'center',
    'topLeft',
    'topCenter',
    'topRight',
    'bottomLeft',
    'bottomCenter',
    'bottomRight',
    'leftCenter',
    'rightCenter',
    'custom',
  ];

  return validPositions.includes(position as WindowPosition);
}

/**
 * Ensure coordinates are within screen bounds
 * @param coords - Coordinates to clamp
 * @param screen - Screen information
 * @param window - Window dimensions
 * @param padding - Minimum padding from edges
 * @returns Clamped coordinates
 */
export function clampToScreen(
  coords: WindowCoordinates,
  screen: ScreenInfo,
  window: WindowDimensions = DEFAULT_WINDOW_DIMENSIONS,
  padding = 0
): WindowCoordinates {
  const maxX = screen.availableWidth - window.width - padding;
  const maxY = screen.availableHeight - window.height - padding;

  return {
    x: Math.max(padding, Math.min(coords.x, maxX)),
    y: Math.max(padding, Math.min(coords.y, maxY)),
  };
}

/**
 * Get a human-readable name for a position preset
 * @param position - Window position
 * @returns Human-readable position name
 */
export function getPositionDisplayName(position: WindowPosition): string {
  const names: Record<WindowPosition, string> = {
    center: 'Center',
    topLeft: 'Top Left',
    topCenter: 'Top Center',
    topRight: 'Top Right',
    bottomLeft: 'Bottom Left',
    bottomCenter: 'Bottom Center',
    bottomRight: 'Bottom Right',
    leftCenter: 'Left Center',
    rightCenter: 'Right Center',
    custom: 'Custom',
  };

  return names[position] || 'Center';
}

/**
 * Get all available position presets
 * @returns Array of position presets with display names
 */
export function getAvailablePositions(): Array<{ value: WindowPosition; label: string }> {
  const positions: WindowPosition[] = [
    'center',
    'topLeft',
    'topCenter',
    'topRight',
    'leftCenter',
    'rightCenter',
    'bottomLeft',
    'bottomCenter',
    'bottomRight',
    'custom',
  ];

  return positions.map((pos) => ({
    value: pos,
    label: getPositionDisplayName(pos),
  }));
}

/**
 * Calculate the distance between two positions
 * @param a - First position
 * @param b - Second position
 * @returns Distance in pixels
 */
export function calculateDistance(a: WindowCoordinates, b: WindowCoordinates): number {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

/**
 * Check if two positions are approximately equal (within threshold)
 * @param a - First position
 * @param b - Second position
 * @param threshold - Distance threshold (default: 5)
 * @returns Whether positions are approximately equal
 */
export function positionsEqual(a: WindowCoordinates, b: WindowCoordinates, threshold = 5): boolean {
  return calculateDistance(a, b) <= threshold;
}

/**
 * Get estimated screen info (fallback when Tauri API not available)
 * @returns Estimated screen information
 */
export function getEstimatedScreenInfo(): ScreenInfo {
  if (typeof window !== 'undefined') {
    return {
      width: window.screen.width,
      height: window.screen.height,
      availableWidth: window.screen.availWidth,
      availableHeight: window.screen.availHeight,
      scaleFactor: window.devicePixelRatio || 1,
    };
  }

  // Default fallback
  return {
    width: 1920,
    height: 1080,
    availableWidth: 1920,
    availableHeight: 1040,
    scaleFactor: 1,
  };
}
