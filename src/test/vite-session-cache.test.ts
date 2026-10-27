// @vitest-environment node
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createViteSessionCache } from '../../scripts/vite-session-cache';

describe('Vite development cache isolation', () => {
  it('keeps a running server intact when another session is cleaned up', () => {
    const first = createViteSessionCache();
    const second = createViteSessionCache();
    try {
      expect(first.cacheDir).not.toBe(second.cacheDir);
      const dependency = join(first.cacheDir, 'react.js');
      writeFileSync(dependency, 'export const version = "current";');
      second.dispose();
      expect(existsSync(second.cacheDir)).toBe(false);
      expect(existsSync(dependency)).toBe(true);
      first.dispose();
      expect(existsSync(first.cacheDir)).toBe(false);
    } finally {
      first.dispose();
      second.dispose();
    }
  });
});
