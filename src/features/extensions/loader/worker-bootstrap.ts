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
 * Messages sent from main thread to Worker
 */
export interface WorkerRequest {
  type: 'match' | 'execute';
  id: number;
  payload: unknown;
}

/**
 * Messages sent from Worker to main thread
 */
export interface WorkerResponse {
  type: 'match-result' | 'execute-result' | 'error';
  id: number;
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
        fetchReq.resolve({
          ok: payload.ok,
          status: payload.status,
          statusText: payload.statusText,
          text: function() { return Promise.resolve(payload.body); },
          json: function() { return Promise.resolve(JSON.parse(payload.body)); },
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

// Override fetch to use permission-controlled proxy
self.fetch = function(url, options) {
  return VoltAPI.fetch(url, options);
};

// Signal ready
self.postMessage({ type: 'ready', id: 0, payload: null });
`;
}
