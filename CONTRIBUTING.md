# Contributing to Volt

Thank you for your interest in contributing to Volt! This guide will help you get started.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## Getting Started

### Prerequisites

- [**Bun**](https://bun.sh) (latest) — JavaScript runtime and package manager
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
bun install

# Run the full app (frontend + Rust backend)
bun tauri dev

# Or run frontend only (faster iteration, no Rust rebuild)
bun run dev
```

## Project Structure

A quick tour of the codebase:

```
src/                    # Frontend (React + TypeScript)
  app/                  # Main App component
  features/             # Feature modules (search, results, plugins, settings, ...)
  shared/               # Shared types, constants, UI components
  styles/               # Global styles and CSS variables

src-tauri/src/          # Backend (Rust)
  core/                 # Foundation: types, traits, constants, errors
  plugins/              # Plugin system and built-in plugins
  commands/             # Tauri command handlers (15 modules: apps, files, settings, launcher, autostart, clipboard, extensions, games, steam, system_monitor, plugins, hotkey, logging, preview, snippets)
  search/               # Search algorithms and scoring
  utils/                # Reusable utilities (icons, fuzzy matching, paths, shell_apps [Windows])
  window/               # Window management
  hotkey/               # Global hotkey registration
  indexer/              # File indexing system (includes windows_search [Windows])
  launcher/             # Cross-platform app launching

docs/                   # Documentation
  architecture/         # Architecture and feature docs
  build-release/        # CI/CD, distribution, roadmap
  plugins/              # Plugin development guides
  user-guide/           # Keyboard shortcuts and user docs
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

Run the full check suite:

```bash
# Frontend
bun run lint                    # Prettier + ESLint
bun run test                    # 166+ vitest tests

# Backend
cd src-tauri
cargo fmt --check               # Formatting
cargo clippy --all-features --all-targets -- -D warnings   # Lints
cargo test --lib                # 138+ tests
```

All checks must pass. CI will run these automatically on your PR, but running locally first saves time.

## Testing Requirements

- Every PR must pass the existing test suite.
- **New features** should include tests. If you can't add tests, explain why in the PR description.
- **Bug fixes** should include a regression test when feasible.
- Frontend tests live alongside their modules (e.g., `src/features/search/__tests__/`). We use [vitest](https://vitest.dev/) with `@testing-library/react`.
- Backend tests live in `#[cfg(test)]` modules within each Rust file. We use standard `cargo test`.

## Code Style

### Frontend (TypeScript / React)

- **Prettier** enforces formatting (single quotes, 100 char line width, 2-space indent). Run `bun run lint` to check.
- Functional components only (no class components).
- Feature-based folder structure — keep related code together.
- Use TypeScript strictly: avoid `any`, prefer explicit types.

### Backend (Rust)

- **rustfmt** enforces formatting (default settings). Run `cargo fmt --check` to verify.
- **Clippy** with `-D warnings` — all warnings are errors. Run `cargo clippy --all-features --all-targets -- -D warnings`.
- Tauri commands return `Result<T, VoltError>` (not `Result<T, String>`).
- Use `#[serde(rename_all = "camelCase")]` for structs shared across the IPC boundary.

## Where to Start

Not sure where to begin? Here are some ideas:

- Look for issues labeled [`good first issue`](https://github.com/VoltLaunchr/Volt/labels/good%20first%20issue) — these are scoped, approachable tasks.
- Improve documentation or fix typos.
- Add tests for existing functionality.
- Try the app and report bugs you find.

## Plugin & Extension Contributions

For external plugin/extension contributions, please use the [Volt Extensions](https://github.com/VoltLaunchr/extensions) repository. The core Volt repo contains only built-in plugins; community extensions are managed separately.

The **Plugin SDK CLI** (`volt-plugin`) can scaffold, validate, and build extensions. See the [Plugin Development Guide](docs/plugins/DEVELOPMENT.md) for details.

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
