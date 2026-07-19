import { invoke } from '@tauri-apps/api/core';
import {
  WebSearchContext,
  WebSearchProvider,
  WebSearchResult,
  WebSuggestion,
  WebSuggestionContext,
  WebSuggestionProvider,
} from '../types';

type InvokeImplementation = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface BraveSuggestionProviderOptions {
  /**
   * The production implementation uses Tauri. Injection exists only to keep
   * the provider independently testable without a desktop runtime.
   */
  invokeImplementation?: InvokeImplementation;
  enabled?: boolean;
  country?: string;
  language?: string;
}

interface BraveSearchHit {
  title: string;
  url: string;
  description?: string;
  age?: string;
  favicon?: string;
}

function isBraveSearchHit(value: unknown): value is BraveSearchHit {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.title === 'string' && typeof candidate.url === 'string';
}

/**
 * Renderer-safe Brave adapter. Credentials and HTTP stay in the Rust command;
 * the frontend only receives already-sanitized hits.
 */
export class BraveSearchProvider implements WebSearchProvider, WebSuggestionProvider {
  readonly id = 'brave';
  private readonly invokeImplementation: InvokeImplementation;
  private readonly enabled: boolean;
  private readonly country: string | undefined;
  private readonly language: string | undefined;

  constructor(options: BraveSuggestionProviderOptions = {}) {
    this.invokeImplementation = options.invokeImplementation ?? invoke;
    this.enabled = options.enabled ?? true;
    this.country = options.country;
    this.language = options.language;
  }

  isConfigured(): boolean {
    return this.enabled;
  }

  async search(query: string, context: WebSearchContext): Promise<WebSearchResult[]> {
    if (!this.isConfigured() || context.signal.aborted) return [];

    try {
      const payload = await this.invokeImplementation('web_search_brave', {
        query,
        count: Math.min(20, Math.max(1, context.limit)),
        country: context.country ?? this.country,
        searchLang: context.language ?? this.language,
        freshness: context.freshness,
      });
      if (context.signal.aborted) return [];

      return (Array.isArray(payload) ? payload : [])
        .filter(isBraveSearchHit)
        .map((hit) => ({
          title: hit.title,
          url: hit.url,
          description: hit.description,
          age: hit.age,
          favicon: hit.favicon,
          providerId: this.id,
        }))
        .slice(0, context.limit);
    } catch {
      // Missing credentials, offline mode and backend errors are non-fatal.
      return [];
    }
  }

  async suggest(query: string, context: WebSuggestionContext): Promise<WebSuggestion[]> {
    const results = await this.search(query, context);
    return results.map((result) => ({
      id: `brave:${result.url}`,
      text: result.title,
      source: 'remote',
      providerId: this.id,
    }));
  }
}

export { BraveSearchProvider as BraveSuggestionProvider };
