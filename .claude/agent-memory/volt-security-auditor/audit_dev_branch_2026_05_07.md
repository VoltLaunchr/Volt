---
name: dev-branch deep audit 2026-05-07
description: Post-2025-audit audit of auth/oauth/credentials/extensions/shell/launch/preview/files; 1 HIGH (auth tokens through IPC), 2 MEDIUM (canonicalize fail-open in extensions, import_settings file-read primitive), 2 LOW
type: project
---

Findings recorded against `dev` branch on 2026-05-07. Scope: only modules added/changed since `RUST_CODE_REVIEW_2025.md`.

**HIGH** — `auth_get_session` (commands/auth.rs:274-288) and `auth_refresh_token` (345-434) return the entire `AuthSession` (access_token + refresh_token) through IPC. Inconsistent with the M2 design choice for `credentials::load_credential` which is explicitly NOT exposed. Frontend confirmed to consume the full struct in `src/features/auth/services/authService.ts:24`. Refresh tokens leaked to renderer = persistent account takeover from any frontend codeexec.

**Why:** Refresh tokens are long-lived, multi-window (`main` + `settings`) shares one capability, any future XSS / vulnerable React dep / dev-tools tampering harvests them.

**How to apply:** Recommend a public-only summary struct `{user_id, expires_at}` for IPC, keep token reads private to backend functions. Same pattern as `load_credential` not exposed via `#[tauri::command]`.

**MEDIUM** — `read_source_files_recursive` (commands/extensions.rs:958-997) fails open if `path.canonicalize()` or `base_dir.canonicalize()` returns Err. Same exact pattern as the fixed C4 in `plugins/api.rs::read_cache`. Reachable for installed extensions via runtime symlink creation; bypasses extension-directory containment, leaks file contents through `ExtensionSource.files`.

**MEDIUM** — `import_settings` (commands/settings.rs:694-724) calls `validate_settings_path(path, None)` (no required ext) and the validator only blocks system roots + `..`. User home + AppData + Documents are reachable. Combined with serde error message variations this is a fingerprinting/oracle primitive. Also no file-size cap.

**LOW** — `clear_oauth_pending` (commands/oauth.rs:296) doesn't validate `service`, allows self-DoS on pending OAuth flow.

**LOW** — `load_dev_state` (commands/extensions.rs:1121) uses `read_state_with_verification` (discards outcome) instead of `read_state_with_outcome`; tampered dev-extensions.json `path` field can redirect to attacker-staged folder. Mitigated by per-call forbidden-dir scan + Worker sandbox + id-collision check, but inconsistent with `load_installed_state` H4 fail-closed pattern.

**LOW** — Token strings not zeroized on drop in auth.rs / credentials.rs / keyring_store.rs.

Items checked and confirmed clean (do not re-report):
- shell.rs blocklist (NFKC, quote-strip, encoded-command, LOLBIN extended, 50KB stream cap, completion-token FIFO)
- launch_validation.rs (UWP-LOLBIN bypass closed, NTFS edge cases handled)
- keyring_store.rs HMAC (domain-separated, length-prefixed, constant-time)
- extension_state_sig.rs atomic write+rename
- auth.rs JWT verification (kid required, alg cross-checked, iss/aud/exp, refresh user_id match)
- extensions.rs archive extraction (symlink reject, traversal reject, 50MB cap, redirect off, allowlist hosts, ALLOWED_PERMISSIONS server-side)
- oauth.rs PKCE/state map
- preview.rs sensitive-path lists + canonical return
- windows_search.rs ($env:VOLT_QUERY indirection — no PS injection)
- sync.rs per-row validators
- shell.rs UNC working_dir reject
- launcher.rs::open_path executable-extension reject
- launcher/process.rs ShellExecuteW + escape_windows_arg

Audit doc says these are open and out-of-scope: P5, I2, I4.
