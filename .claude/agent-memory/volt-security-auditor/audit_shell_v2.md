---
name: Shell v2 Hardening Audit (2026-05-03)
description: Re-audit of shell.rs/shell_history.rs after blocklist + redaction + token + 50KB cap landed
type: project
---

2026-05-03 re-audit of `src-tauri/src/commands/shell.rs`, `shell_history.rs`, `src/features/plugins/builtin/shell/{index.ts,ansiParser.tsx}`. Most prior critical issues are closed; new findings center on blocklist completeness and the streaming-path 50KB cap gap.

**Why:** the 2026-04-18 audit (`audit_shell_execution.md`) flagged the unprotected shell IPC path. Backend now has server-side gating, blocklist, redaction, token-issued history recording, working-dir/shell allowlist, kill+timeout escalation. This audit focuses on whether the new defenses hold.

**Closed since last audit:**
- Server-side `is_command_blocked` + `validate_shell_access` runs on every IPC call.
- `record_shell_command` only takes `execution_id`, validated against backend completion-token FIFO.
- `redact_command` runs before logging AND before history persistence.
- Default-shell setting matched against an allowlist (powershell/pwsh/bash/zsh/sh/cmd) — typos fall back to platform default.
- AnsiText renders text as React children + style objects only — no raw HTML injection. Safe from output-injection XSS.
- Streaming path now spawns child outside the driving task and registers abort handle before await; outer timeout = inner + 2s slack.

**Open issues (severity-ranked):**
- HIGH: streaming path has no per-stream byte cap. `MAX_OUTPUT_BYTES` (50KB) is only applied in `execute_shell_command` (non-streaming). Streaming writes every line into a frontend string -> UI memory DoS / freeze on commands like `yes`.
- HIGH: blocklist is regex-on-substring, no Unicode normalization, no shell-tokenization. Confirmed bypasses: `Remove-Item -Recurse -Force C:\`, `Stop-Computer`, `Restart-Computer`, `logoff`, `init 6`, `telinit 0`, `Format-Volume`, `Clear-Disk`, `diskpart`, `dd ... of=\\.\PhysicalDrive0`, `powershell -EncodedCommand <b64>`, base64-decode pipelines, string-concat (`'shut'+'down'`), chr-encoded payloads, quoted variants (`"rm" -rf /`), and renamed fork bombs.
- MEDIUM: `working_dir` passed to `process.current_dir(dir)` without canonicalization or existence check.
- MEDIUM: redactor regexes don't cover JWT-shaped tokens, AWS access-key-id format (`AKIA...`), GitHub PATs (`ghp_...`), or stripe (`sk_live_...`). Coverage by header/flag is decent; coverage by raw token in arg list is weak.
- LOW: `tokio::io::Lines.next_line().await` line-buffers — commands that emit only `\r` (progress bars) look hung from the UI side.
- LOW: outputCache LRU eviction iterates Map keys in insertion order, but the cache key is `executionId` (unique per run) — concurrent runs of the same command no longer clobber each other (good), but the eviction is still essentially "drop oldest run" not "drop largest run".

**How to apply:** when reviewing future shell-related PRs, focus on (a) any new blocklist additions — push for an allowlist-style token parser instead, (b) any change to the streaming path — require a server-side per-stream cap, (c) any addition to `working_dir` handling — require canonicalization. The bypass class for PowerShell wipe commands (`Remove-Item -Recurse -Force C:\`) is the single most concerning gap because it's both trivial to type and irreversible.
