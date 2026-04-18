/**
 * Extension Loader
 *
 * This module handles dynamic loading and execution of external extensions.
 * Extensions are loaded from the filesystem and their code is executed
 * to register plugins with the pluginRegistry.
 *
 * Supports multi-file extensions with automatic bundling.
 */

import { invoke } from '@tauri-apps/api/core';
import { transform } from 'sucrase';
import { logger } from '../../../shared/utils/logger';
import { pluginRegistry } from '../../plugins/core';
import { Plugin } from '../../plugins/types';
import {
  isExtensionPermission,
  type ExtensionManifest,
  type ExtensionPermission,
} from '../types/extension.types';
import { WorkerPlugin } from './worker-sandbox';

/**
 * Filter an arbitrary permission list down to known `ExtensionPermission`
 * values. Unknown entries are dropped and logged so a misbehaving or malicious
 * manifest can't smuggle fictitious permissions through to the consent dialog
 * or the Worker sandbox.
 *
 * Deduplicates results to keep downstream code (sets, UI lists) tidy.
 */
function sanitizePermissions(
  permissions: readonly unknown[] | undefined | null,
  context: string
): ExtensionPermission[] {
  if (!permissions || permissions.length === 0) {
    return [];
  }
  const valid: ExtensionPermission[] = [];
  const seen = new Set<ExtensionPermission>();
  const unknown: unknown[] = [];
  for (const perm of permissions) {
    if (isExtensionPermission(perm)) {
      if (!seen.has(perm)) {
        seen.add(perm);
        valid.push(perm);
      }
    } else {
      unknown.push(perm);
    }
  }
  if (unknown.length > 0) {
    logger.warn(
      `[ExtensionLoader] ${context} — dropping unknown permission(s):`,
      unknown
    );
  }
  return valid;
}

// Ensure VoltAPI is available globally
import '../api';

/**
 * Extension source from backend
 */
interface ExtensionSource {
  id: string;
  manifest: ExtensionManifest;
  source: string;
  entryPoint: string;
  files: Record<string, string>;
}

/**
 * Loaded extension info
 */
export interface LoadedExtension {
  id: string;
  manifest: ExtensionManifest;
  plugin: Plugin;
}

/**
 * Extension Loader class
 */
export class ExtensionLoader {
  private loadedExtensions: Map<string, LoadedExtension> = new Map();

  /**
   * Callback to request permission consent from the user.
   * Set by the UI layer (e.g., App component).
   * Returns the list of granted permissions, or empty array if denied.
   */
  private permissionRequestHandler:
    | ((
        extensionName: string,
        permissions: ExtensionPermission[]
      ) => Promise<ExtensionPermission[]>)
    | null = null;

  /**
   * Register a handler for permission consent requests.
   */
  setPermissionRequestHandler(
    handler: (
      extensionName: string,
      permissions: ExtensionPermission[]
    ) => Promise<ExtensionPermission[]>
  ): void {
    this.permissionRequestHandler = handler;
  }

  /**
   * Load all enabled extensions
   */
  async loadAllExtensions(): Promise<LoadedExtension[]> {
    try {
      console.log('[ExtensionLoader] Loading all enabled extensions...');

      const sources = await invoke<ExtensionSource[]>('get_enabled_extensions_sources');

      console.log(`[ExtensionLoader] Found ${sources.length} enabled extensions`);

      if (sources.length === 0) {
        console.log('[ExtensionLoader] No extensions found. Make sure extensions are installed and enabled.');
      } else {
        console.log('[ExtensionLoader] Extensions to load:', sources.map(s => s.id).join(', '));
      }

      const loaded: LoadedExtension[] = [];

      for (const source of sources) {
        try {
          const extension = await this.loadExtension(source);
          if (extension) {
            loaded.push(extension);
          }
        } catch (error) {
          logger.error(`[ExtensionLoader] Failed to load ${source.id}:`, error);
        }
      }

      console.log(`[ExtensionLoader] Successfully loaded ${loaded.length} extensions`);
      return loaded;
    } catch (error) {
      logger.error('[ExtensionLoader] Failed to load extensions:', error);
      return [];
    }
  }

  /**
   * Get granted permissions for an installed extension from the backend.
   *
   * The Rust side stores permissions as raw strings; we sanitize here so that
   * only known `ExtensionPermission` values surface to the TS runtime.
   */
  private async getGrantedPermissions(extensionId: string): Promise<ExtensionPermission[]> {
    try {
      const installed = await invoke<{ manifest: { id: string }; grantedPermissions?: string[] }[]>(
        'get_installed_extensions'
      );
      const ext = installed.find((e) => e.manifest.id === extensionId);
      return sanitizePermissions(
        ext?.grantedPermissions,
        `granted permissions for ${extensionId}`
      );
    } catch {
      return [];
    }
  }

