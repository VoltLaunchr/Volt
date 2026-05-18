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
import { useUiStore } from '../../../stores/uiStore';
import { setPendingHud } from './hud-queue';

interface OAuthRequestPayload {
  provider?: string;
  authUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scopes?: string[];
}

interface AIRequestPayload {
  prompt: string;
  options?: {
    provider: string;
    apiKeyPreference?: string;
    model?: string;
    maxTokens?: number;
    system?: string;
    creativity?: string | number;
    temperature?: number;
  };
}

interface SystemRequestPayload {
  op: 'getApplications';
}

interface CaptureExceptionPayload {
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  severity?: 'error' | 'warning';
  phase?: 'match' | 'execute' | 'background' | 'manual';
  queryContext?: string;
}

export interface ExtensionError {
  extensionId: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  /** `error` = crash / unexpected throw; `warning` = recoverable / informational */
  severity: 'error' | 'warning';
  /** Which execution phase produced the error */
  phase: 'match' | 'execute' | 'background' | 'manual';
  /** Query that was being processed when the error occurred (match phase only) */
  queryContext?: string;
  /** When this fingerprint was first seen */
  firstSeen: number;
  /** When this fingerprint was last seen */
  lastSeen: number;
  /** How many times this exact fingerprint has fired */
  count: number;
}

/** Max distinct error fingerprints kept per extension instance */
const MAX_ERROR_LOG_SIZE = 50;
/**
 * Two errors with the same fingerprint within this window are deduplicated
 * (count++ / lastSeen updated) rather than added as a new entry.
 */
const ERROR_DEDUP_WINDOW_MS = 60_000;

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
/**
 * Maps service IDs to the API hostnames that should be handled by the
 * Rust authenticated fetch proxy instead of the regular sandbox fetch.
 * Must stay in sync with `service_api_hosts()` in credentials.rs.
 */
