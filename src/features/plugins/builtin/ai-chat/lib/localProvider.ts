/**
 * Sprint 4 — Pari B. Local model providers (Ollama / LM Studio).
 *
 * The Rust proxy (`ai_proxy_stream`) already accepts a per-request `base_url` and
 * allows a keyless call when one is present, so local models need NO backend
 * change — only a place to hold the user's endpoint + model id. That config is
 * not a secret, so it lives in the renderer (`localStorage`, shared across the
 * main and settings windows since they share an origin) and is forwarded
 * per-request through the AI SDK transport.
 */

export const LOCAL_PROVIDER_ID = 'local';

/** Ollama's default OpenAI-compatible endpoint. LM Studio defaults to :1234/v1. */
export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';

export interface LocalAiConfig {
  /** OpenAI-compatible base URL, e.g. `http://localhost:11434/v1`. */
  baseUrl: string;
  /** Model id as the local server knows it, e.g. `llama3.1` or `qwen2.5-coder`. */
  model: string;
}

const STORAGE_KEY = 'volt:ai:local-config';

/** Read + validate the persisted local config. Returns null if absent/invalid. */
export function loadLocalConfig(): LocalAiConfig | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalAiConfig>;
    const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '';
    const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
    if (!baseUrl || !model) return null;
    if (!/^https?:\/\//.test(baseUrl)) return null;
    return { baseUrl: baseUrl.replace(/\/+$/, ''), model };
  } catch {
    return null;
  }
}

export function saveLocalConfig(cfg: LocalAiConfig): void {
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearLocalConfig(): void {
  globalThis.localStorage?.removeItem(STORAGE_KEY);
}

/**
 * Subscribe to cross-window config changes. The `storage` event fires in *other*
 * same-origin documents, so the chat window reacts when the settings window saves.
 * Returns an unsubscribe fn.
 */
export function onLocalConfigChange(cb: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) cb();
  };
  globalThis.addEventListener('storage', handler);
  return () => globalThis.removeEventListener('storage', handler);
}
