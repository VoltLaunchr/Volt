import { invoke } from '@tauri-apps/api/core';
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';
import { fuzzyScore, openUrl } from '../../utils/helpers';
import { logger } from '../../../../shared/utils/logger';

export interface Quicklink {
  id: string;
  name: string;
  shortcut: string;
  target: string;
  type: 'url' | 'folder' | 'command';
  icon?: string;
}

// Icons for different quicklink types
const TYPE_ICONS: Record<Quicklink['type'], string> = {
  url: '🌐',
  folder: '📁',
  command: '⌨️',
};

// Keywords that trigger the quicklinks plugin
const QUICKLINK_KEYWORDS = ['quicklink', 'link', 'bookmark', 'ql'];

// Management command prefixes
const MANAGEMENT_COMMANDS: Record<string, string> = {
  'ql:add': 'add',
  'ql:list': 'list',
  'ql:remove': 'remove',
  'quicklink:add': 'add',
  'quicklink:list': 'list',
  'quicklink:remove': 'remove',
};

export class QuicklinksPlugin implements Plugin {
  id = 'quicklinks';
  name = 'Quicklinks';
  description = 'Custom shortcuts to URLs, folders, or shell commands';
  enabled = true;

  /** Cached quicklinks list for fast canHandle() checks */
  private cachedQuicklinks: Quicklink[] = [];
  private cacheLoaded = false;

  /**
   * Load and cache quicklinks from the backend.
   * Called lazily on first canHandle() and refreshed after mutations.
   */
  private async refreshCache(): Promise<void> {
    try {
      this.cachedQuicklinks = await invoke<Quicklink[]>('get_quicklinks');
      this.cacheLoaded = true;
    } catch {
      this.cachedQuicklinks = [];
      this.cacheLoaded = true;
    }
  }

  /**
   * Check if query can be handled by the quicklinks plugin
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.trim();
    if (!query) return false;

    const lowerQuery = query.toLowerCase();

    // Check management commands (ql:add, ql:list, ql:remove)
    for (const cmd of Object.keys(MANAGEMENT_COMMANDS)) {
      if (lowerQuery.startsWith(cmd)) return true;
    }

    // Check keyword triggers
    if (QUICKLINK_KEYWORDS.some((kw) => lowerQuery === kw || lowerQuery.startsWith(kw + ' '))) {
      return true;
    }

    // Require at least 2 characters before matching against cached quicklinks
    if (lowerQuery.length < 2) return false;

    // If cache hasn't loaded yet, trigger async load and optimistically return true
    // so the first query isn't dropped; match() will fetch fresh data anyway
    if (!this.cacheLoaded) {
      this.refreshCache();
      return true;
    }

    // Check if query matches any cached quicklink name or shortcut
    return this.cachedQuicklinks.some(
      (ql) =>
        ql.name.toLowerCase().includes(lowerQuery) ||
        ql.shortcut.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Match query and return results
   */
  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.trim();
    const lowerQuery = query.toLowerCase();

    // Handle management commands
    for (const [cmd, action] of Object.entries(MANAGEMENT_COMMANDS)) {
      if (lowerQuery.startsWith(cmd)) {
        return this.handleManagementCommand(action, query.substring(cmd.length).trim());
      }
    }

    // Use cached quicklinks, refreshing if not yet loaded
    if (!this.cacheLoaded) {
      await this.refreshCache();
    }
    const quicklinks = this.cachedQuicklinks;

    const results: PluginResult[] = [];

    // Check if query starts with a keyword trigger
    let searchTerm = lowerQuery;
    let isKeywordTriggered = false;

    for (const kw of QUICKLINK_KEYWORDS) {
      if (lowerQuery === kw) {
        // Just the keyword - show all quicklinks
        searchTerm = '';
        isKeywordTriggered = true;
        break;
      }
      if (lowerQuery.startsWith(kw + ' ')) {
        searchTerm = query.substring(kw.length + 1).trim();
        isKeywordTriggered = true;
        break;
      }
    }

