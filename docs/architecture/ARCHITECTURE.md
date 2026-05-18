# Architecture & Technical Documentation

> **Stack snapshot (v0.2.0)**: Tauri 2 + Rust (edition 2024) backend, React 19 + TypeScript 5.8 + Vite 7 frontend, SQLite (rusqlite, bundled) for indexes, fastembed/ONNX for local embeddings, Tiptap 3 for notes, Tailwind v4, Zustand for state.

---

## 1. Entry Points

| Layer | Entry | Bootstrap |
|---|---|---|
| Frontend | [`src/main.tsx`](../../src/main.tsx) → [`src/app/App.tsx`](../../src/app/App.tsx) | React 19 root, i18n init, Zustand stores hydrated by `useAppLifecycle` |
| Backend | [`src-tauri/src/main.rs`](../../src-tauri/src/main.rs) → `volt_lib::run()` ([`lib.rs`](../../src-tauri/src/lib.rs)) | Tauri builder: single-instance, deep-link, autostart, positioner, opener, shell, fs, dialog, updater, process, global-shortcut |

The main window is created **hidden** in `tauri.conf.json` and revealed once the frontend emits `volt://main-ready` (or `volt://onboarding-complete` on first run), with a 5 s / 30 s Rust-side fallback. This prevents the transparent webview from leaking the desktop during the load gap.

---

## 2. Rust Backend Layout (`src-tauri/src/`)

```
core/        constants.rs · error.rs (VoltError) · traits.rs (Plugin) · types.rs · mod.rs
commands/    30 modules — Tauri command handlers (see §3)
plugins/     Backend plugin system
  api.rs           VoltPluginAPI (path validation, data dir, state)
  registry.rs      Thread-safe PluginRegistry (Arc<RwLock<HashMap>>)
  loader.rs        Dynamic plugin loading
  builtin/         clipboard_manager · game_scanner · system_monitor
indexer/     SQLite-backed file index: database · scanner · watcher · search · windows_search
launcher/    Cross-platform app launching: history · process · types
search/      Top-level search aggregation
embeddings/  fastembed wrapper (multilingual-e5-small, 384-dim, lazy ONNX init)
hotkey/      Global hotkey registration via tauri-plugin-global-shortcut
window/      Window snapping, positioning, multi-monitor
utils/       icon · matching · path · hash · launch_validation · extension_state_sig · shell_apps · game_icon
```

### Setup pipeline in `lib.rs`

1. **Single-instance plugin registered first** so `volt://…` URLs are forwarded to the running process instead of spawning a new one.
2. Tauri plugins initialized: positioner, opener, global-shortcut, shell, fs, dialog, updater, process, deep-link, autostart.
3. `setup()` closure:
   - Initialize `tracing` with stderr + rolling daily file appender (`<app_data_dir>/logs/volt.log`); `LogGuard` held in app state to flush on shutdown.
   - Resolve data directory (`app_data_dir` → `config_dir` → `temp_dir` fallback chain).
   - Register Tauri-managed state: `HotkeyState`, `ShowOnScreenState`, `FileIndexState` (SQLite at `file_index.db`), `WatcherState`, `LaunchHistoryState`, `QueryBindingState`, `FileHistoryState`, `SnippetState`, `ShellHistoryState`, `QuicklinkState`, `NoteState` (SQLite + FTS5), `SyncState`, `EmbeddingState` (`Arc<EmbeddingEngine>`), `PluginState`, `ClipboardManagerState`, `ShellExecutionState`, `SystemMonitorState`, `QuickActionHotkeyState`.
   - Spawn async tasks: load settings → apply hotkey, autostart, window position, AI quick-action hotkeys; CPU prime + 5 s system-monitor ticker (offloaded via `spawn_blocking`).
   - Deep-link listener routes `volt://auth/callback`, `volt://oauth-callback`, `volt://ext-oauth-callback` through their respective handlers (with a 60 s / 5-callback rate limiter, **H9**).
4. `invoke_handler!` registers **~150 commands** (see §3).

---

## 3. Tauri Commands (`commands/`)

