/**
 * Volt Extension API
 *
 * This module exposes the Volt API to external extensions.
 * Extensions can access this via the global `VoltAPI` object.
 */

import {
  Plugin,
  PluginContext,
  PluginResult,
  PluginResultType,
} from '../../plugins/types';
import { logger } from '../../../shared/utils/logger';
import {
  fuzzyScore,
  copyToClipboard,
  openUrl,
  formatNumber,
} from '../../plugins/utils/helpers';
import { VOLT_EVENTS, emitVoltEvent } from '../../../shared/events';

/**
 * The Volt API interface exposed to extensions
 *
 * NOTE: invoke() is intentionally NOT exposed to extensions.
 * Extensions must use the safe utility methods (copyToClipboard, openUrl, etc.)
 * to interact with the system. Direct Tauri IPC access would bypass permission checks.
 */
export interface ToastOptions {
  /** Primary message shown in the toast */
  message: string;
  /** Alias for message (Raycast-compatible) */
  title?: string;
  /** Secondary line below the message */
  subtitle?: string;
  /** Visual style — defaults to 'info' */
  style?: 'info' | 'success' | 'error';
  /** Auto-dismiss delay in ms — defaults to 4000 */
  duration?: number;
}

export interface VoltStorageAPI {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

export interface VoltOAuthAuthorizeOptions {
  provider: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes?: string[];
}

export interface VoltOAuthResult {
  token?: string;
  error?: string;
  success?: boolean;
}

export interface VoltOAuthAPI {
  /** Start PKCE OAuth flow. Opens browser, waits for callback, returns token. */
  authorize: (opts: VoltOAuthAuthorizeOptions) => Promise<VoltOAuthResult>;
  /** Retrieve a previously-stored OAuth token from the OS keyring. */
  getToken: (provider: string) => Promise<VoltOAuthResult>;
  /** Remove a stored OAuth token from the OS keyring. */
  revokeToken: (provider: string) => Promise<void>;
}

/**
 * Named creativity levels — mapped to normalized temperature per provider.
 * Use a number (0–2) for fine-grained control.
 *
 * | Level     | Temperature | Best for                            |
 * |-----------|-------------|-------------------------------------|
 * | none      | 0           | Deterministic output, classification|
 * | low       | 0.33        | Summarization, grammar, translation |
 * | medium    | 1.0         | Q&A, code generation                |
 * | high      | 1.67        | Brainstorming, ideation             |
 * | maximum   | 2.0         | Creative fiction, poetry            |
 */
export type VoltAICreativity = 'none' | 'low' | 'medium' | 'high' | 'maximum' | number;

/**
 * Known models for each provider — use these string literals for autocomplete.
 * Any other string is passed through as-is (for newer/custom model IDs).
 *
 * Prefixed by provider for clarity: `openai:gpt-4o`, `anthropic:claude-sonnet-4-6`, etc.
 */
export type VoltAIModel =
  // OpenAI
  | 'openai:gpt-4o'
  | 'openai:gpt-4o-mini'
  | 'openai:gpt-4-turbo'
  | 'openai:o1'
  | 'openai:o1-mini'
  | 'openai:o3-mini'
  // Anthropic
  | 'anthropic:claude-opus-4-7'
  | 'anthropic:claude-sonnet-4-6'
  | 'anthropic:claude-haiku-4-5-20251001'
  // Groq (Llama, fast inference)
  | 'groq:llama-3.3-70b-versatile'
  | 'groq:llama-3.1-8b-instant'
  | 'groq:llama-3.1-70b-versatile'
  | 'groq:mixtral-8x7b-32768'
  | (string & Record<never, never>); // allow arbitrary strings with autocomplete

export interface VoltAIAskOptions {
  provider: 'openai' | 'anthropic' | 'groq';
  /** Name of the secret preference key storing the API key (set via extension prefs). */
  apiKeyPreference: string;
  /**
   * Model to use — use a `VoltAIModel` constant or pass any model ID string.
   * The provider prefix (`openai:`, `anthropic:`, `groq:`) is stripped automatically.
   * Defaults to the provider's recommended fast model.
   */
  model?: VoltAIModel;
  maxTokens?: number;
  system?: string;
  /**
   * Controls output randomness. Named levels map to normalized 0–2 temperature.
   * Overridden by `temperature` if both are provided.
   */
  creativity?: VoltAICreativity;
  /** Raw temperature (0–2). Overrides `creativity` when set. */
  temperature?: number;
  /**
   * Abort signal — call `controller.abort()` to cancel an in-flight request.
   * The Promise rejects with an AbortError when triggered.
   *
   * @example
   * const controller = new AbortController();
   * setTimeout(() => controller.abort(), 5000); // 5s hard timeout
   * const reply = await VoltAPI.ai.ask(prompt, { ...opts, signal: controller.signal });
   */
  signal?: AbortSignal;
}

export interface VoltAIAPI {
  /**
   * Ask an AI model. API key is read from the OS keyring — never exposed to JS.
   * `onChunk` is called progressively as tokens arrive (streaming).
   * The Promise resolves with the full concatenated text when the stream is done.
   */
  ask: (prompt: string, options: VoltAIAskOptions, onChunk?: (chunk: string) => void) => Promise<string>;
}

export interface VoltSecretsAPI {
  /** Read a secret (API key, token) from the OS keyring. Returns null if not set. */
  get: (key: string) => Promise<string | null>;
  /** Store a secret in the OS keyring (DPAPI/Keychain/Secret Service encrypted). */
  set: (key: string, value: string) => Promise<void>;
  /** Remove a secret from the OS keyring. */
  delete: (key: string) => Promise<void>;
}

export interface UpdateCommandMetadataOptions {
  /** New title to display in search results */
  title?: string;
  /** New subtitle to display in search results */
  subtitle?: string;
}

export interface AppInfo {
  id: string;
  name: string;
  path: string;
  icon?: string | null;
  description?: string | null;
}

export interface VoltSystemAPI {
  /** List all installed applications. Requires 'system' permission. */
  getApplications: () => Promise<AppInfo[]>;
  /** Reveal a path in Finder / Explorer / Nautilus. Requires 'system' permission. */
  showInFolder: (path: string) => Promise<void>;
  /** Move a file or directory to the system trash. Requires 'system' permission. */
  moveToTrash: (path: string) => Promise<void>;
}

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
    /** Write text to clipboard AND paste it into the previously-focused app (requires 'clipboard' permission). */
    pasteText: (text: string) => void;
  };

  // Events
  events: {
    emit: (event: string, detail?: unknown) => void;
    on: (event: string, handler: (detail: unknown) => void) => () => void;
  };

  // Persistent key-value storage (isolated per extension)
  storage: VoltStorageAPI;

  // OS keyring secrets (API keys, tokens — encrypted at rest, never in plain JS memory)
  secrets: VoltSecretsAPI;

  // OAuth PKCE flow (requires 'oauth' permission)
  oauth: VoltOAuthAPI;

  // AI inference via external provider (requires 'ai' permission)
  ai: VoltAIAPI;

  // System utilities (requires 'system' permission)
  system: VoltSystemAPI;

  /**
   * Report an error to the extension error log.
   * Fire-and-forget — never throws.
   */
  captureException: (error: Error | string, context?: Record<string, unknown>, severity?: 'error' | 'warning') => void;

  // Feedback
  notify: (message: string, type?: 'info' | 'success' | 'error') => void;
  showToast: (opts: ToastOptions) => void;
  /**
   * Show a brief confirmation overlay after the Volt window closes.
   * Equivalent to Raycast showHUD — ideal for confirming silent actions
   * like "Copied to clipboard" that don't need the window to stay open.
   */
  showHUD: (message: string) => void;
  /**
   * Show a confirmation dialog. Resolves true when confirmed, false when cancelled.
   * Use before destructive actions that the user should approve.
   */
  confirm: (message: string) => Promise<boolean>;
  /**
   * Dynamically update the title or subtitle of this extension's result
   * in the current search list. Call from execute() to refresh displayed metadata.
   */
  updateCommandMetadata: (opts: UpdateCommandMetadataOptions) => void;
}

