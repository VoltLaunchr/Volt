# Web Worker Sandbox for Extensions — Design Spec

**Date:** 2026-04-13
**Status:** Approved
**Scope:** Extension isolation via Web Workers with declarative canHandle

---

## Context

Extensions currently run in the main thread via dynamic code execution. A buggy or malicious extension can freeze the UI, access the DOM, or interfere with other extensions. This spec adds a Web Worker sandbox that isolates extension code in a separate thread.

## Architecture

Each sandboxed extension gets its own dedicated Web Worker. The main thread communicates with it via `postMessage`. A `WorkerPlugin` proxy class implements the `Plugin` interface, making the Worker transparent to the rest of the system.

```
Main Thread                          Worker Thread
─────────────                        ─────────────
ExtensionLoader                      Extension code (bundled)
  └─ WorkerPlugin                      └─ match(query) → results
       canHandle() → keyword check      └─ execute(result) → action commands
       match() ──postMessage──────────→ onmessage → run match()
              ←──postMessage──────────  postMessage(results)
       execute() ──postMessage────────→ onmessage → run execute()
              ←──postMessage──────────  postMessage(action commands)
```

---

## canHandle — Declarative, Main Thread Only

No extension code runs for `canHandle`. Instead, the manifest declares triggers:

```json
{
  "keywords": ["pass", "password", "pwd"],
  "prefix": "pass"
}
```

`WorkerPlugin.canHandle(context)` logic:
1. If `prefix` defined: `query.toLowerCase().startsWith(prefix)`
2. Else if `keywords` defined: any keyword matches `query.toLowerCase().startsWith(keyword)` OR `query.toLowerCase() === keyword`
3. If neither defined: `true` (extension receives all queries — generic extensions)

Performance target: < 0.1ms per call (pure string comparison, no code execution).

---

## match — Worker Thread, 500ms Timeout

When `canHandle` returns true, `WorkerPlugin.match(context)` sends a message to the Worker:

```ts
// Main thread → Worker
{ type: 'match', id: requestId, payload: { query: string } }

// Worker → Main thread
{ type: 'match-result', id: requestId, payload: PluginResult[] }
```

The `WorkerPlugin` wraps this in a Promise with a 500ms timeout:
- If Worker responds in time → return results
- If timeout → `worker.terminate()`, set `worker = null`, return `[]`
- Next `match` call recreates the Worker (lazy re-initialization)

---

## execute — Worker Thread, Action Commands

