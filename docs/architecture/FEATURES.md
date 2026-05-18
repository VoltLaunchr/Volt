# Volt Features

Complete reference of features available in **Volt v0.2.0**.

> See [`SHORTCUTS.md`](../user-guide/SHORTCUTS.md) for the full keyboard reference and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the technical view.

---

## 🔍 Search & Launch

### Smart search
- Parallel search across **apps · files · plugins · games · commands** with 150 ms debounce + stale-response protection (`latestSearchId`).
- Backend scoring: exact 100 · startsWith 90 · contains 80−position · fuzzy 50.
- **Frecency** ranking: `match_score + launch_count × exp(−age_hours / 168)`; 30 % penalty for never-used apps when history exists.
- **Predictive suggestions** on empty query (frecency-only) — top apps + contextual shortcuts (clipboard, calculator, settings, …).
- **Section grouping** (Raycast-style): Applications, Commands, Games, Files; only shown when results span multiple sections.

### Power-user operators
Parsed by `queryParser.ts`, forwarded to `search_files_advanced`:

| Operator | Example | Effect |
|---|---|---|
| `ext:` | `ext:pdf` | Filter by extension |
| `in:` | `in:~/Documents` | Restrict directory |
| `size:>` / `size:<` | `size:>10mb` | Min/max file size |
| `modified:<` / `modified:>` | `modified:<7d` | Modified within / outside N days |

### Cross-platform app discovery
- **Windows**: Program Files + AppData + Start Menu, Registry `Uninstall` scan for clean display names, Shell `AppsFolder` for Store/UWP/MSIX, junk-app filter, Windows Search Index as supplementary file source.
- **macOS**: Applications folders, `.app` bundles, native icon extraction via `icns`.
- **Linux**: `.desktop` files across XDG dirs, icon-theme support.
- **Frecency-aware launching** with `launch_app` (LOLBIN denylist, NTFS normalization, executable-extension validation).

### Result actions
- Right-click or `Ctrl+K` → context menu (Launch · Open File Location · Copy Path · Properties · Add to Favorites · Remove from History).
- `Ctrl+I` → Properties dialog (full path, size, modified date, type, icon).
- `Alt+1..9` → Quick-launch the Nth result.
- `Shift+Enter` → Admin/elevated launch (Windows).

---

## 🎨 UI

- **Glass-morphism** translucent surface, Tailwind v4 theming, three themes (Dark · Light · Auto).
- **Window positioning**: Top, Center, Custom (x/y), per-monitor (`show_on_screen`: `cursor` · `primary` · `active`).
- **Preview panel** (`Ctrl+P`) — 350 px side panel; window grows from 800 → 1100 px. Supports text (first 2 KB monospace), images (Tauri asset protocol), folder listings, app/file metadata. 200 ms debounce on selection change.
- **Snowfall effect** (toggled by `showSnowEffect` in `searchStore`).
- **Multi-window**: settings · onboarding · system-monitor · notes.
- **Onboarding wizard** on first run — hotkey, theme, integrations. Restartable via Settings → General → Restart Onboarding.

---

## 🔥 Hotkeys

- Global toggle: `Ctrl+Space` (configurable). Clear error message + Settings deep-link on conflict.
- App-specific shortcuts: assign keys to launch specific apps directly.
- **AI Quick Action hotkeys**: per-action global shortcuts that read the clipboard, apply a prompt, and open the AI Chat view.

---

## 🧩 Built-in Plugins (16)

### 🤖 AI Chat
**Trigger**: `ai <prompt>` or a Quick AI hotkey
- In-launcher streaming conversation with **OpenAI · Anthropic · Groq**.
- API keys stored in the OS keyring (`ai_set_global_key`); never enter the renderer in plain text.
- Provider status surfaced by `ai_get_providers_status`; key validation via `ai_verify_key`.
- Dedicated `AiChatView` with conversation history and a lighter `QuickAiView` for one-shot prompts.

### 👤 AI Profile
- Persistent personalization (role, tone, language) prepended to every AI prompt.
- Managed via `ai_profile_get` / `ai_profile_set`.

### ⚡ AI Quick Actions
- Assign any global hotkey to a one-shot prompt that operates on the clipboard or selection.
- Placeholder resolver: `{clipboard}`, `{lang}`, `{now}`, etc.
- Hotkeys re-bound at startup by `ai_quick_actions_apply_all`.

### 📝 Notes (Tiptap)
**Trigger**: `n:` or the Notes suggestion / dedicated window
- Rich-text editor (Tiptap 3) — markdown shortcuts, slash commands, task lists, code blocks (lowlight), image embed, character count, typography.
- SQLite + **FTS5** full-text search; `search_notes` returns ranked excerpts.
- Soft-delete trash → restore or empty.
- JSON import / export.

### 🎨 Custom Emojis (Pro)
- Generate sticker-style emojis from a prompt via Replicate's SDXL Emoji model.
- Stored locally, copyable as images (`custom_emojis_copy_image`).
- Pro gating via `ai_pro_features_enabled`.

