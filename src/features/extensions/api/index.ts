/**
 * Volt Extension API
 *
 * This module exposes the Volt API to external extensions.
 * Extensions can access this via the global `VoltAPI` object.
 */

import { invoke } from '@tauri-apps/api/core';
import {
  Plugin,
  PluginContext,
  PluginResult,
  PluginResultType,
} from '../../plugins/types';
import {
  fuzzyScore,
  copyToClipboard,
  openUrl,
  formatNumber,
} from '../../plugins/utils/helpers';

/**
 * The Volt API interface exposed to extensions
 */
export interface VoltAPIInterface {
  // Types for creating plugins
  types: {
    PluginResultType: typeof PluginResultType;
  };

  // Utilities
  utils: {
    fuzzyScore: typeof fuzzyScore;
    copyToClipboard: typeof copyToClipboard;
    openUrl: typeof openUrl;
    formatNumber: typeof formatNumber;
  };

  // Tauri invoke wrapper
  invoke: typeof invoke;

  // Events
  events: {
    emit: (event: string, detail?: unknown) => void;
    on: (event: string, handler: (detail: unknown) => void) => () => void;
  };

  // Notifications
  notify: (message: string, type?: 'info' | 'success' | 'error') => void;
}

/**
 * Create the Volt API object
 */
export function createVoltAPI(): VoltAPIInterface {
  return {
    types: {
      PluginResultType,
    },

    utils: {
      fuzzyScore,
      copyToClipboard,
      openUrl,
      formatNumber,
    },

    invoke,

    events: {
      emit: (event: string, detail?: unknown) => {
        window.dispatchEvent(new CustomEvent(`volt:${event}`, { detail }));
      },
      on: (event: string, handler: (detail: unknown) => void) => {
        const eventName = `volt:${event}`;
        const listener = ((e: CustomEvent) => handler(e.detail)) as (e: globalThis.Event) => void;
        window.addEventListener(eventName, listener);
        return () => window.removeEventListener(eventName, listener);
      },
    },

    notify: (message: string, type: 'info' | 'success' | 'error' = 'info') => {
      console.log(`[Volt ${type}] ${message}`);
      window.dispatchEvent(
        new CustomEvent('volt:notification', { detail: { message, type } })
      );
    },
  };
}

// Export types for extensions to use
export type { Plugin, PluginContext, PluginResult };
export { PluginResultType };

// Create and expose the global API
const voltAPI = createVoltAPI();

// Declare the global type
declare global {
  interface Window {
    VoltAPI: VoltAPIInterface;
  }
}

// Expose to window for extensions
if (typeof window !== 'undefined') {
  window.VoltAPI = voltAPI;
}

export { voltAPI };
