# Copilot instructions (Volt)

## Big picture

- Volt is a Tauri v2 desktop launcher: React/Vite frontend + Rust backend.
- Entrypoints: frontend [src/main.tsx](../src/main.tsx) → [src/app/App.tsx](../src/app/App.tsx); backend [src-tauri/src/main.rs](../src-tauri/src/main.rs) → `volt_lib::run()` in [src-tauri/src/lib.rs](../src-tauri/src/lib.rs)

## Dev workflows (use pnpm)

- Install: `pnpm install`
- Full app dev (recommended): `pnpm run tauri -- dev`
- Frontend only (Vite on 1420): `pnpm run dev`
- Build: `pnpm run build` (web) and `pnpm run tauri -- build` (desktop bundle)
- Lint: `pnpm run lint`
- Format: `pnpm exec prettier --write .`

## Where things live

- Main UI orchestration: [src/app/App.tsx](../src/app/App.tsx) (thin shell, delegates to extracted hooks in `src/app/hooks/`: `useSearchPipeline`, `useAppLifecycle`, `useGlobalHotkey`, `useResultActions`)
- Feature slices: `src/features/*` (e.g. search/results/settings/plugins). Built-ins: `src/features/plugins/builtin/` (16 plugins, 14 toggleable via `MANAGED_PLUGINS` in `manifest.ts`; `ai-chat` + `developer` always-on), registered on startup in `useAppLifecycle.ts` — not directly in `App.tsx`.
- Shared UI + primitives: `src/shared/components`, shared TS types in `src/shared/types` (plus `generated/` via ts-rs codegen — never hand-edit generated bindings)
- Global styling + themes: `src/styles/*` (theme is driven via `data-theme` and settings)
- Tauri commands: [src-tauri/src/commands](../src-tauri/src/commands) — 8 domains (`ai`, `auth`, `content`, `extensions`, `files`, `launcher`, `shell`, `system`), ~30 files. Legacy flat paths (e.g. `commands::files`) are re-exported via `commands/mod.rs` for compat.
- Global hotkey: [src-tauri/src/hotkey/mod.rs](../src-tauri/src/hotkey/mod.rs)
- Window behavior is configured in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) (transparent, always-on-top, no decorations).

## Cross-boundary patterns (Rust ↔ TS)

- Frontend calls Rust via `invoke()` from `@tauri-apps/api/core` (command names are `snake_case`, e.g. `invoke('scan_applications')`).
- When adding/changing shared data, keep TS `camelCase` vs Rust `snake_case` in mind; use `serde` rename attributes / `rename_all = "camelCase"` as needed.

## Adding a new Tauri command (the project’s wiring)

1. Add `#[tauri::command]` function under the matching domain in [src-tauri/src/commands](../src-tauri/src/commands) (`ai` · `auth` · `content` · `extensions` · `files` · `launcher` · `shell` · `system`).
2. Export it from [src-tauri/src/commands/mod.rs](../src-tauri/src/commands/mod.rs) (or re-export its module — legacy flat paths still work via the compat facade).
3. Register it in `tauri::generate_handler![...]` in [src-tauri/src/lib.rs](../src-tauri/src/lib.rs).
4. Call it from the frontend with `invoke('your_command_name', { ...params })`.
5. If the shape crosses IPC, regenerate the ts-rs bindings into `src/shared/types/generated/` (a Vitest type test fails CI on drift).

## Search + results behavior (don’t break these)

- Search is debounced (150ms) and prevents stale responses via `latestSearchId` in [src/app/hooks/useSearchPipeline.ts](../src/app/hooks/useSearchPipeline.ts).
- App + file + plugin search run in parallel and are merged by the shared `compareResults` comparator (`src/app/searchRanking.ts`): band, tier, quality, frecency, source, declared score, then title.
- File indexing is optional: frontend treats `search_files` failures as empty results.
- File search uses nucleo by default. With the `tantivy-search` Cargo feature it uses the persistent Tantivy index, with SQLite as source of truth and nucleo as fallback.
- The frontend watcher lifecycle is serialized by `FileWatcherLifecycle`: stop before rebuild/config change, start only after indexing completes, stop on unmount.

## Project conventions (senior guardrails)

- Plugins: registry is in [src/features/plugins/core](../src/features/plugins/core) (`registry.ts`, 500 ms timeout; `activation.ts` is the single source of truth for prefixes/keywords — do not duplicate keyword maps in the search pipeline); built-ins live in [src/features/plugins/builtin](../src/features/plugins/builtin) and are registered on startup in `useAppLifecycle.ts`. Toggleable set is `MANAGED_PLUGINS` in `manifest.ts` (with `normalizeEnabledPlugins()` migration).
- Plugin→UI communication can use `volt:*` DOM events (e.g. `volt:open-settings` listener in [src/app/App.tsx](../src/app/App.tsx)); prefer this pattern over ad-hoc globals.
- Frecency: `frecency_date = max(now, frecency_date) + 1 day` on launch. Its raw value breaks ties within a match tier for apps and commands; do not add cross-tier bonuses or reintroduce `calculate_frecency()` on the hot path.
- Theme: applied via `applyTheme()` from `src/features/settings` (sets `data-theme`); keep colors in CSS variables/themes under `src/styles/*`.

## Hotkey behavior

- Hotkey registration is best-effort (does not crash if unavailable). It tries a list of defaults and may apply a user-configured hotkey from settings on startup.
- Keep string formats consistent with `tauri-plugin-global-shortcut` parsing (see [src-tauri/src/hotkey/mod.rs](../src-tauri/src/hotkey/mod.rs)).

## Extensions system

- External extensions are loaded via `src/features/extensions/` on the frontend.
- Backend extension commands live in `src-tauri/src/commands/extensions/` (`management.rs`, `plugins.rs`).

## Logging

- Backend uses `tracing` with rotating daily log files (configured in `src-tauri/src/`).
- Frontend logging helper: `src/shared/utils/logger.ts`.

## Error handling

- All Tauri commands return `VoltResult<T>` (alias for `Result<T, VoltError>`).
- `VoltError` is a discriminated union defined in `src-tauri/src/core/error.rs` — do not use raw `Result<T, String>` for Tauri commands.
