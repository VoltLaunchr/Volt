# Volt - Rust Backend Architecture

This document describes the modular architecture of the Tauri backend.

## 📁 Directory Structure

```
src-tauri/src/
├── commands/           # Tauri command handlers
│   ├── apps.rs        # Application scanning and launching
│   ├── autostart.rs   # Autostart management
│   ├── files.rs       # File indexing
│   ├── launcher.rs    # Launch history tracking
│   ├── settings.rs    # Settings management
│   └── mod.rs         # Module exports
│
├── hotkey/            # Global hotkey management
│   └── mod.rs
│
├── indexer/           # File indexing system
│   ├── scanner.rs
│   └── mod.rs
│
├── launcher/          # Cross-platform app launching
│   ├── process.rs
│   └── mod.rs
│
├── search/            # Search algorithms
│   └── mod.rs         # Application search logic
│
├── utils/             # Shared utilities
│   ├── icon.rs        # Icon extraction (Windows)
│   ├── matching.rs    # Fuzzy matching & scoring
│   ├── path.rs        # Path utilities & exe finding
│   └── mod.rs         # Module exports
│
├── window/            # Window management
│   └── mod.rs         # Show/hide/toggle/center
│
├── core/              # Core types and traits
│   ├── types.rs       # AppInfo, FileInfo, SearchResult
│   ├── traits.rs      # Plugin, Searchable, Launchable
│   ├── error.rs       # VoltError, VoltResult
│   ├── constants.rs   # App-wide constants
│   └── mod.rs         # Module exports
│
├── plugins/           # Plugin system (extensible!)
│   ├── registry.rs    # Plugin registry & management
│   ├── loader.rs      # Dynamic plugin loading
│   ├── api.rs         # VoltPluginAPI - comprehensive plugin API
│   ├── builtin/       # Built-in plugins (organized structure)
│   │   ├── mod.rs     # Plugin registration
│   │   ├── system_monitor/  # System monitoring plugin
│   │   │   ├── mod.rs       # Module declaration
│   │   │   └── plugin.rs    # Implementation
│   │   └── steam_scanner/   # Steam game scanner
│   │       ├── mod.rs       # Module declaration
│   │       ├── plugin.rs    # Plugin implementation
│   │       └── scanner.rs   # Steam scanning logic
│   ├── PLUGIN_GUIDE.md  # Plugin development guide
│   └── mod.rs         # Module exports
│
├── lib.rs             # Main library entry point
└── main.rs            # Binary entry point
```

## 🎯 Module Responsibilities

### `commands/`

Tauri command handlers that are exposed to the frontend via `invoke()`.

- **apps.rs**: Cross-platform application scanning (Windows, macOS, Linux)
- **autostart.rs**: Enable/disable autostart on system boot
- **files.rs**: File indexing for fast file search
- **launcher.rs**: Launch history, pinned apps, tags
- **settings.rs**: Load/save user settings

### `utils/`

Reusable utility functions shared across modules.

#### `utils::icon`

- `extract_icon()`: Extract icon from .exe/.lnk files (Windows)
- `hicon_to_png_base64()`: Convert Windows HICON to PNG
- `base64_encode()`: Simple base64 encoding
- `resolve_linux_icon()`: Find Linux app icons

#### `utils::matching`

- `fuzzy_match()`: Check if pattern matches text in order
- `calculate_match_score()`: Score search relevance (0-100)

#### `utils::path`

- `get_all_drives()`: Get available drive letters (Windows)
- `find_main_executable()`: Find main .exe in a directory
- `find_exe_in_directory()`: Find executables (non-recursive)
- `is_executable()`: Check if file is executable (Linux)

### `search/`

Search and ranking algorithms.

- `search_applications()`: Search apps by query with scoring

### `window/`

Window management commands.

- `show_window()`: Show and focus window
- `hide_window()`: Hide window
- `toggle_window()`: Toggle visibility
- `center_window()`: Center on screen

### `hotkey/`

Global hotkey registration and handling.

- Uses `tauri-plugin-global-shortcut`
- Default: Ctrl+Shift+Space

### `launcher/`

Cross-platform process launching.

- Handles Windows, macOS, Linux
- Detached process spawning
- Error handling

### `indexer/`

File system indexing for fast file search.

- Background scanning
- Incremental updates
- Configurable paths and extensions

### `core/`

