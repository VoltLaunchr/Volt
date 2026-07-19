import { beforeEach, describe, it, expect, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { WorkerPlugin } from './worker-sandbox';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage?: (event: unknown) => void;
  },
}));

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

const newPlugin = (
  grantedPermissions: string[] = ['network'],
  options: { id?: string; extensionId?: string } = {}
): WorkerPlugin =>
  new WorkerPlugin({
    id: options.id ?? 'test',
    extensionId: options.extensionId,
    name: 'test',
    description: '',
    keywords: [],
    prefix: null,
    bundledModuleCode: '',
    entryPoint: 'index.js',
    grantedPermissions,
  });

const isUrlSafe = (p: WorkerPlugin, url: string): boolean =>
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

describe('WorkerPlugin extension runtime IPC parameters', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('does not handle arbitrary queries without an explicit trigger', () => {
    const p = newPlugin([]);

    expect(p.canHandle({ query: 'anything' })).toBe(false);
  });

  it('uses root extensionId, not command plugin id, for Tauri IPC', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const p = newPlugin(['system'], { id: 'github:search_repos', extensionId: 'github' });
    const worker = { postMessage: vi.fn() };
    (p as unknown as { worker: typeof worker }).worker = worker;

    await (p as unknown as {
      handleSystemRequest(requestId: number, payload: { op: 'getApplications' }): Promise<void>;
    }).handleSystemRequest(11, { op: 'getApplications' });

    expect(invoke).toHaveBeenCalledWith('ext_get_applications', { extensionId: 'github' });
  });

  it('passes extensionId to ext_get_applications', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const p = newPlugin(['system']);
    const worker = { postMessage: vi.fn() };
    (p as unknown as { worker: typeof worker }).worker = worker;

    await (p as unknown as {
      handleSystemRequest(requestId: number, payload: { op: 'getApplications' }): Promise<void>;
    }).handleSystemRequest(7, { op: 'getApplications' });

    expect(invoke).toHaveBeenCalledWith('ext_get_applications', { extensionId: 'test' });
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'system-response',
      id: 7,
      payload: { value: [] },
    });
  });

  it('passes extensionId to system actions', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const p = newPlugin(['system']);

    await (p as unknown as {
      executeActions(actions: Array<{ action: 'showInFolder' | 'moveToTrash'; path: string }>): Promise<void>;
    }).executeActions([
      { action: 'showInFolder', path: 'C:\\Users\\Volt\\Desktop\\file.txt' },
      { action: 'moveToTrash', path: 'C:\\Users\\Volt\\Desktop\\old.txt' },
    ]);

    expect(invoke).toHaveBeenCalledWith('ext_show_in_folder', {
      extensionId: 'test',
      path: 'C:\\Users\\Volt\\Desktop\\file.txt',
    });
    expect(invoke).toHaveBeenCalledWith('ext_move_to_trash', {
      extensionId: 'test',
      path: 'C:\\Users\\Volt\\Desktop\\old.txt',
    });
  });

  it('blocks saveCredential without the oauth permission', async () => {
    const p = newPlugin([], { id: 'github', extensionId: 'github' });

    await (p as unknown as {
      executeActions(actions: Array<{
        action: 'saveCredential';
        service: string;
        token: string;
      }>): Promise<void>;
    }).executeActions([{ action: 'saveCredential', service: 'github', token: 'secret' }]);

    expect(invoke).not.toHaveBeenCalled();
  });

  it('routes saveCredential through the permission-enforcing extension command', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const p = newPlugin(['oauth'], { id: 'github:search', extensionId: 'github' });

    await (p as unknown as {
      executeActions(actions: Array<{
        action: 'saveCredential';
        service: string;
        token: string;
      }>): Promise<void>;
    }).executeActions([{ action: 'saveCredential', service: 'github', token: 'secret' }]);

    expect(invoke).toHaveBeenCalledWith('ext_save_credential', {
      extensionId: 'github',
      service: 'github',
      token: 'secret',
    });
  });

  it('forwards AI history and images to the Tauri streaming command', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const p = newPlugin(['ai']);
    const worker = { postMessage: vi.fn() };
    (p as unknown as { worker: typeof worker }).worker = worker;

    const options = {
      provider: 'openai',
      apiKeyPreference: 'OPENAI_API_KEY',
      model: 'openai:gpt-4o',
      history: [
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'previous question' }],
        },
      ],
      images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }],
    };

    await (p as unknown as {
      handleAIRequest(
        requestId: number,
        payload: { prompt: string; options: typeof options }
      ): Promise<void>;
    }).handleAIRequest(9, {
      prompt: 'describe this',
      options,
    });

    expect(invoke).toHaveBeenCalledWith(
      'ext_ai_ask_stream',
      expect.objectContaining({
        extensionId: 'test',
        prompt: 'describe this',
        options,
        channel: expect.anything() as unknown,
      })
    );
  });
});
