// Plugin system types

export type ActionHandler =
  | 'openUrl'
  | 'copyToClipboard'
  | 'openFile'
  | 'runCommand'
  | 'custom';

export interface PluginResultAction {
  id: string;
  title: string;
  icon?: string;
  /** e.g. "cmd+shift+c" */
  shortcut?: string;
  handler: ActionHandler;
  data?: Record<string, unknown>;
}

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
  ShellCommand = 'shellcommand',
  GridItem = 'grid',
  AiChat = 'aichat',
}

/**
 * Declarative activation manifest — the single source of truth for *when* a
 * built-in plugin should surface results. Replaces the per-plugin bespoke
 * `canHandle` prefix/keyword logic and the duplicated `PLUGIN_KEYWORDS` map
 * that used to live in `useSearchPipeline`.
 *
 * A plugin is activated when EITHER:
 *   - the trimmed query starts with one of `prefixes` (symbolic triggers like
 *     `:`, `>`, `;`, `ql:`), OR
 *   - the trimmed query equals, or starts with `<keyword><separator>`, one of
 *     `keywords` (natural-language names — separator is whitespace or `:`).
 *
 * The plugin's own `name` is auto-injected as a keyword by `matchActivation`,
 * which guarantees every built-in is discoverable by typing its name.
 *
 * `mode`:
 *   - `'declarative'` (default): `canHandle` is fully driven by the manifest.
 *   - `'always'`: activates for any query of length >= `minLength` (used by
 *     name-matching plugins like games). `keywords`/`prefixes` still drive the
 *     `matchKind` annotation used for scoring.
 *   - `'custom'`: the plugin keeps its own `canHandle`; `keywords`/`prefixes`
 *     are used ONLY to compute `matchKind` for scoring.
 */
export type PluginActivationMode = 'declarative' | 'always' | 'custom';

export interface PluginActivation {
  /** Symbolic prefixes that hard-trigger the plugin (e.g. ':', '>', ';', 'ql:'). */
  prefixes?: string[];
  /** Natural-language keywords (lowercased). The plugin's `name` is auto-added. */
  keywords?: string[];
  /** Activation strategy. Defaults to 'declarative'. */
  mode?: PluginActivationMode;
  /** For `mode: 'always'`, minimum trimmed-query length to activate. Default 2. */
  minLength?: number;
}

/** How a query matched a plugin's activation manifest — drives result scoring. */
export type ActivationKind = 'prefix' | 'keyword' | 'always' | 'none';

export interface ActivationMatch {
  matched: boolean;
  kind: ActivationKind;
  /**
   * The query with the matched prefix/keyword removed and trimmed. Empty string
   * for a bare keyword/prefix (browse mode). For `always`/`none` it is the full
   * trimmed query. Plugins read this instead of re-parsing their own prefix.
   */
  stripped: string;
  /** The prefix or keyword that matched (diagnostics / scoring granularity). */
  token?: string;
}

/**
 * Raycast-style right-side accessory chip.
 * [SYNC: src/shared/types/common.types.ts::PluginResultAccessory]
 */
export interface PluginResultAccessory {
  icon?: string;
  text?: string;
  color?: string;
  tag?: boolean;
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
  actions?: PluginResultAction[];
  /** Raycast-style right-side accessories: CI, review decision, date, stars… */
  accessories?: PluginResultAccessory[];
  /** Sub-section label for grouping within the results list */
  section?: string;
  /** Render this result in a grid layout (used with PluginResultType.GridItem) */
  layout?: 'grid';
  /**
   * How the originating query matched the plugin's activation manifest.
   * Annotated by the registry (`prefix`/`keyword` → scoring boost). Plugins
   * normally do not set this themselves.
   */
  matchKind?: ActivationKind;
}

export interface PluginContext {
  query: string;
  settings?: Record<string, unknown>;
  /**
   * Pre-computed activation match for this query against the plugin being
   * queried. Injected by the registry so `canHandle`/`match` share one parse.
   * Absent when a plugin is invoked directly (e.g. in unit tests) — in that
   * case `resolveActivation` recomputes it on the fly.
   */
  activation?: ActivationMatch;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;

  /**
   * Declarative activation manifest. When present, the registry pre-computes a
   * match and injects it into the context. Plugins with `mode: 'declarative'`
   * delegate `canHandle` entirely to it; `'custom'`/`'always'` plugins keep
   * their own `canHandle` but still benefit from `matchKind` scoring.
   */
  activation?: PluginActivation;

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
  applyEnabledSet(enabledIds: string[], managedIds: string[]): void;
  query(context: PluginContext): Promise<PluginResult[]>;
}
