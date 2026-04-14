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
import type { ExtensionManifest } from '../types/extension.types';
import { WorkerPlugin } from './worker-sandbox';

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
    | ((extensionName: string, permissions: string[]) => Promise<string[]>)
    | null = null;

  /**
   * Register a handler for permission consent requests.
   */
  setPermissionRequestHandler(
    handler: (extensionName: string, permissions: string[]) => Promise<string[]>
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
   */
  private async getGrantedPermissions(extensionId: string): Promise<string[]> {
    try {
      const installed = await invoke<{ manifest: { id: string }; grantedPermissions?: string[] }[]>(
        'get_installed_extensions'
      );
      const ext = installed.find((e) => e.manifest.id === extensionId);
      return ext?.grantedPermissions || [];
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
    requiredPermissions: string[]
  ): Promise<string[]> {
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
      const granted = await this.permissionRequestHandler(extensionName, requiredPermissions);
      if (granted.length > 0) {
        // Persist granted permissions
        await invoke('update_extension_permissions', {
          extensionId,
          permissions: granted,
        }).catch((err) => {
          console.warn(`[ExtensionLoader] Failed to persist permissions for ${extensionId}:`, err);
        });
      }
      return granted;
    }

    // No handler registered — deny by default
    console.warn(`[ExtensionLoader] No permission handler — denying permissions for ${extensionId}`);
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

      // Resolve permissions before loading
      const requiredPermissions = manifest.permissions || [];
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
  private loadInWorker(source: ExtensionSource, grantedPermissions: string[]): LoadedExtension | null {
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
   * Transform a single module's code
   */
  private transformModuleCode(code: string, filePath: string): string {
    let transformed = code;

    console.log(`[ExtensionLoader] [${filePath}] Original code:`, transformed.substring(0, 500));

    // Remove TypeScript type annotations using Sucrase
    transformed = this.transpileTypeScript(transformed);
    console.log(`[ExtensionLoader] [${filePath}] After Sucrase:`, transformed.substring(0, 500));

    // Transform imports to use our module system
    transformed = this.transformImports(transformed, filePath);

    // Transform exports
    transformed = this.transformExports(transformed);

    // Replace Node.js crypto with Web Crypto API
    transformed = this.replaceNodeCrypto(transformed);

    console.log(`[ExtensionLoader] [${filePath}] Final code:`, transformed.substring(0, 500));

    return transformed;
  }

  /**
   * Transpile TypeScript to JavaScript using Sucrase
   * This properly handles all TypeScript syntax including:
   * - Type annotations, interfaces, type aliases
   * - Generics, union types, intersection types
   * - 'as const', 'as Type' assertions
   * - implements, extends clauses
   */
  private transpileTypeScript(code: string): string {
    try {
      const result = transform(code, {
        transforms: ['typescript'],
        // Note: disableESTransforms removed to allow class fields transformation
      });
      return result.code;
    } catch (error) {
      console.warn('[ExtensionLoader] Sucrase transpilation failed, returning original code:', error);
      return code;
    }
  }

  /**
   * Transform import statements
   */
  private transformImports(code: string, currentFile: string): string {
    let result = code;

    // Handle: import { X, Y } from './path'
    result = result.replace(
      /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"];?/g,
      (_match, imports, importPath) => {
        // Check if it's a relative import or API import
        if (importPath.includes('/api/') || importPath.includes('../../api')) {
          // Map to VoltAPI
          const importList = imports.split(',').map((s: string) => s.trim());
          return importList
            .map((name: string) => {
              const cleanName = name.split(' as ')[0].trim();
              if (cleanName === 'PluginResultType') {
                return `const ${cleanName} = VoltAPI.types.PluginResultType;`;
              }
              if (['Plugin', 'PluginContext', 'PluginResult'].includes(cleanName)) {
                return ''; // Types, not needed at runtime
              }
              return '';
            })
            .filter(Boolean)
            .join('\n');
        }

        // For relative imports, mark for module resolution
        const resolvedPath = this.resolveImportPath(importPath, currentFile);
        const importList = imports.split(',').map((s: string) => s.trim());
        return importList
          .map((name: string) => {
            const parts = name.split(' as ');
            const importName = parts[0].trim();
            const localName = parts[1]?.trim() || importName;
            // Skip empty imports (happens when Sucrase removes type-only imports)
            if (!importName || !localName) {
              return '';
            }
            return `const ${localName} = __modules__["${resolvedPath}"]?.${importName};`;
          })
          .filter(Boolean)
          .join('\n');
      }
    );

    // Handle: import X from './path'
    result = result.replace(
      /import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g,
      (_match, name, importPath) => {
        if (importPath === 'crypto') {
          return ''; // Will be handled by replaceNodeCrypto
        }
        const resolvedPath = this.resolveImportPath(importPath, currentFile);
        return `const ${name} = __modules__["${resolvedPath}"]?.default;`;
      }
    );

    // Handle: import './path' (side effect imports)
    result = result.replace(
      /import\s*['"]([^'"]+)['"];?/g,
      ''
    );

    return result;
  }

  /**
   * Transform export statements
   */
  private transformExports(code: string): string {
    let result = code;
    const namedExports: string[] = [];

    // Handle: export default X
    result = result.replace(
      /export\s+default\s+(\w+);?$/gm,
      '__exports__.default = $1;'
    );

    // Handle: export default class X
    result = result.replace(
      /export\s+default\s+class\s+(\w+)/g,
      (_match, name) => {
        namedExports.push(`default: ${name}`);
        return `class ${name}`;
      }
    );

    // Handle: export class X
    result = result.replace(
      /export\s+class\s+(\w+)/g,
      (_match, name) => {
        namedExports.push(name);
        return `class ${name}`;
      }
    );

    // Handle: export async function X
    result = result.replace(
      /export\s+async\s+function\s+(\w+)/g,
      (_match, name) => {
        namedExports.push(name);
        return `async function ${name}`;
      }
    );

    // Handle: export function X
    result = result.replace(
      /export\s+function\s+(\w+)/g,
      (_match, name) => {
        namedExports.push(name);
        return `function ${name}`;
      }
    );

    // Handle: export const X
    result = result.replace(
      /export\s+const\s+(\w+)/g,
      (_match, name) => {
        namedExports.push(name);
        return `const ${name}`;
      }
    );

    // Handle: export let X
    result = result.replace(
      /export\s+let\s+(\w+)/g,
      (_match, name) => {
        namedExports.push(name);
        return `let ${name}`;
      }
    );

    // Handle: export var X
    result = result.replace(
      /export\s+var\s+(\w+)/g,
      (_match, name) => {
        namedExports.push(name);
        return `var ${name}`;
      }
    );

    // Handle: export { X, Y } from './path' (re-exports)
    // This MUST come before the simple export { X, Y } pattern
    result = result.replace(
      /export\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"];?/g,
      '' // Re-exports are handled via imports, remove them
    );

    // Handle: export { X, Y }
    result = result.replace(
      /export\s*\{\s*([^}]+)\s*\};?/g,
      (_match, exports) => {
        const exportList = exports.split(',').map((s: string) => s.trim());
        return exportList
          .map((name: string) => {
            const parts = name.split(' as ');
            const localName = parts[0].trim();
            const exportName = parts[1]?.trim() || localName;
            // Skip empty exports
            if (!localName) return '';
            return `__exports__.${exportName} = ${localName};`;
          })
          .filter(Boolean)
          .join('\n');
      }
    );

    // Add all named exports at the end
    if (namedExports.length > 0) {
      const exportStatements = namedExports
        .map((name) => {
          if (name.startsWith('default: ')) {
            const className = name.replace('default: ', '');
            return `__exports__.default = ${className};`;
          }
          return `__exports__.${name} = ${name};`;
        })
        .join('\n');
      result += '\n' + exportStatements;
    }

    // Debug: Check for remaining exports
    const remainingExports = result.match(/\bexport\s+\w+/g);
    if (remainingExports) {
      console.warn('[ExtensionLoader] Unhandled exports found:', remainingExports);
    }

    return result;
  }

  /**
   * Replace Node.js crypto with Web Crypto API
   */
  private replaceNodeCrypto(code: string): string {
    let result = code;

    // Remove crypto import
    result = result.replace(/import\s*\{\s*randomInt\s*\}\s*from\s*['"]crypto['"];?/g, '');

    // Replace randomInt calls with Web Crypto equivalent
    result = result.replace(
      /randomInt\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g,
      '__secureRandomInt__($1, $2)'
    );

    return result;
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
   * Build the final bundle from all modules with pre-sorted order
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

// VoltAPI reference
const VoltAPI = window.VoltAPI;
const PluginResultType = VoltAPI.types.PluginResultType;
const copyToClipboard = VoltAPI.utils.copyToClipboard;

// i18n API for extensions
const VoltI18n = {
  addTranslations: function(lng, namespace, resources) {
    const prefixed = 'ext-' + namespace;
    window.__volt_i18n_addBundle__(lng, prefixed, resources);
  }
};

`;

    // Add each module in sorted order
    for (const modulePath of sortedPaths) {
      const code = modules[modulePath];
      if (!code) continue;

      bundle += `
// Module: ${modulePath}
(function() {
  const __exports__ = {};
  ${code}
  __modules__["${modulePath}"] = __exports__;
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

      // Find dependencies
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
