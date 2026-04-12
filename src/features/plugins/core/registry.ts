import { logger } from '../../../shared/utils/logger';
import { Plugin, PluginRegistry as IPluginRegistry, PluginContext, PluginResult } from '../types';

export class PluginRegistry implements IPluginRegistry {
  plugins: Map<string, Plugin>;
  private initialized = false;

  constructor() {
    this.plugins = new Map();
  }

  /**
   * Check if a plugin is already registered
   */
  isRegistered(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Check if the registry has been initialized with built-in plugins
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Mark the registry as initialized (call after registering built-in plugins)
   */
  markInitialized(): void {
    this.initialized = true;
  }

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      // Skip silently if already registered (prevents StrictMode double-registration)
      return;
    }
    this.plugins.set(plugin.id, plugin);
    console.log(`✓ Plugin registered: ${plugin.name} (${plugin.id})`);
  }

  unregister(pluginId: string): void {
    if (this.plugins.has(pluginId)) {
      this.plugins.delete(pluginId);
      console.log(`✓ Plugin unregistered: ${pluginId}`);
    }
  }

  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getEnabledPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) => p.enabled);
  }

  /**
   * Query all enabled plugins for results
   * Handles errors gracefully to prevent one plugin from breaking the whole system
   */
  async query(context: PluginContext): Promise<PluginResult[]> {
    const enabledPlugins = this.getEnabledPlugins();
    const results: PluginResult[] = [];

    // Query plugins in parallel
    const promises = enabledPlugins.map(async (plugin) => {
      try {
        // Check if plugin can handle the query
        if (!plugin.canHandle(context)) {
          return null;
        }

        // Get results with timeout protection
        const timeoutMs = 500; // 500ms max per plugin
        const matchPromise = Promise.resolve(plugin.match(context));
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), timeoutMs)
        );

        const pluginResults = await Promise.race([matchPromise, timeoutPromise]);

        if (pluginResults && Array.isArray(pluginResults)) {
          // Add plugin ID to each result for execution later
          return pluginResults.map((result) => ({
            ...result,
            pluginId: plugin.id,
          }));
        }
        return null;
      } catch (error) {
        logger.error(`Plugin ${plugin.id} error:`, error);
        return null;
      }
    });

    const allResults = await Promise.all(promises);

    // Flatten and filter out null results
    for (const result of allResults) {
      if (result) {
        results.push(...result);
      }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }
}

// Singleton instance
export const pluginRegistry = new PluginRegistry();
