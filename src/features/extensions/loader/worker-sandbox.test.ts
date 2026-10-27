import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
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

    await (
      p as unknown as {
        handleSystemRequest(requestId: number, payload: { op: 'getApplications' }): Promise<void>;
      }
    ).handleSystemRequest(11, { op: 'getApplications' });

    expect(invoke).toHaveBeenCalledWith('ext_get_applications', { extensionId: 'github' });
  });

  it('passes extensionId to ext_get_applications', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const p = newPlugin(['system']);
    const worker = { postMessage: vi.fn() };
    (p as unknown as { worker: typeof worker }).worker = worker;

    await (
      p as unknown as {
        handleSystemRequest(requestId: number, payload: { op: 'getApplications' }): Promise<void>;
      }
    ).handleSystemRequest(7, { op: 'getApplications' });

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

    await (
      p as unknown as {
        executeActions(
          actions: Array<{ action: 'showInFolder' | 'moveToTrash'; path: string }>
        ): Promise<void>;
      }
    ).executeActions([
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

    await (
      p as unknown as {
        executeActions(
          actions: Array<{
            action: 'saveCredential';
            service: string;
            token: string;
          }>
        ): Promise<void>;
      }
    ).executeActions([{ action: 'saveCredential', service: 'github', token: 'secret' }]);

    expect(invoke).not.toHaveBeenCalled();
  });

  it('routes saveCredential through the permission-enforcing extension command', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const p = newPlugin(['oauth'], { id: 'github:search', extensionId: 'github' });

    await (
      p as unknown as {
        executeActions(
          actions: Array<{
            action: 'saveCredential';
            service: string;
            token: string;
          }>
        ): Promise<void>;
      }
    ).executeActions([{ action: 'saveCredential', service: 'github', token: 'secret' }]);

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

    await (
      p as unknown as {
        handleAIRequest(
          requestId: number,
          payload: { prompt: string; options: typeof options }
        ): Promise<void>;
      }
    ).handleAIRequest(9, {
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

  it('does not deliver an obsolete AI response to a replacement worker', async () => {
    let rejectInvoke!: (reason: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectInvoke = reject;
        })
    );
    const p = newPlugin(['ai']);
    const oldWorker = { postMessage: vi.fn(), terminate: vi.fn() };
    const newWorker = { postMessage: vi.fn(), terminate: vi.fn() };
    (p as unknown as { worker: typeof oldWorker }).worker = oldWorker;

    const request = (
      p as unknown as {
        handleAIRequest(requestId: number, payload: { prompt: string }): Promise<void>;
      }
    ).handleAIRequest(12, { prompt: 'slow request' });
    await vi.waitFor(() => expect(rejectInvoke).toBeTypeOf('function'));
    (p as unknown as { terminateWorker(): void }).terminateWorker();
    (p as unknown as { worker: typeof newWorker }).worker = newWorker;
    rejectInvoke(new Error('old request failed'));
    await request;

    expect(newWorker.postMessage).not.toHaveBeenCalled();
  });
});

/**
 * Per-request cancellation (audit passe 2, sujet 4).
 *
 * Le bug historique: chaque timer `sendRequest` appelait `cleanupPending()`
 * (rejet global) + `terminateWorker()`. Une requête A expirée tuait donc une
 * requête B plus récente partageant le même worker. Ces tests pilotent un
 * faux Worker déterministe (aucun sleep réel, fake timers) et prouvent:
 *  - un timeout ne règle QUE sa propre requête;
 *  - les réponses hors-ordre sont routées par id;
 *  - un worker bloqué n'est recyclé que lorsqu'il n'a plus rien en vol;
 *  - un timer périmé ne touche jamais un worker de remplacement.
 */

