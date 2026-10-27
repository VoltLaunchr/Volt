# Volt - Tauri Backend

Professional, modular Rust backend for the Volt application launcher.

## 🏗️ Architecture Overview

```
src-tauri/src/
├── core/              ⭐ Foundation - Types, traits, constants
├── plugins/           🔌 Plugin system - Extensibility
├── utils/             🛠️ Utilities - Reusable functions
├── search/            🔍 Search - Algorithms & ranking
├── window/            🪟 Window - Management commands
├── commands/          📡 Commands - Tauri handlers (8 domains: ai/auth/content/extensions/files/launcher/shell/system)
├── hotkey/            ⌨️  Hotkey - Global shortcuts
├── indexer/           📂 Indexer - File scanning (SQLite + optional Tantivy + watcher)
├── launcher/          🚀 Launcher - Process management
├── embeddings/        🧠 Local embeddings (fastembed, lazy ONNX)
└── expansion/         ⌨️ Global snippet expansion (Windows, opt-in feature)
```

## 📦 Module Descriptions

### ⭐ Core (`core/`)

**Foundation module** with shared types, traits, and constants.

- **types.rs**: AppCategory, SearchResultType, Platform, LaunchMode
- **traits.rs**: Searchable, Launchable, Plugin, Cacheable
- **constants.rs**: App-wide constants and configuration
- **error.rs**: VoltError and VoltResult types