### 🧮 Calculator
**Trigger**: `=`, `calc`, or a numeric query
- Arithmetic, scientific functions (`sqrt`, `sin`, …), constants (`pi`, `e`), unit conversions, date math, timezone conversions.
- Dedicated `CalculatorView` with history.

### 📋 Clipboard Manager
**Trigger**: `clipboard` / paste hotkey
- Auto-tracked history (configurable retention), pin, search, restore, delete.
- App-level exclusion list (`set_clipboard_disabled_apps`).
- Sequential paste (`paste_sequentially`) for chained insertions.

### ✂️ Snippets
**Trigger**: `;`
- Triggered text expansion with variables: `{date}` · `{time}` · `{datetime}` · `{clipboard}` · `{random}`.
- Categories, import/export (JSON, size-capped).
- Implemented via the `snippets` builtin plugin + `commands/snippets.rs`.

### 🔗 Quicklinks
**Trigger**: `ql:`
- URL / folder / shell-command shortcuts with parameter placeholders.
- Validated server-side (URL parsing, folder existence, command allowlist).

### 🖥️ Shell
**Trigger**: `>`
- Streaming shell execution with live output, cancellable.
- **Blocklist** (NFKC-normalized, lowercase, quotes stripped): `Stop-Computer`, `Restart-Computer`, `Format-Volume`, `Clear-Disk`, `diskpart`, `Remove-Item -Recurse -Force <drive>:\`, `init 0/6`, `telinit 0/6`, `logoff`, PowerShell `-EncodedCommand`, `reg.exe delete`, `find -delete`, …
- **Redactors** on history + logs: GitHub (`ghp_`, `gho_`, …), AWS `AKIA`, Stripe `sk_live_` / `sk_test_`, Slack `xox*`, JWTs, `curl -u user:pass`.
- UNC `working_dir` rejected.
- Frecency-scored history (500 entries cap), pinnable.

### 😀 Emoji Picker
**Trigger**: `:`
- Search by name, category browsing (Smileys, Animals, Food, …).
- Copy to clipboard, recent-emoji tracking via `emojibase` 17.

### 🌐 Web Search
**Trigger**: `?<query>`
- Default engine configurable; explicit aliases: `?g` (Google), `?ddg` (DuckDuckGo), `?b` (Bing).
- Direct URL handling.

### ⏱️ Timer
**Trigger**: `timer <duration>`
- Formats: `5m`, `25 minutes`, `1h30m`, `90s`, `timer 25m pomodoro`.
- In-memory `timerStore` + `tasksStore`; visual countdown via `TimerDisplay` overlay.
- Desktop notifications on completion. Pause / resume / cancel.

### 📊 System Monitor
**Trigger**: `system`, `cpu`, `ram`, `disk`
- Real-time CPU (incl. **per-core v2**), memory, disk, **network**, **temperatures**.
- Process list with kill (`kill_process_by_pid`) and Open Task Manager.
- Background ticker (5 s cache refresh on a `spawn_blocking` thread) — frontend queries served from cache.
- Dedicated system-monitor window with visx line charts.

### 🎮 Games
**Trigger**: game name or `games`
- **10 platforms**: Steam, Epic Games, GOG Galaxy, Xbox, EA App (Origin), Ubisoft Connect, Riot, Amazon Games, Battle.net, Rockstar.
- Platform metadata + icons, deduplication, cache for fast launch.
- `launch_steam_game`, `rescan_all_games`, dedicated `GameView`.

### 🪟 Window Management
- Snap commands (`snap_window`) for left/right/top/bottom/maximize on Windows.

### 🔧 System Commands
- `settings` · `preferences` · `reload` · `refresh` · `quit` · `exit` · `about` · `info` · `account`.

### 🛠️ Developer Commands
**Trigger**: `dev:`
- Scaffold a new extension, link/unlink/refresh dev extensions, jump to the developer portal.
- Backed by `commands/extensions.rs` dev-extension subcommands and `voltlaunchr.com/developer`.

---

## 📦 Extension Ecosystem

### Dual-source registry
- **GitHub legacy** — [`VoltLaunchr/volt-extensions`](https://github.com/VoltLaunchr/volt-extensions) (`github`, `notion`, `password-generator`).
- **Supabase** — `developer_extensions` table, `status = 'approved'`. Submitted via the developer portal on **voltlaunchr.com/developer**.
- Merged by `/api/extensions` with dedup by slug; built-ins always win.

### Extension store (Settings → Extensions)
- Browse · install · uninstall · enable / disable · update check · auto-update.
- Permission consent dialog on first load; per-extension grants persisted.
- Tamper alert in the UI if `installed.json` or `dev-extensions.json` HMAC fails.

### Developer mode
- Link local extension folders, hot-reload on file change, source-code viewer, error capture surfaced via `volt:extension-error`.
- `scaffold_extension` command bootstraps a new manifest + skeleton.
- API keys (`sk_live_*`) for future CLI automation — SHA-256 hashed in DB, never stored in clear.

### Sandbox & security
- Web Worker for any extension with `keywords` / `prefix` (declarative `canHandle` stays on the main thread, < 0.1 ms).
- `eval`, `Function`, `WebSocket`, `XMLHttpRequest`, `importScripts` all disabled; prototype frozen; getter-only Worker global.
- 500 ms timeout (8 s for `match()`), pending-request map cleared on timeout.
- **Network**: Worker `fetch` proxied via `postMessage` → Rust; SSRF prevention (private IPs, numeric IPv4/IPv6-mapped hosts, redirect SSRF), credentials omitted, Cookie/Auth stripped, 10 MB body cap.
- **OAuth**: tokens stored and replayed entirely in Rust (`extension_authenticated_fetch`); the renderer only sees an opaque handle (H2).
- **HMAC state signatures** on `installed.json` / `dev-extensions.json`; mismatch → fail-closed, all `granted_permissions` reset (H4).
- **Server-side permission allowlist** (M1) — batch rejected on any unknown permission.
- **Launch validation** — LOLBIN denylist, NTFS normalization, executable-extension check.

---

## 🔐 Auth & Credentials

- **Supabase** auth via `volt://auth/callback` deep link; **CSRF nonce** (5 min TTL) bound to each login attempt (C1).
- JWT `exp` / `iss` / `sub` verified against the configured Supabase URL; `user_id` and `expires_at` taken from claims, never URL params.
- Refresh response `user_id` mismatch rejected; `expires_in` capped at 24 h.
- **OS keyring storage** with domain-tagged HMAC-SHA256 (length-prefixed); tamper → silent logout (M10).
- Deep-link rate-limit (5 callbacks / 60 s sliding window, H9) with forensic logs.
- `test_credential` lets the UI verify a stored token without exposing it to the renderer.
- Premium **Cloud Sync** (push/pull snippets + quicklinks) gated behind the Account panel.

