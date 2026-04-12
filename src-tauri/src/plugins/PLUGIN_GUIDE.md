# Volt Plugin Development Guide

Welcome to the Volt Plugin Development Guide! This document will help you create custom plugins to extend Volt's functionality with our new scalable architecture.

## 📚 Table of Contents

1. [Overview](#overview)
2. [Plugin Architecture](#plugin-architecture)
3. [Creating Your First Plugin](#creating-your-first-plugin)
4. [Using the Plugin API](#using-the-plugin-api)
5. [Example Plugins](#example-plugins)
6. [Best Practices](#best-practices)
7. [Publishing Plugins](#publishing-plugins)

## 🎯 Overview

Volt supports two types of plugins:

### Frontend Plugins (TypeScript)

- **Location**: `src/features/plugins/builtin/`
- **Purpose**: UI interactions, calculations, web searches, timers
- **Language**: TypeScript/React
- **Examples**: Calculator, WebSearch, Timer

### Backend Plugins (Rust)

- **Location**: `src-tauri/src/plugins/builtin/`
- **Purpose**: System integrations, file operations, native features
- **Language**: Rust
- **Examples**: Steam Scanner, System Monitor, Cloud Storage

## 🏗️ Plugin Architecture

### New Scalable Structure

Each plugin now has its own directory for better organization:

```
src-tauri/src/plugins/
├── api.rs              # VoltPluginAPI - comprehensive API for plugins
├── registry.rs         # Plugin registry and management
├── loader.rs           # Dynamic plugin loading
├── mod.rs              # Module exports
└── builtin/            # Built-in plugins
    ├── mod.rs          # Plugin registration
    ├── system_monitor/ # Example plugin 1
    │   ├── mod.rs      # Module declaration
    │   └── plugin.rs   # Implementation
    └── steam_scanner/  # Example plugin 2
        ├── mod.rs      # Module declaration
        ├── plugin.rs   # Plugin implementation
        └── scanner.rs  # Additional logic
```

### Core Components

```
src-tauri/src/
├── core/              # Core types and traits
│   ├── types.rs       # AppInfo, SearchResult, etc.
│   ├── traits.rs      # Plugin trait definition
│   ├── error.rs       # Error handling
│   └── constants.rs   # App constants
│
├── plugins/           # Plugin system
│   ├── api.rs         # VoltPluginAPI (NEW!)
│   ├── registry.rs    # Plugin registry
│   ├── loader.rs      # Dynamic loading
│   └── builtin/       # Built-in plugins (organized)
│
└── lib.rs             # Main entry point
```

### Plugin Lifecycle

```
Registration → Initialization → Active → Shutdown
      ↓              ↓            ↓         ↓
   register()   initialize()   API calls  shutdown()
                     ↓
                VoltPluginAPI
```

## 🚀 Creating Your First Plugin

### Step 1: Create Plugin Directory Structure

Each plugin gets its own directory:

```bash
mkdir src-tauri/src/plugins/builtin/my_plugin
cd src-tauri/src/plugins/builtin/my_plugin
touch mod.rs plugin.rs
```

**Directory structure:**

```
my_plugin/
├── mod.rs          - Module declaration and exports
├── plugin.rs       - Main plugin implementation
└── helper.rs       - Additional logic (optional)
```

### Step 2: Create Module Declaration

In `my_plugin/mod.rs`:

```rust
/// My Plugin - Does something awesome
pub mod plugin;

pub use plugin::MyPlugin;
```

### Step 3: Implement the Plugin

In `my_plugin/plugin.rs`:

```rust
use crate::core::traits::Plugin;
use crate::plugins::api::{VoltPluginAPI, LogLevel};
use async_trait::async_trait;
use std::sync::Arc;

/// My awesome plugin
pub struct MyPlugin {
    enabled: bool,
    api: Option<Arc<VoltPluginAPI>>,
    config: MyPluginConfig,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct MyPluginConfig {
    api_key: Option<String>,
    setting1: bool,
}

impl Default for MyPluginConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            setting1: true,
        }
    }
}

impl MyPlugin {
    pub fn new() -> Self {
        Self {
            enabled: true,
            api: None,
            config: MyPluginConfig::default(),
        }
    }

    /// Set the plugin API (called during registration)
    pub fn with_api(mut self, api: Arc<VoltPluginAPI>) -> Self {
        self.api = Some(api);
        self
    }

    /// Load configuration from disk
    async fn load_config(&mut self) -> Result<(), String> {
        if let Some(api) = &self.api {
            match api.load_config(self.id(), "settings") {
                Ok(config_value) => {
                    self.config = serde_json::from_value(config_value)
                        .unwrap_or_default();
                    api.log(self.id(), LogLevel::Info, "Config loaded");
                }
                Err(_) => {
                    api.log(self.id(), LogLevel::Warn, "No config, using defaults");
                }
            }
        }
        Ok(())
    }
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
        "Does something amazing"
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    async fn initialize(&mut self) -> Result<(), String> {
        if let Some(api) = &self.api {
            api.log(self.id(), LogLevel::Info, "Initializing...");

            // Create directories
            api.get_plugin_data_dir(self.id())?;
            api.get_plugin_cache_dir(self.id())?;

            // Load config
            self.load_config().await?;

            api.log(self.id(), LogLevel::Info, "Initialized successfully");
        }

        Ok(())
    }

    async fn shutdown(&mut self) -> Result<(), String> {
        if let Some(api) = &self.api {
            api.log(self.id(), LogLevel::Info, "Shutting down");

            // Save config
            let config_value = serde_json::to_value(&self.config)
                .map_err(|e| e.to_string())?;
            api.save_config(self.id(), "settings", &config_value)?;
        }

        Ok(())
    }
}
```

### Step 4: Register in builtin/mod.rs

Add your plugin to `src-tauri/src/plugins/builtin/mod.rs`:

```rust
pub mod my_plugin;
pub use my_plugin::MyPlugin;

pub fn get_builtin_plugins(
    api: Arc<VoltPluginAPI>,
) -> Vec<Box<dyn Plugin>> {
    vec![
        Box::new(MyPlugin::new().with_api(api.clone())),
        // ... other plugins
    ]
}
```

## 🔌 Using the Plugin API

The `VoltPluginAPI` provides comprehensive functionality:

### File System Access

```rust
// Get plugin-specific directories
let data_dir = api.get_plugin_data_dir(self.id())?;
let cache_dir = api.get_plugin_cache_dir(self.id())?;
let config_dir = api.get_plugin_config_dir(self.id())?;
```

### Configuration Management

```rust
// Load configuration
let config = api.load_config(self.id(), "settings")?;

// Save configuration
api.save_config(self.id(), "settings", &config_value)?;
```

### Caching

```rust
// Write to cache
let data = b"some data";
api.write_cache(self.id(), "cache_key", data)?;

// Read from cache
let cached = api.read_cache(self.id(), "cache_key")?;

// Clear all cache
api.clear_cache(self.id())?;
```

### Logging

```rust
use crate::plugins::api::LogLevel;

api.log(self.id(), LogLevel::Info, "Information message");
api.log(self.id(), LogLevel::Warn, "Warning message");
api.log(self.id(), LogLevel::Error, "Error message");
api.log(self.id(), LogLevel::Debug, "Debug message");
```

### Application Information

```rust
// Get Volt version
let version = api.get_volt_version();

// Get app data directory
let app_dir = api.get_app_data_dir()?;
```

## 💡 Example Plugins

### Example 1: System Monitor Plugin

Located at `builtin/system_monitor/`, this plugin demonstrates:

- Configuration loading and saving
- Using the API for logging
- Periodic background tasks (placeholder)
- Default configuration patterns

See [system_monitor/plugin.rs](builtin/system_monitor/plugin.rs) for implementation.

### Example 2: Steam Scanner Plugin

Located at `builtin/steam_scanner/`, this plugin demonstrates:

- Multi-file plugin structure (mod.rs, plugin.rs, scanner.rs)
- Platform-specific code with `#[cfg]`
- Caching scanned data
- Complex initialization logic
- External library integration (regex, dirs)

See [steam_scanner/](builtin/steam_scanner/) for full implementation.

**Key features:**

```rust
// Multi-file structure
steam_scanner/
├── mod.rs      // Exports
├── plugin.rs   // Plugin trait implementation
└── scanner.rs  // Steam scanning logic

// Platform-specific paths
#[cfg(target_os = "windows")]
fn find_steam() -> Option<PathBuf> {
    Some(PathBuf::from(r"C:\Program Files (x86)\Steam"))
}

#[cfg(target_os = "linux")]
fn find_steam() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".steam/steam"))
}

// Caching results
async fn save_cache(&self) -> Result<(), String> {
    let data = serde_json::to_vec(&self.games)?;
    self.api.write_cache(self.id(), "games.json", &data)?;
    Ok(())
}
```

## ✅ Best Practices

### 1. Directory Structure

**Always use a directory per plugin:**

```
my_plugin/
├── mod.rs          # Module declaration
├── plugin.rs       # Plugin trait implementation
├── logic.rs        # Business logic
└── types.rs        # Plugin-specific types
```

### 2. API Initialization

**Always set API before initialization:**

```rust
impl MyPlugin {
    pub fn with_api(mut self, api: Arc<VoltPluginAPI>) -> Self {
        self.api = Some(api);
        self
    }
}

// Usage in builtin/mod.rs
Box::new(MyPlugin::new().with_api(api.clone()))
```

### 3. Configuration

**Use serde for config with defaults:**

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct MyConfig {
    enabled: bool,
    #[serde(default = "default_timeout")]
    timeout: u64,
}

fn default_timeout() -> u64 { 30 }

impl Default for MyConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            timeout: default_timeout(),
        }
    }
}
```

### 4. Error Handling

**Always use Result and proper error messages:**

```rust
async fn initialize(&mut self) -> Result<(), String> {
    if let Some(api) = &self.api {
        api.get_plugin_data_dir(self.id())
            .map_err(|e| format!("Failed to create data dir: {}", e))?;
    }
    Ok(())
}
```

### 5. Logging

**Log important events:**

```rust
api.log(self.id(), LogLevel::Info, "Starting operation");
// ... do work ...
api.log(self.id(), LogLevel::Info, "Operation completed");
```

### 6. Resource Cleanup

**Always implement shutdown:**

```rust
async fn shutdown(&mut self) -> Result<(), String> {
    // Save state
    self.save_config().await?;

    // Close connections
    if let Some(conn) = &self.connection {
        conn.close().await?;
    }

    // Clear temp data
    self.cache.clear();

    Ok(())
}
```

### 7. Thread Safety

**Plugins must be Send + Sync:**

```rust
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct MyPlugin {
    data: Arc<RwLock<HashMap<String, String>>>,
}
```

### 8. Testing

**Write tests for your plugin:**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_creation() {
        let plugin = MyPlugin::new();
        assert_eq!(plugin.id(), "my_plugin");
        assert!(plugin.is_enabled());
    }

    #[tokio::test]
    async fn test_initialization() {
        let mut plugin = MyPlugin::new();
        assert!(plugin.initialize().await.is_ok());
    }
}
```

## 📦 Publishing Plugins

### Plugin Metadata

Create a `plugin.toml`:

```toml
[plugin]
id = "my-plugin"
name = "My Awesome Plugin"
version = "1.0.0"
author = "Your Name <your@email.com>"
description = "Does something amazing"
license = "MIT"

[dependencies]
volt = "0.2.0"

[build]
required_features = ["network", "filesystem"]
```

### Testing Checklist

- [ ] Plugin follows new directory structure
- [ ] Uses VoltPluginAPI for all interactions
- [ ] Has proper error handling
- [ ] Includes unit tests
- [ ] Documentation is complete
- [ ] No hardcoded paths
- [ ] Platform-specific code uses `#[cfg]`
- [ ] Implements proper shutdown

### Documentation

**Use rustdoc comments:**

````rust
/// My Awesome Plugin
///
/// This plugin provides amazing functionality.
///
/// # Examples
///
/// ```no_run
/// let plugin = MyPlugin::new();
/// plugin.with_api(api).initialize().await?;
/// ```
///
/// # Configuration
///
/// Configure via `config/plugins/my-plugin/settings.json`:
/// ```json
/// {
///   "enabled": true,
///   "api_key": "your-key"
/// }
/// ```
pub struct MyPlugin {
    // ...
}
````

## 🔐 Security

1. **Validate inputs**: Never trust external data
2. **Use VoltPluginAPI**: Don't access filesystem directly
3. **Encrypt secrets**: Use proper encryption for API keys
4. **Limit network access**: Only connect to trusted servers
5. **Audit dependencies**: Run `cargo audit` regularly

## 🆘 Getting Help

- **Documentation**: Read [ARCHITECTURE.md](../ARCHITECTURE.md)
- **Examples**: Check `builtin/system_monitor` and `builtin/steam_scanner`
- **Issues**: Report bugs on GitHub
- **Community**: Join our Discord

## 📝 License

This guide is part of Volt, licensed under MIT.

Happy plugin development! 🚀
