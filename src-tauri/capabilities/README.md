# Capabilities & Permission Scope

This document explains why each permission in `default.json` is required and the threat model for Volt's Tauri v2 capability configuration.

## Default Capability (`default.json`)

Applied to both `main` and `settings` windows.

| Permission | Rationale | Risk if compromised |
|---|---|---|
| `core:default` | Base Tauri IPC (invoke, events) | Attacker can call any registered command |
| `core:window:*` (show/hide/close/minimize/focus/dragging/create) | Window management for launcher UX + settings window | Window manipulation only — no data access |
| `core:webview:allow-create-webview-window` | Opening settings window from main | Could open arbitrary webview windows |
| `opener:default` | Launch apps and open URLs/folders via OS default handler | Could open arbitrary URLs/programs |
| `autostart:default` | User opt-in launch-at-login | Could enable/disable autostart |
| `positioner:default` | Multi-monitor window positioning | Window position manipulation only |
| `dialog:default` | Native file/folder picker for settings (indexing paths) | Could show dialogs — no direct file access |
| `updater:default` | Auto-update check + signed install | Update endpoint is pinned; signatures verified via minisign |
| `deep-link:default` | `volt://` protocol for OAuth callbacks (auth, extensions) | Could intercept OAuth redirects if scheme is hijacked |

## Permissions NOT granted

| Permission | Why excluded |
|---|---|
| `fs:*` (broad) | Not needed — file access is done via Rust commands with validated paths |
| `shell:execute` | Not granted to webview — shell execution goes through specific Tauri commands with validation |
| `process:*` (broad) | Only process plugin default (exit/restart for updater) |
| `http:*` | Network requests go through Rust backend (reqwest), not webview fetch |

## Threat model

**Trust boundary**: The webview is semi-trusted. Extensions run in Web Worker sandboxes with explicit permission grants. The Rust backend validates all inputs.

**Extension isolation**: Extensions with network permission have fetch requests proxied via `postMessage`. Extensions cannot access Tauri IPC directly — they communicate through the extension loader bridge.

**CSP hardening**: `connect-src` is pinned to the specific Supabase project subdomain. `worker-src` is restricted to `'self' blob:`. `script-src` does not allow `unsafe-eval` or `unsafe-inline`.

## Future considerations

- Split capabilities by window scope (main vs settings) for tighter least-privilege
- Remove `style-src 'unsafe-inline'` when React/Vite CSP nonce support matures
