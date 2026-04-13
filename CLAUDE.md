# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Volt is a keyboard-driven application launcher (Tauri v2 + React + TypeScript). Fast, minimal interface similar to Spotlight/Alfred, toggled with `Ctrl+Space`.

## Key Commands

**Frontend**: `bun run dev` | **Full stack**: `bun tauri dev` | **Build**: `bun tauri build`
**Format**: `bun prettier --write .` | **Lint**: `bun run lint` | **Test**: `bun run test`
**Rust check**: `cd src-tauri && cargo check` | **Rust lint**: `cd src-tauri && cargo clippy`

## Architecture Quick Reference

### Entry Points
- **Frontend**: `src/main.tsx` → `src/app/App.tsx`
- **Backend**: `src-tauri/src/main.rs` → `volt_lib::run()` in `src-tauri/src/lib.rs`

### Backend Modules (`src-tauri/src/`)
```
core/          # Foundation (types, traits, constants, errors)
plugins/       # Plugin system with builtin plugins
  builtin/     # clipboard_manager, game_scanner, system_monitor
  api.rs       # VoltPluginAPI (path validation, state)
  registry.rs  # Thread-safe PluginRegistry (Arc<RwLock<HashMap>>)
utils/         # Reusable (icon extraction, fuzzy matching, path utils)
search/        # Search algorithms with scoring
window/        # Window management commands
commands/      # Tauri command handlers
  apps.rs      # App scanning (Windows/macOS/Linux)
  settings.rs  # Settings management
  files.rs     # File indexing
  launcher.rs  # Launch history & pins
  clipboard.rs # Clipboard history
  extensions.rs# Extension management
  games.rs     # Game scanning
  steam.rs     # Steam integration
  system_monitor.rs # CPU/RAM/disk metrics
  plugins.rs   # Plugin commands
  hotkey.rs    # Hotkey commands
  autostart.rs # Autostart management
  logging.rs   # Log management
hotkey/        # Global hotkey management
indexer/       # File indexing system (scanner, watcher, search_engine, SQLite)
launcher/      # Cross-platform app launching (history, process)
```

### Frontend Structure
```
src/
  app/                           # Main app component
    hooks/                       # useAppLifecycle, useGlobalHotkey, useSearchPipeline, useResultActions
    components/                  # ResultContextMenu, ViewRouter
  features/
    search/components/           # SearchBar with 150ms debounce
    results/components/          # ResultsList, ResultItem
    applications/                # App scanning + launching (hooks, services, utils, types)
    clipboard/                   # Clipboard history plugin
    extensions/                  # Extension store (api, loader, services, types)
    files/                       # File search components
    plugins/                     # Plugin system
      builtin/                   # calculator, emoji-picker, timer, websearch, steam, systemcommands, systemmonitor
      core/registry.ts           # Plugin registry singleton (500ms timeout)
      types/                     # Plugin, PluginResult, PluginContext interfaces
    settings/                    # Settings management
    suggestions/                 # Default suggestions
    window/                      # Window state management
  shared/
    types/common.types.ts        # SearchResult, AppInfo, etc.
    constants/                   # Configuration
    hooks/                       # Reusable React hooks
    components/ui/               # HotkeyCapture, ContextMenu, Modal, HelpDialog, PropertiesDialog
    components/layout/           # Footer, Header
    utils/                       # logger, clipboard helpers
  styles/                        # Global styles, themes
```

## Adding a Tauri Command

1. Define function with `#[tauri::command]` in appropriate `commands/*.rs`
2. Export from `commands/mod.rs`
3. Add to `invoke_handler![]` in `lib.rs`
4. Call from frontend: `invoke('command_name', { params })`

**Type sync**: Use `#[serde(rename_all = "camelCase")]` for Rust structs (TS is camelCase, Rust is snake_case)

## Important Implementation Details

