/* global Worker, MessageEvent, RequestInit, Response, fetch, ErrorEvent, Blob, URL, Headers, TextDecoder, crypto, btoa */
/**
 * Worker Sandbox
 *
 * WorkerPlugin is a proxy that implements the Plugin interface
 * but runs extension code in a dedicated Web Worker. Communication
 * happens via postMessage with a 500ms timeout.
 */

import { Plugin, PluginContext, PluginResult } from '../../plugins/types';
import { copyToClipboard, openUrl } from '../../plugins/utils/helpers';
import { generateWorkerBootstrap, type ActionCommand, type WorkerResponse } from './worker-bootstrap';
import { logger } from '../../../shared/utils/logger';

const WORKER_TIMEOUT_MS = 500;

/**
 * Maximum fetch response body size (10 MB). A malicious endpoint could
 * otherwise stream an unbounded body and OOM the renderer.
 */
const MAX_FETCH_BODY_BYTES = 10 * 1024 * 1024;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A Plugin implementation that delegates match() and execute() to a Web Worker.
 * canHandle() is evaluated declaratively on the main thread using keywords/prefix.
 */
export class WorkerPlugin implements Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;

  private worker: Worker | null = null;
  // Pending match/execute requests. Keyed by cryptographic random UUIDs
  // generated on the main thread (see sendRequest). A sequential counter
  // would let a compromised Worker guess the id of another in-flight
  // request and resolve it with forged data; a full UUID is infeasible
  // to guess. Fetch requests use a separate flow (see handleFetchRequest)
  // and never share this map to avoid id-collision confusion with the
  // extension-controlled worker response stream.
  private pending = new Map<string, PendingRequest>();
  private workerCode: string;
  private blobUrl: string | null = null;

  // Declarative canHandle config
  private keywords: string[];
  private prefix: string | null;

  // Permission enforcement
  private grantedPermissions: Set<string>;

  constructor(options: {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    prefix: string | null;
    bundledModuleCode: string;
    entryPoint: string;
    grantedPermissions: string[];
  }) {
    this.id = options.id;
    this.name = options.name;
    this.description = options.description;
    this.enabled = true;
    this.keywords = options.keywords.map((k) => k.toLowerCase());
    this.prefix = options.prefix?.toLowerCase() ?? null;
    this.workerCode = generateWorkerBootstrap(options.bundledModuleCode, options.entryPoint);
    this.grantedPermissions = new Set(options.grantedPermissions);
  }

  /**
   * Check if a permission is granted for this extension.
   */
  private hasPermission(permission: string): boolean {
    return this.grantedPermissions.has(permission);
  }

  /**
   * Declarative canHandle — no extension code executed.
   * Evaluated on main thread using keywords/prefix from manifest.
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.toLowerCase().trim();
    if (!query) return false;

    if (this.prefix) {
      return query.startsWith(this.prefix);
    }

    if (this.keywords.length > 0) {
      return this.keywords.some(
        (kw) => query.startsWith(kw) || query === kw
      );
    }

    // No keywords or prefix → generic extension, receives all queries
    return true;
  }

  /**
   * Sends match request to Worker, returns results with 500ms timeout.
   */
  async match(context: PluginContext): Promise<PluginResult[]> {
    try {
      const worker = this.getOrCreateWorker();
      const results = await this.sendRequest<PluginResult[]>(worker, 'match', {
        query: context.query,
      });
      // Tag results with pluginId
      return (results || []).map((r) => ({ ...r, pluginId: this.id }));
    } catch (err) {
      logger.error(`[WorkerPlugin:${this.id}] match() failed:`, err);
      return [];
    }
  }

  /**
   * Sends execute request to Worker, receives action commands and runs them.
   */
  async execute(result: PluginResult): Promise<void> {
    try {
      const worker = this.getOrCreateWorker();
      const actions = await this.sendRequest<ActionCommand[]>(worker, 'execute', result);
      if (actions) {
        await this.executeActions(actions);
      }
    } catch (err) {
      logger.error(`[WorkerPlugin:${this.id}] execute() failed:`, err);
    }
  }

  /**
   * Send a typed request to the Worker and wait for response with timeout.
   */
  private sendRequest<T>(worker: Worker, type: 'match' | 'execute', payload: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Cryptographic random id: defeats same-type id-guessing from a
      // compromised Worker that could otherwise forge a match/execute
      // response against a pending request.
      const id = crypto.randomUUID();

      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.terminateWorker();
        reject(new Error(`Worker timeout after ${WORKER_TIMEOUT_MS}ms for ${type}`));
      }, WORKER_TIMEOUT_MS);

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      worker.postMessage({ type, id, payload });
    });
  }

  /**
   * Handle messages from the Worker.
   *
   * Routing is strictly by message `type`. Only match/execute responses are
   * allowed to resolve entries in `this.pending`; fetch-request messages use
   * a dedicated handler and never touch the main-thread pending map. This
   * prevents a malicious worker from sending e.g. a `fetch-request` (whose
   * numeric id is worker-controlled and lives in a separate namespace) from
   * mis-resolving a pending match/execute entry whose id happens to collide.
   */
  private handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const { type, id, payload } = event.data;

    // Ignore 'ready' signal
    if (type === 'ready' as string) return;

    // Handle fetch requests from Worker. Fetch ids are generated inside the
    // worker in their own counter namespace and must not touch this.pending.
    if (type === 'fetch-request' as string) {
      // Worker-generated fetch ids are numeric (see __fetchCounter__ in
      // worker-bootstrap); coerce for the handler signature.
      const fetchId = typeof id === 'number' ? id : Number(id);
      this.handleFetchRequest(fetchId, payload as { url: string; options?: RequestInit });
      return;
    }

    // Only these response types are allowed to resolve match/execute pending
    // entries. Any other/unknown type is dropped to prevent worker-controlled
    // messages from manipulating the pending map.
    if (type !== 'match-result' && type !== 'execute-result' && type !== 'error') {
      return;
    }

    // Match/execute ids are string UUIDs minted by sendRequest; a non-string
    // echo means the worker is misbehaving and the message is dropped.
    if (typeof id !== 'string') return;

    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (type === 'error') {
      pending.reject(new Error(String(payload)));
    } else {
      pending.resolve(payload);
    }
  };

  /**
   * Check whether a dotted-quad IPv4 string falls in a private/reserved
   * range that should be blocked for SSRF prevention.
   */
  private isPrivateIPv4(hostname: string): boolean {
    const parts = hostname.split('.');
    if (parts.length !== 4 || !parts.every((p) => /^\d+$/.test(p))) return false;
    const octets = parts.map(Number);
    if (octets.some((o) => o < 0 || o > 255)) return false;
    // 10.0.0.0/8
    if (octets[0] === 10) return true;
    // 172.16.0.0/12
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    // 192.168.0.0/16
    if (octets[0] === 192 && octets[1] === 168) return true;
    // 127.0.0.0/8 loopback
    if (octets[0] === 127) return true;
    // 169.254.0.0/16 link-local (covers 169.254.169.254 cloud metadata)
    if (octets[0] === 169 && octets[1] === 254) return true;
    // 0.0.0.0/8 "this host"
    if (octets[0] === 0) return true;
    return false;
  }

  /**
   * Check whether a hostname is a private/loopback/link-local IPv6 address.
   * Handles bracketed URL form (`[::1]`) and IPv4-mapped IPv6 (`::ffff:a.b.c.d`).
   */
  private isPrivateIPv6(hostname: string): boolean {
    // Strip surrounding brackets used in URL form.
    const h =
      hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;
    if (h === '::1' || h === '::' ) return true;
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — apply IPv4 private rules to
    // the embedded address so the mapped form cannot bypass IPv4 blocks.
    const ipv4Mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (ipv4Mapped) return this.isPrivateIPv4(ipv4Mapped[1]);
    // Extract the first hextet (anything before the first ':'). Empty first
    // hextet (e.g. "::1") is not a private range signal by itself.
    const firstHextet = h.split(':')[0]?.toLowerCase();
    if (!firstHextet) return false;
    const n = parseInt(firstHextet, 16);
    if (Number.isNaN(n)) return false;
    // fc00::/7 — Unique Local Addresses (RFC 4193), first hextet 0xfc00..0xfdff.
    if (n >= 0xfc00 && n <= 0xfdff) return true;
    // fe80::/10 — link-local, first hextet 0xfe80..0xfebf.
    if (n >= 0xfe80 && n <= 0xfebf) return true;
    return false;
  }

  /**
   * Validate that a URL is safe to fetch (blocks SSRF targets).
   *
   * Known limitation: DNS rebinding is not defended here because hostname
   * resolution happens inside `fetch()`; blocking it requires a custom
   * resolver layer (not available in-browser without a native proxy).
   */
  private isUrlSafe(url: string): boolean {
    try {
      const parsed = new URL(url);

      // Only allow http and https schemes
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      const hostname = parsed.hostname.toLowerCase();

      // Block localhost by name.
      if (hostname === 'localhost') return false;

      // IPv4 private/reserved ranges.
      if (this.isPrivateIPv4(hostname)) return false;

      // IPv6 loopback / ULA / link-local / IPv4-mapped-private.
      // `URL` exposes bracketed hostnames with brackets stripped, but we
      // handle both forms defensively.
      if (hostname.includes(':') || hostname.startsWith('[')) {
        if (this.isPrivateIPv6(hostname)) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read a Response body as UTF-8 text with a hard byte cap. Prevents a
   * malicious endpoint from OOMing the renderer via an unbounded stream.
   */
  private async readBodyCapped(response: Response): Promise<string> {
    const merged = await this.readBodyBytesCapped(response);
    return new TextDecoder('utf-8', { fatal: false }).decode(merged);
  }

  /**
   * Read a Response body as raw bytes with the same 10 MB hard cap as the
   * text path. Extracted so the text and base64 branches share cap semantics
   * exactly (cancel reader on overflow, reject the whole response).
   */
  private async readBodyBytesCapped(response: Response): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_FETCH_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          /* best-effort cancel */
        }
        throw new Error(
          `Response body exceeds ${MAX_FETCH_BODY_BYTES} bytes`
        );
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return merged;
  }

  /**
   * Read a Response body as base64-encoded bytes with the 10 MB cap. Used
   * for binary content types (images, PDFs, zip, octet-stream, fonts, etc.)
   * so the Worker-side fetch stub can reconstruct exact bytes for
   * `.blob()` / `.arrayBuffer()` rather than lose data through UTF-8 decode.
   *
   * Encoding path: build the binary string in small chunks via
   * `String.fromCharCode.apply` to avoid stack overflow on large buffers,
   * then `btoa()` the concatenated string. Stays in-browser (no deps).
   */
  private async readBodyBase64Capped(response: Response): Promise<string> {
    const bytes = await this.readBodyBytesCapped(response);
    if (bytes.byteLength === 0) return '';
    const CHUNK = 0x8000; // 32 KB — well under V8 arg-count limits for apply()
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
      binary += String.fromCharCode.apply(
        null,
        slice as unknown as number[]
      );
    }
    return btoa(binary);
  }

  /**
   * Classify a Content-Type header as text-bearing (UTF-8 safe) or binary.
   *
   * Text set: `text/*`, `application/json`, `application/xml`,
   * `application/javascript`, `application/ecmascript`, `application/ld+json`,
   * `application/yaml`, `image/svg+xml` (SVG is XML), and any suffix-typed
   * media type ending in `+json` or `+xml` (RFC 6838 structured syntax suffix).
   *
   * Only the MIME portion is considered; charset and other parameters are
   * stripped before comparison. Missing or unparseable Content-Type is
   * treated as binary — safer default (base64 round-trips anything).
   */
  private isTextContentType(contentType: string | null): boolean {
    if (!contentType) return false;
    const mime = contentType.split(';')[0]?.trim().toLowerCase();
    if (!mime) return false;
    if (mime.startsWith('text/')) return true;
    if (mime === 'application/json') return true;
    if (mime === 'application/xml') return true;
    if (mime === 'application/javascript') return true;
    if (mime === 'application/ecmascript') return true;
    if (mime === 'application/ld+json') return true;
    if (mime === 'application/yaml' || mime === 'application/x-yaml') return true;
    if (mime === 'image/svg+xml') return true;
    if (mime.endsWith('+json') || mime.endsWith('+xml')) return true;
    return false;
  }

  /**
   * Sanitize a RequestInit supplied by a sandboxed extension before it is
   * passed to `fetch()`.
   *
   * Security rationale: extension network requests must never carry the
   * main app's ambient credentials (cookies, Authorization headers tied to
   * the app origin), otherwise a malicious extension could exfiltrate
   * session data by forcing `credentials: 'include'` or injecting a
   * `Cookie` / `Authorization` header.
   *
   * We therefore:
   *   - Force `credentials: 'omit'` unconditionally.
   *   - Strip `Cookie`, `Cookie2`, `Set-Cookie`, and `Authorization` headers
   *     (case-insensitive) from either a plain object or a `Headers` instance.
   *
   * Method, body, and content-type remain extension-controlled: those are
   * legitimate request surface for an extension.
   */
  private sanitizeFetchOptions(options: RequestInit | undefined): RequestInit {
    const FORBIDDEN_HEADERS = new Set(['cookie', 'cookie2', 'set-cookie', 'authorization']);

    const sanitized: RequestInit = { ...(options || {}) };

    // Force credentials off — extensions must never carry app cookies.
    sanitized.credentials = 'omit';

    if (sanitized.headers) {
      if (sanitized.headers instanceof Headers) {
        const cleaned = new Headers();
        sanitized.headers.forEach((value, key) => {
          if (!FORBIDDEN_HEADERS.has(key.toLowerCase())) {
            cleaned.append(key, value);
          }
        });
        sanitized.headers = cleaned;
      } else if (Array.isArray(sanitized.headers)) {
        sanitized.headers = (sanitized.headers as [string, string][]).filter(
          ([key]) => !FORBIDDEN_HEADERS.has(String(key).toLowerCase())
        );
      } else if (typeof sanitized.headers === 'object') {
        const cleaned: Record<string, string> = {};
        for (const [key, value] of Object.entries(
          sanitized.headers as Record<string, string>
        )) {
          if (!FORBIDDEN_HEADERS.has(key.toLowerCase())) {
            cleaned[key] = value;
          }
        }
        sanitized.headers = cleaned;
      }
    }

    return sanitized;
  }

  /**
   * Handle fetch requests from the Worker.
   * Executes fetch on the main thread (where network is available) and sends response back.
   *
   * Per-host allowlist: the current `ExtensionManifest.permissions` shape only
   * declares the boolean `network` capability (see extension.types.ts). There
   * is no host allowlist field in the manifest today, so enforcement here is
   * limited to (1) the boolean `network` permission and (2) `isUrlSafe` SSRF
   * blocks. Adding per-host allowlisting is deferred pending a manifest
   * schema change (e.g. `permissions.network.hosts: string[]`).
   */
  private async handleFetchRequest(
    requestId: number,
    payload: { url: string; options?: RequestInit }
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    if (!this.hasPermission('network')) {
      console.warn(`[WorkerPlugin:${this.id}] Blocked fetch — network permission not granted`);
      worker.postMessage({
        type: 'fetch-response',
        id: requestId,
        payload: { error: 'Network permission not granted' },
      });
      return;
    }

    if (!this.isUrlSafe(payload.url)) {
      console.warn(
        `[WorkerPlugin:${this.id}] Blocked fetch to unsafe URL: ${payload.url}`
      );
      worker.postMessage({
        type: 'fetch-response',
        id: requestId,
        payload: { error: 'URL blocked by security policy' },
      });
      return;
    }

    try {
      const safeOptions = this.sanitizeFetchOptions(payload.options);
      const response = await fetch(payload.url, safeOptions);
      // Cap body read to MAX_FETCH_BODY_BYTES on BOTH branches to prevent a
      // malicious endpoint from OOMing the renderer with an unbounded stream.
      //
      // Content-Type classification drives the payload encoding:
      //   - text-like types (text/*, application/json, +json, +xml, SVG…)
      //     round-trip as a UTF-8 string — cheap & legacy-compatible.
      //   - everything else (images, PDFs, zip, octet-stream, fonts, audio,
      //     video…) round-trip as base64 so .blob() / .arrayBuffer() on the
      //     worker side get exact bytes instead of a UTF-8-replacement-char
      //     corrupted string.
      const contentType = response.headers.get('content-type');
      const isText = this.isTextContentType(contentType);
      if (isText) {
        const text = await this.readBodyCapped(response);
        worker.postMessage({
          type: 'fetch-response',
          id: requestId,
          payload: {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            body: text,
            bodyEncoding: 'utf-8',
          },
        });
      } else {
        const base64 = await this.readBodyBase64Capped(response);
        worker.postMessage({
          type: 'fetch-response',
          id: requestId,
          payload: {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            body: base64,
            bodyEncoding: 'base64',
          },
        });
      }
    } catch (err) {
      worker.postMessage({
        type: 'fetch-response',
        id: requestId,
        payload: { error: String(err) },
      });
    }
  }

  /**
   * Handle Worker errors.
   */
  private handleError = (event: ErrorEvent) => {
    logger.error(`[WorkerPlugin:${this.id}] Worker error:`, event.message);
    // Reject all pending requests
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Worker error: ${event.message}`));
    }
    this.pending.clear();
    this.terminateWorker();
  };

  /**
   * Get existing Worker or create a new one (lazy initialization).
   */
  private getOrCreateWorker(): Worker {
    if (this.worker) return this.worker;

    const blob = new Blob([this.workerCode], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.blobUrl);
    this.worker.onmessage = this.handleMessage;
    this.worker.onerror = this.handleError;

    return this.worker;
  }

  /**
   * Terminate the Worker and clean up resources.
   */
  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  /**
   * Execute action commands returned by the Worker.
   */
  private async executeActions(actions: ActionCommand[]): Promise<void> {
    for (const action of actions) {
      switch (action.action) {
        case 'copyToClipboard':
          if (!this.hasPermission('clipboard')) {
            console.warn(`[WorkerPlugin:${this.id}] Blocked clipboard access — permission not granted`);
            break;
          }
          await copyToClipboard(action.text);
          break;
        case 'openUrl':
          if (!this.hasPermission('openUrl')) {
            console.warn(
              `[WorkerPlugin:${this.id}] Blocked openUrl — permission not granted`
            );
            break;
          }
          await openUrl(action.url);
          break;
        case 'fetch': {
          if (!this.hasPermission('network')) {
            console.warn(`[WorkerPlugin:${this.id}] Blocked network access — permission not granted`);
            break;
          }
          // Network fetch is handled in match/execute response flow, not here
          break;
        }
        case 'notify':
          if (!this.hasPermission('notifications')) {
            console.warn(`[WorkerPlugin:${this.id}] Blocked notification — permission not granted`);
            break;
          }
          window.dispatchEvent(
            new CustomEvent('volt:notification', {
              detail: { message: action.message, type: action.type || 'info' },
            })
          );
          break;
        case 'noop':
          break;
      }
    }
  }

  /**
   * Clean up resources when the plugin is unloaded.
   */
  destroy(): void {
    // Reject all pending requests
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Plugin destroyed'));
    }
    this.pending.clear();
    this.terminateWorker();
  }
}