| File | Responsibility |
|---|---|
| `apps.rs` | App discovery + search (`scan_applications`, `search_applications`, `search_applications_frecency`, `launch_application`) |
| `launcher.rs` | Launch history & pins, frecency, tags, `open_path` (executable extensions rejected), `open_file_with_dialog` (UNC + `.lnk` blocked), `record_search_selection` |
| `files.rs` | SQLite indexer commands: `start_indexing`, `search_files*`, watcher start/stop, recent files, categories, stats |
| `search.rs` | Batch `search_all` + `search_streaming` |
| `settings.rs` | Load/save settings (8+ categories), per-category updates, theme, app shortcuts, export/import |
| `clipboard.rs` | Clipboard manager (history, search, pin, monitor, paste, sequential paste, retention/exclusions) |
| `extensions.rs` | Extension registry, install/uninstall, toggle, **permission allowlist** (M1), tamper alerts (H4), storage/preferences/secrets/OAuth/AI APIs, ext-OAuth deep-link handler |
| `games.rs` | Multi-platform game scanner (10 platforms, see §6) |
| `steam.rs` | Steam-specific commands (kept separate for backwards compat) |
| `system_monitor.rs` | CPU/RAM/disk + **v2**: per-core, network, temps, processes; `kill_process_by_pid`, `open_task_manager` |
| `snippets.rs` | CRUD + variable expansion; JSON import size-capped |
| `quicklinks.rs` | CRUD with URL/folder/command validation |
| `shell.rs` | Streaming execution with NFKC blocklist + 9+ patterns, extended redactors (GitHub/AWS/Stripe/Slack/JWT/curl basic-auth), UNC `working_dir` rejected |
| `shell_history.rs` | Shell history with frecency (500 entries cap) |
| `notes.rs` | Tiptap-backed notes: CRUD, FTS5 search, trash (soft delete), restore, empty, JSON import/export |
| `ai_profile.rs` | Persistent personalization prefix (role, tone, language) appended to AI prompts |
| `ai_quick_actions.rs` | Per-hotkey one-shot prompts on the clipboard/selection; `apply_all` binds global shortcuts |
| `custom_emojis.rs` | SDXL Emoji via Replicate; list/delete/copy + `ai_pro_features_enabled` gate |
| `embeddings.rs` | `embeddings_prepare`, `embeddings_is_ready`, `embeddings_test` (debug-only) |
| `preview.rs` | `get_file_preview` (text/image/folder/metadata) for the preview panel |
| `auth.rs` | Supabase auth + deep link; **CSRF state nonce** (5 min TTL, C1); JWT claim validation (`exp`/`iss`/`sub`); refresh `user_id` consistency check; HMAC-signed keyring storage |
| `oauth.rs` | OAuth flow (GitHub, Notion) + deep-link callbacks (host check, state log demoted) |
| `credentials.rs` | Encrypted credential storage (OS keyring); `test_credential` (token never crosses IPC); `extension_authenticated_fetch` |
| `keyring_store.rs` | OS keyring abstraction; `store_signed`/`retrieve_signed` (domain-tagged HMAC-SHA256, length-prefixed domain) |
| `sync.rs` | Premium cloud sync (push/pull, status) |
| `plugins.rs` | Plugin registry inspection, external plugin loading |
| `hotkey.rs` | `set_global_hotkey`, `get_current_hotkey` |
| `autostart.rs` | Enable/disable/check autostart (auto-disabled in debug builds) |
| `logging.rs` | `get_log_file_path` |
| `window_management.rs` | `snap_window`, `open_notes_window` |

### Type sync convention

Rust uses `snake_case`, TypeScript uses `camelCase`. **Always** annotate Rust DTOs with `#[serde(rename_all = "camelCase")]` and mirror the type in [`src/shared/types/common.types.ts`](../../src/shared/types/common.types.ts). Backend functions return `VoltResult<T>` (alias for `Result<T, VoltError>`) at the module boundary and `Result<T, String>` at the `#[tauri::command]` boundary via `map_err(|e| e.to_string())`.

---

## 4. Frontend Layout (`src/`)