### Search Flow
1. Frontend: 150ms debounce + `latestSearchId` for stale response protection
2. Backend: `search_applications()` uses scoring (exact=100, startsWith=90, contains=80-position, fuzzy=50)
3. Results sorted by score descending

### File Indexing
- In-memory state: `FileIndexState` (Arc<Mutex<Vec<FileInfo>>>)
- Background scan via `start_indexing()` with `max_depth=10`, `max_file_size=100MB`
- Extensions filter: empty = all files; specified = only those extensions
- Search: `indexer/search.rs` with same scoring as apps

### Plugins vs Extensions
**Builtin plugins** (in-repo, `src/features/plugins/builtin/`):
- Registry: `pluginRegistry.query()` calls enabled plugins with 500ms timeout
- Events: Use `volt:*` DOM events for plugin→UI communication
- Builtin plugins registered in `App.tsx` on mount
- Backend plugins: trait-based in `src-tauri/src/plugins/` (async_trait, Send+Sync)

**Extensions** (separate repo: https://github.com/VoltLaunchr/volt-extensions):
- Community/third-party extensions live in the volt-extensions repo
- Manifest-based: ExtensionManifest with id, name, version, permissions
- Dynamic loading via ExtensionLoader + Sucrase transpilation
- Management: `src/features/extensions/` (install, uninstall, toggle)

### Hotkey
- Default: `Ctrl+Space` (configurable in Settings)
- No fallback hotkeys - if default conflicts, user can change in Settings

### Theme
- Controlled via `data-theme` attribute + `applyTheme()` from `features/settings`
- Auto theme uses system preference listener

## Window Config

Always-on-top, transparent, 600x400px, no decorations, skips taskbar (see `tauri.conf.json`)

## Key Dependencies

### Backend (Rust)
- **Tauri v2** + plugins: global-shortcut, shell, fs, dialog, updater, positioner, autostart, opener, process
- **tokio** (full) — async runtime
- **rusqlite** (bundled) — SQLite for file indexing
- **notify** v6 — filesystem watcher
- **reqwest** — HTTP client
- **nucleo-matcher** — fuzzy matching
- **sysinfo** — system metrics
- **tracing** + tracing-appender — structured logging with rotating files
- **Windows**: winapi, winreg, lnk

### Frontend (TypeScript)
- **React 19** + React DOM 19
- **Vite 7** — build tool (multi-page: main + settings windows)
- **TypeScript 5.8** — strict mode
- **lucide-react** — icons
- **date-fns** — date utilities
- **emojibase** — emoji data
- **sucrase** — TypeScript transpiler for extensions

## Documentation

- **Backend architecture**: `src-tauri/README.md`, `ARCHITECTURE.md`, `MODULES.md`
- **Plugin development**: `src-tauri/src/plugins/README.md`
- **Project-level**: `AGENTS.md` (detailed conventions), `README.md` (getting started)
- **Archive**: `archive/` for historical docs

## Code Style

**TS/React**: Prettier (single quotes, 100 char, 2 spaces), feature-based folders, functional components
**Rust**: rustfmt, commands return `Result<T, String>`, use `map_err(|e| e.to_string())`

## Custom Agents (`.claude/commands/`)

| Command | Purpose |
|---|---|
| `/volt-tauri-cmd` | Create Tauri v2 commands with full Rust→TS wiring |
| `/volt-plugin` | Create plugins (builtin) or extensions (volt-extensions repo) |
| `/volt-docs` | Fetch official docs (Tauri v2, React 19, Rust) via context7 + web |
| `/volt-debug` | Diagnose & fix bugs across the full stack |
| `/volt-feature` | Architect & implement new features end-to-end |

## Best Practices

- Maintain 150ms search debounce & latestSearchId protection
- Don't duplicate code - use `utils/` modules
- Test individual modules (faster than monolithic)
- Document all public APIs
- Follow existing patterns for new features
- Builtin plugins go in-repo; community extensions go in volt-extensions repo
- Always verify compilation after changes: `cargo check` (Rust) + `bun run build` (TS)