interface SentMessage {
  type: string;
  id: unknown;
  payload: unknown;
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  sent: SentMessage[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: SentMessage): void {
    this.sent.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

type SandboxInternals = {
  getOrCreateWorker(): FakeWorker;
  sendRequest<T>(worker: FakeWorker, type: 'match' | 'execute', payload: unknown): Promise<T>;
  pending: Map<string, unknown>;
  worker: FakeWorker | null;
};

const asInternals = (p: WorkerPlugin): SandboxInternals => p as unknown as SandboxInternals;

describe('WorkerPlugin per-request cancellation', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    if (
      typeof globalThis.crypto === 'undefined' ||
      typeof (globalThis.crypto as { randomUUID?: unknown }).randomUUID !== 'function'
    ) {
      let counter = 0;
      vi.stubGlobal('crypto', {
        ...(globalThis.crypto as object | undefined),
        randomUUID: () => `test-uuid-${++counter}`,
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const freshPlugin = (): WorkerPlugin =>
    new WorkerPlugin({
      id: 'test',
      name: 'test',
      description: '',
      keywords: ['test'],
      prefix: null,
      bundledModuleCode: '',
      entryPoint: 'index.js',
      grantedPermissions: [],
    });

  it("a stale timeout settles only its own request and never kills the worker's fresh request", async () => {
    const p = freshPlugin();
    const internals = asInternals(p);
    const worker = internals.getOrCreateWorker();

    const rA = internals.sendRequest<unknown[]>(worker, 'match', { query: 'a' });
    // B démarre 4 s plus tard: les deux timers expirent à des instants
    // distincts, ce qui rend le scénario A-puis-B déterministe.
    await vi.advanceTimersByTimeAsync(4000);
    const rB = internals.sendRequest<unknown[]>(worker, 'match', { query: 'ab' });
    const settleA = rA.then(
      () => 'resolved',
      (e: unknown) => `rejected:${String(e)}`
    );
    const settleB = rB.then(
      () => 'resolved',
      (e: unknown) => `rejected:${String(e)}`
    );

    // Le timer de A (8 s après son envoi) expire alors que B est en vol sur
    // le même worker. À cet instant t=8000, seul A est échu (B échoit à
    // t=12000): on n'avance donc que de 4000.
    await vi.advanceTimersByTimeAsync(4000);
    await expect(settleA).resolves.toMatch(/^rejected:Error: Worker timeout/);
    // B survit: toujours pending, worker intact.
    expect(internals.pending.size).toBe(1);
    expect(worker.terminated).toBe(false);
    expect(internals.worker).toBe(worker);

    // B peut encore se résoudre normalement (réponse tardive mais saine).
    const idB = worker.sent[1].id;
    worker.receive({ type: 'match-result', id: idB, payload: [{ id: 'r-b' }] });
    await expect(settleB).resolves.toBe('resolved');
    expect(internals.pending.size).toBe(0);
    // Résolution normale: pas de recyclage.
    expect(worker.terminated).toBe(false);
  });

  it('routes out-of-order completions to the correct request (A, B, C -> C, A, B)', async () => {
    const p = freshPlugin();
    const internals = asInternals(p);
    const worker = internals.getOrCreateWorker();

    const rA = internals.sendRequest<string>(worker, 'match', { query: 'a' });
    const rB = internals.sendRequest<string>(worker, 'match', { query: 'b' });
    const rC = internals.sendRequest<string>(worker, 'match', { query: 'c' });
    const [idA, idB, idC] = worker.sent.map((m) => m.id);

    worker.receive({ type: 'match-result', id: idC, payload: 'C' });
    worker.receive({ type: 'match-result', id: idA, payload: 'A' });
    worker.receive({ type: 'match-result', id: idB, payload: 'B' });

    await expect(rC).resolves.toBe('C');
    await expect(rA).resolves.toBe('A');
    await expect(rB).resolves.toBe('B');
    expect(internals.pending.size).toBe(0);
    expect(worker.terminated).toBe(false);
  });

  it('recycles a wedged worker only once nothing is outstanding, then serves fresh requests', async () => {
    const p = freshPlugin();
    const internals = asInternals(p);
    const wedged = internals.getOrCreateWorker();

    // Deux requêtes échelonnées sur un worker qui ne répond jamais.
    const rA = internals.sendRequest<unknown[]>(wedged, 'match', { query: 'a' });
    await vi.advanceTimersByTimeAsync(4000);
    const rB = internals.sendRequest<unknown[]>(wedged, 'match', { query: 'b' });
    void rA.catch(() => {});
    void rB.catch(() => {});

    // Premier timeout (t=8000): B est encore en vol -> pas de terminate.
    await vi.advanceTimersByTimeAsync(4000);
    await expect(rA).rejects.toThrow(/Worker timeout/);
    expect(wedged.terminated).toBe(false);

    // Second timeout (t=12000): plus rien en vol sur ce worker -> recyclage.
    await vi.advanceTimersByTimeAsync(4000);
    await expect(rB).rejects.toThrow(/Worker timeout/);
    expect(wedged.terminated).toBe(true);
    expect(internals.worker).toBeNull();

    // Une requête fraîche recrée un worker sain et se résout.
    const fresh = internals.getOrCreateWorker();
    expect(fresh).not.toBe(wedged);
    const rC = internals.sendRequest<string>(fresh, 'match', { query: 'c' });
    fresh.receive({ type: 'match-result', id: fresh.sent[0].id, payload: 'C' });
    await expect(rC).resolves.toBe('C');
  });

  it('a destroyed worker never leaks a stale timer onto its replacement', async () => {
    const p = freshPlugin();
    const internals = asInternals(p);
    const oldWorker = internals.getOrCreateWorker();
    const rA = internals.sendRequest<unknown[]>(oldWorker, 'match', { query: 'a' });
    void rA.catch(() => {});

    // Teardown explicite: pending vidé, timers annulés, worker tué.
    (p as unknown as { destroy(): void }).destroy();
    expect(internals.pending.size).toBe(0);

    const newWorker = internals.getOrCreateWorker();
    expect(newWorker).not.toBe(oldWorker);
    const rB = internals.sendRequest<string>(newWorker, 'match', { query: 'b' });
    newWorker.receive({ type: 'match-result', id: newWorker.sent[0].id, payload: 'B' });
    await expect(rB).resolves.toBe('B');

    // Même loin après l'échéance originelle de A: rien ne bouge.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(newWorker.terminated).toBe(false);
    expect(internals.pending.size).toBe(0);
  });
});
