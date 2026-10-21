import { LruTtlCache, LruTtlCacheOptions } from './cache';
import { WebSearchHistory } from './history';
import { WebSuggestion, WebSuggestionProvider, WebSuggestionRequest } from './types';

export interface WebSuggestionCoordinatorOptions {
  providers?: WebSuggestionProvider[];
  history?: WebSearchHistory;
  minQueryLength?: number;
  debounceMs?: number;
  maxSuggestions?: number;
  cache?: LruTtlCache<WebSuggestion[]>;
  cacheOptions?: LruTtlCacheOptions;
}

const DEFAULT_MIN_QUERY_LENGTH = 2;
const DEFAULT_DEBOUNCE_MS = 200;
const DEFAULT_MAX_SUGGESTIONS = 5;

function normalizedCacheKey(request: WebSuggestionRequest): string {
  return [
    request.query.trim().toLocaleLowerCase(),
    request.country?.toUpperCase() ?? '',
    request.language?.toLocaleLowerCase() ?? '',
  ].join('|');
}

function mergeUnique(
  history: WebSuggestion[],
  remote: WebSuggestion[],
  limit: number
): WebSuggestion[] {
  const seen = new Set<string>();
  const merged: WebSuggestion[] = [];

  for (const suggestion of [...history, ...remote]) {
    const key = suggestion.text.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(suggestion);
    if (merged.length >= limit) break;
  }

  return merged;
}

function waitForDebounce(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Privacy gate and concurrency boundary for web autosuggestions.
 *
 * Calling `suggest` for a non-web query cancels in-flight work and returns
 * immediately without consulting providers.
 */
export class WebSuggestionCoordinator {
  private readonly providers: WebSuggestionProvider[];
  private readonly history: WebSearchHistory;
  private readonly minQueryLength: number;
  private readonly debounceMs: number;
  private readonly maxSuggestions: number;
  private readonly cache: LruTtlCache<WebSuggestion[]>;
  private activeController: AbortController | null = null;

  constructor(options: WebSuggestionCoordinatorOptions = {}) {
    this.providers = options.providers ?? [];
    this.history = options.history ?? new WebSearchHistory();
    this.minQueryLength = Math.max(1, options.minQueryLength ?? DEFAULT_MIN_QUERY_LENGTH);
    this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.maxSuggestions = Math.max(1, options.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS);
    this.cache = options.cache ?? new LruTtlCache<WebSuggestion[]>(options.cacheOptions);
  }

  async suggest(request: WebSuggestionRequest): Promise<WebSuggestion[]> {
    this.cancel();

    const query = request.query.trim();
    if (!request.explicitWebIntent || query.length < this.minQueryLength) return [];

    const historySuggestions = this.history.suggest(query, this.maxSuggestions);
    const cached = this.cache.get(normalizedCacheKey(request));
    if (cached) return mergeUnique(historySuggestions, cached, this.maxSuggestions);

    const providers = this.providers.filter((provider) => provider.isConfigured());
    if (providers.length === 0) return historySuggestions;

    const controller = new AbortController();
    this.activeController = controller;
    const abortFromCaller = () => controller.abort();

    if (request.signal?.aborted) controller.abort();
    else request.signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      await waitForDebounce(this.debounceMs, controller.signal);
      if (controller.signal.aborted || this.activeController !== controller) return [];

      const settled = await Promise.allSettled(
        providers.map((provider) =>
          provider.suggest(query, {
            signal: controller.signal,
            limit: this.maxSuggestions,
            country: request.country,
            language: request.language,
          })
        )
      );

      if (controller.signal.aborted || this.activeController !== controller) return [];

      const successful = settled.filter(
        (result): result is PromiseFulfilledResult<WebSuggestion[]> => result.status === 'fulfilled'
      );
      const remoteSuggestions = successful.flatMap((result) => result.value);
      if (successful.length > 0 && remoteSuggestions.length > 0) {
        this.cache.set(normalizedCacheKey(request), remoteSuggestions);
      }

      return mergeUnique(historySuggestions, remoteSuggestions, this.maxSuggestions);
    } catch (error) {
      if (controller.signal.aborted) return [];
      throw error;
    } finally {
      request.signal?.removeEventListener('abort', abortFromCaller);
      if (this.activeController === controller) this.activeController = null;
    }
  }

  recordSearch(query: string): void {
    this.history.record(query);
  }

  cancel(): void {
    this.activeController?.abort();
    this.activeController = null;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
