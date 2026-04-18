---
name: Extension System Security Audit Findings
description: Key security patterns and vulnerabilities found in Volt's extension/Worker sandbox system (2026-04-17 audit)
type: project
---

Extension system audit completed 2026-04-17. Key findings:

**Good patterns already in place:**
- Worker sandbox isolates extension code; `importScripts` blocked; `self.fetch` overridden
- Permission enforcement on main thread for clipboard, openUrl, network, notifications
- `ensure_contained()` for path traversal, `validate_extension_id()`, `validate_download_url()`
- CSP blocks `eval`, remote scripts; `frame-src: none`; `object-src: none`
- Symlinks rejected in ZIP extraction; forbidden dirs for dev extensions

**Key vulnerabilities identified:**
- Network proxy (fetch) has no URL validation -- SSRF via extensions to localhost/internal
- `filesystem` and `shell` permissions declared in types but never enforced (no backend action)
- `openUrl` action has no URL scheme validation -- could open `file:///`, `javascript:`, etc.
- `update_extension_permissions` does not validate permission strings server-side
- `read_source_files_recursive` follows symlinks without checking containment
- VoltAPI.events.emit on window.VoltAPI allows main-thread extensions (if any exist) to spoof volt:* events
- Permission dialog is all-or-nothing (grant all or deny all)

**How to apply:** Reference these findings when reviewing extension PRs or security hardening work.