```
app/                     App.tsx · main.tsx (entry)
  components/            ActionsMenu · ResultContextMenu · ViewRouter
  hooks/                 useAppLifecycle · useSearchPipeline · useGlobalHotkey · useResultActions
features/
  search/                SearchBar (150 ms debounce) + components
  results/               ResultsList · ResultItem (grouped by section)
  applications/          App scanner, launcher, frecency
  files/                 File search UI
  clipboard/             Clipboard history view
  plugins/
    builtin/             16 plugins (see §5)
    core/registry.ts     Plugin registry singleton (500 ms timeout per plugin)
    types/               Plugin · PluginContext · PluginResult interfaces
  extensions/            api · loader (Sucrase + Worker sandbox) · services · components
  settings/              Settings window (8+ panels)
  suggestions/           Empty-query default suggestions
  notes/                 Tiptap notes editor, slash menu, task lists, image embed
  ai-profile/            AI personalization service + UI
  ai-quick-actions/      Hotkey-bound AI prompts, placeholder resolver
  custom-emojis/         SDXL Emoji generator UI + Replicate-token state
  developer/             Developer portal & dev-extensions tooling
  auth/                  Supabase auth UI, session hydration
  changelog/             In-app "What's new" view
  window/                Window state hook
shared/
  types/                 common.types.ts (SearchResult, AppInfo, …)
  constants/             Keyboard keys, config
  hooks/                 Reusable hooks (debounce, clipboard, …)
  components/
    ui/                  HotkeyCapture · ContextMenu · Modal · HelpDialog · PropertiesDialog · PreviewPanel · ToastContainer · AlertDialog
    layout/              Header · Footer
  utils/                 logger · queryParser (power-user operators) · clipboard helpers
stores/                  Zustand: appStore · searchStore · uiStore
pages/                   Multi-page entry points (settings, system-monitor, onboarding, notes)
i18n/                    i18next setup (English + French)
styles/                  Global styles, Tailwind v4, theme.css
test/                    Vitest setup + jsdom
```

### Plugin registration order (`useAppLifecycle.ts`)

`ClipboardPlugin → AiChatPlugin → CalculatorPlugin → DeveloperCommandsPlugin → EmojiPickerPlugin → WebSearchPlugin → SystemCommandsPlugin → TimerPlugin → SystemMonitorPlugin → GamesPlugin → SnippetsPlugin → QuicklinksPlugin → NotesPlugin → WindowManagementPlugin → ShellCommandPlugin`

---

## 5. Built-in Plugins (frontend, `src/features/plugins/builtin/`)

| Plugin | Trigger | Backend? |
|---|---|---|
| `ai-chat` | `ai ` prefix / Quick AI hotkey | `ai_ask_builtin_stream`, `ai_set_global_key` |
| `calculator` | `=`, numeric input, `calc` | none |
| `clipboard` (in `features/clipboard`) | `clipboard` / paste hotkey | `commands/clipboard.rs` |
| `developer` | `dev:` commands | dev-extensions commands |
| `emoji-picker` | `:` | `custom_emojis_*` (Pro) |
| `games` | game name / `games` | `commands/games.rs` |
| `notes` | `n:` / suggestion | `commands/notes.rs` |
| `quicklinks` | `ql:` | `commands/quicklinks.rs` |
| `shell` | `>` | `execute_shell_command_streaming`, `cancel_shell_command` |
| `snippets` | `;` | `commands/snippets.rs` |
| `steam` (legacy, fused into `games`) | — | `commands/steam.rs` |
| `systemcommands` | `settings`, `reload`, `quit`, … | none |
| `systemmonitor` | `system`, `cpu`, `ram`, `disk` | `commands/system_monitor.rs` |
| `timer` | `timer 5m` | none (in-memory `timerStore`) |
| `websearch` | `?`, `?g`, `?ddg`, `?b` | none |
| `window-management` | snap commands | `snap_window` |

Backend plugins (Rust, `plugins/builtin/`): `system_monitor`, `game_scanner`, `clipboard_manager` (clipboard initialized separately to avoid double init).

---

## 6. Search & Indexing

### Search pipeline

1. **Frontend** — `useSearchPipeline` debounces input 150 ms, tags each call with `latestSearchId` for stale-response protection, then fans out to:
   - `pluginRegistry.query()` (500 ms timeout per plugin)
   - Backend `search_all` / `search_streaming` (apps + files + commands)
2. **Backend scoring** (`apps.rs`): exact=100, startsWith=90, contains=80-position, fuzzy=50. Filtered out if no match.
3. **Frecency** (`launcher::history`): `launch_count × exp(-age_hours / 168)` (1-week half-life), 30 % penalty for never-used apps when history exists. On empty query, results are ordered by frecency alone.
4. **Power-user operators** parsed by `queryParser.ts`: `ext:pdf`, `in:~/Documents`, `size:>10mb`, `modified:<7d`, `modified:>30d` → filter params forwarded to `search_files_advanced`.
5. **Results grouping**: Raycast-style section headers (Applications, Commands, Games, Files); shown only when results span multiple sections.

