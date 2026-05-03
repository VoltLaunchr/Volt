---
name: Extension System Security Audit Findings
description: Key security patterns and vulnerabilities found in Volt's extension/Worker sandbox system (latest 2026-05-03)
type: project
---

Latest audit 2026-05-03 (post-hardening). Snapshot of state.

**Hardening verified working:**
- HMAC-SHA256 detached sigs (`extension_state_sig.rs`): sig-first, JSON-atomic, sig-rename-last is correct. Constant-time `verify_slice`. Tamper-detected flag exposed to UI. Mismatch is logged-only (intentional — caller comments justify not bricking).
- Worker bootstrap: blocks `eval`, `Function`, `WebSocket`, `XMLHttpRequest`, `indexedDB`, `caches`, `Worker`, `SharedWorker`, `ServiceWorker(Container)`, `*Worklet`, `importScripts`, string-based `setTimeout`/`setInterval`. AsyncFunction/GeneratorFunction/AsyncGeneratorFunction `.constructor` properties are locked down with `Object.defineProperty(..., {value: throw, writable:false, configurable:false})`.
- `navigator.serviceWorker` getter is overridden to throw.
- Manifest permissions sanitized: `sanitizePermissions` (loader/index.ts:31) drops unknown values via `isExtensionPermission` guard. `EXTENSION_PERMISSIONS` is `['clipboard','network','notifications','openUrl']` — `filesystem`/`shell` are no longer in the type union.
- `transformModuleCode` uses Sucrase AST (typescript+imports), not regex.
- `__voltRequire__` regex pins `/(?:^|\/)api(?:\.(?:ts|js|tsx|jsx|mjs))?$/` so mid-path `vendor/api/foo` cannot shadow the shim.
- ZIP/tar extraction rejects symlinks, `..`, abs paths; `ensure_contained` belt-and-suspenders. Dev paths reject `.ssh/.aws/.config/.gnupg/.docker/.kube/.azure/.netrc`. `manifest.id` must equal `extension_id` post-extract. Dev id collisions with installed extensions rejected at link time AND filtered at read time in `get_enabled_extensions_sources`.
- `update_extension_permissions` had no server-side validation in prior audit — STILL accepts arbitrary strings; sanitization is only on the read side via TS `sanitizePermissions`. Not a vuln by itself but worth noting.

**Outstanding vulnerabilities:**
- `isUrlSafe` (worker-sandbox.ts:269) does NOT pass `redirect:'manual'` or check redirect chain — server returning 30x to `127.0.0.1` bypasses the SSRF block (default `redirect:'follow'`).
- DNS rebinding: explicitly acknowledged as out of scope (line 266-268).
- `RequestInit.signal` and `referrer` aren't normalized — minor.
- `mailto:` allowed in `openUrl` (helpers.ts:163) — `mailto:?attach=...` was historically abusable on Windows but mostly mitigated by Tauri opener; low risk.
- `navigator.sendBeacon` not blocked in Worker — was not in the bootstrap blocklist; check if Workers have it (they don't usually, but worth noting).
- `update_extension_permissions` accepts arbitrary `Vec<String>` — could persist non-canonical entries. TS read-side filters them, but it's a footgun.

**How to apply:** Reference these findings when reviewing extension PRs or hardening work.