Foundation types and traits used throughout the application.

#### `core::types`

- `AppInfo`: Application metadata structure
- `FileInfo`: File information structure
- `SearchResult`: Unified search result type
- `SearchResultType`: Result type enumeration
- `AppCategory`: Application categorization
- `Platform`: Platform detection

#### `core::traits`

- `Plugin`: Main plugin trait for extensibility
- `Searchable`: Trait for searchable objects
- `Launchable`: Trait for launchable objects
- `Cacheable`: Trait for cacheable objects
- `Persistable`: Trait for disk serialization

#### `core::error`

- `VoltError`: Application-wide error type
- `VoltResult<T>`: Result type alias
- Error conversion utilities

#### `core::constants`

- Application constants (name, version, defaults)
- Search scoring weights
- Performance tuning parameters
- File paths and cache settings

### `plugins/`

**Extensible plugin system for adding custom functionality.**

#### Plugin Architecture

Volt supports both frontend (TypeScript) and backend (Rust) plugins:

- **Frontend Plugins**: UI interactions (calculator, timer, web search)
- **Backend Plugins**: System integrations (Steam scanner, cloud storage)

#### Key Components

- **registry.rs**: Thread-safe plugin registry with lifecycle management
- **loader.rs**: Dynamic plugin loading (future: external .wasm plugins)
- **api.rs**: VoltPluginAPI - comprehensive API for plugin interactions
- **builtin/**: Built-in plugins shipped with Volt (organized by directory)

#### VoltPluginAPI

The `VoltPluginAPI` provides plugins with controlled access to Volt's functionality:

**File System:**

- `get_plugin_data_dir()` - Plugin's data directory
- `get_plugin_cache_dir()` - Plugin's cache directory
- `get_plugin_config_dir()` - Plugin's config directory

**Configuration:**

- `load_config()` - Load plugin settings from JSON
- `save_config()` - Save plugin settings to JSON

**Caching:**

- `read_cache()` - Read cached data
- `write_cache()` - Write data to cache
- `clear_cache()` - Clear all cached data

**Logging:**

- `log()` - Log messages with levels (Info, Warn, Error, Debug)

**Application Info:**

- `get_volt_version()` - Get Volt's version
- `get_app_data_dir()` - Get app data directory

#### Plugin Structure

Each plugin now has its own directory for better organization:

```
builtin/
├── mod.rs              # Plugin registration with API
├── system_monitor/     # Example plugin
│   ├── mod.rs         # Module declaration
│   └── plugin.rs      # Plugin implementation
└── steam_scanner/      # Complex example
    ├── mod.rs         # Module declaration
    ├── plugin.rs      # Plugin trait impl
    └── scanner.rs     # Additional logic
```

**Benefits:**

- Better code organization and separation
- Easier to add new plugins
- Clear structure for third-party developers
- Each plugin can have multiple implementation files

#### Plugin Lifecycle

```
Registration → API Setup → Initialization → Active → Shutdown
     ↓              ↓            ↓            ↓         ↓
  new()       with_api()   initialize()   execute()  shutdown()
                               ↓
                         VoltPluginAPI
```

Each plugin implements the `Plugin` trait:

- `fn id()` - Unique plugin identifier
- `fn name()` - Display name
- `fn description()` - What it does
- `fn is_enabled()` - Check if plugin is active
- `async fn initialize()` - Setup on app start (uses API)
- `async fn shutdown()` - Cleanup on app exit (uses API)

See [PLUGIN_GUIDE.md](src/plugins/PLUGIN_GUIDE.md) for development docs.

## 🔄 Data Flow

```
Frontend (React)
      ↓
   invoke()
      ↓
  commands/
      ↓
  ┌───┴───┐
  ↓       ↓
search/  plugins/ ──→ Plugin API
  ↓       ↓              ↓
utils/   core/  ←───────┘
  ↓
launcher/
```

### Plugin Integration Flow

```
User Query
    ↓
Frontend → invoke('search')
    ↓
commands/apps.rs
    ↓
search::search_applications()
    ↓
    ├─→ Built-in search (apps.rs)
    ├─→ File search (indexer/)
    └─→ Plugin search (plugins/)
           ↓
      Plugin Registry
           ↓
      Active Plugins
           ↓
      Plugin Results → Merged → Sorted → Frontend
```

## 🏗️ Design Principles

1. **Separation of Concerns**: Each module has a single responsibility
2. **Cross-Platform**: Platform-specific code isolated with `#[cfg]`
3. **Testable**: Pure functions in `utils/` are easy to test
4. **Reusable**: Utilities are shared across commands
5. **Documented**: All public functions have doc comments
6. **Extensible**: Plugin system allows third-party extensions
7. **Type-Safe**: Strong typing via `core/` types and traits
8. **Async-First**: Non-blocking operations using Tokio

## 📝 Adding New Features

### Adding a new utility function

1. Choose appropriate module in `utils/` (icon, matching, or path)
2. Add function with doc comment and `pub` visibility
3. Export from `utils/mod.rs` if needed
4. Add tests if applicable

### Adding a new command

1. Add function to appropriate file in `commands/`
2. Mark with `#[tauri::command]` attribute
3. Add to `invoke_handler!` macro in `lib.rs`
4. Export from `commands/mod.rs`

### Adding a new module

1. Create directory with `mod.rs`
2. Add `mod module_name;` to `lib.rs`
3. Define public API in `mod.rs`
4. Document module purpose

### Creating a plugin

1. Read the [Plugin Development Guide](src/plugins/PLUGIN_GUIDE.md)
2. Create new file in `plugins/builtin/`
3. Implement the `Plugin` trait from `core::traits`
4. Register in plugin registry during app setup
5. Write tests and documentation

**Example**:

```rust
use async_trait::async_trait;
use crate::core::traits::Plugin;

pub struct MyPlugin { /* ... */ }

