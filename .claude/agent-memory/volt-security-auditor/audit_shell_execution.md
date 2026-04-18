---
name: Shell Execution & dev-branch Audit Findings
description: 2026-04-18 audit of shell.rs, shell_history, extension_state_sig, launch_validation, preview.rs updates
type: project
---

2026-04-18 audit of dev branch (shell feature + extension hardening).

**Critical issue (must-fix):**
- `execute_shell_command` / `execute_shell_command_streaming` in `src-tauri/src/commands/shell.rs` expose raw `sh -c` / `cmd /C` to the webview. They (a) ignore the `ShellSettings.enabled` toggle, (b) have no server-side block-pattern check (only a client-side BLOCKED_PATTERNS list in `src/features/plugins/builtin/shell/index.ts`), and (c) are callable from ALL windows including `settings`. An XSS or extension sandbox escape = full RCE. Capability is in `default.json` applied to both `main` and `settings` windows.

**Other open items:**
- `get_file_preview` returns the user's raw `path` string (not canonical), so downstream consumers bypass sensitive-dir checks. Also missing filename denylist for `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.pgpass`.
- `record_shell_command` has no execution proof — webview can synthesize history entries to trick users (trojan suggestion). Shell history written plaintext + logged via `info!` — secrets in args leak.
- `link_dev_extension` accepts paths under `~/Downloads` / `~/Desktop` (common drop locations).
- HMAC key rotation in `extension_state_sig.rs` happens silently on malformed keyring entry — log-only warning, should be user-visible.
- `execute_shell_command_streaming` spawns child before registering abort handle (race: caller drops future → orphan process). No outer timeout wrapping task.await.
- Frontend hardcodes `timeoutMs: 10000`, ignores user-configured `settings.shell.timeoutMs`.

**Good patterns confirmed in this audit:**
- `extension_state_sig` HMAC design: sig-first atomic write, constant-time compare, no-brick policy, single-warn on keyring-unavailable.
- `launch_validation` LOLBIN block is in place (cmd, powershell, mshta, regsvr32, rundll32, etc.).
- `ansiParser.tsx` uses allowlist-only SGR → no XSS via style injection.
- `worker-sandbox.ts` SSRF guard (`isUrlSafe`) and 10MB fetch body cap now in place; `openUrl` has protocol allowlist (http/https/mailto) via `plugins/utils/helpers.ts` — prior audit findings addressed.
- ZIP/tar extraction uses `enclosed_name()`, rejects symlinks, and has `ensure_contained` defense-in-depth.

**How to apply:** On next review of shell feature PRs, confirm C1 is fixed (server-side gating). When reviewing preview/extension PRs, check the path-canonicalisation + filename-denylist items (H2, H3).
