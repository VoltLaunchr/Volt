/**
 * Window service for interacting with the Tauri window API
 * Provides methods for controlling window visibility, position, and behavior
 */

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { logger } from '../../../shared/utils';
import type { CustomPosition, WindowPosition } from '../types';

/**
 * Service for managing the application window
 */
export const windowService = {
  /**
   * Show the main window and bring it to focus
   */
  async show(): Promise<void> {
    try {
      await invoke('show_window');
    } catch (error) {
      logger.error('Failed to show window:', error);
      throw new Error(`Failed to show window: ${error}`);
    }
  },

  /**
   * Hide the main window
   */
  async hide(): Promise<void> {
    try {
      await invoke('hide_window');
    } catch (error) {
      logger.error('Failed to hide window:', error);
      throw new Error(`Failed to hide window: ${error}`);
    }
  },

  /**
   * Toggle window visibility (show if hidden, hide if visible)
   */
  async toggle(): Promise<void> {
    try {
      await invoke('toggle_window');
    } catch (error) {
      logger.error('Failed to toggle window:', error);
      throw new Error(`Failed to toggle window: ${error}`);
    }
  },

  /**
   * Center the window on the screen
   */
  async center(): Promise<void> {
    try {
      await invoke('center_window');
    } catch (error) {
      logger.error('Failed to center window:', error);
      throw new Error(`Failed to center window: ${error}`);
    }
  },

  /**
   * Set the window position
   * @param position - Position preset or 'custom'
   * @param customX - Custom X coordinate (only used if position is 'custom')
   * @param customY - Custom Y coordinate (only used if position is 'custom')
   */
  async setPosition(position: WindowPosition, customX?: number, customY?: number): Promise<void> {
    try {
      await invoke('set_window_position', {
        position,
        customX,
        customY,
      });
    } catch (error) {
      logger.error('Failed to set window position:', error);
      throw new Error(`Failed to set window position: ${error}`);
    }
  },

  /**
   * Get the current window position setting
   * @returns Current position setting
   */
  async getPosition(): Promise<{ position: WindowPosition; customPosition?: CustomPosition }> {
    try {
      const result = await invoke<{ position: WindowPosition; customPosition?: CustomPosition }>(
        'get_window_position'
      );
      return result;
    } catch (error) {
      logger.error('Failed to get window position:', error);
      return { position: 'center' };
    }
  },

  /**
   * Start dragging the window (for custom title bar)
   * This should be called on mousedown of the drag region
   */
  async startDragging(): Promise<void> {
    try {
      const window = getCurrentWindow();
      await window.startDragging();
    } catch (error) {
      logger.error('Failed to start window dragging:', error);
    }
  },

  /**
   * Check if the window is currently visible
   * @returns Promise resolving to visibility state
   */
  async isVisible(): Promise<boolean> {
    try {
      const window = getCurrentWindow();
      return await window.isVisible();
    } catch (error) {
      logger.error('Failed to check window visibility:', error);
      return false;
    }
  },

  /**
   * Check if the window is currently focused
   * @returns Promise resolving to focus state
   */
  async isFocused(): Promise<boolean> {
    try {
      const window = getCurrentWindow();
      return await window.isFocused();
    } catch (error) {
      logger.error('Failed to check window focus:', error);
      return false;
    }
  },

  /**
   * Set focus to the window
   */
  async focus(): Promise<void> {
    try {
      const window = getCurrentWindow();
      await window.setFocus();
    } catch (error) {
      logger.error('Failed to focus window:', error);
      throw new Error(`Failed to focus window: ${error}`);
    }
  },

  /**
   * Minimize the window
   */
  async minimize(): Promise<void> {
    try {
      const window = getCurrentWindow();
      await window.minimize();
    } catch (error) {
      logger.error('Failed to minimize window:', error);
      throw new Error(`Failed to minimize window: ${error}`);
    }
  },

  /**
   * Close the window (and application)
   */
  async close(): Promise<void> {
    try {
      const window = getCurrentWindow();
      await window.close();
    } catch (error) {
      logger.error('Failed to close window:', error);
      throw new Error(`Failed to close window: ${error}`);
    }
  },
};

export default windowService;
