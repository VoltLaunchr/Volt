import {
  Plugin,
  PluginActivation,
  PluginContext,
  PluginResult,
  PluginResultType,
} from '../../types';
import { resolveActivation } from '../../core/activation';
import { openUrl } from '../../utils/helpers';
import { logger } from '../../../../shared/utils/logger';
import { WEB_BRAND_ICONS } from '../../../../shared/constants/webBrandIcons';
import { webSearchHistory } from '../../../web-search';
import i18n from 'i18next';
import { useAppStore } from '../../../../stores/appStore';

const WEBSEARCH_NS = 'websearch';

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

    const defaultEngine = useAppStore.getState().settings?.webSearch.defaultEngine ?? 'google';
    const searchEngine = (token && ENGINE_BY_TOKEN[token]) || defaultEngine;
    const engineName = searchEngine.charAt(0).toUpperCase() + searchEngine.slice(1);

    const icon =
      searchEngine === 'google'
        ? WEB_BRAND_ICONS.google
        : searchEngine === 'duckduckgo'
          ? WEB_BRAND_ICONS.duckduckgo
          : undefined;
    const primary: PluginResult = {
      id: `websearch-${searchEngine}-primary`,
      type: PluginResultType.WebSearch,
      title: i18n.t('searchOn', {
        ns: WEBSEARCH_NS,
        defaultValue: 'Search "{{query}}" on {{engine}}',
        query: searchQuery,
        engine: engineName,
      }),
      subtitle: i18n.t('pressEnter', {
        ns: WEBSEARCH_NS,
        defaultValue: 'Press Enter to search',
      }),
      icon,
      score: 90,
      section: i18n.t('sections.search', { ns: WEBSEARCH_NS, defaultValue: 'Search' }),
      data: {
        query: searchQuery,
        engine: searchEngine,
        url: this.buildSearchUrl(searchEngine, searchQuery),
      },
    };

    const historyResults: PluginResult[] = webSearchHistory
      .suggest(searchQuery, 3)
      .filter(
        (suggestion) => suggestion.text.toLocaleLowerCase() !== searchQuery.toLocaleLowerCase()
      )
      .map((suggestion, index) => ({
        id: `websearch-history-${index}`,
        type: PluginResultType.WebSearch,
        title: suggestion.text,
        subtitle: i18n.t('searchAgainOn', {
          ns: WEBSEARCH_NS,
          defaultValue: 'Search again on {{engine}}',
          engine: engineName,
        }),
        icon,
        badge: i18n.t('historyBadge', { ns: WEBSEARCH_NS, defaultValue: 'History' }),
        section: i18n.t('sections.recent', {
          ns: WEBSEARCH_NS,
          defaultValue: 'Recent searches',
        }),
        score: 85 - index,
        data: {
          query: suggestion.text,
          engine: searchEngine,
          url: this.buildSearchUrl(searchEngine, suggestion.text),
        },
      }));

    return [primary, ...historyResults];
  }

  /**
   * Open the search URL in browser
   */
  async execute(result: PluginResult): Promise<void> {
    const url = result.data?.url as string;

    if (url) {
      await openUrl(url);
      logger.info('Opened web search in the configured browser');
    }
  }

  private buildSearchUrl(engine: string, query: string): string {
    const baseUrl =
      this.searchEngines[engine as keyof typeof this.searchEngines] || this.searchEngines.google;
    return baseUrl + encodeURIComponent(query);
  }
}