/**
 * Create the Volt API object.
 *
 * NOTE: This API is exposed as `window.VoltAPI` on the main renderer thread.
 * Extensions run in Web Workers and use their own bootstrap mock (worker-bootstrap.ts)
 * which routes storage/oauth/ai calls through postMessage to WorkerPlugin handlers.
 * The `extensionId` parameter here only affects the dead-code main-thread storage path.
 */
export function createVoltAPI(extensionId: string = '__main__'): VoltAPIInterface {
  return {
    types: {
      PluginResultType,
    },

    utils: {
      fuzzyScore,
      copyToClipboard,
      openUrl,
      formatNumber,
      pasteText: () => {
        throw new Error('VoltAPI.utils.pasteText is only available inside extension Workers');
      },
    },

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
      logger.info(`[Volt ${type}] ${message}`);
      emitVoltEvent(VOLT_EVENTS.NOTIFICATION, { message, type });
    },

    showToast: (opts: ToastOptions) => {
      emitVoltEvent(VOLT_EVENTS.TOAST, {
        message: opts.message ?? opts.title ?? '',
        subtitle: opts.subtitle,
        style: opts.style ?? 'info',
        duration: opts.duration,
      });
    },

    storage: {
      get: async (key: string): Promise<string | null> => {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke<string | null>('ext_storage_get', { extensionId, key });
      },
      set: async (key: string, value: string): Promise<void> => {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke('ext_storage_set', { extensionId, key, value });
      },
      remove: async (key: string): Promise<void> => {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke('ext_storage_remove', { extensionId, key });
      },
      clear: async (): Promise<void> => {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke('ext_storage_clear', { extensionId });
      },
    },

    secrets: {
      get: () =>
        Promise.reject(new Error('VoltAPI.secrets is only available inside extension Workers')),
      set: () =>
        Promise.reject(new Error('VoltAPI.secrets is only available inside extension Workers')),
      delete: () =>
        Promise.reject(new Error('VoltAPI.secrets is only available inside extension Workers')),
    },

    oauth: {
      authorize: () =>
        Promise.reject(new Error('VoltAPI.oauth is only available inside extension Workers')),
      getToken: () =>
        Promise.reject(new Error('VoltAPI.oauth is only available inside extension Workers')),
      revokeToken: () =>
        Promise.reject(new Error('VoltAPI.oauth is only available inside extension Workers')),
    },

    ai: {
      ask: () =>
        Promise.reject(new Error('VoltAPI.ai is only available inside extension Workers')),
    },

    system: {
      getApplications: () =>
        Promise.reject(new Error('VoltAPI.system is only available inside extension Workers')),
      showInFolder: () =>
        Promise.reject(new Error('VoltAPI.system is only available inside extension Workers')),
      moveToTrash: () =>
        Promise.reject(new Error('VoltAPI.system is only available inside extension Workers')),
    },

    captureException: () => {
      // No-op on main thread — only functional in Workers
    },

    showHUD: () => {
      throw new Error('VoltAPI.showHUD is only available inside extension Workers');
    },

    confirm: () =>
      Promise.reject(new Error('VoltAPI.confirm is only available inside extension Workers')),

    updateCommandMetadata: () => {
      throw new Error('VoltAPI.updateCommandMetadata is only available inside extension Workers');
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
    /**
     * Extension i18n bridge installed by `src/i18n/index.ts` after
     * `i18n.init()` resolves. The Worker bundle's \`VoltI18n.addTranslations()\`
     * helper calls this so extensions can add translation resources at runtime.
     * Optional because main thread code runs before i18n is initialised
     * (e.g. in tests), and it is `undefined` in that window.
     */
    __volt_i18n_addBundle__?: (
      lng: string,
      ns: string,
      resources: Record<string, unknown>
    ) => void;
  }
}

// Expose to window for extensions
if (typeof window !== 'undefined') {
  window.VoltAPI = voltAPI;
}

export { voltAPI };
