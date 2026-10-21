export type WebSuggestionSource = 'history' | 'remote';

export interface WebSuggestion {
  id: string;
  text: string;
  source: WebSuggestionSource;
  providerId?: string;
}

export interface WebSuggestionContext {
  signal: AbortSignal;
  limit: number;
  country?: string;
  language?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  description?: string;
  age?: string;
  favicon?: string;
  providerId: string;
}

export interface WebSearchContext {
  signal: AbortSignal;
  limit: number;
  country?: string;
  language?: string;
  freshness?: string;
}

export interface WebSearchProvider {
  readonly id: string;
  isConfigured(): boolean;
  search(query: string, context: WebSearchContext): Promise<WebSearchResult[]>;
}

/**
 * A provider is deliberately inert until `isConfigured()` returns true.
 * This keeps credentials and network policy outside the search pipeline.
 */
export interface WebSuggestionProvider {
  readonly id: string;
  isConfigured(): boolean;
  suggest(query: string, context: WebSuggestionContext): Promise<WebSuggestion[]>;
}

export interface WebSuggestionRequest {
  query: string;
  /**
   * Must only be true after the caller has positively classified the query as
   * a web-search intent (for example `? cats` or `web cats`).
   */
  explicitWebIntent: boolean;
  signal?: AbortSignal;
  country?: string;
  language?: string;
}
