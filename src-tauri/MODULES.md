# Volt Backend Modules Documentation

Complete guide to the Rust backend module system.

## 📚 Table of Contents

1. [Core Module](#core-module)
2. [Plugins Module](#plugins-module)
3. [Utils Module](#utils-module)
4. [Search Module](#search-module)
5. [Window Module](#window-module)
6. [Commands Module](#commands-module)

---

## Core Module

**Location**: `src/core/`

The foundation module providing shared types, traits, constants, and error handling.

### Structure

```
core/
├── mod.rs         # Module exports
├── types.rs       # Core type definitions
├── traits.rs      # Core traits
├── constants.rs   # Application constants
└── error.rs       # Error types
```

### Key Components

#### Types (`types.rs`)

- **AppCategory**: Application categorization

  ```rust
  pub enum AppCategory {
      Development, Productivity, Media, Gaming,
      System, Internet, Graphics, Office, Utilities, Other
  }
  ```

- **SearchResultType**: Type of search results

  ```rust
  pub enum SearchResultType {
      Application, File, Folder, Plugin, Command,
      Calculator, WebSearch, SystemCommand, Timer
  }
  ```

- **Platform**: OS detection

  ```rust
  pub enum Platform {
      Windows, MacOS, Linux
  }
  ```

- **LaunchMode**: How to launch applications
  ```rust
  pub enum LaunchMode {
      Normal, Elevated, Minimized, Maximized
  }
  ```

#### Traits (`traits.rs`)

- **Searchable**: For searchable objects

  ```rust
  pub trait Searchable {
      fn search_text(&self) -> String;
      fn search_keywords(&self) -> Vec<String>;
      fn match_score(&self, query: &str) -> f32;
  }
  ```

- **Launchable**: For executable items

  ```rust
  #[async_trait]
  pub trait Launchable {
      async fn launch(&self) -> Result<(), String>;
      fn can_launch(&self) -> bool;
      fn launch_preview(&self) -> Option<String>;
  }
  ```

- **Plugin**: Plugin interface
  ```rust
  #[async_trait]
  pub trait Plugin: Send + Sync {
      fn id(&self) -> &str;
      fn name(&self) -> &str;
      fn description(&self) -> &str;
      fn is_enabled(&self) -> bool;
      async fn initialize(&mut self) -> Result<(), String>;
      async fn shutdown(&mut self) -> Result<(), String>;
  }
  ```

#### Constants (`constants.rs`)

Key application constants:

- `APP_NAME`, `APP_VERSION`
- `DEFAULT_WINDOW_WIDTH`, `DEFAULT_WINDOW_HEIGHT`
- `MAX_SEARCH_RESULTS = 10`
- `SEARCH_DEBOUNCE_MS = 150`
- Score weights for search ranking

#### Error Handling (`error.rs`)

```rust
pub enum VoltError {
    FileSystem(String),
    NotFound(String),
    PermissionDenied(String),
    InvalidConfig(String),
    Plugin(String),
    Search(String),
    Launch(String),
    Serialization(String),
    Unknown(String),
}

pub type VoltResult<T> = Result<T, VoltError>;
```

---

## Plugins Module

**Location**: `src/plugins/`

Extensible plugin system for adding backend functionality.

### Structure

```
plugins/
├── mod.rs              # Module exports
├── registry.rs         # Plugin registry
├── loader.rs           # Dynamic plugin loading
└── builtin/
    ├── mod.rs          # Built-in plugins
    └── system_monitor.rs
```

### Plugin Registry (`registry.rs`)

Thread-safe plugin management:

```rust
pub struct PluginRegistry {
    plugins: Arc<RwLock<HashMap<String, Box<dyn Plugin>>>>,
}

impl PluginRegistry {
    pub fn register(&self, plugin: Box<dyn Plugin>) -> Result<(), String>;
    pub fn unregister(&self, plugin_id: &str) -> Result<(), String>;
    pub fn get(&self, plugin_id: &str) -> Result<(), String>;
    pub fn list_plugins(&self) -> Result<Vec<String>, String>;
    pub async fn initialize_all(&self) -> Result<(), String>;
    pub async fn shutdown_all(&self) -> Result<(), String>;
}
```

### Built-in Plugins

#### System Monitor Plugin

Example plugin implementation:

```rust
pub struct SystemMonitorPlugin {
    enabled: bool,
}

impl Plugin for SystemMonitorPlugin {
    fn id(&self) -> &str { "system_monitor" }
    fn name(&self) -> &str { "System Monitor" }
    // ... other trait methods
}
```

### Plugin Loader (`loader.rs`)

Future support for dynamic plugin loading:

```rust
pub struct PluginLoader;

impl PluginLoader {
    pub fn load_from_path(path: &Path) -> Result<Box<dyn Plugin>, String>;
    pub fn load_from_directory(dir: &Path) -> Result<Vec<Box<dyn Plugin>>, String>;
}
```

---

## Utils Module

**Location**: `src/utils/`

Reusable utility functions.

### Structure

```
utils/
├── mod.rs        # Module exports
├── icon.rs       # Icon extraction
├── matching.rs   # Search algorithms
└── path.rs       # Path utilities
```

### Icon Utilities (`icon.rs`)

Windows icon extraction:

- `extract_icon(path: &str) -> Option<String>`
- `hicon_to_png_base64()` - Convert Windows icons to PNG
- `base64_encode()` - Base64 encoding
- `resolve_linux_icon()` - Linux icon resolution

### Matching Utilities (`matching.rs`)

Search and matching algorithms:

- `fuzzy_match(text: &str, pattern: &str) -> bool`
- `calculate_match_score(text: &str, query: &str) -> f32`

Score calculation:

- 100: Exact match
- 90: Starts with query
- 80: Contains query (position-weighted)
- 50: Fuzzy match
- 0: No match

### Path Utilities (`path.rs`)

File system helpers:

- `get_all_drives() -> Vec<char>` (Windows)
- `find_main_executable(dir: &PathBuf) -> Option<PathBuf>`
- `find_exe_in_directory(dir: &PathBuf) -> Option<PathBuf>`
- `is_executable(path: &Path) -> bool` (Linux)

---

## Search Module

**Location**: `src/search/`

Application search and ranking.

```rust
pub fn search_applications(query: &str, apps: Vec<AppInfo>) -> Vec<AppInfo>
```

Features:

- Fuzzy matching
- Score-based ranking
- Empty query handling
- Sorted results (highest score first)

---

## Window Module

**Location**: `src/window/`

Window management commands.

### Available Commands

```rust
#[tauri::command]
pub fn show_window(window: Window) -> Result<(), String>;

#[tauri::command]
pub fn hide_window(window: Window) -> Result<(), String>;

#[tauri::command]
pub fn toggle_window(app: AppHandle) -> Result<(), String>;

#[tauri::command]
pub fn center_window(window: Window) -> Result<(), String>;
```

---

## Commands Module

**Location**: `src/commands/`

Tauri command handlers exposed to frontend.

### Modules

- **apps.rs**: Application scanning and launching
- **autostart.rs**: Autostart management
- **files.rs**: File indexing
- **launcher.rs**: Launch history tracking
- **settings.rs**: Settings management

---

## Usage Examples

### Using Core Types

```rust
use crate::core::{AppCategory, Platform, VoltResult};

fn example() -> VoltResult<()> {
    let category = AppCategory::from_str("gaming");
    let platform = Platform::current();

    if platform.is_current() {
        println!("Running on {}", platform.as_str());
    }

    Ok(())
}
```

### Implementing a Plugin

```rust
use crate::core::traits::Plugin;
use async_trait::async_trait;

pub struct MyPlugin {
    enabled: bool,
}

#[async_trait]
impl Plugin for MyPlugin {
    fn id(&self) -> &str {
        "my_plugin"
    }

    fn name(&self) -> &str {
        "My Awesome Plugin"
    }

    fn description(&self) -> &str {
        "Does awesome things"
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    async fn initialize(&mut self) -> Result<(), String> {
        println!("My plugin initialized!");
        Ok(())
    }

    async fn shutdown(&mut self) -> Result<(), String> {
        println!("My plugin shutting down...");
        Ok(())
    }
}
```

### Using Utils

```rust
use crate::utils::{fuzzy_match, calculate_match_score, extract_icon};

fn search_example() {
    let text = "Visual Studio Code";
    let query = "vsc";

    if fuzzy_match(&text.to_lowercase(), &query.to_lowercase()) {
        let score = calculate_match_score(text, query);
        println!("Match score: {}", score);
    }
}

fn icon_example() {
    if let Some(icon_data) = extract_icon(r"C:\Path\To\App.exe") {
        println!("Icon extracted: {} bytes", icon_data.len());
    }
}
```

---

## Testing

Run module tests:

```bash
cargo test --lib
```

Run specific module tests:

```bash
cargo test --lib core::
cargo test --lib utils::matching
cargo test --lib plugins::registry
```

---

## Adding New Modules

1. Create directory in `src/`
2. Add `mod.rs` with exports
3. Implement functionality
4. Add to `src/lib.rs`
5. Document in this file
6. Write tests

---

## Dependencies

- `async-trait` - Async trait support
- `serde` - Serialization
- `chrono` - Date/time
- `md5` - Hashing
- Platform-specific crates as needed