const SERVICE_API_HOSTS: Record<string, readonly string[]> = {
  github: ['api.github.com'],
  notion: ['api.notion.com'],
};

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

  // Cleanup callbacks for active OAuth event listeners (cancelled on destroy)
  private oauthUnlisteners: Array<() => void> = [];

  // Cleanup callback for a pending alert dialog (cancelled on destroy)
  private pendingAlertCleanup: (() => void) | null = null;

  // Background refresh
  private refreshIntervalMs: number = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private cachedResults: import('../../plugins/types').PluginResult[] = [];
  private cacheTimestamp: number = 0;

  // Extension error log (deduplicated, max MAX_ERROR_LOG_SIZE fingerprints)
  private errorLog: ExtensionError[] = [];
  // Timestamp of last `volt:extension-error` DOM event — throttled to ≤1/s
  private lastErrorEventAt: number = 0;

  /**
   * Process-wide error log shared across all WorkerPlugin instances.
   * Keyed by extensionId for O(1) lookup from the settings UI.
   */
  static readonly globalLog = new Map<string, ExtensionError[]>();

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
   * Sends match request to Worker, returns results with timeout.
   * When backgroundRefresh is configured and the cache is fresh, returns cached results
   * instantly; a background refresh is triggered if the cache is older than half the interval.
   */
  async match(context: PluginContext): Promise<PluginResult[]> {
    // Serve from background-refresh cache when query is empty and cache is fresh
    if (this.refreshIntervalMs > 0 && !context.query) {
      const age = Date.now() - this.cacheTimestamp;
      if (this.cachedResults.length > 0 && age < this.refreshIntervalMs) {
        // Trigger a background refresh if approaching stale
        if (age > this.refreshIntervalMs / 2) {
          void this.refreshCache();
        }
        return this.cachedResults;
      }
    }

    try {
      const worker = this.getOrCreateWorker();
      const results = await this.sendRequest<PluginResult[]>(worker, 'match', {
        query: context.query,
      });
      const tagged = (results || []).map((r) => ({ ...r, pluginId: this.id }));
      // Update cache when this was a background (empty-query) refresh
      if (this.refreshIntervalMs > 0 && !context.query) {
        this.cachedResults = tagged;
        this.cacheTimestamp = Date.now();
      }
      return tagged;
    } catch (err) {
      this.recordError({
        message: String(err),
        severity: 'error',
        phase: 'match',
        queryContext: context.query || undefined,
      });
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
      this.recordError({ message: String(err), severity: 'error', phase: 'execute' });
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

    if (
      type === 'oauth-request' as string ||
      type === 'oauth-get-token' as string ||
      type === 'oauth-revoke-token' as string
    ) {
      const oauthId = typeof id === 'number' ? id : Number(id);
      void this.handleOAuthRequest(oauthId, type, payload as OAuthRequestPayload);
      return;
    }

    if (type === 'ai-request' as string) {
      const aiId = typeof id === 'number' ? id : Number(id);
      void this.handleAIRequest(aiId, payload as AIRequestPayload);
      return;
    }

    if (type === 'system-request' as string) {
      const sysId = typeof id === 'number' ? id : Number(id);
      void this.handleSystemRequest(sysId, payload as SystemRequestPayload);
      return;
    }

    if (type === 'capture-exception' as string) {
      this.recordError(payload as CaptureExceptionPayload);
      return;
    }

    if (type === 'alert-request' as string) {
      const alertId = typeof id === 'number' ? id : Number(id);
      void this.handleAlertRequest(alertId, payload as { message: string });
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

      // Route requests to known service API hosts through the Rust authenticated
      // fetch proxy. The token is read from the OS keyring inside Rust and never
      // crosses the Worker or renderer boundary.
      try {
        const parsedUrl = new URL(payload.url);
        const serviceHosts = SERVICE_API_HOSTS[this.id] ?? [];
        if ((serviceHosts as string[]).includes(parsedUrl.hostname)) {
          await this.handleAuthenticatedFetch(requestId, payload.url, safeOptions);
          return;
        }
      } catch {
        // URL parse error — fall through to regular fetch which will fail naturally
      }

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
   * Route a fetch through the Rust `extension_authenticated_fetch` command.
   * The token is read from the OS keyring inside Rust — it never crosses the
   * Worker or renderer process boundary.
   */
  private async handleAuthenticatedFetch(
    requestId: number,
    url: string,
    safeOptions: RequestInit
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    try {
      // Flatten sanitized headers to a plain object for Tauri IPC serialisation.
      const headers: Record<string, string> = {};
      if (safeOptions.headers) {
        if (safeOptions.headers instanceof Headers) {
          safeOptions.headers.forEach((v, k) => { headers[k] = v; });
        } else if (Array.isArray(safeOptions.headers)) {
          for (const [k, v] of safeOptions.headers) { headers[String(k)] = String(v); }
        } else if (typeof safeOptions.headers === 'object') {
          Object.assign(headers, safeOptions.headers);
        }
      }

      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{
        ok: boolean;
        status: number;
        statusText: string;
        body: string;
        bodyEncoding: string;
      }>('extension_authenticated_fetch', {
        extensionId: this.id,
        url,
        method: (safeOptions.method as string) ?? 'GET',
        headers,
        body: typeof safeOptions.body === 'string' ? safeOptions.body : null,
      });

      worker.postMessage({
        type: 'fetch-response',
        id: requestId,
        payload: {
          ok: result.ok,
          status: result.status,
          statusText: result.statusText,
          body: result.body,
          bodyEncoding: result.bodyEncoding ?? 'utf-8',
        },
      });
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
        case 'saveCredential': {
          // Extension may only save a credential for the service matching its own
          // ID. This prevents a compromised extension from overwriting credentials
          // belonging to a different service.
          if (action.service !== this.id) {
            console.warn(
              `[WorkerPlugin:${this.id}] Blocked saveCredential for '${action.service}' — must match extension ID`
            );
            break;
          }
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('save_credential', { service: action.service, token: action.token });
          break;
        }
        case 'showInFolder': {
          if (!this.hasPermission('system')) {
            console.warn(`[WorkerPlugin:${this.id}] Blocked showInFolder — system permission not granted`);
            break;
          }
          const { invoke: _inv1 } = await import('@tauri-apps/api/core');
          await _inv1('ext_show_in_folder', { path: action.path }).catch((e: unknown) => {
            logger.error(`[WorkerPlugin:${this.id}] showInFolder failed:`, e);
          });
          break;
        }
        case 'moveToTrash': {
          if (!this.hasPermission('system')) {
            console.warn(`[WorkerPlugin:${this.id}] Blocked moveToTrash — system permission not granted`);
            break;
          }
          const { invoke: _inv2 } = await import('@tauri-apps/api/core');
          await _inv2('ext_move_to_trash', { path: action.path }).catch((e: unknown) => {
            logger.error(`[WorkerPlugin:${this.id}] moveToTrash failed:`, e);
          });
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
        case 'hud':
          setPendingHud(action.message);
          window.dispatchEvent(
            new CustomEvent('volt:hud', { detail: { message: action.message } })
          );
          break;
        case 'updateMetadata':
          window.dispatchEvent(
            new CustomEvent('volt:update-metadata', {
              detail: { pluginId: this.id, title: action.title, subtitle: action.subtitle },
            })
          );
          break;
        case 'pasteText': {
          if (!this.hasPermission('clipboard')) {
            console.warn(`[WorkerPlugin:${this.id}] Blocked pasteText — clipboard permission not granted`);
            break;
          }
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('paste_text', { text: action.text });
          } catch (err) {
            logger.error(`[WorkerPlugin:${this.id}] pasteText failed:`, err);
          }
          break;
        }
      }
    }
  }

  /**
   * Handle OAuth PKCE requests from the Worker.
   * Routes authorize/getToken/revokeToken through Tauri commands.
   * The PKCE code_verifier is generated in Rust — it never touches JS.
   */
  private async handleOAuthRequest(
    requestId: number,
    msgType: string,
    payload: OAuthRequestPayload
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    if (!this.hasPermission('oauth')) {
      worker.postMessage({
        type: 'oauth-response',
        id: requestId,
        payload: { error: 'OAuth permission not granted. Add "oauth" to extension permissions.' },
      });
      return;
    }

    const respond = (result: Record<string, unknown>) => {
      if (this.worker) {
        this.worker.postMessage({ type: 'oauth-response', id: requestId, payload: result });
      }
    };

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      if (msgType === 'oauth-get-token') {
        const token = await invoke<string | null>('ext_oauth_get_token', {
          extensionId: this.id,
          provider: payload.provider ?? '',
        });
        respond({ token });
        return;
      }

      if (msgType === 'oauth-revoke-token') {
        await invoke<void>('ext_oauth_revoke_token', {
          extensionId: this.id,
          provider: payload.provider ?? '',
        });
        respond({ success: true });
        return;
      }

      // oauth-request: full PKCE authorize flow.
      // Register the listener BEFORE opening the browser to close the race where
      // the callback URL arrives before listen() has resolved. The state nonce is
      // applied as a post-registration filter so concurrent flows don't cross-resolve.
      const { listen } = await import('@tauri-apps/api/event');
      const eventName = `ext-oauth-${this.id}`;

      let done = false;
      let unlistenFn: (() => void) | null = null;
      let timerId: ReturnType<typeof setTimeout> | null = null;
      let pendingState: string | null = null;

      const finish = (result: Record<string, unknown>) => {
        if (done) return;
        done = true;
        if (timerId !== null) { clearTimeout(timerId); timerId = null; }
        if (unlistenFn !== null) { unlistenFn(); unlistenFn = null; }
        const idx = this.oauthUnlisteners.indexOf(cancelFn);
        if (idx >= 0) this.oauthUnlisteners.splice(idx, 1);
        respond(result);
      };

      const cancelFn = () => finish({ error: 'OAuth cancelled (extension unloaded)' });
      this.oauthUnlisteners.push(cancelFn);

      timerId = setTimeout(
        () => finish({ error: 'OAuth authorization timed out after 5 minutes' }),
        5 * 60 * 1000
      );

      unlistenFn = await listen<{ error?: string; state?: string }>(
        eventName,
        (event) => {
          // Accept all events until we have the state nonce; filter strictly after.
          if (pendingState !== null && event.payload.state && event.payload.state !== pendingState) return;
          if (event.payload.error) {
            finish({ error: event.payload.error });
          } else {
            // Token is NOT in the event payload — the Rust side stores it in the
            // OS keyring and emits only a success signal. Retrieve the token via
            // ext_oauth_get_token so it never travels over the broadcast event
            // channel where another extension could intercept it. (H2)
            const provider = payload.provider ?? '';
            import('@tauri-apps/api/core').then(({ invoke }) =>
              invoke<string | null>('ext_oauth_get_token', {
                extensionId: this.id,
                provider,
              })
            ).then((token) => {
              finish({ token });
            }).catch((err: unknown) => {
              finish({ error: `Failed to retrieve OAuth token: ${String(err)}` });
            });
          }
        }
      );

      // If finish() fired (e.g. timeout elapsed during listen()), clean up and bail.
      if (done) { unlistenFn(); return; }

      // Rust builds the full auth URL with PKCE params and stores the pending entry.
      const { authUrl, state } = await invoke<{ authUrl: string; state: string }>('ext_oauth_start', {
        extensionId: this.id,
        provider: payload.provider ?? '',
        baseAuthUrl: payload.authUrl ?? '',
        tokenUrl: payload.tokenUrl ?? '',
        clientId: payload.clientId ?? '',
        scopes: payload.scopes ?? [],
      });

      // Enable strict state filtering now that we have the nonce.
      pendingState = state;

      // Open the authorization URL in the default browser.
      await openUrl(authUrl);

    } catch (err) {
      respond({ error: String(err) });
    }
  }

  /**
   * Handle AI inference requests from the Worker using streaming (Tauri Channel API).
   *
   * Emits `ai-chunk` for each token so extensions can render progressive output,
   * then `ai-response` with the full text when the stream is done.
   * Times out after 60 s to avoid hanging the Worker indefinitely.
   */
  private async handleAIRequest(
    requestId: number,
    payload: AIRequestPayload
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    if (!this.hasPermission('ai')) {
      worker.postMessage({
        type: 'ai-response',
        id: requestId,
        payload: { error: 'AI permission not granted. Add "ai" to extension permissions.' },
      });
      return;
    }

    const AI_TIMEOUT_MS = 60_000;

    try {
      const { invoke, Channel } = await import('@tauri-apps/api/core');

      type AiStreamEvent =
        | { type: 'chunk'; text: string }
        | { type: 'done'; fullText: string }
        | { type: 'error'; error: string };

      const channel = new Channel<AiStreamEvent>();

      channel.onmessage = (event) => {
        if (!this.worker) return;
        if (event.type === 'chunk') {
          this.worker.postMessage({ type: 'ai-chunk', id: requestId, payload: { text: event.text } });
        } else if (event.type === 'done') {
          this.worker.postMessage({
            type: 'ai-response',
            id: requestId,
            payload: { text: event.fullText },
          });
        } else if (event.type === 'error') {
          this.worker.postMessage({
            type: 'ai-response',
            id: requestId,
            payload: { error: event.error },
          });
        }
      };

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('AI request timed out (60s)')),
          AI_TIMEOUT_MS
        )
      );

      await Promise.race([
        invoke('ext_ai_ask_stream', {
          extensionId: this.id,
          prompt: payload.prompt,
          options: payload.options ?? {},
          channel,
        }),
        timeoutPromise,
      ]);
    } catch (err) {
      worker.postMessage({
        type: 'ai-response',
        id: requestId,
        payload: { error: String(err) },
      });
    }
  }

  /**
   * Handle system requests from the Worker (getApplications).
   * Requires 'system' permission.
   */
  private async handleSystemRequest(
    requestId: number,
    payload: SystemRequestPayload
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    if (!this.hasPermission('system')) {
      worker.postMessage({
        type: 'system-response',
        id: requestId,
        payload: { error: 'System permission not granted. Add "system" to extension permissions.' },
      });
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (payload.op === 'getApplications') {
        const apps = await invoke<unknown[]>('ext_get_applications');
        worker.postMessage({ type: 'system-response', id: requestId, payload: { value: apps } });
      } else {
        worker.postMessage({ type: 'system-response', id: requestId, payload: { error: 'Unknown system op' } });
      }
    } catch (err) {
      worker.postMessage({ type: 'system-response', id: requestId, payload: { error: String(err) } });
    }
  }

  /**
   * Record an error into the ring buffer with fingerprint deduplication.
   *
   * Fingerprint = message + first non-empty stack line.  Two calls with the
   * same fingerprint within ERROR_DEDUP_WINDOW_MS increment `count`/`lastSeen`
   * rather than adding a new entry.  DOM events are throttled to ≤1 per second
   * to avoid flooding listeners during error storms.  Every write syncs to the
   * process-wide `WorkerPlugin.globalLog` for cross-plugin inspection.
   */
  private recordError(payload: Partial<CaptureExceptionPayload>): void {
    const now = Date.now();
    const message = payload.message ?? 'Unknown error';
    const firstStackLine = payload.stack?.split('\n').find((l) => l.trim()) ?? '';

    const existing = this.errorLog.find((e) => {
      const eFirst = e.stack?.split('\n').find((l) => l.trim()) ?? '';
      return e.message === message && eFirst === firstStackLine && now - e.lastSeen < ERROR_DEDUP_WINDOW_MS;
    });
    if (existing) {
      existing.count++;
      existing.lastSeen = now;
      WorkerPlugin.globalLog.set(this.id, this.errorLog.slice());
      return;
    }

    const entry: ExtensionError = {
      extensionId: this.id,
      message,
      stack: payload.stack,
      context: payload.context,
      severity: payload.severity ?? 'error',
      phase: payload.phase ?? 'manual',
      queryContext: payload.queryContext,
      firstSeen: now,
      lastSeen: now,
      count: 1,
    };

    this.errorLog.push(entry);
    if (this.errorLog.length > MAX_ERROR_LOG_SIZE) {
      this.errorLog.shift();
    }

    WorkerPlugin.globalLog.set(this.id, this.errorLog.slice());

    if (now - this.lastErrorEventAt > 1000) {
      this.lastErrorEventAt = now;
      window.dispatchEvent(new CustomEvent('volt:extension-error', { detail: entry }));
    }

    logger.warn(`[WorkerPlugin:${this.id}] Extension error captured:`, entry.message);
  }

  /** Return the captured error log for this extension (most recent last). */
  getErrorLog(): ExtensionError[] {
    return this.errorLog.slice();
  }

  /**
   * Start background refresh at the given interval (ms).
   * Triggers an immediate warm-up, then refreshes on schedule.
   */
  startBackgroundRefresh(intervalMs: number): void {
    if (intervalMs <= 0) return;
    this.refreshIntervalMs = intervalMs;
    // Warm up immediately without blocking the current call
    void this.refreshCache();
    this.refreshTimer = setInterval(() => { void this.refreshCache(); }, intervalMs);
  }

  /** Stop background refresh and clear the cache. */
  stopBackgroundRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshIntervalMs = 0;
    this.cachedResults = [];
    this.cacheTimestamp = 0;
  }

  /** Internal: call match with empty query to warm the cache. */
  private async refreshCache(): Promise<void> {
    try {
      const worker = this.getOrCreateWorker();
      const results = await this.sendRequest<PluginResult[]>(worker, 'match', { query: '' });
      this.cachedResults = (results || []).map((r) => ({ ...r, pluginId: this.id }));
      this.cacheTimestamp = Date.now();
    } catch {
      // Refresh failures are silent — stale cache is served until next interval
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
      } else if (payload.op === 'get-secret') {
        result = await invoke<string | null>('get_extension_secret', {
          extensionId: this.id,
          key: payload.key,
        });
      } else if (payload.op === 'set-secret') {
        await invoke('set_extension_secret', {
          extensionId: this.id,
          key: payload.key,
          value: payload.value ?? '',
        });
      } else if (payload.op === 'delete-secret') {
        await invoke('delete_extension_secret', {
          extensionId: this.id,
          key: payload.key,
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
  /**
   * Handle a confirm() dialog request from the Worker.
   * Opens the AlertDialog via uiStore and resolves/rejects the Worker promise.
   */
  private async handleAlertRequest(
    requestId: number,
    payload: { message: string }
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    const respond = (confirmed: boolean) => {
      if (this.worker) {
        this.worker.postMessage({ type: 'alert-response', id: requestId, payload: { confirmed } });
      }
    };

    try {
      const confirmed = await new Promise<boolean>((resolve, reject) => {
        this.pendingAlertCleanup = () => {
          useUiStore.getState().setAlertRequest(null);
          this.pendingAlertCleanup = null;
          reject(new Error('Alert cancelled (extension unloaded)'));
        };
        useUiStore.getState().setAlertRequest({
          message: payload.message,
          resolve,
        });
      });
      respond(confirmed);
    } catch {
      respond(false);
    } finally {
      this.pendingAlertCleanup = null;
    }
  }

  /**
   * Clean up resources when the plugin is unloaded.
   */
  destroy(): void {
    // Stop background refresh timer
    this.stopBackgroundRefresh();

    // Cancel all active OAuth event listeners and their timeouts
    for (const cancel of this.oauthUnlisteners) {
      try { cancel(); } catch { /* best-effort */ }
    }
    this.oauthUnlisteners = [];

    // Cancel pending alert dialog if extension is unloaded while dialog is open
    this.pendingAlertCleanup?.();

    // Remove from process-wide error log
    WorkerPlugin.globalLog.delete(this.id);

    // Reject all pending match/execute requests via the shared helper (see M12)
    this.cleanupPending('Plugin destroyed');
    this.terminateWorker();
  }
}
