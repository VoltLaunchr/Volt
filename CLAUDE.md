# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Volt is a keyboard-driven application launcher (Tauri v2 + React + TypeScript). Fast, minimal interface similar to Spotlight/Alfred, toggled with `Ctrl+Shift+Space`.

## Key Commands

**Frontend**: `bun run dev` | **Full stack**: `bun tauri dev` | **Build**: `bun tauri build`
**Format**: `bun prettier --write .`

## Architecture Quick Reference

### Entry Points
- **Frontend**: `src/main.tsx` → `src/app/App.tsx`
- **Backend**: `src-tauri/src/main.rs` → `volt_lib::run()` in `src-tauri/src/lib.rs`

### Backend Modules (`src-tauri/src/`)
```
core/          # Foundation (types, traits, constants, errors)
plugins/       # Plugin system with builtin plugins
utils/         # Reusable (icon extraction, fuzzy matching, path utils)
search/        # Search algorithms with scoring
window/        # Window management commands
commands/      # Tauri command handlers
  apps.rs      # App scanning (Windows/macOS/Linux)
  settings.rs  # Settings management
  files.rs     # File indexing
  launcher.rs  # Launch history & pins
hotkey/        # Global hotkey management
indexer/       # File indexing system
launcher/      # Cross-platform app launching
```

### Frontend Structure
```
src/
  app/                           # Main app component
  features/
    search/components/           # SearchBar with debounce
    results/components/          # ResultsList, ResultItem
    applications/utils/          # App helpers
    plugins/                     # Plugin system
      builtin/                   # calculator, timer, websearch
      core/registry.ts           # Plugin registry (500ms timeout)
    settings/                    # Settings management
  shared/
    types/                       # TypeScript interfaces
    constants/                   # Configuration
    components/ui/               # Reusable UI (HotkeyCapture, ContextMenu, etc.)
  styles/                        # Global styles, variables
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

### Plugins
- Registry: `pluginRegistry.query()` calls enabled plugins with 500ms timeout
- Events: Use `volt:*` DOM events for plugin→UI communication
- Builtin plugins registered in `App.tsx` on mount

### Hotkey
- Best-effort registration tries multiple combos (Alt+Space, Ctrl+Shift+Space, etc.)
- Settings can override default on startup

### Theme
- Controlled via `data-theme` attribute + `applyTheme()` from `features/settings`
- Auto theme uses system preference listener

## Window Config

Always-on-top, transparent, 600x400px, no decorations, skips taskbar (see `tauri.conf.json`)

## Documentation

- **Backend architecture**: `src-tauri/README.md`, `ARCHITECTURE.md`, `MODULES.md`
- **Plugin development**: `src-tauri/src/plugins/README.md`
- **Project-level**: `AGENTS.md` (detailed conventions), `README.md` (getting started)
- **Archive**: `archive/` for historical docs

## Code Style

**TS/React**: Prettier (single quotes, 100 char, 2 spaces), feature-based folders, functional components
**Rust**: rustfmt, commands return `Result<T, String>`, use `map_err(|e| e.to_string())`

## Best Practices

- Maintain 150ms search debounce & latestSearchId protection
- Don't duplicate code - use `utils/` modules
- Test individual modules (faster than monolithic)
- Document all public APIs
- Follow existing patterns for new features