### File indexer

- **SQLite-backed** (`indexer/database.rs`, file at `<app_data_dir>/file_index.db`).
- `start_indexing()` walks configured folders with `max_depth=10`, `max_file_size=100 MB`. RAII `IndexingGuard` prevents `is_indexing` from sticking on abort.
- `notify` v6 watcher (`indexer/watcher.rs`) keeps the index live.
- On Windows, `windows_search.rs` queries the Windows Search index as a supplementary source (query length-capped).
- Same scoring algorithm as apps, plus highlighting via `search_files_with_highlighting`.

### Local embeddings (semantic search)

- `fastembed` v5 wrapping `multilingual-e5-small` (384-dim, FR + EN).
- Model **not bundled**: downloaded on first use to `<app_data_dir>/embeddings/` (~120 MB). `EmbeddingEngine::new` is cheap; the ONNX session is initialized inside the `Mutex<Option<TextEmbedding>>` on first `embed` call.
- Inference is `&mut self` in fastembed v5 → single mutex guards all calls; CPU work offloaded to `spawn_blocking`. `tokio::sync::Mutex` held across await.
- E5 prefix convention is the **caller's responsibility**: `passage: <text>` at indexing time, `query: <text>` at query time. Mixing prefixes silently degrades recall.

---

## 7. Extensions vs Plugins

**Plugins** ship in-repo (`src/features/plugins/builtin/`). Registered in `useAppLifecycle`. Use `volt:*` DOM events for plugin↔UI communication (e.g. `volt:open-ai-chat`, `volt:toast`, `volt:update-metadata`).

**Extensions** are third-party, loaded dynamically:

