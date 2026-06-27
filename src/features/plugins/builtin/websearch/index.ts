
import { Plugin, PluginActivation, PluginContext, PluginResult, PluginResultType } from '../../types';
import { resolveActivation } from '../../core/activation';
import { openUrl } from '../../utils/helpers';
import { logger } from '../../../../shared/utils/logger';

/** Maps an activation token (matched prefix/keyword) to a search engine id. */
const ENGINE_BY_TOKEN: Record<string, 'google' | 'bing' | 'duckduckgo'> = {
  bing: 'bing',
  ddg: 'duckduckgo',
  google: 'google',
};

export class WebSearchPlugin implements Plugin {
  id = 'websearch';
  name = 'Web Search';
  description = 'Search the web using your default browser';
  enabled = true;

  // `?` prefix or an engine keyword. The matched token selects the engine
  // (see ENGINE_BY_TOKEN); everything else defaults to Google.
  activation: PluginActivation = {
    prefixes: ['?'],
    keywords: ['web', 'search', 'google', 'bing', 'ddg', 'chercher'],
  };

  private searchEngines = {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
  };

  /**
   * Check if query starts with web search prefix or an engine keyword.
   */
  canHandle(context: PluginContext): boolean {
    return resolveActivation(this, context).matched;
  }

  /**
   * Generate web search result
   */
  match(context: PluginContext): PluginResult[] | null {
    const { stripped: searchQuery, token } = resolveActivation(this, context);

    // If no actual search term, don't show result
    if (!searchQuery) {
      return null;
    }

    const searchEngine = (token && ENGINE_BY_TOKEN[token]) || 'google';
    const engineName = searchEngine.charAt(0).toUpperCase() + searchEngine.slice(1);

    return [
      {
        id: `websearch-${Date.now()}`,
        type: PluginResultType.WebSearch,
        title: `Search "${searchQuery}" on ${engineName}`,
        subtitle: `Press Enter to search`,
        score: 90,
        data: {
          query: searchQuery,
          engine: searchEngine,
          url: this.buildSearchUrl(searchEngine, searchQuery),
        },
      },
    ];
  }

  /**
   * Open the search URL in browser
   */
  async execute(result: PluginResult): Promise<void> {
    const url = result.data?.url as string;

    if (url) {
      await openUrl(url);
      logger.info(`✓ Opened web search: ${url}`);
    }
  }

  private buildSearchUrl(engine: string, query: string): string {
    const baseUrl =
      this.searchEngines[engine as keyof typeof this.searchEngines] || this.searchEngines.google;
    return baseUrl + encodeURIComponent(query);
  }
}
