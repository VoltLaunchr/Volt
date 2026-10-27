# Volt Backend Modules Documentation

Complete guide to the Rust backend module system.

## 📚 Table of Contents

1. [Core Module](#core-module)
2. [Plugins Module](#plugins-module)
3. [Utils Module](#utils-module)
4. [Search Module](#search-module)
5. [Window Module](#window-module)
6. [Commands Module](#commands-module)
7. [Hotkey Module](#hotkey-module)
8. [Indexer Module](#indexer-module)
9. [Launcher Module](#launcher-module)

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
      async fn launch(&self) -> VoltResult<()>;
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
      async fn initialize(&mut self) -> VoltResult<()>;
      async fn shutdown(&mut self) -> VoltResult<()>;
  }
  ```

#### Constants (`constants.rs`)

Application version only — `APP_VERSION` (from `Cargo.toml`).

> Frontend search limits live in `src/shared/constants/` (`MAX_RESULTS = 20`, `DEBOUNCE_MS = 150`); scoring tiers in `src-tauri/src/utils/matching.rs` (100 / 90 / 50–89).

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

`VoltError` has `From` implementations for `io::Error`, `serde_json::Error`, `tauri::Error`, `String`, and `&str`, enabling seamless error conversion with the `?` operator.

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
├── api.rs              # VoltPluginAPI - comprehensive plugin API
└── builtin/
    ├── mod.rs          # Plugin registration
    ├── clipboard_manager/  # Clipboard management plugin
    ├── game_scanner/       # Multi-platform game scanner (10 platform files: amazon, battlenet, ea, epic, gog, riot, rockstar, steam, ubisoft, xbox)
    └── system_monitor/     # System monitoring plugin
        ├── mod.rs
        └── plugin.rs
```

### Plugin Registry (`registry.rs`)

Thread-safe plugin management:

```rust
pub struct PluginRegistry {
    plugins: Arc<RwLock<HashMap<String, Box<dyn Plugin>>>>,
}

impl PluginRegistry {
    pub fn register(&self, plugin: Box<dyn Plugin>) -> VoltResult<()>;
    pub fn unregister(&self, plugin_id: &str) -> VoltResult<()>;
    pub fn get(&self, plugin_id: &str) -> VoltResult<()>;
    pub fn list_plugins(&self) -> VoltResult<Vec<String>>;
    pub async fn initialize_all(&self) -> VoltResult<()>;
    pub async fn shutdown_all(&self) -> VoltResult<()>;
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
├── icon.rs       # Icon extraction (Windows/macOS/Linux)
├── matching.rs   # Search algorithms
├── path.rs       # Path utilities
├── win32.rs      # Foreground app name resolution (Windows, Hyprland via hyprctl, Linux X11)
├── x11.rs        # (Linux) X11 connection, active window & WM_CLASS helpers via x11rb
└── shell_apps.rs # (Windows) Shell AppsFolder enumeration for Store/UWP apps, junk app filtering
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
pub fn search_applications_with_frecency(query: &str, apps: Vec<AppInfo>, history: &LaunchHistory) -> Vec<AppInfo>
pub fn calculate_frecency(frequency: u32, last_used: DateTime<Utc>) -> f64
```

Features:

- Fuzzy matching
- Score-based ranking
- Empty query handling
- Sorted results (highest score first)
- Frecency ranking: `frecency_date = max(now, frecency_date) + 1 day` on launch (backfilled, capped) + bounded `ln` search bonus (`MAX_FRECENCY_BOOST = 20`, cf. `search/mod.rs`)
- `search_applications_with_frecency()` combines match score with frecency for personalized ranking

---

## Window Module

**Location**: `src/window/`

Window management commands.

### Available Commands

```rust
#[tauri::command]
pub fn show_window(window: Window) -> VoltResult<()>;

#[tauri::command]
pub fn hide_window(window: Window) -> VoltResult<()>;

#[tauri::command]
pub fn toggle_window(app: AppHandle) -> VoltResult<()>;

#[tauri::command]
pub fn center_window(window: Window) -> VoltResult<()>;
```

---

## Commands Module

**Location**: `src/commands/` — 8 product domains (`ai/` · `auth/` · `content/` · `extensions/` · `files/` · `launcher/` · `shell/` · `system/`), ~40 files, ~230 `#[tauri::command]` (recompter via `rg -o "#\[tauri::command\]" src-tauri/src/commands | wc -l`).

Tauri command handlers exposed to frontend. Legacy flat paths (e.g. `commands::files`, `commands::ai_profile`) are re-exported via `commands/mod.rs` — Tauri command names come from function names, so the IPC API is unchanged.

### Modules

All commands return `VoltResult<T>` at the module boundary (using the `VoltError` discriminated union), mapped to `Result<T, String>` at the `#[tauri::command]` boundary.

- **launcher/** (`apps.rs`, `history.rs`, `search.rs`, `games.rs`, `steam.rs`): application scanning/launching, launch history & frecency (`frecency_date`), batch/streaming search, multi-platform game scan, Steam integration
- **files/** (`index.rs`, `preview.rs`): file indexing (SQLite + Tantivy), watcher, recent files/categories/stats; file preview (`get_file_preview`: text/image/folder/app/binary detection)
- **system/** (`settings.rs`, `clipboard.rs`, `monitor.rs`, `window_management.rs`, `autostart.rs`, `logging.rs`, `notifications.rs`, `web_search.rs`): settings (8+ categories), clipboard, system resources (incl. v2: per-core/network/temps/processes), window snap/maximize/minimize/restore (Windows Win32 + Linux X11/EWMH), autostart, logs, notifications, web search
- **content/** (`notes.rs`, `snippets.rs`, `quicklinks.rs`, `snippet_expansion.rs`): notes (FTS5, trash/restore), snippets CRUD + expansion (JSON import size-capped), quicklinks CRUD with validation
- **shell/** (`execution.rs`, `history.rs`): streaming execution (NFKC blocklist + 9+ patterns, extended redactors, UNC `working_dir` rejected), shell history with frecency (500 entries)
- **ai/** (`profile.rs`, `quick_actions.rs`, `embeddings.rs`, `proxy.rs`, `custom_emojis.rs`): AI profile, quick actions + global hotkeys, embeddings (`prepare`/`is_ready`/`test`), AI proxy, SDXL emoji (Pro-gated)
- **auth/** (`session.rs`, `oauth.rs`, `credentials.rs`, `keyring_store.rs`, `sync.rs`): Supabase auth + deep link (CSRF nonce, JWT `exp`/`iss`/`sub` checks), OAuth (GitHub/Notion), OS-keyring credentials, signed keyring store (HMAC-SHA256), cloud sync
- **extensions/** (`management.rs`, `plugins.rs`): extension registry/install/toggle, permission allowlist, tamper alerts, storage/preferences/secrets/OAuth/AI APIs, plugin lifecycle

---

## Hotkey Module

**Location**: `src/hotkey/`

Global hotkey registration and handling.

### Structure

```
hotkey/
└── mod.rs         # Global shortcut management
```

- Uses `tauri-plugin-global-shortcut`
- Default: Ctrl+Space (configurable in Settings)
- No fallback hotkeys - if default conflicts, user can change in Settings

---

## Indexer Module

**Location**: `src/indexer/`

File system indexing for fast file search.

### Structure

```
indexer/
├── mod.rs             # Module exports
├── scanner.rs         # Background file system scanning
├── search.rs          # File search with scoring
├── search_engine.rs   # Default nucleo search engine and fallback
├── fulltext.rs        # Persistent Tantivy backend (feature-gated)
├── database.rs        # SQLite source of truth and transactional replacement
├── watcher.rs         # notify watcher; syncs SQLite/cache/Tantivy
├── types.rs           # Indexer-specific types
├── file_history.rs    # File access history tracking
└── windows_search.rs  # (Windows) Windows Search Index OLE DB query as supplementary file source
```

- In-memory state: immutable `Arc<Vec<FileInfo>>` snapshot plus a coherent path-to-position lookup
- Background scan via `start_indexing()` with `max_depth=10`, `max_file_size=100MB`
- Extensions filter: empty = all files; specified = only those extensions
- Full scans replace SQLite transactionally only after success; failed scans preserve the previous snapshot
- Default nucleo search, with persistent exact/BM25/prefix/fuzzy Tantivy search under `tantivy-search`
- Tantivy reuse is guarded by a SQLite dirty marker and document-count check
- Hidden files are excluded by default
- `notify` v6 watcher synchronizes SQLite, cache/lookup and Tantivy; stop joins the worker

---

## Launcher Module

**Location**: `src/launcher/`

Cross-platform process launching and history.

### Structure

```
launcher/
├── mod.rs         # Module exports
├── process.rs     # Cross-platform process spawning
├── history.rs     # Launch history tracking
└── types.rs       # Launcher-specific types
```

- Detached process spawning for Windows, macOS, Linux
- Launch history with frequency and recency tracking
- Error handling via VoltResult

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

    async fn initialize(&mut self) -> VoltResult<()> {
        println!("My plugin initialized!");
        Ok(())
    }

    async fn shutdown(&mut self) -> VoltResult<()> {
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

- `tauri` (v2) - Desktop app framework
- `async-trait` - Async trait support
- `serde` / `serde_json` - Serialization
- `tokio` - Async runtime
- `chrono` - Date/time
- `md5` - Hashing
- `notify` (v6) - File system watcher
- `reqwest` - HTTP client
- `nucleo-matcher` - High-performance fuzzy matching
- `tantivy` (optional) - Persistent inverted index for file search
- `image` - Image processing
- `base64` - Base64 encoding/decoding
- `arboard` - Clipboard access
- `tracing` / `tracing-subscriber` / `tracing-appender` - Structured logging with rotating daily log files
- `zip` - Archive handling
- `url` - URL parsing
- `once_cell` - Lazy static initialization
- `png` - Icon encoding
- Platform-specific crates as needed (winapi, etc.)

Development dependencies:

- `tempfile` - Temporary file/directory creation for tests