- **Dual-source registry**:
  - **GitHub legacy** — [`VoltLaunchr/volt-extensions/registry.json`](https://github.com/VoltLaunchr/volt-extensions). Historical (github, notion, password-generator).
  - **Supabase** — `developer_extensions` table with `status = 'approved'`. New submissions go through the developer portal on `voltlaunchr.com` (draft → pending → approved/rejected).
  - Merged by `/api/extensions` on the website with dedup by slug. Built-ins always win.
- **Manifest** with `id`, `name`, `version`, `permissions`, optional `keywords`/`prefix`.
- **Loader** ([`src/features/extensions/loader/index.ts`](../../src/features/extensions/loader/index.ts)): Sucrase transpilation → dedicated Web Worker if manifest has `keywords`/`prefix`, else main-thread.
- **Worker sandbox**: `eval`, `Function`, `WebSocket`, `XMLHttpRequest`, `importScripts` all disabled; prototype frozen; getter-only Worker global; pending-request map cleared on timeout (8 s for `match()`, 500 ms general).
- **Permission enforcement**: consent dialog on first load; granted permissions persisted in `installed.json` (HMAC-SHA256 signed).
- **Network proxy**: Worker `fetch` is relayed via `postMessage` to the main thread, then to Rust; SSRF prevention (private IP block, numeric IPv4/IPv6-mapped hosts rejected, redirect SSRF blocked, credentials omitted, Cookie/Auth headers stripped, 10 MB body cap).
- **OAuth isolation (H2)**: extension OAuth tokens are stored and replayed entirely from Rust (`extension_authenticated_fetch`); the renderer only ever sees an opaque handle.
- **Tamper detection**: `installed.json.sig` + `dev-extensions.json.sig` HMAC; signature mismatch → fail-closed (granted_permissions reset to empty per extension, H4) + UI alert via `get_extension_tamper_alert`.
- **Server-side permission allowlist** (M1): `update_extension_permissions` validates every entry against `ALLOWED_PERMISSIONS`; entire batch rejected on a single unknown entry.
- **Launch validation** (`utils/launch_validation.rs`): LOLBIN denylist, NTFS path normalization, executable-extension check applied to every launch path.

---

## 8. Auth & Credential Security

| Concern | Defense |
|---|---|
| Drive-by deep-link session injection | `auth_start_login` generates a UUID state nonce (5 min TTL); `handle_auth_deep_link` verifies + consumes it (C1) |
| Forged JWT | `exp`, `iss`, `sub` claims verified against `SUPABASE_URL`; `user_id` and `expires_at` from verified claims, never URL params |
| Refresh-token swap | Refresh response `user_id` mismatch rejected; `expires_in` capped at 24 h |
| Tampered keyring entry | `store_signed`/`retrieve_signed` attach a domain-tagged HMAC-SHA256 (length-prefixed domain prevents cross-domain replay) — tamper → silent logout (M10) |
| Deep-link spam / probe | Sliding 60 s / 5-callback rate limiter in `lib.rs::deeplink_rate_limited`; single warn on transition, forensic log per forwarded URL (H9) |

---

## 9. Window & Hotkey

- **Main window** (`tauri.conf.json`): 800 × 550, transparent, always-on-top, no decorations, skips taskbar, auto-focused. Resizes to 1100 × 550 when the preview panel opens (`Ctrl+P`).
- **Additional windows**: `settings`, `onboarding`, `system-monitor`, `notes` (multi-page Vite build).
- **Global hotkey**: default `Ctrl+Space`, user-configurable via Settings. No fallback hotkey — clear error message + Settings link on conflict. Best-effort registration: app still launches if registration fails. Implementation: `tauri-plugin-global-shortcut` in `hotkey/mod.rs`.
- **AI Quick Actions**: separate hotkey bindings via `QuickActionHotkeyState`, applied at startup by `ai_quick_actions_apply_all`.

---

## 10. Build & Tooling

| Concern | Tool |
|---|---|
| Frontend bundler | Vite 7 (multi-page) |
| TS strictness | TypeScript 5.8 strict mode |
| Lint | ESLint 9 flat config — `react-hooks/purity`, `react-hooks/refs`, `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-require-imports` all `error`; no `eslint-disable` / `@ts-ignore` allowed (see [`CLAUDE.md`](../../CLAUDE.md)) |
| Format | Prettier (single quotes, 100 cols, 2-space) |
| Test | Vitest 4 (jsdom) + Playwright (e2e) |
| Rust lint | rustfmt + clippy (`-D warnings` on Rust 1.95) |
| CI | GitHub Actions — `check.yml`, `release.yml`, `auto-tag.yml`, `changelog.yml`, `e2e.yml`, `pr-title.yml`, `version-bump.yml` |

### Release flow

`release/vX.Y.Z` branch → `bump-version.mjs` syncs `package.json` + `Cargo.toml` + `tauri.conf.json` → manual `public/changelog.json` entry → lint/build/clippy/test/cycle-scan all green → merge → `auto-tag.yml` creates the tag → `release.yml` publishes signed artifacts (`.msi`, `.exe`, `.dmg`, `.deb`, `.rpm`, `.AppImage` + `.sig`). See [`build-release/`](../build-release/) and the **Release Process** section of [`CLAUDE.md`](../../CLAUDE.md) for the full checklist.

---

## 11. Where to look next

- Backend module docs: [`src-tauri/README.md`](../../src-tauri/README.md), [`src-tauri/ARCHITECTURE.md`](../../src-tauri/ARCHITECTURE.md), [`src-tauri/MODULES.md`](../../src-tauri/MODULES.md)
- Plugin development: [`src-tauri/src/plugins/README.md`](../../src-tauri/src/plugins/README.md), [`docs/plugins/DEVELOPMENT.md`](../plugins/DEVELOPMENT.md)
- Features (user-facing): [`docs/architecture/FEATURES.md`](./FEATURES.md)
- Security: [`docs/security/`](../security/) (`ACCEPTED_RISKS.md`, `RUST_CODE_REVIEW_2025.md`, `updater-key-custody.md`)
- OAuth integration: [`docs/architecture/OAUTH_IMPLEMENTATION.md`](./OAUTH_IMPLEMENTATION.md)
- Roadmap: [`docs/roadmap/PRODUCT_ROADMAP.md`](../roadmap/PRODUCT_ROADMAP.md), [`COMPETITIVE_ANALYSIS.md`](../roadmap/COMPETITIVE_ANALYSIS.md), [`EXTENSION_ECOSYSTEM_PLAN.md`](../roadmap/EXTENSION_ECOSYSTEM_PLAN.md)