    // Match against quicklinks
    for (const ql of quicklinks) {
      const nameScore = fuzzyScore(searchTerm || '', ql.name);
      const shortcutScore = fuzzyScore(searchTerm || '', ql.shortcut);
      const bestScore = Math.max(nameScore, shortcutScore);

      // If no search term (keyword only), show all with base score
      // Otherwise require a minimum match score
      if (searchTerm === '' || bestScore > 0) {
        const icon = ql.icon || TYPE_ICONS[ql.type];
        const score = searchTerm === '' ? 80 : bestScore;

        results.push({
          id: `quicklink-${ql.id}`,
          type: PluginResultType.Info,
          title: `${icon} ${ql.name}`,
          subtitle: `${ql.type === 'command' ? 'Run' : 'Open'}: ${ql.target}`,
          badge: ql.type.charAt(0).toUpperCase() + ql.type.slice(1),
          score: isKeywordTriggered ? score : Math.max(score - 10, 0),
          data: {
            quicklink: ql,
            action: 'open',
          },
        });
      }
    }

    // Show "Create quicklink" when using keyword trigger with no matches
    if (isKeywordTriggered && searchTerm && results.length === 0) {
      results.push({
        id: 'quicklink-create-hint',
        type: PluginResultType.Info,
        title: '➕ Create Quicklink',
        subtitle: `Use ql:add <name> <url|path|command> to create a quicklink`,
        score: 70,
        data: {
          action: 'create-hint',
        },
      });
    }

