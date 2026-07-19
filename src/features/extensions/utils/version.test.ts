import { describe, expect, it } from 'vitest';
import { isVersionAtLeast, parseStrictSemver } from './version';

describe('extension version compatibility', () => {
  it('parses strict three-part semantic versions', () => {
    expect(parseStrictSemver('0.4.0')).toEqual([0, 4, 0]);
    expect(parseStrictSemver('0.4')).toBeNull();
    expect(parseStrictSemver('v0.4.0')).toBeNull();
  });

  it('compares major, minor, and patch components', () => {
    expect(isVersionAtLeast('0.4.0', '0.4.0')).toBe(true);
    expect(isVersionAtLeast('0.4.1', '0.4.0')).toBe(true);
    expect(isVersionAtLeast('0.3.9', '0.4.0')).toBe(false);
    expect(isVersionAtLeast('1.0.0', '0.9.9')).toBe(true);
  });
});
