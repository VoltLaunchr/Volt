/**
 * Typed `volt:*` DOM event bus — single source of truth for intra-renderer
 * `CustomEvent`s used for plugin → UI and cross-component coordination.
 *
 * Why this exists: emitters and listeners previously duplicated magic strings
 * (`'volt:toast'`, `'volt:open-ai-chat'`, …) and passed untyped `detail`. This
 * centralizes the names in {@link VOLT_EVENTS} and types each payload via
 * {@link VoltEventMap}, so a typo or a payload-shape mismatch is a compile
 * error rather than a silent runtime no-op.
 *
 * Scope: this module only covers DOM `CustomEvent`s dispatched on `window`.
 * Tauri cross-window events (`volt://…`, sent via `@tauri-apps/api/event`) use a
 * different transport and are intentionally NOT handled here.
 *
 * Type imports below are `import type` so they are erased at build time and add
 * no runtime dependency edges (avoids chunk import cycles).
 */
import type { ExtensionError } from '../features/extensions/loader/worker-sandbox';
import type { ShellOutputData } from '../features/plugins/builtin/shell';

/** Payload for the toast bridge (`VoltAPI.showToast`, Worker `toast` action). */
export interface VoltToastDetail {
  message: string;
  subtitle?: string;
  style?: 'info' | 'success' | 'error';
  duration?: number;
}

/** Payload for the legacy notification bridge (`VoltAPI.notify`). */
export interface VoltNotificationDetail {
  message: string;
  type?: 'info' | 'success' | 'error';
}

/** Payload for HUD overlay events. */
export interface VoltHudDetail {
  message: string;
}

/** Payload for in-place search-result metadata updates. */
export interface VoltUpdateMetadataDetail {
  pluginId: string;
  title?: string;
  subtitle?: string;
}

/** Payload for opening the AI Chat / Quick AI views. */
export interface VoltOpenAiViewDetail {
  query: string;
  systemPrompt?: string;
}

/** Payload for streaming shell command output. */
export interface VoltShellOutputDetail {
  command: string;
  data: ShellOutputData;
}

/** Payload emitted when a clipboard item is copied. */
export interface VoltClipboardCopiedDetail {
  id: number;
  preview: string;
}

/** Payload emitted when a clipboard copy fails. */
export interface VoltClipboardErrorDetail {
  error: string;
}

/**
 * Maps each `volt:*` event name to its `CustomEvent.detail` payload type.
 * Events with no payload map to `undefined`.
 */
export interface VoltEventMap {
  'volt:open-timer': undefined;
  'volt:open-calculator': undefined;
  'volt:open-settings': undefined;
  'volt:open-create-extension': undefined;
  'volt:open-manage-extensions': undefined;
  'volt:open-ai-chat': VoltOpenAiViewDetail;
  'volt:open-quick-ai': VoltOpenAiViewDetail;
  'volt:toast': VoltToastDetail;
  'volt:notification': VoltNotificationDetail;
  'volt:hud': VoltHudDetail;
  'volt:hud-show': VoltHudDetail;
  'volt:update-metadata': VoltUpdateMetadataDetail;
  'volt:extension-error': ExtensionError;
  'volt:shell-output': VoltShellOutputDetail;
  'volt:clipboard:copied': VoltClipboardCopiedDetail;
  'volt:clipboard:error': VoltClipboardErrorDetail;
  'volt:clipboard:cleared': undefined;
  'volt:openSystemMonitor': undefined;
}

/**
 * Single source of truth for the event-name string literals. Use these instead
 * of inlining `'volt:…'` strings so renames are mechanical and typo-safe.
 */