#[async_trait]
impl Plugin for MyPlugin {
    fn id(&self) -> &str { "my-plugin" }
    fn name(&self) -> &str { "My Plugin" }
    fn description(&self) -> &str { "Does cool stuff" }
}
```

## 🧪 Testing

Run tests with:

```bash
cargo test
```

Check compilation:

```bash
cargo check
```

Build release:

```bash
cargo build --release
```

## 🔧 Platform-Specific Code

Use conditional compilation for platform-specific code:

```rust
#[cfg(target_os = "windows")]
fn windows_specific() { }

#[cfg(target_os = "macos")]
fn macos_specific() { }

#[cfg(target_os = "linux")]
fn linux_specific() { }
```

## 📚 Dependencies

Key dependencies:

- `tauri`: Framework for desktop apps (v2)
- `serde` & `serde_json`: Serialization/deserialization
- `tokio`: Async runtime
- `async-trait`: Async traits for plugins
- `whoami`: Get username
- `md5`: Generate app IDs
- `png`: Icon encoding
- `winapi`: Windows API (Windows only)

Development dependencies:

- `cargo-audit`: Security auditing
- `criterion`: Benchmarking
- `proptest`: Property-based testing

## 🎯 Roadmap

### ✅ Completed

- [x] Modular architecture (core, utils, search, window)
- [x] Cross-platform app scanning (Windows, macOS, Linux)
- [x] Plugin system with trait-based extensibility
- [x] Comprehensive error handling with `VoltError`
- [x] File indexing system
- [x] Launch history and statistics

### 🚧 In Progress

- [ ] WASM plugin support for external plugins
- [ ] Plugin marketplace/discovery
- [ ] Advanced search algorithms (AI-powered suggestions)
- [ ] Cloud synchronization (settings, history)

### 📋 Planned

- [ ] Performance profiling and optimization
- [ ] Icon extraction caching layer
- [ ] Plugin sandboxing for security
- [ ] Telemetry and analytics (opt-in)
- [ ] Multi-window support
- [ ] Custom themes and styling API

## 🤝 Contributing

When contributing to the Rust backend:

1. **Follow module structure**: Put code in the right module
2. **Use core types**: Import from `core::` for shared types
3. **Write tests**: Add tests for new functionality
4. **Document code**: Use rustdoc comments (`///`)
5. **Handle errors**: Use `VoltResult` and `VoltError`
6. **Think async**: Use `async`/`await` for I/O operations
7. **Platform awareness**: Use `#[cfg]` for platform-specific code

## 📖 Additional Documentation

- **Plugin Development**: See [PLUGIN_GUIDE.md](src/plugins/PLUGIN_GUIDE.md)
- **API Reference**: Run `cargo doc --open`
- **Examples**: Check `examples/` directory
- **Tests**: See `*/tests/` in each module
