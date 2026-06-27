import { SEARCH_LIMITS } from '../../../shared/constants/searchScoring';
import { logger } from '../../../shared/utils/logger';
import { Plugin, PluginRegistry as IPluginRegistry, PluginContext, PluginResult } from '../types';
import { matchActivation } from './activation';

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
    logger.debug(`Plugin registered: ${plugin.name} (${plugin.id})`);
  }

  unregister(pluginId: string): void {
    if (this.plugins.has(pluginId)) {
      this.plugins.delete(pluginId);
      logger.debug(`Plugin unregistered: ${pluginId}`);
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
   * Apply the persisted `enabledPlugins` setting to the registered plugins.
   *
   * Only plugins whose id is in `managedIds` are gate-able: such a plugin is
   * enabled iff its id appears in `enabledIds`. Plugins not in `managedIds`
   * (e.g. ai-chat, developer) are always-on and left untouched. This is what
   * actually wires the Settings toggles to the runtime query path — previously
   * `enabledPlugins` was stored but never honoured.
   */
  applyEnabledSet(enabledIds: string[], managedIds: string[]): void {
    const enabled = new Set(enabledIds);
    const managed = new Set(managedIds);
    for (const plugin of this.plugins.values()) {
      if (managed.has(plugin.id)) {
        plugin.enabled = enabled.has(plugin.id);
      }
    }
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
        // Pre-compute the activation match once and inject it into the context
        // so both canHandle and match share a single parse. Plugins without an
        // activation manifest fall back to their own canHandle (custom logic).
        const activation = plugin.activation
          ? matchActivation(context.query, plugin.activation, plugin.name)
          : undefined;
        const pluginContext: PluginContext = activation ? { ...context, activation } : context;

        // Check if plugin can handle the query
        if (!plugin.canHandle(pluginContext)) {
          return null;
        }

        // Get results with timeout protection
        const timeoutMs = SEARCH_LIMITS.PLUGIN_TIMEOUT_MS;
        const matchPromise = Promise.resolve(plugin.match(pluginContext));
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => resolve(null), timeoutMs);
        });

        const pluginResults = await Promise.race([matchPromise, timeoutPromise]);
        if (timeoutId !== undefined) clearTimeout(timeoutId);

        if (pluginResults && Array.isArray(pluginResults)) {
          // Annotate each result with its plugin ID (for execution) and the
          // activation match kind (for deterministic scoring in the pipeline).
          return pluginResults.map((result) => ({
            ...result,
            pluginId: plugin.id,
            matchKind: result.matchKind ?? activation?.kind ?? 'none',
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
