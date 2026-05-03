---
name: Release-readiness security audit (2026-05-03)
description: Pre-release security audit findings for v0.1.2 — devtools-on-by-default, single shared capability, load_credential exposure, sync re-validation, etc.
type: project
---

Pre-release audit of `dev` branch at `b2b90ee` (v0.1.2). Most prior hardening is verified landed; new findings concentrated on capability scoping and a few residual frontend trust issues.

**Critical / hardening regressions in v0.1.2:**
- `Cargo.toml:93` — `default = ["devtools"]`. Release binaries ship with devtools enabled. Any user can `Ctrl+Shift+I` and `invoke()` everything (incl. `load_credential`, `auth_get_session`).
- `capabilities/default.json` — single capability scoped to ALL four windows (`main`, `settings`, `system-monitor`, `onboarding`). No per-window scoping. The system-monitor window inherits the same `auth_get_session`/`load_credential` invoke surface even though it doesn't need any of it.
- `commands/credentials.rs:85` — `load_credential` still exposed to renderer; only consumer is `hasToken` which discards the value, so the bare-token return is dead weight. test_credential migration is otherwise complete.

**Major / open from prior audits, status:**
- `windows_search.rs` PowerShell-injection — FIXED (uses `$env:VOLT_QUERY`, no interpolation). Verified 2026-05-03.
- `sync.rs` quicklinks `replace_all` without re-running `validate_quicklink` / snippet validation — STILL OPEN. Pulled `Quicklink.command` rows can carry shell metachars / non-existent program paths and are silently accepted.
- `sync.rs::require_premium` checks `profile.tier` over REST. If profiles RLS allows self-update, user can self-promote to premium. Premium gate should be JWT claim or RLS on sync_data.
- `extensions.rs::install_extension` does not check the manifest's declared permissions against `ALLOWED_PERMISSIONS` — only `update_extension_permissions` does. A registry extension whose manifest lists `["clipboard","fileSystem"]` won't fail install (file_system isn't allowed), it just silently loses the bogus perm at grant time. Minor.
- CSP includes `'unsafe-inline'` for style-src — needed for React inline styles, acceptable but should be moved to nonce-based when feasible.

**What's notable as good (cite when reviewing future PRs):**
- Single CSP allowlist for connect-src (no wildcards). dev CSP cleanly separated.
- Rate-limited deep links + redacted query params before logging.
- Worker sandbox locks down constructor-paths, Worker / SharedWorker / Worklets, navigator.serviceWorker accessor, importScripts, string-eval setTimeout.
- Domain-tagged HMAC on credentials and extension-state files; `verify_slice` constant-time.
- JWT validation: ES256 pinned via JWKS `alg` field, `kid` required, alg-confusion check (header.alg vs JWK.alg), kid-rotation refresh.
- PKCE: 43-char URL-safe-no-pad verifier, S256 challenge, AUTH_STATE pruning + 64-entry cap.
- Launch validation: UWP regex anchored, LOLBIN denylist runs on first `!`-token, NTFS trailing-space + ADS handled.
- Shell: NFKC + quote-strip blocklist, streaming 50KB cap with kill flag, redactors cover ghp/AKIA/sk_live/xoxa-s/JWT/`-u`.

**How to apply on next PR review:**
1. Block release-readiness on flipping `default = ["devtools"]` to `default = []` and gating with `#[cfg(any(debug_assertions, feature = "devtools"))]` if needed.
2. Per-window capability files (`capabilities/main.json`, `capabilities/settings.json`, etc.) before adding any window that handles auth/credentials.
3. Any sync.rs change must re-run validation row-by-row on pulled data.
4. Move premium check off `profiles.tier` REST read into a JWT claim populated server-side.
