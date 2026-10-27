# Contributing to Volt

Thank you for your interest in contributing to Volt! This guide will help you get started.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## Getting Started

### Prerequisites

- [**pnpm**](https://pnpm.io) (latest) — JavaScript package manager (we use `pnpm` for consistency)
- [**Rust**](https://rustup.rs/) (stable toolchain) — backend language
- **Tauri prerequisites** for your OS — see the [Tauri v2 prerequisites guide](https://tauri.app/start/prerequisites/)
  - Windows: WebView2 (pre-installed on Windows 10+), Visual Studio Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: system dependencies listed in the Tauri docs (webkit2gtk, etc.)

### Setting up your dev environment

```bash
# Clone the repo
git clone https://github.com/VoltLaunchr/Volt.git
cd Volt

# Install frontend dependencies
pnpm install

# Run the full app (frontend + Rust backend)
pnpm run tauri -- dev

# Or run frontend only (faster iteration, no Rust rebuild)
pnpm run dev
```

## Project Structure

A quick tour of the codebase:

```
src/                    # Frontend (React 19 + TypeScript 6, Vite 8)
  app/                  # Main App component + hooks (useAppLifecycle, useSearchPipeline, useGlobalHotkey, useResultActions)
  features/             # Feature modules (search, results, plugins/builtin [16 plugins], settings, extensions, notes, ...)
  shared/               # Shared types (incl. generated/ via ts-rs codegen), constants, UI components
  stores/               # Zustand stores (appStore, searchStore, uiStore)
  pages/                # Multi-page entries (main, settings, onboarding, system-monitor, notes)
  styles/               # Global styles and CSS variables (Tailwind v4 + theme.css)

src-tauri/src/          # Backend (Rust, edition 2024)
  core/                 # Foundation: types, traits, constants, errors (VoltError/VoltResult)
  plugins/              # Plugin system and built-in plugins
  commands/             # Tauri command handlers — 8 domains: ai, auth, content, extensions, files, launcher, shell, system
                        # (legacy flat paths re-exported via commands/mod.rs for compat)
  search/               # Search algorithms and scoring
  indexer/              # File indexing (scanner, watcher, search_engine, SQLite database, fulltext [tantivy-search], usn [usn-incremental])
  launcher/             # Cross-platform app launching (history with frecency_date, process, launch_validation)
  embeddings/           # Local embeddings (fastembed, multilingual-e5-small, lazy ONNX)
  expansion/            # Global snippet expansion (Windows + snippet-global-expansion feature, off by default)
  utils/                # Reusable utilities (icons, fuzzy matching, paths, launch_validation, shell_apps [Windows], x11 [Linux])
  window/               # Window management
  hotkey/               # Global hotkey registration

docs/                   # Documentation (index: docs/README.md)
  architecture/         # Architecture and feature docs
  build-release/        # CI/CD, distribution, signing, roadmap
  plugins/              # Plugin development guides
  user-guide/           # Keyboard shortcuts and user docs
  refonte/              # Active 2026 core-refactor tracking (pillars followed in refonte/TODO-REFONTE.md)
```

## Branch Naming

Use descriptive, prefixed branch names:

| Prefix | Use for |
|--------|---------|
| `feature/` | New features — `feature/emoji-picker` |
| `fix/` | Bug fixes — `fix/hotkey-registration` |
| `docs/` | Documentation — `docs/plugin-api-guide` |
| `refactor/` | Code refactoring — `refactor/search-scoring` |
| `test/` | Adding or fixing tests — `test/calculator-edge-cases` |
| `ci/` | CI/CD changes — `ci/add-macos-arm64` |

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/). Format:

```
<type>(<optional scope>): <description>

[optional body]
```

**Types**: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `perf`, `style`

**Examples**:
```
feat(plugins): add timezone conversion to calculator
fix(search): prevent stale results from overwriting newer query
docs: update plugin development guide with new API
test(launcher): add Windows arg escaping edge cases
chore: bump tauri to 2.2.0
refactor(commands): extract file history into dedicated module
```

## Pull Request Process

1. **Fork** the repository and create your branch from `main`.
2. **Make your changes** following the code style and conventions below.
3. **Write or update tests** for your changes (see Testing below).
4. **Run the full check suite locally** before pushing (see below).
5. **Push** your branch to your fork.
6. **Open a Pull Request** against `main` with a clear description of what and why. Fill in the PR template.
7. **Address review feedback** — maintainers may request changes before merging.

### Before opening your PR

Run the full check suite (same as CI `check.yml`):

```bash
# Frontend
pnpm run lint                    # ESLint, 0 errors
pnpm run build                   # tsc + Vite bundle
pnpm run test                    # Vitest suite

# Backend — primary matrix (default + tantivy-search)
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --features tantivy-search -- -D warnings
cargo test --workspace --lib --features tantivy-search

# Backend — encrypted-DB matrix (when touching storage/indexer)
cargo clippy --all-targets --no-default-features --features sqlcipher -- -D warnings
cargo test --workspace --lib --no-default-features --features sqlcipher
```

> Skip the sqlcipher matrix for frontend-only changes. Always run it when touching storage/indexer code.
> Also run `node scripts/sync-version.mjs --check` if you touched any version file.

All checks must pass. CI will run these automatically on your PR, but running locally first saves time.

## Testing Requirements

- Every PR must pass the existing test suite.
- **New features** should include tests. If you can't add tests, explain why in the PR description.
- **Bug fixes** should include a regression test when feasible.
- Frontend tests live alongside their modules (e.g., `src/features/search/__tests__/`). We use [vitest](https://vitest.dev/) with `@testing-library/react`.
- Backend tests live in `#[cfg(test)]` modules within each Rust file. We use standard `cargo test`.

## Code Style

### Frontend (TypeScript / React)

- **Prettier** enforces formatting (single quotes, 100 char line width, 2-space indent). Run `pnpm run lint` to check.
- Functional components only (no class components).
- Feature-based folder structure — keep related code together.
- Use TypeScript strictly: avoid `any`, prefer explicit types. Never use `// eslint-disable`, `// @ts-ignore` / `// @ts-expect-error`, or `as any` to silence errors — fix the code instead (see `CLAUDE.md` § Lint & Code Quality).
- Search behavior is load-bearing: keep the 150 ms debounce + `latestSearchId` stale-response protection in `useSearchPipeline.ts`.

### Backend (Rust)

- **rustfmt** enforces formatting (default settings). Run `cargo fmt --check` to verify.
- **Clippy** with `-D warnings` on both matrices (see above) — all warnings are errors.
- Tauri commands return `VoltResult<T>` (alias for `Result<T, VoltError>`) at the module boundary, mapped to `Result<T, String>` at the `#[tauri::command]` boundary via `map_err(|e| e.to_string())`. Never expose raw `Result<T, String>` internals.
- Use `#[serde(rename_all = "camelCase")]` for structs shared across the IPC boundary (TS is camelCase, Rust is snake_case).
- New commands go in the matching `commands/<domain>/` file (`ai` · `auth` · `content` · `extensions` · `files` · `launcher` · `shell` · `system`), are re-exported via `commands/mod.rs`, and registered in `invoke_handler![]` in `lib.rs`. If the shape crosses IPC, regenerate the TS bindings (`ts-rs` → `src/shared/types/generated/`, guarded by a Vitest type test).

## Release branches (summary)

Releases go through `release/vX.Y.Z` branches cut from `origin/main` (never from `dev` — otherwise `auto-tag.yml` won't fire). Bump with `node scripts/bump-version.mjs X.Y.Z`, verify with `node scripts/sync-version.mjs --check`, add the manual `public/changelog.json` entry, then run lint + build + both Clippy matrices + tests + the chunk cycle-scan. The full blocking checklist lives in `CLAUDE.md` § Release Process — read it before cutting a release.

## Where to Start

Not sure where to begin? Here are some ideas:

- Look for issues labeled [`good first issue`](https://github.com/VoltLaunchr/Volt/labels/good%20first%20issue) — these are scoped, approachable tasks.
- Improve documentation or fix typos.
- Add tests for existing functionality.
- Try the app and report bugs you find.

## Plugin & Extension Contributions

For external plugin/extension contributions, please use the [volt-extensions](https://github.com/VoltLaunchr/volt-extensions) repository (registry: `VoltLaunchr/volt-extensions/registry.json` for legacy entries; new submissions go through the developer portal backed by Supabase). The core Volt repo contains only built-in plugins; community extensions are managed separately.

The **Plugin SDK CLI** (`volt-plugin init/test/publish`, in the volt-extensions repo) can scaffold, validate, and build extensions. See the [Plugin Development Guide](docs/plugins/DEVELOPMENT.md) for details. In-repo built-ins (16 plugins, 14 toggleable via `MANAGED_PLUGINS` in `src/features/plugins/builtin/manifest.ts`) must declare their `activation` (prefixes/keywords) and register in `useAppLifecycle.ts`.

## What We Won't Merge

To set expectations and save everyone time:

- **Drive-by formatting changes** — reformatting code you didn't otherwise modify clutters the diff and git blame.
- **Dependency bumps without justification** — explain why the upgrade is needed (security fix, new feature you're using, etc.).
- **Breaking changes without discussion** — open an issue first so we can discuss the design and migration path.
- **Large PRs without prior discussion** — for anything beyond a small fix, open an issue or discussion first to align on approach.

## Questions?

- Open a [Discussion](https://github.com/VoltLaunchr/Volt/discussions) for questions, ideas, or help.
- For security issues, see [`SECURITY.md`](SECURITY.md).

Thank you for helping make Volt better!
