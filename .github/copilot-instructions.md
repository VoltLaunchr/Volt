# Copilot instructions (Volt)

## Big picture

- Volt is a Tauri v2 desktop launcher: React/Vite frontend + Rust backend.
- Entrypoints: frontend [src/main.tsx](../src/main.tsx) → [src/app/App.tsx](../src/app/App.tsx); backend [src-tauri/src/main.rs](../src-tauri/src/main.rs) → `volt_lib::run()` in [src-tauri/src/lib.rs](../src-tauri/src/lib.rs)

## Dev workflows (use Bun)

- Install: `bun install`
- Full app dev (recommended): `bun tauri dev`
- Frontend only (Vite on 1420): `bun run dev`
- Build: `bun run build` (web) and `bun tauri build` (desktop bundle)
- Lint: `bun run lint`
- Format: `bun prettier --write .`

## Where things live

- Main UI orchestration (loading apps/settings, debounced search, key handling): [src/app/App.tsx](../src/app/App.tsx)
- Feature slices: `src/features/*` (e.g. search/results/settings/plugins)
- Shared UI + primitives: `src/shared/components`, shared TS types in `src/shared/types`
- Global styling + themes: `src/styles/*` (theme is driven via `data-theme` and settings)
- Tauri commands: [src-tauri/src/commands](../src-tauri/src/commands) (apps/files/settings/window)
- Global hotkey: [src-tauri/src/hotkey/mod.rs](../src-tauri/src/hotkey/mod.rs)
- Window behavior is configured in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) (transparent, always-on-top, no decorations).

## Cross-boundary patterns (Rust ↔ TS)

- Frontend calls Rust via `invoke()` from `@tauri-apps/api/core` (command names are `snake_case`, e.g. `invoke('scan_applications')`).
- When adding/changing shared data, keep TS `camelCase` vs Rust `snake_case` in mind; use `serde` rename attributes / `rename_all = "camelCase"` as needed.

## Adding a new Tauri command (the project’s wiring)

1. Add `#[tauri::command]` function under [src-tauri/src/commands](../src-tauri/src/commands).
2. Export it from [src-tauri/src/commands/mod.rs](../src-tauri/src/commands/mod.rs) (or re-export its module).
3. Register it in `tauri::generate_handler![...]` in [src-tauri/src/lib.rs](../src-tauri/src/lib.rs).
4. Call it from the frontend with `invoke('your_command_name', { ...params })`.

## Search + results behavior (don’t break these)

- Search is debounced (150ms) and prevents stale responses via `latestSearchId` in [src/app/App.tsx](../src/app/App.tsx).
- App + file + plugin search run in parallel and are merged/sorted by `score`.
- File indexing is optional: frontend treats `search_files` failures as empty results.

## Project conventions (senior guardrails)

- Plugins: registry is in [src/features/plugins/core](../src/features/plugins/core); built-ins live in [src/features/plugins/builtin](../src/features/plugins/builtin) and are registered on startup in [src/app/App.tsx](../src/app/App.tsx).
- Plugin→UI communication can use `volt:*` DOM events (e.g. `volt:open-settings` listener in [src/app/App.tsx](../src/app/App.tsx)); prefer this pattern over ad-hoc globals.
- Theme: applied via `applyTheme()` from `src/features/settings` (sets `data-theme`); keep colors in CSS variables/themes under `src/styles/*`.

## Hotkey behavior

- Hotkey registration is best-effort (does not crash if unavailable). It tries a list of defaults and may apply a user-configured hotkey from settings on startup.
- Keep string formats consistent with `tauri-plugin-global-shortcut` parsing (see [src-tauri/src/hotkey/mod.rs](../src-tauri/src/hotkey/mod.rs)).
