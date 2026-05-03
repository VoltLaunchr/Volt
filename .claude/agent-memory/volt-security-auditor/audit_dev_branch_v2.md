---
name: dev-branch second-pass audit (2026-05-03)
description: Verifies May-03 hardening sequence (PKCE, JWKS, HMAC keyring, fail-closed perms, shell blocklist, SSRF, rate limiter) actually landed; flags new issues from surrounding refactor
type: project
---

Second-pass audit of `dev` vs `main` 2026-05-03. Most prior hardening verified landed; new issues center on the cloud-sync introduction, the PowerShell-shaped Windows Search query, and renderer-trust between newly-added windows.

**Hardening verified landed (no longer regressing items from prior memory files):**
- `auth.rs` PKCE + JWKS ES256 + alg-confusion check + refresh user_id verify + 24h cap.
- `keyring_store::store_signed/retrieve_signed` domain-tagged HMAC, length-prefixed domain, constant-time compare.
- `extension_state_sig::read_state_with_outcome` exposes `Mismatch`; `extensions.rs::load_installed_state` resets `granted_permissions` on mismatch (H4 fail-closed).
- `extensions.rs::ALLOWED_PERMISSIONS` server-side allowlist; whole batch rejected on bad entry.
- `shell.rs` NFKC + extended blocklist (Stop-Computer, Restart-Computer, Format-Volume, Clear-Disk, diskpart, init/telinit 0/6, EncodedCommand, reg.exe, Remove-Item -Recurse -Force C:\, find -delete, logoff). Streaming `STREAM_OUTPUT_CAP` 50KB tripping kill flag. UNC working_dir reject + canonicalize. Redactors include ghp_/AKIA/sk_live_/xox*/JWT/`-u`.
- `launch_validation.rs` UWP regex + LOLBIN-on-first-token check (closes `cmd.exe!whatever` bypass).
- `launcher.rs::open_path` blocks LOLBIN extensions; new `open_file_with_dialog` rejects UNC + .lnk.
- `worker-sandbox.ts` `redirect: 'manual'` + per-hop `isUrlSafe`, hex-mapped IPv6 detection, numeric/octal/decimal IPv4 reject, `cleanupPending` shared helper.
- `lib.rs` deep-link rate limiter (5/60s sliding, log on transition).
- `oauth.rs::handle_oauth_deep_link` host-must-be `oauth-callback`.
- `credentialsService.ts` no longer holds bare tokens — uses `invoke('test_credential')`.

**New / open issues (severity-ranked):**

- **HIGH (likely RCE)**: `indexer/windows_search.rs:52` builds a PowerShell `"…"` literal containing `safe_query`. Single + double quotes escaped, but `$`, `` ` ``, `(`, `)` are not. PS double-quoted strings perform `$( … )` subexpression evaluation. Reachable from search bar via `search_files` → `search_windows_index`. Fix: blocklist `$\`()` in the pre-check, or move to parameterized OLE DB.

- **HIGH (data loss + persisted XSS)**: `commands/sync.rs::sync_pull` quicklinks branch is `replace_all(map)` — no `updated_at`, no re-validation. Pulled `Quicklink.command` rows aren't run through `validate_quicklink`. Pulled snippets aren't run through snippet content validation. A compromised/cross-device session writes attacker-controlled commands or XSS-prone snippets that are silently accepted on next pull.

- **HIGH (authz bypass)**: `sync.rs::require_premium` checks `profile.tier` via REST. If RLS allows user UPDATE on profiles, user can self-promote. Move premium gate to RLS on `sync_data` itself (using a `tier` JWT claim populated by an auth hook).

- **HIGH (token theft via XSS)**: New `system-monitor` window in `tauri.conf.json` shares `index.html` and the same capability set. `auth_get_session` returns bare `access_token` to JS. Per-window capability scoping is needed.

- **MEDIUM**: `increment_extension_download` is unrate-limited fire-and-forget — counter poison + Supabase quota burn.
- **MEDIUM**: `validate_working_dir` leaks OS error strings (path existence oracle).
- **MEDIUM**: `import_settings` doesn't run `validate_launch_path` on imported `app_shortcuts.path`.
- **MEDIUM**: PKCE `AUTH_STATE` has no upper bound; renderer XSS can fill it via repeated `auth_start_login`.
- **MEDIUM**: legacy implicit auth path still accepted (sunset planned but not enforced).

**How to apply on next PR review:**
1. Treat any change to `indexer/windows_search.rs` as PowerShell-injection-sensitive — require character allowlist or parameterized binding.
2. Any change touching `sync.rs` / `sync_data` table: ensure premium check is server-side and pulled rows are re-validated row-by-row.
3. Any new window in `tauri.conf.json`: require an explicit per-window capability file; do not let it inherit `default.json`.
4. Any new `volt://` URL handler: ensure host is asserted and state nonce is required (precedent: `oauth.rs:253`, `auth.rs:447`).
