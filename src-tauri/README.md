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
├── commands/          📡 Commands - Tauri handlers
├── hotkey/            ⌨️  Hotkey - Global shortcuts
├── indexer/           📂 Indexer - File scanning
└── launcher/          🚀 Launcher - Process management
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
- **builtin/**: Built-in plugins (SystemMonitor, etc.)

**Documentation**: See [plugins/README.md](./src/plugins/README.md)

### 🛠️ Utils (`utils/`)

**Reusable utilities** shared across modules.

- **icon.rs**: Icon extraction (Windows HICON → PNG)
- **matching.rs**: Fuzzy match & scoring algorithms
- **path.rs**: File system utilities

**Key Functions**:

- `extract_icon()` - Extract app icons
- `fuzzy_match()` - Pattern matching
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

### 📡 Commands (`commands/`)

**Tauri command handlers** exposed to frontend.

- **apps.rs**: Scan & launch applications
- **settings.rs**: Load/save settings
- **files.rs**: File indexing
- **launcher.rs**: Launch history
- **autostart.rs**: Autostart management

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
bun tauri dev
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

- **Total Modules**: 9
- **Core Types**: 4 enums, 6 traits
- **Utility Functions**: 15+
- **Tauri Commands**: 30+
- **Built-in Plugins**: 1 (expandable)

## 🛣️ Roadmap

### Phase 1: Foundation ✅

- [x] Module structure
- [x] Core types and traits
- [x] Utils module
- [x] Plugin system foundation

### Phase 2: Enhancement 🚧

- [ ] More built-in plugins
- [ ] Advanced search algorithms
- [ ] Caching layer
- [ ] Performance optimizations

### Phase 3: Extensibility 📋

- [ ] Dynamic plugin loading
- [ ] Plugin marketplace
- [ ] Plugin API documentation
- [ ] Third-party plugin support

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
