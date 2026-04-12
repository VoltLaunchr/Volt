// Plugin system types

export enum PluginResultType {
  Calculator = 'calculator',
  WebSearch = 'websearch',
  SystemCommand = 'systemcommand',
  FileExplorer = 'fileexplorer',
  Timer = 'timer',
  SystemMonitor = 'systemmonitor',
  Steam = 'steam',
  Game = 'game',
  Clipboard = 'clipboard',
  Emoji = 'emoji',
  Info = 'info',
  Password = 'password',
}

export interface PluginResult {
  id: string;
  type: PluginResultType;
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: string; // Badge text displayed on the right (e.g., "Game", "App")
  score: number;
  data?: Record<string, unknown>;
  pluginId?: string; // ID of the plugin that created this result
}

export interface PluginContext {
  query: string;
  settings?: Record<string, unknown>;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;

  /**
   * Test if this plugin should handle the query
   * @returns true if plugin can handle this query
   */
  canHandle(context: PluginContext): boolean;

  /**
   * Generate results for the query
   * @returns array of plugin results or null if no matches
   */
  match(context: PluginContext): Promise<PluginResult[]> | PluginResult[] | null;

  /**
   * Execute the action for a plugin result
   */
  execute(result: PluginResult): Promise<void> | void;
}

export interface PluginRegistry {
  plugins: Map<string, Plugin>;
  register(plugin: Plugin): void;
  unregister(pluginId: string): void;
  getPlugin(pluginId: string): Plugin | undefined;
  getAllPlugins(): Plugin[];
  getEnabledPlugins(): Plugin[];
  query(context: PluginContext): Promise<PluginResult[]>;
}