`execute` sends the result to the Worker. The extension code processes it and returns **action commands** instead of directly calling APIs (which aren't available in the Worker):

```ts
// Main thread → Worker
{ type: 'execute', id: requestId, payload: PluginResult }

// Worker → Main thread
{ type: 'execute-result', id: requestId, payload: ActionCommand[] }
```

Supported action commands:

```ts
type ActionCommand =
  | { action: 'copyToClipboard'; text: string }
  | { action: 'openUrl'; url: string }
  | { action: 'notify'; message: string; type?: 'info' | 'success' | 'error' }
  | { action: 'noop' }
```

The main thread executes each command using VoltAPI utilities. Same 500ms timeout applies.

---

## Worker Environment

The Worker receives the bundled extension code (same bundling as today via `bundleExtension()`) wrapped in an `onmessage` handler. The Worker has access to:

- `self` (Worker global scope)
- `crypto.getRandomValues` (for `__secureRandomInt__`)
- `PluginResultType` enum values (injected)
- `console` (for debugging)
- `__secureRandomInt__` helper (same as current)

The Worker does NOT have access to:
- `window`, `document`, `DOM`
- `VoltAPI` global (replaced with mock — see below)
- `fetch` (network access) — extensions needing network should declare `network` permission (Phase 3.2)
- `invoke` (Tauri IPC)
- Other extensions' state

### Worker Bootstrap

The Worker is created from a Blob URL containing:
1. The `__secureRandomInt__` helper
2. `PluginResultType` enum as a plain object
3. The module system (`__modules__`, IIFE modules)
4. The bundled extension code
5. An `onmessage` handler that dispatches to `match`/`execute`

The `onmessage` handler instantiates the plugin (from the default export) once on first message, then routes subsequent messages to the appropriate method.

---

## VoltAPI Mock for Workers

Extensions currently access VoltAPI methods directly (`VoltAPI.utils.copyToClipboard()`). In the Worker, these calls become action commands captured in a pending list.

The Worker injects a **mock VoltAPI** that captures actions instead of executing them:

- `copyToClipboard(text)` → pushes `{ action: 'copyToClipboard', text }` to pending actions
- `openUrl(url)` → pushes `{ action: 'openUrl', url }` to pending actions
- `formatNumber(n)` → returns `n.toLocaleString()` (pure function, works in Worker)
- `fuzzyScore(query, target)` → simple inline implementation (string includes check)
- `notify(message, type)` → pushes `{ action: 'notify', message, type }` to pending actions

For `match()`: pending actions are cleared after each call (match should only return results).
For `execute()`: pending actions are collected and returned to the main thread for execution.

---

## Manifest Changes

Add optional fields to `ExtensionManifest`:

```ts
interface ExtensionManifest {
  // ... existing fields ...
  keywords?: string[];  // Trigger keywords for canHandle
  prefix?: string;      // Trigger prefix for canHandle
}
```

Rust struct (`ExtensionManifest` in extensions.rs):
```rust
#[serde(default)]
pub keywords: Vec<String>,
#[serde(default)]
pub prefix: Option<String>,
```

---

## Sandbox Detection & Fallback

In `ExtensionLoader.loadExtension()`:

```ts
if (manifest.keywords?.length || manifest.prefix) {
  // New path: Worker sandbox
  return this.loadInWorker(source);
} else {
  // Legacy path: inline execution (existing behavior)
  console.warn(`Extension ${id} has no keywords/prefix — running inline (legacy mode)`);
  return this.loadInline(source);
}
```

This ensures 100% backwards compatibility. Existing extensions work as before. New/updated extensions with `keywords`/`prefix` in their manifest get the Worker sandbox automatically.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/features/extensions/loader/worker-sandbox.ts` | `WorkerPlugin` proxy class — implements `Plugin`, communicates with Worker via postMessage |
| `src/features/extensions/loader/worker-bootstrap.ts` | Generates the Worker bootstrap code (wraps bundled extension in onmessage handler) |

## Files to Modify

| File | Changes |
|------|---------|
| `src/features/extensions/loader/index.ts` | Add `loadInWorker()` path, rename current logic to `loadInline()` |
| `src/features/extensions/types/extension.types.ts` | Add `keywords?: string[]`, `prefix?: string` to ExtensionManifest |
| `src-tauri/src/commands/extensions.rs` | Add `keywords: Vec<String>`, `prefix: Option<String>` to ExtensionManifest struct |

## Files to Update (volt-extensions repo)

| File | Changes |
|------|---------|
| `D:\dev\volt-extensions\examples\password-generator\manifest.json` | Add `"keywords": ["pass", "password", "pwd"], "prefix": "pass"` |
| `D:\dev\volt-extensions\examples\calculator\manifest.json` | Add `"keywords": ["calc", "=", "math"]` |
| `D:\dev\volt-extensions\examples\websearch\manifest.json` | Add `"keywords": ["?"], "prefix": "?"` |
| `D:\dev\volt-extensions\registry.json` | Update password-generator manifest with keywords/prefix |

---

## Acceptance Criteria

- Extensions with `keywords`/`prefix` in manifest execute in a dedicated Web Worker
- Extensions without keywords/prefix fallback to inline execution (legacy) with console warning
- `canHandle` evaluated in < 0.1ms (no extension code execution)
- `match` timeout at 500ms → Worker terminated and recreated on next call
- `execute` returns action commands executed by main thread
- Password-generator extension works identically in Worker sandbox
- Zero regression on builtin plugins (they don't go through ExtensionLoader)
- Worker crash recovery: terminated Worker is lazily recreated on next call

---

## Out of Scope

- Permission enforcement (Phase 3.2 — separate spec)
- Network access control in Workers (Phase 3.2)
- Plugin SDK CLI (Phase 3.3)
- SharedWorker or Worker pool optimizations
- Worker-to-Worker communication
