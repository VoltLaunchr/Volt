/**
 * Worker Bootstrap Generator
 *
 * Generates the JavaScript code that runs inside a Web Worker
 * for sandboxed extension execution. The Worker receives messages
 * from the main thread to call match() and execute() on the plugin.
 */

import { PluginResultType } from '../../plugins/types';

/**
 * Action commands that the Worker sends back to the main thread
 * for execution (since Workers can't access DOM/Tauri APIs).
 */
export type ActionCommand =
  | { action: 'copyToClipboard'; text: string }
  | { action: 'openUrl'; url: string }
  | { action: 'notify'; message: string; type?: 'info' | 'success' | 'error' }
  | { action: 'fetch'; url: string; options?: Record<string, unknown> }
  | { action: 'noop' };

/**
 * Messages sent from main thread to Worker.
 *
 * `id` is `string | number` because match/execute requests now use
 * cryptographic random UUIDs generated on the main thread (see
 * WorkerPlugin.sendRequest), while fetch-responses echo the numeric
 * counter id generated inside the Worker.
 */
export interface WorkerRequest {
  type: 'match' | 'execute';
  id: string | number;
  payload: unknown;
}

/**
 * Messages sent from Worker to main thread.
 *
 * `id` follows the same mixed convention as WorkerRequest: the Worker
 * echoes whatever id the main thread sent for match/execute responses,
 * and uses its own numeric counter for fetch-request messages.
 */
export interface WorkerResponse {
  type: 'match-result' | 'execute-result' | 'error';
  id: string | number;
  payload: unknown;
}

/**
 * Generate the Worker bootstrap code that wraps bundled extension code.
 *
 * @param bundledModuleCode - The bundled extension modules (from buildBundleWithOrder),
 *   but WITHOUT the "use strict" header, VoltAPI reference, and return statement.
 *   This should be just the module IIFEs.
 * @param entryPoint - The entry point module path (e.g., "index.ts")
 */
