---
name: audit-extension-sandbox-2026-05-14
description: Deep audit of Volt extension Worker sandbox + Rust extension commands; CRITICAL C2 saveCredential bypass and C3 extension_authenticated_fetch caller-trust; HIGH H2 OAuth event token leak; multiple defense-in-depth gaps
metadata:
  type: project
---

# Volt extension sandbox audit — 2026-05-14

Comprehensive sandbox audit performed against `dev` branch. The architecture is solid (constructor lockdown, hex-mapped IPv6 SSRF blocking, manual redirect re-validation, server-side permission allowlist, HMAC state sigs with atomic sig-first write). Real issues clustered around two patterns: **caller-supplied `extension_id` on commands granting ambient authority**, and **token material crossing the IPC event boundary**.

## Findings to track

- **C2 (CRITIQUE)**: `worker-sandbox.ts:1008-1021` — `saveCredential` action handler does NOT check `grantedPermissions`; only checks `action.service !== this.id`. An extension with `manifest.id = "github"` can overwrite the user's real GitHub credential at any time. Compounds with `save_credential`'s `["github","notion"]` whitelist — `id` collision allows poisoning. Fix: gate behind `'oauth'` permission AND namespace keyring entry per extension id.

- **C3 (CRITIQUE)**: `extension_authenticated_fetch` is in `main.json:167` and the command trusts caller-supplied `extension_id`. Any renderer code (XSS, future bug) can invoke with `extensionId: "github"` and exfiltrate GitHub API responses with the user's token attached server-side. Fix: remove the capability, route via Worker-bound handler so `extension_id` is server-known.

- **H2 (HAUT)**: `extensions.rs:handle_ext_oauth_deep_link` line 2462-2468 emits the `access_token` inside the `ext-oauth-{id}` Tauri event payload. Any renderer-side `listen("ext-oauth-<other>")` captures the token. Fix: emit only `{ state, error }`, have the Worker re-fetch via `ext_oauth_get_token`.

- **H4 (HAUT)**: `__secureRandomInt__` in both `worker-bootstrap.ts:200-205` and `index.ts:545-549` is biased mod-N. Real impact for password-generator-style extensions. Fix: rejection sampling.

- **H1 (HAUT, latent)**: Worker bootstrap doesn't define `__voltRequire__` — multi-file Sucrase output silently breaks at runtime in the Worker. Future fix must inject an **allowlisted** require, not a passthrough — passthrough would expose `@tauri-apps/api/core`.

## Positive patterns to keep

- `__blockedCtors__` constructor lockdown blocks the n8n CVE-2025-68613 prototype-chain technique.
- `isHexMappedIpv4Private` catches `[::ffff:7f00:1]` — beyond industry baseline.
- Manual-redirect re-validation with opaque-redirect fail-closed.
- `ALLOWED_PERMISSIONS` server-side allowlist with batch-reject on unknown.
- HMAC sig-first atomic write survives crashes without false-positive Mismatch.

## Things deferred / not exhaustive

- Did not audit `settings.json`, `onboarding.json`, `system-monitor.json` capabilities — they may duplicate `allow-extension-authenticated-fetch` / `allow-save-credential` (M10).
- Did not test live escape attempts (constructor-chain, prototype walk on `importScripts`); flagged M9 as worth verifying.
- Did not verify Modal focus-trap for permission dialog (I6).

## Where to look first next audit

- New Worker action handlers added since (the `executeActions` switch) — verify each one has `hasPermission(...)` gate.
- Any new Tauri command with `extension_id: String` as a parameter — verify caller authentication.
- `WorkerPlugin.globalLog` if it ever gets exposed to other extensions' query results.
