/* global TextDecoder, crypto, btoa */
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

/** Timeout for match() — must cover network round-trips for extensions with `network` permission */
const WORKER_MATCH_TIMEOUT_MS = 8000;
/** Timeout for execute() — local side-effects only, should be fast */
const WORKER_EXECUTE_TIMEOUT_MS = 500;

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
   * Reject and clear ALL pending requests (used when the worker is being torn
   * down). Without this, a per-request timeout that recreates the worker
   * leaves stale `pending` entries whose later timer firings call
   * `terminateWorker()` on the freshly-recreated worker, breaking the new
   * one. See M12.
   */
  private cleanupPending(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
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

      const timeoutMs = type === 'match' ? WORKER_MATCH_TIMEOUT_MS : WORKER_EXECUTE_TIMEOUT_MS;
      const timer = setTimeout(() => {
        // Reject ALL pending entries — not just this one. Keeping the others
        // alive past `terminateWorker()` is unsafe: their later timer firings
        // would call `terminateWorker()` again, killing whichever worker the
        // plugin has lazily recreated in the meantime. (M12)
        this.cleanupPending(
          `Worker reset due to timeout (after ${timeoutMs}ms on ${type})`
        );
        this.terminateWorker();
        reject(new Error(`Worker timeout after ${timeoutMs}ms for ${type}`));
      }, timeoutMs);

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
      void this.handleFetchRequest(fetchId, payload as { url: string; options?: RequestInit });
      return;
    }

    if (type === 'storage-request' as string) {
      const storageId = typeof id === 'number' ? id : Number(id);
      void this.handleStorageRequest(storageId, payload as { op: string; key?: string; value?: string });
      return;
    }

    if (type === 'prefs-request' as string) {
      const prefsId = typeof id === 'number' ? id : Number(id);
      void this.handlePrefsRequest(prefsId, payload as { op: string; key: string; value?: string; default?: unknown });
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

      // Empty hostname is not addressable; refuse rather than letting the
      // platform fetcher decide. (M2)
      if (hostname === '') return false;

      // Block localhost by name.
      if (hostname === 'localhost') return false;

      // Reject "compressed" IPv4 forms that browsers happily resolve to
      // private addresses:
      //   * `http://0/` → 0.0.0.0
      //   * `http://2130706433/` → 127.0.0.1 (decimal-as-int)
      //   * `http://0x7f000001/` → 127.0.0.1 (hex-as-int)
      //   * `http://0177.0.0.1/` → 127.0.0.1 (octal-prefixed dotted form)
      // Anything that isn't either a strict dotted-quad IPv4 or a host with
      // at least one alphabetic character (FQDN) is suspicious. (M2)
      if (
        hostname === '0' ||
        /^(?:0x[0-9a-f]+|\d+)$/i.test(hostname)
      ) {
        return false;
      }

      // If the hostname looks IPv4-shaped at all (digits + dots, no letters)
      // require strict dotted-quad. This rejects octal forms like
      // `0177.0.0.1` and partial forms like `127.1`.
      const hasLetter = /[a-z]/i.test(hostname);
      const looksIpv4ish = /^[0-9.]+$/.test(hostname);
      if (!hasLetter && looksIpv4ish) {
        const strictDottedQuad = /^\d{1,3}(\.\d{1,3}){3}$/;
        if (!strictDottedQuad.test(hostname)) return false;
        // Each octet must be 0..255 with no leading zero ambiguity.
        const octets = hostname.split('.');
        for (const o of octets) {
          if (o.length > 1 && o.startsWith('0')) return false; // octal-style
          const n = Number(o);
          if (!Number.isInteger(n) || n < 0 || n > 255) return false;
        }
      }

      // IPv4 private/reserved ranges.
      if (this.isPrivateIPv4(hostname)) return false;

      // IPv6 loopback / ULA / link-local / IPv4-mapped-private.
      // `URL` exposes bracketed hostnames with brackets stripped, but we
      // handle both forms defensively. Catch IPv4-mapped IPv6 expressed
      // purely in hex hextets (e.g. `[::ffff:7f00:1]`) which the original
      // `isPrivateIPv6` regex (which only handled `::ffff:a.b.c.d`) missed.
      // (M2)
      if (hostname.includes(':') || hostname.startsWith('[')) {
        if (this.isPrivateIPv6(hostname)) return false;
        if (this.isHexMappedIpv4Private(hostname)) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detect IPv4-mapped IPv6 addresses encoded as hex hextets (e.g.
   * `::ffff:7f00:1` == 127.0.0.1). The existing `isPrivateIPv6` only matches
   * the dotted form (`::ffff:127.0.0.1`); without this helper an attacker can
   * round-trip the same address as `[::ffff:7f00:1]` and bypass the check.
   * (M2)
   */
  private isHexMappedIpv4Private(hostname: string): boolean {
    // Strip brackets and lowercase.
    const h = (
      hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname
    ).toLowerCase();
    if (!h.includes(':')) return false;
    const parts = h.split(':');
    // Need at least the last two hextets to encode 32 bits of IPv4.
    if (parts.length < 2) return false;
    const lastTwo = parts.slice(-2);
    const hex = /^[0-9a-f]{1,4}$/;
    if (!hex.test(lastTwo[0]) || !hex.test(lastTwo[1])) return false;
    const high = parseInt(lastTwo[0], 16);
    const low = parseInt(lastTwo[1], 16);
    if (Number.isNaN(high) || Number.isNaN(low)) return false;
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    const dotted = `${a}.${b}.${c}.${d}`;
    return this.isPrivateIPv4(dotted);
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

    // Force manual redirect handling so we can re-validate each hop's URL
    // against `isUrlSafe` (SSRF defense). With the default `redirect: 'follow'`
    // a server can return a 302 pointing at 127.0.0.1 / link-local addresses
    // and the platform fetcher will silently follow it because only the
    // INITIAL URL was validated. We loop in `handleFetchRequest` instead. (H3)
    sanitized.redirect = 'manual';

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
        sanitized.headers = sanitized.headers.filter(
          ([key]) => !FORBIDDEN_HEADERS.has(String(key).toLowerCase())
        );
      } else if (typeof sanitized.headers === 'object') {
        const cleaned: Record<string, string> = {};
        for (const [key, value] of Object.entries(sanitized.headers)) {
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

      // Manual redirect loop with re-validation at every hop. The initial URL
      // was already approved by `isUrlSafe` above; we still re-check it inside
      // the loop so a single code path enforces the policy for hop 0..N. (H3)
      //
      // Browser caveat: with `redirect: 'manual'` the response is "opaque
      // redirect" — `status` is reported as 0 and `Location` may be hidden.
      // In Tauri's WebView2/WKWebView the spec-compliant behavior tends to
      // follow Chromium/Safari, where `headers.get('Location')` is null on
      // opaque redirects. As a defense in depth we therefore detect *both*
      // `type === 'opaqueredirect'` and a real 3xx (in case the runtime
      // surfaces redirects transparently); when `Location` is null on an
      // opaque redirect we fail closed rather than blindly returning the
      // opaque body. The redirected request is still safer than the default
      // `follow` behavior because the platform fetcher refuses to follow on
      // its own under `manual`.
      const MAX_REDIRECTS = 5;
      let currentUrl = payload.url;
      let response: Response | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!this.isUrlSafe(currentUrl)) {
          throw new Error(`SSRF: blocked redirect to ${currentUrl}`);
        }
        const candidate = await fetch(currentUrl, safeOptions);
        const isRedirect =
          candidate.type === 'opaqueredirect' ||
          (candidate.status >= 300 && candidate.status < 400);
        if (isRedirect) {
          const loc = candidate.headers.get('Location');
          if (!loc) {
            // Opaque redirect with no readable Location: fail closed. The
            // alternative (return the opaque response to the worker) leaks
            // a "redirect happened to somewhere unknown" — better to error
            // than to silently let an SSRF attempt look like a normal
            // empty 0-status response.
            if (candidate.type === 'opaqueredirect') {
              throw new Error(
                'SSRF: blocked opaque redirect with unreadable Location header'
              );
            }
            response = candidate;
            break;
          }
          // Resolve relative redirects against the URL we just fetched.
          currentUrl = new URL(loc, currentUrl).toString();
          continue;
        }
        response = candidate;
        break;
      }
      if (!response) {
        throw new Error('SSRF: redirect loop exceeded MAX_REDIRECTS');
      }
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
    // Reject ALL pending requests and clear timers in one shot — same M12
    // rationale as in `sendRequest`: orphaned timers would call
    // `terminateWorker()` on the next-created worker.
    this.cleanupPending(`Worker error: ${event.message}`);
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
        case 'toast':
          window.dispatchEvent(
            new CustomEvent('volt:toast', {
              detail: {
                message: action.message,
                subtitle: action.subtitle,
                style: action.style ?? 'info',
                duration: action.duration,
              },
            })
          );
          break;
        case 'noop':
          break;
      }
    }
  }

  /**
   * Handle preference requests from the Worker.
   * Non-secret prefs → JSON file via get_extension_preference / set_extension_preference.
   * Secret prefs → OS keyring via get_extension_secret / set_extension_secret.
   */
  private async handlePrefsRequest(
    requestId: number,
    payload: { op: string; key: string; value?: string; default?: unknown }
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      let result: unknown = undefined;
      if (payload.op === 'get') {
        result = await invoke<string | null>('get_extension_preference', {
          extensionId: this.id,
          key: payload.key,
        });
        if (result === null || result === undefined) {
          result = payload.default ?? null;
        }
      } else if (payload.op === 'set') {
        await invoke('set_extension_preference', {
          extensionId: this.id,
          key: payload.key,
          value: payload.value ?? '',
        });
      }

      worker.postMessage({ type: 'prefs-response', id: requestId, payload: { value: result } });
    } catch (err) {
      worker.postMessage({ type: 'prefs-response', id: requestId, payload: { error: String(err) } });
    }
  }

  /**
   * Handle storage requests from the Worker.
   * Executes SQLite CRUD on the main thread via Tauri IPC.
   */
  private async handleStorageRequest(
    requestId: number,
    payload: { op: string; key?: string; value?: string }
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const extensionId = this.id;

      let result: unknown = undefined;
      switch (payload.op) {
        case 'get':
          result = await invoke<string | null>('ext_storage_get', {
            extensionId,
            key: payload.key ?? '',
          });
          break;
        case 'set':
          await invoke('ext_storage_set', {
            extensionId,
            key: payload.key ?? '',
            value: payload.value ?? '',
          });
          break;
        case 'remove':
          await invoke('ext_storage_remove', {
            extensionId,
            key: payload.key ?? '',
          });
          break;
        case 'clear':
          await invoke('ext_storage_clear', { extensionId });
          break;
        default:
          throw new Error(`Unknown storage op: ${payload.op}`);
      }

      worker.postMessage({
        type: 'storage-response',
        id: requestId,
        payload: { value: result },
      });
    } catch (err) {
      worker.postMessage({
        type: 'storage-response',
        id: requestId,
        payload: { error: String(err) },
      });
    }
  }

  /**
   * Clean up resources when the plugin is unloaded.
   */
  destroy(): void {
    // Reject all pending requests via the shared helper (same semantics as
    // the timeout / error paths — see M12).
    this.cleanupPending('Plugin destroyed');
    this.terminateWorker();
  }
}