export const VOLT_EVENTS = {
  OPEN_TIMER: 'volt:open-timer',
  OPEN_CALCULATOR: 'volt:open-calculator',
  OPEN_SETTINGS: 'volt:open-settings',
  OPEN_CREATE_EXTENSION: 'volt:open-create-extension',
  OPEN_MANAGE_EXTENSIONS: 'volt:open-manage-extensions',
  OPEN_AI_CHAT: 'volt:open-ai-chat',
  OPEN_QUICK_AI: 'volt:open-quick-ai',
  TOAST: 'volt:toast',
  NOTIFICATION: 'volt:notification',
  HUD: 'volt:hud',
  HUD_SHOW: 'volt:hud-show',
  UPDATE_METADATA: 'volt:update-metadata',
  EXTENSION_ERROR: 'volt:extension-error',
  SHELL_OUTPUT: 'volt:shell-output',
  CLIPBOARD_COPIED: 'volt:clipboard:copied',
  CLIPBOARD_ERROR: 'volt:clipboard:error',
  CLIPBOARD_CLEARED: 'volt:clipboard:cleared',
  OPEN_SYSTEM_MONITOR: 'volt:openSystemMonitor',
} as const satisfies Record<string, keyof VoltEventMap>;

declare global {
  interface WindowEventMap {
    'volt:open-timer': CustomEvent<VoltEventMap['volt:open-timer']>;
    'volt:open-calculator': CustomEvent<VoltEventMap['volt:open-calculator']>;
    'volt:open-settings': CustomEvent<VoltEventMap['volt:open-settings']>;
    'volt:open-create-extension': CustomEvent<VoltEventMap['volt:open-create-extension']>;
    'volt:open-manage-extensions': CustomEvent<VoltEventMap['volt:open-manage-extensions']>;
    'volt:open-ai-chat': CustomEvent<VoltEventMap['volt:open-ai-chat']>;
    'volt:open-quick-ai': CustomEvent<VoltEventMap['volt:open-quick-ai']>;
    'volt:toast': CustomEvent<VoltEventMap['volt:toast']>;
    'volt:notification': CustomEvent<VoltEventMap['volt:notification']>;
    'volt:hud': CustomEvent<VoltEventMap['volt:hud']>;
    'volt:hud-show': CustomEvent<VoltEventMap['volt:hud-show']>;
    'volt:update-metadata': CustomEvent<VoltEventMap['volt:update-metadata']>;
    'volt:extension-error': CustomEvent<VoltEventMap['volt:extension-error']>;
    'volt:shell-output': CustomEvent<VoltEventMap['volt:shell-output']>;
    'volt:clipboard:copied': CustomEvent<VoltEventMap['volt:clipboard:copied']>;
    'volt:clipboard:error': CustomEvent<VoltEventMap['volt:clipboard:error']>;
    'volt:clipboard:cleared': CustomEvent<VoltEventMap['volt:clipboard:cleared']>;
    'volt:openSystemMonitor': CustomEvent<VoltEventMap['volt:openSystemMonitor']>;
  }
}

/**
 * Resolves to an empty argument list for payload-less events (mapped to
 * `undefined`) and to a single required `detail` argument otherwise. This keeps
 * a single function signature (so `no-redeclare` is satisfied) while still
 * forbidding a stray argument on void events and requiring one elsewhere.
 */
type VoltEventArgs<K extends keyof VoltEventMap> = VoltEventMap[K] extends undefined
  ? []
  : [detail: VoltEventMap[K]];

/**
 * Dispatch a typed `volt:*` `CustomEvent` on `window`.
 *
 * Payload-less events (those mapped to `undefined`) are called without a second
 * argument; all others require a correctly-typed `detail`.
 */
export function emitVoltEvent<K extends keyof VoltEventMap>(
  name: K,
  ...args: VoltEventArgs<K>
): void {
  const init: CustomEventInit<VoltEventMap[K]> = { detail: args[0] };
  window.dispatchEvent(new CustomEvent(name, init));
}

/**
 * Subscribe to a typed `volt:*` event on `window`. Returns an unsubscribe
 * function that removes the listener — call it in a `useEffect` cleanup.
 */
export function onVoltEvent<K extends keyof VoltEventMap>(
  name: K,
  handler: (detail: VoltEventMap[K]) => void
): () => void {
  const listener = (event: Event): void => {
    handler((event as CustomEvent<VoltEventMap[K]>).detail);
  };
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