---

## ⚙️ Settings

| Panel | Highlights |
|---|---|
| **General** | Max results · Close on launch · Start with Windows · Language (English / French) · Restart Onboarding · Show-on-screen (cursor / primary / active monitor) |
| **Appearance** | Theme (Dark · Light · Auto) · Window position (Top · Center · Custom x/y) |
| **Hotkeys** | Toggle window · Open settings · Custom app shortcuts |
| **Indexing** | Folders · Exclusions · Extension filter · Index on startup · Manual rescan |
| **Plugins** | Enable / disable individual plugins |
| **Shell** | Default shell · Working directory · Timeout · History size · Clear history |
| **Shortcuts** | Per-app shortcuts |
| **Extensions** | Browse store · manage installed · dev mode |
| **Account** | Login · Premium / Sync status |
| **AI** | Per-provider API keys · AI Profile · Quick Actions |
| **Notes** | Editor preferences |

Export / import via `export_settings` / `import_settings`.

---

## 🚀 Performance

- Cold start < 1 s (window created hidden, revealed on `volt://main-ready` with 5 s fallback).
- Search debounce 150 ms · plugin timeout 500 ms · preview debounce 200 ms.
- Background SQLite indexer with `notify` watcher — no blocking UI scan.
- System Monitor cache refreshed by a 5 s ticker on `spawn_blocking` so queries are instant.
- Local embeddings loaded **lazily** on first use; model file kept out of the binary.
- Typical memory footprint ~50–100 MB.
- Bundle protected by a chunk-cycle scan in the release checklist (prevents the v0.1.8 "splash infini" class of bugs).

---

## ♿ Accessibility

- Full keyboard navigation (no mouse required); skip-link to the search input on every view.
- Visible focus outlines, ARIA roles on overlays (HUD, toasts, dialogs).
- Configurable font size (planned), high-contrast theme support.
- i18n: English + French via `i18next`.

---

## 🔄 Auto-Updates

- Silent update check on startup via `tauri-plugin-updater`.
- **Deferred install on close**: the app intercepts close requests; if an update is pending, it installs before exit (see `installPendingUpdate` / `hasPendingUpdate` in `features/settings/services/updateService`).
- Signed artifacts (`latest.json` + `.sig` per platform) published by `release.yml`.

---

## 🧠 Local Embeddings (foundation)

- `fastembed` v5 + `multilingual-e5-small` (384-dim, FR + EN, ~120 MB).
- Lazy ONNX session, single mutex (inference is `&mut self`), `spawn_blocking` offload.
- E5 prefix convention enforced at the call site (`passage:` for indexing, `query:` for retrieval).
- Backing surface for "Ask my notes" RAG (Notes integration shipping incrementally).

---

For bug reports and feature requests: [GitHub Issues](https://github.com/VoltLaunchr/Volt/issues).

_Last updated: 2026-05-18 (v0.2.0)_
