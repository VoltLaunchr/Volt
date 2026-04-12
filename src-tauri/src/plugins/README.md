# Volt Plugin System

The Volt plugin system allows extending functionality through Rust-based plugins.

## 🎯 Plugin Types

### Frontend Plugins (TypeScript)

Located in `src/features/plugins/`, these handle UI interactions:

- Calculator
- Web Search
- Timer
- System Commands

### Backend Plugins (Rust)

Located in `src-tauri/src/plugins/`, these provide system-level capabilities:

- System monitoring
- Custom file scanners
- Cloud integrations
- AI-powered features

## 📦 Creating a Plugin

### 1. Implement the Plugin Trait

```rust
use crate::core::traits::Plugin;
use async_trait::async_trait;

pub struct MyPlugin {
    enabled: bool,
    config: PluginConfig,
}

#[async_trait]
impl Plugin for MyPlugin {
    fn id(&self) -> &str {
        "my_plugin"
    }

    fn name(&self) -> &str {
        "My Plugin"
    }

    fn description(&self) -> &str {
        "Description of what my plugin does"
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    async fn initialize(&mut self) -> Result<(), String> {
        // Setup code
        println!("Plugin initialized");
        Ok(())
    }

    async fn shutdown(&mut self) -> Result<(), String> {
        // Cleanup code
        println!("Plugin shut down");
        Ok(())
    }
}
```

### 2. Register Your Plugin

Add to `builtin/mod.rs`:

```rust
pub mod my_plugin;

pub fn get_builtin_plugins() -> Vec<Box<dyn Plugin>> {
    vec![
        Box::new(SystemMonitorPlugin::new()),
        Box::new(MyPlugin::new()),  // Add here
    ]
}
```

### 3. Use the Plugin Registry

```rust
use crate::plugins::PluginRegistry;

fn setup_plugins() {
    let registry = PluginRegistry::new();

    // Register plugin
    let plugin = Box::new(MyPlugin::new());
    registry.register(plugin).unwrap();

    // Initialize all
    registry.initialize_all().await.unwrap();
}
```

## 🔌 Plugin Lifecycle

1. **Creation**: Plugin instance created
2. **Registration**: Added to registry
3. **Initialization**: `initialize()` called
4. **Active**: Plugin running and available
5. **Shutdown**: `shutdown()` called on app exit

## 🛠️ Built-in Plugins

### System Monitor

- **ID**: `system_monitor`
- **Purpose**: Monitor CPU, RAM, disk usage
- **File**: `builtin/system_monitor.rs`

## 🚀 Future Enhancements

### Dynamic Plugin Loading

```rust
use crate::plugins::PluginLoader;

// Load from file
let plugin = PluginLoader::load_from_path("plugins/my_plugin.dll")?;
registry.register(plugin)?;

// Load all from directory
let plugins = PluginLoader::load_from_directory("plugins/")?;
for plugin in plugins {
    registry.register(plugin)?;
}
```

### Plugin Metadata

```rust
pub struct PluginMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub min_volt_version: String,
}
```

### Plugin Communication

Plugins could communicate via events:

```rust
pub trait Plugin {
    // ...existing methods...

    async fn on_event(&self, event: PluginEvent) -> Result<(), String> {
        Ok(())
    }
}
```

## 📝 Best Practices

1. **Error Handling**: Always return `Result` with descriptive errors
2. **Thread Safety**: Use `Arc<RwLock<>>` for shared state
3. **Async Operations**: Use `async_trait` for async methods
4. **Logging**: Use `println!` or proper logging crate
5. **Configuration**: Store config in plugin struct
6. **Resource Cleanup**: Implement proper `shutdown()`

## 🧪 Testing Plugins

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_plugin_lifecycle() {
        let mut plugin = MyPlugin::new();

        assert_eq!(plugin.id(), "my_plugin");
        assert!(plugin.is_enabled());

        // Test initialization
        plugin.initialize().await.unwrap();

        // Test shutdown
        plugin.shutdown().await.unwrap();
    }
}
```

## 📚 Resources

- [Plugin Trait Definition](../core/traits.rs)
- [Plugin Registry](registry.rs)
- [Example Plugin](builtin/system_monitor.rs)
- [Architecture Documentation](../ARCHITECTURE.md)
