import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Vite keeps dependency versions in memory. Sharing its on-disk cache with another server
 * (even one that fails to bind its port) can invalidate every lazy import in a running app. */
export function createViteSessionCache() {
  const cacheDir = mkdtempSync(join(tmpdir(), 'volt-vite-'));
  const dispose = () => {
    // Remove only the private directory created above, never a shared node_modules cache.
    try {
      rmSync(cacheDir, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      console.warn(`[volt] Could not remove development cache ${cacheDir}`, error);
    }
  };
  const plugin: Plugin = { name: 'volt-session-cache', closeBundle: dispose };
  return { cacheDir, plugin, dispose };
}
