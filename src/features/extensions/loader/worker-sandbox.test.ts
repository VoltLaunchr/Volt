import { describe, it, expect } from 'vitest';
import { WorkerPlugin } from './worker-sandbox';

/**
 * Unit coverage for SSRF-relevant URL hardening on `WorkerPlugin.isUrlSafe`.
 *
 * The method is private; tests reach into it via a typed-cast helper rather
 * than widening the public surface. The covered classes target M2 hardening:
 *
 *   * empty / decimal-as-int / hex-as-int hostnames
 *   * octal-prefixed dotted-quad
 *   * partial dotted-quad (e.g. `127.1`)
 *   * IPv4-mapped IPv6 in hex-hextet form (`::ffff:7f00:1`)
 */

const newPlugin = (): WorkerPlugin =>
  new WorkerPlugin({
    id: 'test',
    name: 'test',
    description: '',
    keywords: [],
    prefix: null,
    bundledModuleCode: '',
    entryPoint: 'index.js',
    grantedPermissions: ['network'],
  });

const isUrlSafe = (p: WorkerPlugin, url: string): boolean =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (p as unknown as { isUrlSafe(url: string): boolean }).isUrlSafe(url);

describe('WorkerPlugin.isUrlSafe — M2 hostname hardening', () => {
  const p = newPlugin();

  it('rejects unsupported schemes', () => {
    expect(isUrlSafe(p, 'file:///etc/passwd')).toBe(false);
    expect(isUrlSafe(p, 'gopher://example.com/')).toBe(false);
  });

  it('rejects literal localhost', () => {
    expect(isUrlSafe(p, 'http://localhost/')).toBe(false);
    expect(isUrlSafe(p, 'http://LOCALHOST/')).toBe(false);
  });

  it('rejects bare numeric forms that resolve to private addresses', () => {
    // http://0/ → 0.0.0.0
    expect(isUrlSafe(p, 'http://0/')).toBe(false);
    // http://2130706433/ → 127.0.0.1
    expect(isUrlSafe(p, 'http://2130706433/')).toBe(false);
    // http://0x7f000001/ → 127.0.0.1
    expect(isUrlSafe(p, 'http://0x7f000001/')).toBe(false);
  });

  it('rejects octal-prefixed dotted IPv4', () => {
    // 0177 == 127 octal
    expect(isUrlSafe(p, 'http://0177.0.0.1/')).toBe(false);
    // hex octet
    expect(isUrlSafe(p, 'http://0x7f.0.0.1/')).toBe(false);
  });

  it('rejects partial / non-strict dotted forms', () => {
    expect(isUrlSafe(p, 'http://127.1/')).toBe(false);
    expect(isUrlSafe(p, 'http://10.0.0.0.0/')).toBe(false);
  });

  it('rejects standard private IPv4 ranges', () => {
    expect(isUrlSafe(p, 'http://127.0.0.1/')).toBe(false);
    expect(isUrlSafe(p, 'http://10.0.0.5/')).toBe(false);
    expect(isUrlSafe(p, 'http://192.168.1.1/')).toBe(false);
    expect(isUrlSafe(p, 'http://169.254.169.254/')).toBe(false);
    expect(isUrlSafe(p, 'http://172.16.0.1/')).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 in hex-hextet form', () => {
    // ::ffff:7f00:1  →  127.0.0.1
    expect(isUrlSafe(p, 'http://[::ffff:7f00:1]/')).toBe(false);
    // ::ffff:a00:5  →  10.0.0.5
    expect(isUrlSafe(p, 'http://[::ffff:a00:5]/')).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 in dotted form', () => {
    expect(isUrlSafe(p, 'http://[::ffff:127.0.0.1]/')).toBe(false);
  });

  it('rejects IPv6 loopback and link-local', () => {
    expect(isUrlSafe(p, 'http://[::1]/')).toBe(false);
    expect(isUrlSafe(p, 'http://[fe80::1]/')).toBe(false);
    expect(isUrlSafe(p, 'http://[fc00::1]/')).toBe(false);
  });

  it('accepts public hostnames', () => {
    expect(isUrlSafe(p, 'https://example.com/')).toBe(true);
    expect(isUrlSafe(p, 'http://api.github.com/repos')).toBe(true);
    expect(isUrlSafe(p, 'https://1.1.1.1/')).toBe(true);
    expect(isUrlSafe(p, 'https://8.8.8.8/dns-query')).toBe(true);
  });
});
