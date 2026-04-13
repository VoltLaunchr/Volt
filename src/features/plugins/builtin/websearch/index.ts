import i18n from 'i18next';
import enWebsearch from './locales/en.json';
import frWebsearch from './locales/fr.json';
i18n.addResourceBundle('en', 'websearch', enWebsearch);
i18n.addResourceBundle('fr', 'websearch', frWebsearch);

import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';
import { openUrl } from '../../utils/helpers';

export class WebSearchPlugin implements Plugin {
  id = 'websearch';
  name = 'Web Search';
  description = 'Search the web using your default browser';
  enabled = true;

  private searchEngines = {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
  };

  /**
   * Check if query starts with web search prefix
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.trim().toLowerCase();

    // Trigger patterns
    const triggers = ['?', 'web ', 'search ', 'google ', 'bing ', 'ddg '];

    return triggers.some((trigger) => query.startsWith(trigger));
  }

  /**
   * Generate web search result
   */
  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.trim();
    const lowerQuery = query.toLowerCase();

    let searchEngine = 'google';
    let searchQuery = query;

    // Detect search engine
    if (lowerQuery.startsWith('?')) {
      searchQuery = query.substring(1).trim();
    } else if (lowerQuery.startsWith('web ')) {
      searchQuery = query.substring(4).trim();
    } else if (lowerQuery.startsWith('search ')) {
      searchQuery = query.substring(7).trim();
    } else if (lowerQuery.startsWith('google ')) {
      searchQuery = query.substring(7).trim();
      searchEngine = 'google';
    } else if (lowerQuery.startsWith('bing ')) {
      searchQuery = query.substring(5).trim();
      searchEngine = 'bing';
    } else if (lowerQuery.startsWith('ddg ')) {
      searchQuery = query.substring(4).trim();
      searchEngine = 'duckduckgo';
    }

    // If no actual search term, don't show result
    if (!searchQuery) {
      return null;
    }

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
      console.log(`✓ Opened web search: ${url}`);
    }
  }

  private buildSearchUrl(engine: string, query: string): string {
    const baseUrl =
      this.searchEngines[engine as keyof typeof this.searchEngines] || this.searchEngines.google;
    return baseUrl + encodeURIComponent(query);
  }
}