  /**
   * Resolve permissions for an extension: check if already granted, prompt if not.
   * Returns the granted permissions array.
   */
  private async resolvePermissions(
    extensionId: string,
    extensionName: string,
    requiredPermissions: ExtensionPermission[]
  ): Promise<ExtensionPermission[]> {
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return [];
    }

    // Check what's already granted
    const alreadyGranted = await this.getGrantedPermissions(extensionId);
    const missing = requiredPermissions.filter((p) => !alreadyGranted.includes(p));

    if (missing.length === 0) {
      return alreadyGranted;
    }

    // Ask user for consent
    if (this.permissionRequestHandler) {
      const rawGranted = await this.permissionRequestHandler(
        extensionName,
        requiredPermissions
      );
      // Defensive: handler is typed but lives outside this module — re-sanitize.
      const granted = sanitizePermissions(
        rawGranted,
        `consent response for ${extensionId}`
      );
      if (granted.length > 0) {
        // Persist granted permissions. For dev extensions the Rust side has no
        // matching installed record, so this is an intentional no-op (the IPC
        // resolves with NotFound and we swallow the error) — dev sources
        // re-prompt on every reload by design.
        await invoke('update_extension_permissions', {
          extensionId,
          permissions: granted,
        }).catch((err) => {
          logger.warn(`[ExtensionLoader] Failed to persist permissions for ${extensionId}:`, err);
        });
      }
      return granted;
    }