    return results;
  }

  /**
   * Execute when user selects a result
   */
  async execute(result: PluginResult): Promise<void> {
    const action = result.data?.action as string;
    const ql = result.data?.quicklink as Quicklink | undefined;

    switch (action) {
      case 'open': {
        if (!ql) return;
        try {
          await invoke('open_quicklink', { quicklink: ql });
          logger.info(`Opened quicklink: ${ql.name} → ${ql.target}`);
        } catch (error) {
          logger.error(`Failed to open quicklink ${ql.name}:`, error);
          // Fallback for URLs
          if (ql.type === 'url') {
            await openUrl(ql.target);
          }
        }
        break;
      }
      case 'save': {
        if (!ql) return;
        try {
          await invoke('save_quicklink', { quicklink: ql });
          logger.info(`Saved quicklink: ${ql.shortcut} → ${ql.target}`);
          await this.refreshCache();
        } catch (error) {
          logger.error(`Failed to save quicklink:`, error);
        }
        break;
      }
      case 'delete': {
        if (!ql) return;
        try {
          await invoke('delete_quicklink', { id: ql.id });
          logger.info(`Deleted quicklink: ${ql.shortcut}`);
          await this.refreshCache();
        } catch (error) {
          logger.error(`Failed to delete quicklink:`, error);
        }
        break;
      }
      case 'create-hint':
      case 'list':
        // No-op; informational display
        break;
    }
  }

  /**
   * Handle management commands (ql:add, ql:list, ql:remove)
   */
  private async handleManagementCommand(
    action: string,
    args: string
  ): Promise<PluginResult[]> {
    switch (action) {
      case 'add':
        return this.handleAdd(args);
      case 'list':
        return this.handleList();
      case 'remove':
        return this.handleRemove(args);
      default:
        return [];
    }
  }

  /**
   * Handle ql:add <name> <target>
   * Auto-detects type from target:
   * - Starts with http/https → url
   * - Looks like a path → folder
   * - Otherwise → command
   */
  private async handleAdd(args: string): Promise<PluginResult[]> {
    if (!args.trim()) {
      return [
        {
          id: 'quicklink-add-help',
          type: PluginResultType.Info,
          title: '➕ Create Quicklink',
          subtitle: 'Usage: ql:add <shortcut> <target> (e.g., ql:add gh https://github.com)',
          score: 90,
          data: { action: 'create-hint' },
        },
      ];
    }

    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      return [
        {
          id: 'quicklink-add-incomplete',
          type: PluginResultType.Info,
          title: '➕ Create Quicklink',
          subtitle: `Provide a target: ql:add ${parts[0]} <url|path|command>`,
          score: 90,
          data: { action: 'create-hint' },
        },
      ];
    }

    const shortcut = parts[0];
    const target = parts.slice(1).join(' ');
    const type = this.detectType(target);
    const icon = TYPE_ICONS[type];

    const quicklink: Quicklink = {
      id: crypto.randomUUID(),
      name: shortcut,
      shortcut: shortcut,
      target: target,
      type: type,
    };

    return [
      {
        id: 'quicklink-add-confirm',
        type: PluginResultType.Info,
        title: `${icon} Create "${shortcut}" → ${target}`,
        subtitle: `Press Enter to save (type: ${type})`,
        score: 95,
        data: {
          quicklink,
          action: 'save',
        },
      },
    ];
  }

  /**
   * Handle ql:list - show all quicklinks
   */
  private async handleList(): Promise<PluginResult[]> {
    let quicklinks: Quicklink[] = [];
    try {
      quicklinks = await invoke<Quicklink[]>('get_quicklinks');
    } catch {
      return [
        {
          id: 'quicklink-list-error',
          type: PluginResultType.Info,
          title: '⚠️ Failed to load quicklinks',
          subtitle: 'Could not retrieve quicklinks from storage',
          score: 90,
          data: { action: 'list' },
        },
      ];
    }

    if (quicklinks.length === 0) {
      return [
        {
          id: 'quicklink-list-empty',
          type: PluginResultType.Info,
          title: '📋 No Quicklinks',
          subtitle: 'Use ql:add <shortcut> <target> to create one',
          score: 90,
          data: { action: 'list' },
        },
      ];
    }

    return quicklinks.map((ql, index) => {
      const icon = ql.icon || TYPE_ICONS[ql.type];
      return {
        id: `quicklink-list-${ql.id}`,
        type: PluginResultType.Info,
        title: `${icon} ${ql.shortcut} → ${ql.target}`,
        subtitle: `${ql.name} (${ql.type})`,
        badge: ql.type.charAt(0).toUpperCase() + ql.type.slice(1),
        score: 90 - index,
        data: {
          quicklink: ql,
          action: 'open',
        },
      };
    });
  }

  /**
   * Handle ql:remove <name>
   */
  private async handleRemove(args: string): Promise<PluginResult[]> {
    if (!args.trim()) {
      return [
        {
          id: 'quicklink-remove-help',
          type: PluginResultType.Info,
          title: '🗑️ Remove Quicklink',
          subtitle: 'Usage: ql:remove <shortcut> (e.g., ql:remove gh)',
          score: 90,
          data: { action: 'create-hint' },
        },
      ];
    }

    const searchTerm = args.trim().toLowerCase();
    let quicklinks: Quicklink[] = [];
    try {
      quicklinks = await invoke<Quicklink[]>('get_quicklinks');
    } catch {
      return [];
    }

    const matches = quicklinks.filter(
      (ql) =>
        ql.shortcut.toLowerCase().includes(searchTerm) ||
        ql.name.toLowerCase().includes(searchTerm)
    );

    if (matches.length === 0) {
      return [
        {
          id: 'quicklink-remove-notfound',
          type: PluginResultType.Info,
          title: '🗑️ No matching quicklinks',
          subtitle: `No quicklink found matching "${args.trim()}"`,
          score: 90,
          data: { action: 'list' },
        },
      ];
    }

    return matches.map((ql) => {
      const icon = ql.icon || TYPE_ICONS[ql.type];
      return {
        id: `quicklink-remove-${ql.id}`,
        type: PluginResultType.Info,
        title: `🗑️ Remove "${ql.shortcut}" (${icon} ${ql.target})`,
        subtitle: 'Press Enter to remove',
        score: 90,
        data: {
          quicklink: ql,
          action: 'delete',
        },
      };
    });
  }

  /**
   * Detect quicklink type from target string
   */
  private detectType(target: string): Quicklink['type'] {
    // URL detection
    if (/^https?:\/\//i.test(target) || /^www\./i.test(target)) {
      return 'url';
    }

    // Path detection (Windows or Unix paths)
    if (/^[a-zA-Z]:\\/.test(target) || /^\//.test(target) || /^~\//.test(target)) {
      return 'folder';
    }

    // Default to command
    return 'command';
  }
}