export function generateWorkerBootstrap(
  bundledModuleCode: string,
  entryPoint: string
): string {
  const normalizedEntry =
    entryPoint.endsWith('.ts') || entryPoint.endsWith('.js')
      ? entryPoint
      : entryPoint + '.ts';

  // Serialize PluginResultType enum values for the Worker
  const pluginResultTypeObj = JSON.stringify(PluginResultType);

  return `
"use strict";

// === Worker Bootstrap for Volt Extension ===

// === Sandbox: block dangerous globals ===
// IMPORTANT: These overrides MUST be installed BEFORE any user/extension code
// runs (including top-level IIFEs in bundledModuleCode). Otherwise a malicious
// extension could invoke importScripts / dynamic code compilation at module
// import time, before activate() is ever called, and escape the sandbox.
self.eval = undefined;
self.Function = undefined;
self.WebSocket = undefined;
self.XMLHttpRequest = undefined;
self.indexedDB = undefined;
self.caches = undefined;
// Block nested Worker spawning: a child Worker gets a fresh un-locked-down
// global realm (pristine Function / WebSocket / importScripts etc.), so a
// compromised extension could do new Worker('data:text/javascript,...')
// and escape this sandbox. Must live in the early-override block so user
// code can't grab a reference to Worker before we null it.
self.Worker = undefined;
self.SharedWorker = undefined;
// Block ServiceWorker registration paths: navigator.serviceWorker is reachable
// in WorkerGlobalScope on Chromium 105+ (matches WebView2) and can register
// a background SW with network-interception capability. Also null Worklet
// variants — each Worklet creates a fresh realm with un-locked-down globals.
self.ServiceWorker = undefined;
self.ServiceWorkerContainer = undefined;
self.AudioWorklet = undefined;
self.PaintWorklet = undefined;
self.LayoutWorklet = undefined;
self.Worklet = undefined;
// navigator is a read-only property on WorkerGlobalScope; we can't reassign it,
// but we can make the serviceWorker accessor throw so the registration entry
// point is unreachable even if a child realm exposes ServiceWorker somehow.
try {
  if (self.navigator) {
    Object.defineProperty(self.navigator, 'serviceWorker', {
      get: function() { throw new Error('ServiceWorker access is disabled in extension sandbox'); },
      configurable: false,
    });
  }
} catch (_e) { /* best-effort; some engines have frozen navigator */ }

// Block importScripts to prevent loading remote code (installed early so
// top-level extension code cannot pull in attacker-controlled scripts).
self.importScripts = function() {
  throw new Error('importScripts is blocked in sandboxed extensions');
};

// Block string-based setTimeout/setInterval (dynamic-compile vector)
var _origSetTimeout = self.setTimeout;
self.setTimeout = function(fn, ms) {
  if (typeof fn === 'string') throw new Error('String eval blocked');
  return _origSetTimeout(fn, ms);
};
var _origSetInterval = self.setInterval;
self.setInterval = function(fn, ms) {
  if (typeof fn === 'string') throw new Error('String eval blocked');
  return _origSetInterval(fn, ms);
};

// Neutralize constructor-path escapes that would otherwise reach dynamic
// function construction even with self.Function / self.eval set to undefined:
//   (async () => {}).constructor('return x')        -> AsyncFunction
//   (function*(){}).constructor                     -> GeneratorFunction
//   (async function*(){}).constructor               -> AsyncGeneratorFunction
//   Object.getPrototypeOf(async function(){}).constructor -> same target
// We override .constructor on each prototype so those paths throw instead of
// returning a fresh string-compiled function.
try {
  var __AsyncFunction__ = (async function(){}).constructor;
  var __GeneratorFunction__ = (function*(){}).constructor;
  var __AsyncGeneratorFunction__ = (async function*(){}).constructor;
  var __blockedCtors__ = [Function, __AsyncFunction__, __GeneratorFunction__, __AsyncGeneratorFunction__];
  for (var __i__ = 0; __i__ < __blockedCtors__.length; __i__++) {
    var __Ctor__ = __blockedCtors__[__i__];
    if (!__Ctor__ || !__Ctor__.prototype) continue;
    try {
      Object.defineProperty(__Ctor__, 'prototype', {
        value: __Ctor__.prototype,
        writable: false,
        configurable: false,
      });
    } catch (_e1) {
      try { console.warn('[volt-sandbox] constructor lockdown skipped for Ctor index ' + __i__ + ': ' + _e1); } catch (_) {}
    }
    try {
      Object.defineProperty(__Ctor__.prototype, 'constructor', {
        value: function() {
          throw new Error('Dynamic function construction is disabled in extension sandbox');
        },
        writable: false,
        configurable: false,
      });
    } catch (_e2) {
      try { console.warn('[volt-sandbox] constructor prop lockdown skipped for Ctor index ' + __i__ + ': ' + _e2); } catch (_) {}
    }
  }
} catch (_e) {
  try { console.warn('[volt-sandbox] constructor lockdown block failed (generator flavors unavailable?): ' + _e); } catch (_) {}
}

// Secure random number generator (Web Crypto API)
function __secureRandomInt__(min, max) {
  const range = max - min;
  const randomBuffer = new Uint32Array(1);
  crypto.getRandomValues(randomBuffer);
  return min + (randomBuffer[0] % range);
}

// PluginResultType enum
const PluginResultType = ${pluginResultTypeObj};

// Action capture for execute()
let __pendingActions__ = [];

// Fetch proxy infrastructure
let __fetchCounter__ = 10000;
var __fetchPending__ = {};

// Mock VoltAPI (captures actions instead of executing them)
const VoltAPI = {
  types: { PluginResultType },
  utils: {
    copyToClipboard: function(text) {
      __pendingActions__.push({ action: 'copyToClipboard', text: text });
    },
    openUrl: function(url) {
      __pendingActions__.push({ action: 'openUrl', url: url });
    },
    formatNumber: function(n) {
      return typeof n === 'number' ? n.toLocaleString() : String(n);
    },
    fuzzyScore: function(query, target) {
      if (!query || !target) return 0;
      var q = query.toLowerCase();
      var t = target.toLowerCase();
      if (t === q) return 100;
      if (t.startsWith(q)) return 90;
      if (t.includes(q)) return 80;
      return 0;
    },
  },
  invoke: function() {
    console.warn('[Worker] invoke() is not available in sandboxed extensions');
    return Promise.resolve(null);
  },
  events: {
    emit: function() {},
    on: function() { return function() {}; },
  },
  notify: function(message, type) {
    __pendingActions__.push({ action: 'notify', message: message, type: type || 'info' });
  },
  fetch: function(url, options) {
    return new Promise(function(resolve, reject) {
      var fetchId = ++__fetchCounter__;
      __fetchPending__[fetchId] = { resolve: resolve, reject: reject };
      self.postMessage({
        type: 'fetch-request',
        id: fetchId,
        payload: { url: url, options: options }
      });
    });
  },
};

// Install permission-proxied fetch BEFORE bundledModuleCode so a top-level
// \`const _fetch = fetch\` in extension init cannot capture the native binding.
self.fetch = function(url, options) {
  return VoltAPI.fetch(url, options);
};

// Module registry
const __modules__ = {};

// === Extension Modules ===
${bundledModuleCode}

// === Plugin Instantiation ===
const __entryModule__ = __modules__["${normalizedEntry}"];
const __defaultExport__ = __entryModule__ && __entryModule__.default;

let __plugin__ = null;

function __getPlugin__() {
  if (__plugin__) return __plugin__;
  if (!__defaultExport__) {
    throw new Error('Extension has no default export');
  }
  if (typeof __defaultExport__ === 'function') {
    try {
      __plugin__ = new __defaultExport__();
    } catch (e) {
      __plugin__ = __defaultExport__();
    }
  } else {
    __plugin__ = __defaultExport__;
  }
  return __plugin__;
}

// === Message Handler ===
self.onmessage = function(event) {
  var msg = event.data;
  var id = msg.id;
  var type = msg.type;
  var payload = msg.payload;

  if (type === 'fetch-response') {
    var fetchReq = __fetchPending__[id];
    if (fetchReq) {
      delete __fetchPending__[id];
      if (payload.error) {
        fetchReq.reject(new Error(payload.error));
      } else {
        // Body arrives either as a UTF-8 string (text/* + JSON/XML/SVG/etc.)
        // or base64-encoded bytes (images, PDFs, zips, octet-stream…).
        // We decode once lazily and share across .text()/.blob()/.arrayBuffer()
        // so extensions that call multiple accessors don't re-decode.
        var __bodyEncoding__ = payload.bodyEncoding || 'utf-8';
        var __bytes__ = null;
        function __getBytes__() {
          if (__bytes__) return __bytes__;
          if (__bodyEncoding__ === 'base64') {
            // Worker context provides atob. charCode loop reconstructs
            // exact bytes — necessary because binary data round-tripped
            // through UTF-8 would be corrupted by replacement chars.
            var bin = atob(payload.body || '');
            var len = bin.length;
            var out = new Uint8Array(len);
            for (var i = 0; i < len; i++) out[i] = bin.charCodeAt(i) & 0xff;
            __bytes__ = out;
          } else {
            // UTF-8 text path: encode the string to bytes for .blob()/.arrayBuffer()
            __bytes__ = new TextEncoder().encode(payload.body || '');
          }
          return __bytes__;
        }
        fetchReq.resolve({
          ok: payload.ok,
          status: payload.status,
          statusText: payload.statusText,
          text: function() {
            if (__bodyEncoding__ === 'base64') {
              return Promise.resolve(new TextDecoder().decode(__getBytes__()));
            }
            return Promise.resolve(payload.body);
          },
          json: function() {
            if (__bodyEncoding__ === 'base64') {
              // Binary content cannot be parsed as JSON; fail loudly
              // rather than producing garbage. Mirrors native fetch: calling
              // .json() on a non-JSON response throws SyntaxError.
              return Promise.reject(new SyntaxError(
                'Cannot parse binary response (bodyEncoding=base64) as JSON'
              ));
            }
            return Promise.resolve(JSON.parse(payload.body));
          },
          blob: function() {
            return Promise.resolve(new Blob([__getBytes__()]));
          },
          arrayBuffer: function() {
            var b = __getBytes__();
            // Return a standalone ArrayBuffer copy so the caller can't
            // mutate our shared __bytes__ buffer through the returned view.
            return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
          },
        });
      }
    }
    return;
  }

  try {
    var plugin = __getPlugin__();

    if (type === 'match') {
      __pendingActions__ = [];
      var context = { query: payload.query };
      var resultOrPromise = plugin.match(context);

      Promise.resolve(resultOrPromise).then(function(results) {
        self.postMessage({
          type: 'match-result',
          id: id,
          payload: results || []
        });
      }).catch(function(err) {
        console.error('[Worker] match() error:', err);
        self.postMessage({
          type: 'match-result',
          id: id,
          payload: []
        });
      });

    } else if (type === 'execute') {
      __pendingActions__ = [];
      var executeResult = plugin.execute(payload);

      Promise.resolve(executeResult).then(function() {
        var actions = __pendingActions__.slice();
        __pendingActions__ = [];
        self.postMessage({
          type: 'execute-result',
          id: id,
          payload: actions.length > 0 ? actions : [{ action: 'noop' }]
        });
      }).catch(function(err) {
        console.error('[Worker] execute() error:', err);
        self.postMessage({
          type: 'execute-result',
          id: id,
          payload: [{ action: 'noop' }]
        });
      });
    }
  } catch (err) {
    console.error('[Worker] Error:', err);
    self.postMessage({
      type: 'error',
      id: id,
      payload: err.message || String(err)
    });
  }
};

// Signal ready
self.postMessage({ type: 'ready', id: 0, payload: null });
`;
}