    // No handler registered — deny by default
    logger.warn(`[ExtensionLoader] No permission handler — denying permissions for ${extensionId}`);
    return [];
  }

  /**
   * Load a single extension from source
   */
  private async loadExtension(source: ExtensionSource): Promise<LoadedExtension | null> {
    const { id, manifest } = source;

    console.log(`[ExtensionLoader] Loading extension: ${manifest.name} (${id})`);
    console.log(`[ExtensionLoader] Files available:`, Object.keys(source.files));

    try {
      const hasKeywords = manifest.keywords && manifest.keywords.length > 0;
      const hasPrefix = !!manifest.prefix;

      // Resolve permissions before loading. Sanitize the manifest first so
      // that fictitious permission strings can neither reach the consent
      // dialog nor be persisted as granted.
      const requiredPermissions = sanitizePermissions(
        manifest.permissions,
        `manifest permissions for ${id}`
      );
      const grantedPermissions = await this.resolvePermissions(
        id,
        manifest.name,
        requiredPermissions
      );

      // If extension requires permissions but none were granted, skip it
      if (requiredPermissions.length > 0 && grantedPermissions.length === 0) {
        console.warn(`[ExtensionLoader] Extension ${id} skipped — permissions denied`);
        return null;
      }

      if (hasKeywords || hasPrefix) {
        return this.loadInWorker(source, grantedPermissions);
      } else {
        // Extensions without keywords/prefix cannot be loaded safely in the Worker sandbox.
        // Inline execution (legacy mode) is disabled for security — it would run untrusted
        // code in the main renderer with full access to the DOM and Tauri IPC.
        console.warn(
          `[ExtensionLoader] Extension ${id} has no keywords/prefix — cannot load safely. ` +
          `Add "keywords" or "prefix" to the extension manifest to enable Worker sandbox loading.`
        );
        return null;
      }
    } catch (error) {
      logger.error(`[ExtensionLoader] Error loading ${id}:`, error);
      return null;
    }
  }

  /**
   * Load extension in a Web Worker sandbox.
   * The Worker gets its own thread — canHandle is declarative on main thread.
   */
  private loadInWorker(
    source: ExtensionSource,
    grantedPermissions: ExtensionPermission[]
  ): LoadedExtension | null {
    const { id, manifest } = source;

    console.log(`[ExtensionLoader] Loading ${id} in Worker sandbox`);

    // Bundle the extension modules (reuse existing bundling logic)
    const bundledCode = this.bundleExtension(source);

    // Extract just the module code (remove the header and return statement
    // that buildBundleWithOrder adds — the Worker bootstrap generates its own)
    const moduleCode = this.extractModuleCode(bundledCode);

    // Create WorkerPlugin proxy
    // grantedPermissions will be populated by the consent flow (wired in task #22)
    const plugin = new WorkerPlugin({
      id,
      name: manifest.name,
      description: manifest.description || '',
      keywords: manifest.keywords || [],
      prefix: manifest.prefix || null,
      bundledModuleCode: moduleCode,
      entryPoint: source.entryPoint,
      grantedPermissions,
    });

    // Register with plugin registry
    pluginRegistry.register(plugin);

    const loaded: LoadedExtension = { id, manifest, plugin };
    this.loadedExtensions.set(id, loaded);

    console.log(`[ExtensionLoader] Successfully loaded in Worker: ${manifest.name}`);
    return loaded;
  }

  /**
   * Extract just the module IIFE code from a full bundle.
   * Strips the header (use strict, helpers, VoltAPI) and footer (entry point return).
   * This is used by loadInWorker — the Worker bootstrap generates its own header/footer.
   */
  private extractModuleCode(fullBundle: string): string {
    // Find the first module IIFE marker
    const moduleStart = fullBundle.indexOf('// Module:');
    // Find the entry point marker
    const entryStart = fullBundle.indexOf('// Entry point');

    if (moduleStart === -1) {
      // No modules found — return empty (extension has only entry point inline)
      return '';
    }

    if (entryStart === -1) {
      // No entry point marker — return everything from first module
      return fullBundle.substring(moduleStart);
    }

    // Return just the module IIFEs between the markers
    return fullBundle.substring(moduleStart, entryStart).trim();
  }

  /**
   * Bundle all extension files into a single executable code
   */
  private bundleExtension(source: ExtensionSource): string {
    const { files, entryPoint } = source;

    // Filter source files only
    const sourceFiles: Record<string, string> = {};
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
        sourceFiles[filePath] = content;
      }
    }

    // Sort modules by dependency order FIRST (using original code)
    const sortedPaths = this.sortModulesByDependency(sourceFiles, entryPoint);
    console.log('[ExtensionLoader] Module order:', sortedPaths);

    // Transform each module
    const transformedModules: Record<string, string> = {};
    for (const filePath of sortedPaths) {
      const content = sourceFiles[filePath];
      if (content) {
        transformedModules[filePath] = this.transformModuleCode(content, filePath);
      }
    }

    // Build the bundled code with sorted modules
    const bundledCode = this.buildBundleWithOrder(transformedModules, sortedPaths, entryPoint);

    return bundledCode;
  }

  /**
   * Transform a single module's code via Sucrase AST-based transforms.
   *
   * Security note: previous implementation used regex replacements on the raw
   * source string, which is forgeable — a string literal like
   * `"import { x } from '../../api'"` would get rewritten, and carefully
   * crafted source could leak references to VoltAPI past the Worker sandbox
   * boundary. Sucrase runs a real lexer/parser: `import`/`export` tokens are
   * only matched at statement level, never inside strings, template literals,
   * or comments.
   *
   * We use Sucrase's `['typescript', 'imports']` pipeline which:
   *  - strips TS type annotations and type-only imports/re-exports
   *  - transforms every top-level ESM `import`/`export` into CommonJS
   *    `require(...)` / `exports.X = ...` form
   * Sucrase's output references `require`, `exports`, and `module` as free
   * identifiers — the module IIFE in {@link buildBundleWithOrder} supplies
   * those as locals (sandbox CJS emulation), so the bundled code runs without
   * any additional text-level rewriting.
   */
  private transformModuleCode(code: string, filePath: string): string {
    console.log(
      `[ExtensionLoader] [${filePath}] Original code:`,
      code.substring(0, 500)
    );

    try {
      const result = transform(code, {
        transforms: ['typescript', 'imports'],
        // filePath helps Sucrase produce better error messages.
        filePath,
      });
      console.log(
        `[ExtensionLoader] [${filePath}] After Sucrase:`,
        result.code.substring(0, 500)
      );
      return result.code;
    } catch (error) {
      logger.error(
        `[ExtensionLoader] [${filePath}] Sucrase transform failed:`,
        error
      );
      // Fall back to original source — almost certainly broken, but better
      // than silently producing a bundle with half the module stripped.
      return code;
    }
  }

  /**
   * Resolve import path relative to current file
   */
  private resolveImportPath(importPath: string, currentFile: string): string {
    if (!importPath.startsWith('.')) {
      return importPath;
    }

    const currentDir = currentFile.includes('/')
      ? currentFile.substring(0, currentFile.lastIndexOf('/'))
      : '';

    const parts = importPath.split('/');
    const currentParts = currentDir ? currentDir.split('/') : [];

    for (const part of parts) {
      if (part === '.') {
        continue;
      } else if (part === '..') {
        currentParts.pop();
      } else {
        currentParts.push(part);
      }
    }

    let resolved = currentParts.join('/');

    // Add .ts extension if not present
    if (!resolved.endsWith('.ts') && !resolved.endsWith('.js')) {
      resolved += '.ts';
    }

    return resolved;
  }

  /**
   * Build the final bundle from all modules with pre-sorted order.
   *
   * Each module is wrapped in an IIFE that provides CommonJS-compatible
   * locals (`require`, `exports`, `module`) as well as the Volt-specific
   * `__secureRandomInt__` helper and a `VoltAPI` shim (mapped to the global
   * in the renderer bundle, or the Worker-side mock in the Worker bundle).
   *
   * The `require` function inside each IIFE only resolves to:
   *   - `crypto` → a tiny Web Crypto adapter exposing `randomInt`
   *   - the Volt extension API (`volt-api`, `'/api'`, `'../../api'`, etc.)
   *   - a previously bundled module from `__modules__`
   * It does NOT fetch from the network or touch the real CommonJS require,
   * so the bundle can never reach out for arbitrary modules at runtime.
   */
  private buildBundleWithOrder(
    modules: Record<string, string>,
    sortedPaths: string[],
    entryPoint: string
  ): string {
    // Build the bundle
    let bundle = `
"use strict";

// Secure random number generator (Web Crypto API)
function __secureRandomInt__(min, max) {
  const range = max - min;
  const randomBuffer = new Uint32Array(1);
  crypto.getRandomValues(randomBuffer);
  return min + (randomBuffer[0] % range);
}

// Module registry
const __modules__ = {};

// NOTE: the renderer-side inline-execution path is currently disabled (see
// loadExtension in index.ts — extensions without keywords/prefix are rejected),
// so this header only ever runs stripped-down inside the Worker bootstrap,
// which injects its own VoltAPI mock. If the renderer path is ever
// re-enabled it MUST assign VoltAPI explicitly from window.VoltAPI and fail
// loud when absent — do NOT re-introduce the previous
// \`const VoltAPI = ... || VoltAPI\` self-fallback: the RHS refers to the same
// TDZ binding and throws ReferenceError in any context where window.VoltAPI
// is unavailable.

// Shim surfaced to extension code when it does \`import { PluginResultType } from '../../api'\`.
// Intentionally minimal: only values that extensions legitimately consume at runtime.
const __voltApiShim__ = Object.freeze({
  PluginResultType: VoltAPI.types.PluginResultType,
  copyToClipboard: VoltAPI.utils.copyToClipboard,
  openUrl: VoltAPI.utils.openUrl,
  formatNumber: VoltAPI.utils.formatNumber,
  fuzzyScore: VoltAPI.utils.fuzzyScore,
  notify: VoltAPI.notify ? VoltAPI.notify.bind(VoltAPI) : function() {},
  events: VoltAPI.events,
});

// Adapter for Node.js 'crypto' — only exposes what extensions legitimately need.
const __cryptoShim__ = Object.freeze({
  randomInt: function(min, max) { return __secureRandomInt__(min, max); },
});

// i18n API for extensions
const VoltI18n = {
  addTranslations: function(lng, namespace, resources) {
    const prefixed = 'ext-' + namespace;
    if (typeof window !== 'undefined' && typeof window.__volt_i18n_addBundle__ === 'function') {
      window.__volt_i18n_addBundle__(lng, prefixed, resources);
    }
  }
};

// Shared require-path resolver. Relative paths resolve against the caller
// module's directory; bare specifiers fall through to the shim tables.
function __resolveRelativePath__(requestPath, fromPath) {
  if (!requestPath.startsWith('.')) return requestPath;
  var fromDir = fromPath.includes('/') ? fromPath.substring(0, fromPath.lastIndexOf('/')) : '';
  var parts = requestPath.split('/');
  var base = fromDir ? fromDir.split('/') : [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p === '.') continue;
    if (p === '..') { base.pop(); continue; }
    base.push(p);
  }
  var resolved = base.join('/');
  if (!/\\.(ts|js)$/.test(resolved)) resolved += '.ts';
  return resolved;
}

function __voltRequire__(requestPath, fromPath) {
  if (requestPath === 'crypto') return __cryptoShim__;
  // Only exact "volt-api" or a specifier whose final path segment is "api"
  // (optionally with a .ts/.js/.tsx/.jsx/.mjs extension) resolves to the shim.
  // This matches the legitimate patterns \`import ... from '../../api'\` and
  // \`import ... from './api.ts'\` while rejecting mid-path segments like
  // '../../vendor/api/foo' — otherwise a malicious extension could shadow its
  // own bundled 'vendor/api/foo.ts' module with the frozen shim and subvert
  // its module graph.
  if (requestPath === 'volt-api' || /(?:^|\\/)api(?:\\.(?:ts|js|tsx|jsx|mjs))?$/.test(requestPath)) {
    return __voltApiShim__;
  }
  var resolved = __resolveRelativePath__(requestPath, fromPath);
  var mod = __modules__[resolved];
  if (!mod) {
    // Return an empty module rather than throwing, so optional side-effect
    // imports don't crash the whole extension. A warning would be useful,
    // but we avoid noise for type-only imports that Sucrase already stripped.
    return {};
  }
  return mod;
}

`;

    // Add each module in sorted order. Each module gets its own CommonJS
    // environment — `require`, `exports`, `module` — so Sucrase's CJS output
    // runs verbatim without any post-transform text rewriting.
    for (const modulePath of sortedPaths) {
      const code = modules[modulePath];
      if (!code) continue;

      const escapedPath = JSON.stringify(modulePath);
      bundle += `
// Module: ${modulePath}
(function() {
  var exports = {};
  var module = { exports: exports };
  function require(p) { return __voltRequire__(p, ${escapedPath}); }
  ${code}
  // Honour \`module.exports = ...\` reassignment (rare but legal).
  __modules__[${escapedPath}] = (module.exports !== exports) ? module.exports : exports;
})();
`;
    }

    // Add entry point execution
    const normalizedEntry = entryPoint.endsWith('.ts') || entryPoint.endsWith('.js')
      ? entryPoint
      : entryPoint + '.ts';

    bundle += `
// Entry point
const __entryModule__ = __modules__["${normalizedEntry}"];
const __defaultExport__ = __entryModule__?.default;
return __defaultExport__;
`;

    return bundle;
  }

  /**
   * Sort modules by dependency order
   */
  private sortModulesByDependency(modules: Record<string, string>, entryPoint: string): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();

    const visit = (path: string) => {
      if (visited.has(path)) return;
      visited.add(path);

      const code = modules[path];
      if (!code) return;

      // Find dependencies.
      //
      // Note: this is a raw-source regex pass rather than an AST-based one. It
      // is used ONLY to compute a visit order for the dependency-free topological
      // sort below; the actual module transform goes through Sucrase (see
      // transformModuleCode) and runtime specifier resolution goes through
      // __voltRequire__ inside each IIFE. A false positive here (e.g. an
      // import-like string literal) only over-includes a module in the visit
      // order — it cannot pull an extra file into the bundle, nor escape the
      // shim. A false negative cannot occur for a real import. We intentionally
      // keep this simple rather than running a second Sucrase pass.
      const importMatches = code.matchAll(/from\s*['"]\.([^'"]+)['"]/g);
      for (const match of importMatches) {
        const depPath = this.resolveImportPath('.' + match[1], path);
        visit(depPath);
      }

      sorted.push(path);
    };

    // Visit all modules starting from entry point
    const normalizedEntry = entryPoint.endsWith('.ts') || entryPoint.endsWith('.js')
      ? entryPoint
      : entryPoint + '.ts';
    visit(normalizedEntry);

    // Also visit any unvisited modules
    for (const path of Object.keys(modules)) {
      if (!visited.has(path)) {
        visit(path);
      }
    }

    return sorted;
  }

  /**
   * Unload an extension
   */
  unloadExtension(extensionId: string): boolean {
    const extension = this.loadedExtensions.get(extensionId);
    if (!extension) {
      return false;
    }

    // Unregister from plugin registry
    pluginRegistry.unregister(extensionId);

    // Destroy Worker if it's a WorkerPlugin
    if (extension.plugin && 'destroy' in extension.plugin) {
      (extension.plugin as WorkerPlugin).destroy();
    }

    // Remove from loaded extensions
    this.loadedExtensions.delete(extensionId);

    console.log(`[ExtensionLoader] Unloaded extension: ${extensionId}`);
    return true;
  }

  /**
   * Reload an extension
   */
  async reloadExtension(extensionId: string): Promise<boolean> {
    this.unloadExtension(extensionId);

    try {
      const source = await invoke<ExtensionSource>('read_extension_source', { extensionId });
      const extension = await this.loadExtension(source);
      return extension !== null;
    } catch (error) {
      logger.error(`[ExtensionLoader] Failed to reload ${extensionId}:`, error);
      return false;
    }
  }

  /**
   * Get all loaded extensions
   */
  getLoadedExtensions(): LoadedExtension[] {
    return Array.from(this.loadedExtensions.values());
  }

  /**
   * Check if an extension is loaded
   */
  isLoaded(extensionId: string): boolean {
    return this.loadedExtensions.has(extensionId);
  }
}

// Singleton instance
export const extensionLoader = new ExtensionLoader();