**Documentation**: See [MODULES.md](./MODULES.md#core-module)

### 🔌 Plugins (`plugins/`)

**Extensible plugin system** for backend functionality.

- **registry.rs**: Thread-safe plugin management
- **loader.rs**: Dynamic plugin loading (future)
- **api.rs**: VoltPluginAPI for plugin interactions
- **builtin/**: Built-in plugins (clipboard_manager, game_scanner, system_monitor)

**Documentation**: See [plugins/README.md](./src/plugins/README.md)

### 🛠️ Utils (`utils/`)

**Reusable utilities** shared across modules.

- **icon.rs**: Icon extraction (Windows HICON → PNG)
- **matching.rs**: Fuzzy match & scoring algorithms
- **path.rs**: File system utilities

**Key Functions**:

- `extract_icon()` - Extract app icons
- `fuzzy_match()` - Pattern matching (uses nucleo-matcher)
- `calculate_match_score()` - Search scoring (0-100)

### 🔍 Search (`search/`)

**Search algorithms** with scoring and ranking.

- Fuzzy matching
- Score-based ranking
- Sorted results

### 🪟 Window (`window/`)

**Window management** commands.

- `show_window()` - Show and focus
- `hide_window()` - Hide window
- `toggle_window()` - Toggle visibility
- `center_window()` - Center on screen

### 📡 Commands (`commands/` — 8 domains)

**Tauri command handlers** exposed to frontend (~230 `#[tauri::command]`, legacy flat paths re-exported via `commands/mod.rs`).

- **launcher/**: app scan & launch, game/Steam scan, batch/streaming search, launch history
- **files/**: file indexing + file preview
- **system/**: settings, clipboard, system monitor, window management, autostart, logging, notifications, web search
- **content/**: notes, snippets (+ global expansion trigger), quicklinks
- **shell/**: shell execution (streaming) + shell history
- **ai/**: AI profile, quick actions, embeddings, proxy, custom emojis
- **auth/**: session (Supabase + deep link), OAuth, credentials (keyring), signed keyring store, sync
- **extensions/**: extension management + plugin commands

All commands return `VoltResult<T>` at the module boundary (mapped to `Result<T, String>` at the `#[tauri::command]` boundary).

## 🚀 Quick Start

### Build

```bash
cargo build --release
```

### Test

```bash
cargo test
```

### Check

```bash
cargo check
```

### Run with Tauri

```bash
pnpm run tauri -- dev
```

## 📖 Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Overall architecture guide
- **[MODULES.md](./MODULES.md)** - Detailed module documentation
- **[plugins/README.md](./src/plugins/README.md)** - Plugin development guide

## 🎯 Design Principles

1. **Modularity**: Each module has single responsibility
2. **Testability**: Pure functions with comprehensive tests
3. **Extensibility**: Plugin system for custom features
4. **Cross-Platform**: Conditional compilation for Windows/macOS/Linux
5. **Type Safety**: Strong typing with custom error types
6. **Documentation**: Every public API documented

## 🔧 Key Features

### Cross-Platform App Scanning

- Windows: Program Files, Start Menu, multiple drives
- macOS: /Applications and user apps
- Linux: .desktop files and executables

### Intelligent Search

- Exact match scoring
- Fuzzy matching
- Position-weighted ranking
- Customizable thresholds

### Plugin System

- Trait-based plugin interface
- Built-in plugins included
- Future: Dynamic plugin loading

### Type-Safe Core

- Shared types across modules
- Custom error handling
- Platform detection
- Launch modes

## 📝 Usage Examples

### Using Core Types

```rust
use crate::core::{AppCategory, Platform, VoltResult};

fn check_platform() -> VoltResult<()> {
    let platform = Platform::current();
    println!("Running on: {}", platform.as_str());
    Ok(())
}
```

### Search with Utils

```rust
use crate::utils::{fuzzy_match, calculate_match_score};

let score = calculate_match_score("Visual Studio Code", "vsc");
if score > 50.0 {
    println!("Good match! Score: {}", score);
}
```

### Creating a Plugin

```rust
use crate::core::traits::Plugin;
use async_trait::async_trait;

struct MyPlugin;

#[async_trait]
impl Plugin for MyPlugin {
    fn id(&self) -> &str { "my_plugin" }
    fn name(&self) -> &str { "My Plugin" }
    fn description(&self) -> &str { "Does cool stuff" }
}
```

## 🧪 Testing

### Run All Tests

```bash
cargo test
```

### Test Specific Module

```bash
cargo test core::
cargo test utils::matching
cargo test plugins::registry
```

### Test with Output

```bash
cargo test -- --nocapture
```

## 📊 Module Statistics

- **Top-level modules**: core, plugins, utils, search, window, commands (8 domains), hotkey, indexer, launcher, embeddings, expansion
- **Core Types**: AppCategory, SearchResultType, Platform, LaunchMode (+ VoltError/VoltResult)
- **Tauri Commands**: ~230 `#[tauri::command]` across ~40 files (recompter via `rg -o "#\[tauri::command\]" src-tauri/src/commands | wc -l`)
- **Built-in backend plugins**: 3 (clipboard_manager, game_scanner [10 platform scanners], system_monitor)
- **Feature flags**: `tantivy-search` (persistent file index) · `sqlcipher` (encrypted DB) · `usn-incremental` (Windows delta reader) · `snippet-global-expansion` (Windows hook) · `test-embeddings` · `devtools` (debug)

## 🛣️ Roadmap

### Phase 1: Foundation ✅

- [x] Module structure
- [x] Core types and traits
- [x] Utils module
- [x] Plugin system foundation

### Phase 2: Enhancement ✅

- [x] More built-in plugins (clipboard_manager, game_scanner)
- [x] Advanced search algorithms (nucleo-matcher fuzzy matching)
- [x] Persistent file index (SQLite source of truth + optional Tantivy backend)
- [x] Encrypted data-at-rest track (`sqlcipher` feature, see `docs/refonte/REFONTE-PILIER-C-SQLCIPHER.md`)
- [ ] Performance baselines (see `docs/benchmarks/PERFORMANCE_BASELINE.md`)

### Phase 3: Extensibility 📋

- [ ] Dynamic plugin loading
- [ ] Plugin marketplace
- [ ] Plugin API documentation
- [ ] Third-party plugin support

## 🔍 Logging & IPC command timing

Logging uses `tracing` with an `EnvFilter` that defaults to `info`. Override it
with the `RUST_LOG` environment variable.

High-traffic Tauri commands (search / apps / files / clipboard / launcher query
paths) are instrumented with a lightweight timing guard
(`utils::timing::TimedSpan` + the `time_command!` macro). The guard logs elapsed
time at the `debug` level and is **zero-cost when `debug` is filtered out** — no
`Instant` is taken unless `debug` is enabled.

Enable timing logs by raising the level for the `volt` target:

```bash
# Windows (PowerShell)
$env:RUST_LOG = "volt=debug"; volt.exe

# Unix
RUST_LOG=volt=debug volt
```

Each instrumented command then emits a line such as:

```text
DEBUG volt::utils::timing: ipc command finished command="search_files" elapsed_us=842
```

## 🤝 Contributing

When adding new features:

1. **Follow module structure** - Place code in appropriate module
2. **Write tests** - Add tests for new functionality
3. **Document** - Add doc comments and update READMEs
4. **Use core types** - Leverage existing types and traits
5. **Error handling** - Use VoltResult for operations

## 📄 License

See [LICENSE](../../LICENSE) for details.

## 🔗 Links

- [Frontend Documentation](../../README.md)
- [Project Architecture](./ARCHITECTURE.md)
- [Module Reference](./MODULES.md)
- [Plugin Guide](./src/plugins/README.md)

---

**Built with ❤️ using Rust and Tauri**
