import { WebSuggestion } from './types';

export interface WebSearchHistoryEntry {
  query: string;
  visitedAt: number;
}

export interface WebSearchHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WebSearchHistoryOptions {
  enabled?: boolean;
  maxEntries?: number;
  storageKey?: string;
  storage?: WebSearchHistoryStorage | null;
  now?: () => number;
}

const DEFAULT_STORAGE_KEY = 'volt:web-search-history';
const DEFAULT_MAX_ENTRIES = 50;

function getDefaultStorage(): WebSearchHistoryStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isHistoryEntry(value: unknown): value is WebSearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.query === 'string' &&
    candidate.query.trim().length > 0 &&
    typeof candidate.visitedAt === 'number' &&
    Number.isFinite(candidate.visitedAt)
  );
}

/**
 * Local, opt-in history. When disabled it does not even read from storage.
 */
export class WebSearchHistory {
  private enabled: boolean;
  private readonly maxEntries: number;
  private readonly storageKey: string;
  private readonly configuredStorage: WebSearchHistoryStorage | null | undefined;
  private readonly now: () => number;

  constructor(options: WebSearchHistoryOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.configuredStorage = options.storage;
    this.now = options.now ?? Date.now;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  record(query: string): void {
    if (!this.enabled) return;

    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;

    const entries = this.read();
    const comparableQuery = normalizedQuery.toLocaleLowerCase();
    const nextEntries = [
      { query: normalizedQuery, visitedAt: this.now() },
      ...entries.filter((entry) => entry.query.toLocaleLowerCase() !== comparableQuery),
    ].slice(0, this.maxEntries);

    this.write(nextEntries);
  }

  suggest(query: string, limit: number): WebSuggestion[] {
    if (!this.enabled || limit <= 0) return [];

    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];

    return this.read()
      .filter((entry) => entry.query.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => {
        const leftStartsWith = left.query.toLocaleLowerCase().startsWith(normalizedQuery);
        const rightStartsWith = right.query.toLocaleLowerCase().startsWith(normalizedQuery);
        if (leftStartsWith !== rightStartsWith) return leftStartsWith ? -1 : 1;
        return right.visitedAt - left.visitedAt;
      })
      .slice(0, limit)
      .map((entry) => ({
        id: `history:${entry.query.toLocaleLowerCase()}`,
        text: entry.query,
        source: 'history',
      }));
  }

  clear(): void {
    try {
      this.getStorage()?.removeItem(this.storageKey);
    } catch {
      // History is a progressive enhancement; unavailable storage is non-fatal.
    }
  }

  private getStorage(): WebSearchHistoryStorage | null {
    return this.configuredStorage === undefined ? getDefaultStorage() : this.configuredStorage;
  }

  private read(): WebSearchHistoryEntry[] {
    try {
      const raw = this.getStorage()?.getItem(this.storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isHistoryEntry).slice(0, this.maxEntries) : [];
    } catch {
      return [];
    }
  }

  private write(entries: WebSearchHistoryEntry[]): void {
    try {
      this.getStorage()?.setItem(this.storageKey, JSON.stringify(entries));
    } catch {
      // Private mode and storage quotas must not break search.
    }
  }
}
