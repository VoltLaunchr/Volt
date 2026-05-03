---
name: IPC + File-system + Launch Validation Audit
description: Findings on Tauri command surface, path validation, launch validation, deep-link handlers (2026-05-03)
type: project
---

Audit of `commands/`, `launcher/`, `indexer/`, `utils/launch_validation.rs`, and capabilities.

**Why:** User requested ruthless audit of the IPC + filesystem + launch surface to find concrete, exploitable issues against the threat model of malicious extensions / malicious files / malicious network responses.

**How to apply:** When reviewing changes that touch these modules, watch for these recurring patterns:

Confirmed weaknesses:
- `validate_launch_path` allow-bypass: any `path` without `\` or `/` but containing `!` is allow-listed as a "Shell:AppsFolder identifier" (`launch_validation.rs:81`). This is then passed to `ShellExecuteW("open", ...)`. A malicious extension can call `launch_app` with `cmd!arg` or any `Foo!Bar` and it skips ALL validation and calls ShellExecute.
- `open_quicklink` "command" type: validates absolute path on save+exec but spawns via `std::process::Command::new(program).args(args).spawn()` — fine because no shell. Rejection of metachars + abs-path file check is solid (good pattern).
- `open_path` (`launcher.rs:315`) accepts ANY path that exists and forwards to `tauri_plugin_opener::open_path`. Frontend or extension can pass arbitrary `.exe`, `.scr`, `.lnk`, `.msi` — relies on shell file association (the LOLBIN denylist in `validate_launch_path` is NOT applied here).
- `windows_search.rs:34` constructs a PowerShell script with user-controlled `safe_query` interpolated into a heredoc. Quote-doubling escape is correct for the WQL CONTAINS literal but the surrounding PowerShell script is built via `format!()` — the only PowerShell injection sink is the inner SQL string, which uses `''` and `""` doubling.
- `clear_oauth_pending(service)` (oauth.rs:208) does no input validation on `service` — but it only filters in-memory map, no real impact.
- `auth.rs:handle_auth_deep_link` accepts any `volt://auth/callback?...` URL; the deep-link listener in `lib.rs:396` parses the JSON event payload from the OS — an attacker controlling the URL handler at OS level could feed crafted tokens that are then stored to OS keyring as `supabase_auth`. Trust boundary: anything that can register a `volt://` link can poison the session.
- Snippet `import_snippets` deserializes user JSON, regenerates IDs (good), but content is rendered via `expand_snippet` and pasted to clipboard — content is user-controlled. Not exploitable for code exec, but XSS possible if rendered as HTML in UI.
- `indexer/scanner.rs:182` uses `entry.metadata()` (follows symlinks) to test `is_symlink()` — on the resolved target. This is correct because Rust's `DirEntry::metadata()` does not follow symlinks (it uses `lstat`/`FILE_ATTRIBUTE_REPARSE_POINT` on Windows). Confirmed safe.
- `commands/apps.rs:1200,1294` uses `entry.metadata()` to test `is_symlink()` — same as above; safe.
- `set_window_position` accepts arbitrary `i32` for custom_x/y — could move window off-screen. Local user trust → low risk.
- Launch flow takes paths from registry/start-menu/.lnk targets. Registry `DisplayIcon` could point to a `.exe` outside Program Files (malware persistence). However this is local trusted state; treat as "discovered apps already present on disk" — out of scope.
- `tauri.conf.json` CSP: `default-src 'self'; script-src 'self'` — strong. No `unsafe-inline` or `unsafe-eval` for scripts. `style-src 'self' 'unsafe-inline'` is the only inline channel (typical React).
- Capability default.json: minimal; no fs/shell scopes granted, only window+opener+autostart+positioner+dialog+updater+deep-link defaults. The `opener:default` permission is the broad surface — frontend can call `plugin:opener|open_path` indirectly through the Tauri runtime, BUT all the IPC commands wrap it in Rust (preview validates path; open_path doesn't validate-but-needs-existence; auth/oauth use open_url with hardcoded URLs).

Good patterns to keep:
- `quicklinks.rs` validates abs-path program + rejects shell metachars + uses `Command::new(program).args(args)` (no shell involved).
- `preview.rs` canonicalizes + sensitive-dir check + sensitive-extension list + size cap + UTF-8 lossy fallback.
- `launch_validation.rs` handles NTFS trailing-space + ADS suffix correctly via split-and-trim normalization.
- `process.rs:launch_url` rejects non-http(s) schemes, uses ShellExecuteW with explicit operation arg (no `cmd /C start`).
- `steam.rs:launch_game` validates app_id is digits-only ≤10 chars before formatting URL.
- `settings.rs:save_settings_to_file` writes to `.tmp` then renames atomically.
- `settings.rs:validate_settings_path` blocks `..` traversal + canonicalizes parent + blocks system dirs (Windows + Unix lists).
- `indexer/scanner.rs` uses `entry.metadata()` (lstat-equivalent) so symlinks aren't followed.
- SQLite queries in `indexer/database.rs` are all parameterized (`params![...]`).
