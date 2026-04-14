import { invoke } from '@tauri-apps/api/core';
import { PluginResultType, type Plugin, PluginContext, PluginResult } from '../plugins/types';
import { logger } from '../../shared/utils';
import { isClipboardItem } from '../../shared/utils/typeGuards';
import type { ClipboardItem } from '../../shared/types/clipboard';

/**
 * Clipboard History Plugin
 *
 * Provides quick access to clipboard history with search, pin, and paste functionality.
 * Trigger: 'clipboard', 'clip', 'cb', or just type to search
 */
export class ClipboardPlugin implements Plugin {
  id = 'clipboard';
  name = 'Clipboard History';
  description = 'Search and manage clipboard history';
  enabled = true;
  triggers = ['clipboard', 'clip', 'cb', 'history'];
  priority = 80;

  private cache: ClipboardItem[] | null = null;
  private cacheTime = 0;
  private readonly CACHE_TTL = 2000; // 2 seconds

  canHandle(context: PluginContext): boolean {
    const query = context.query.toLowerCase().trim();

    // Always handle if starts with trigger word
    if (this.triggers.some((trigger) => query.startsWith(trigger))) {
      return true;
    }

    return false;
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.toLowerCase().trim();

    // Remove trigger word if present
    let searchQuery = query;
    for (const trigger of this.triggers) {
      if (query.startsWith(trigger)) {
        searchQuery = query.slice(trigger.length).trim();
        break;
      }
    }

    try {
      let items: ClipboardItem[];

      // Use cache if valid
      const now = Date.now();
      const cacheValid = this.cache && now - this.cacheTime < this.CACHE_TTL;

      if (cacheValid && searchQuery.length === 0) {
        // Cache hit, no query - return cached results directly
        items = this.cache!;
      } else if (cacheValid && searchQuery.length > 0) {
        // Cache hit with query - filter from cache in-memory
        const lowerQuery = searchQuery.toLowerCase();
        items = this.cache!.filter(
          (item) =>
            item.content.toLowerCase().includes(lowerQuery) ||
            item.preview.toLowerCase().includes(lowerQuery)
        );
      } else {
        // Cache miss - fetch full history from backend
        const fullHistory = await invoke<ClipboardItem[]>('get_clipboard_history', {
          limit: 50,
        });
        this.cache = fullHistory;
        this.cacheTime = now;

        // Filter if needed
        if (searchQuery.length > 0) {
          const lowerQuery = searchQuery.toLowerCase();
          items = fullHistory.filter(
            (item) =>
              item.content.toLowerCase().includes(lowerQuery) ||
              item.preview.toLowerCase().includes(lowerQuery)
          );
        } else {
          items = fullHistory;
        }
      }

      // Convert to plugin results
      return items.map((item, index) => this.clipboardItemToResult(item, index));
    } catch (error) {
      logger.error('Failed to get clipboard history:', error);
      return [];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    if (!result.data) return;

    const item = result.data as unknown as ClipboardItem;
    if (!isClipboardItem(item)) {
      throw new Error('Invalid clipboard item data');
    }

    try {
      // Copy to clipboard
      await invoke('copy_to_clipboard', { content: item.content });

      // Hide window after paste
      await invoke('hide_window');

      // Emit success event
      window.dispatchEvent(
        new CustomEvent('volt:clipboard:copied', {
          detail: { id: item.id, preview: item.preview },
        })
      );
    } catch (error) {
      logger.error('Failed to copy to clipboard:', error);

      // Emit error event
      window.dispatchEvent(
        new CustomEvent('volt:clipboard:error', {
          detail: { error: String(error) },
        })
      );
    }
  }

  private clipboardItemToResult(item: ClipboardItem, index: number): PluginResult {
    const score = 100 - index; // Higher score for recent items

    // Format timestamp
    const date = new Date(item.timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    let timeAgo: string;
    if (diffMins < 1) {
      timeAgo = 'Just now';
    } else if (diffMins < 60) {
      timeAgo = `${diffMins}m ago`;
    } else if (diffHours < 24) {
      timeAgo = `${diffHours}h ago`;
    } else if (diffDays < 7) {
      timeAgo = `${diffDays}d ago`;
    } else {
      timeAgo = date.toLocaleDateString();
    }

    // Determine icon based on type
    let icon = '📋';
    if (item.contentType === 'image') {
      icon = '🖼️';
    } else if (item.contentType === 'files') {
      icon = '📁';
    } else if (item.pinned) {
      icon = '📌';
    }

    // Create subtitle with metadata
    const subtitle = `${timeAgo}${item.pinned ? ' • Pinned' : ''} • ${item.content.length} chars`;

    return {
      id: `clipboard-${item.id}`,
      type: PluginResultType.Clipboard,
      title: item.preview,
      subtitle,
      icon,
      score,
      data: item as unknown as Record<string, unknown>,
      pluginId: this.id,
    };
  }

  /**
   * Start automatic clipboard monitoring
   */
  static async startMonitoring(): Promise<void> {
    try {
      await invoke('start_clipboard_monitoring');
      logger.info('Clipboard monitoring started');
    } catch (error) {
      logger.error('Failed to start clipboard monitoring:', error);
    }
  }

  /**
   * Stop automatic clipboard monitoring
   */
  static async stopMonitoring(): Promise<void> {
    try {
      await invoke('stop_clipboard_monitoring');
      logger.info('Clipboard monitoring stopped');
    } catch (error) {
      logger.error('Failed to stop clipboard monitoring:', error);
    }
  }

  /**
   * Check if monitoring is active
   */
  static async isMonitoring(): Promise<boolean> {
    try {
      return await invoke<boolean>('is_clipboard_monitoring');
    } catch (error) {
      logger.error('Failed to check monitoring status:', error);
      return false;
    }
  }

  /**
   * Clear clipboard history
   */
  static async clearHistory(includePinned: boolean = false): Promise<void> {
    try {
      await invoke('clear_clipboard_history', { includePinned });
      window.dispatchEvent(new CustomEvent('volt:clipboard:cleared'));
    } catch (error) {
      logger.error('Failed to clear clipboard history:', error);
      throw error;
    }
  }
}
