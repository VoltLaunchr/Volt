//! Built-in plugins that ship with Volt
//!
//! These plugins provide core functionality and serve as examples
//! for third-party plugin development.
//!
//! ## Organization
//!
//! Each plugin has its own directory with the following structure:
//! ```
//! plugin_name/
//! ├── mod.rs          - Module declaration and exports
//! ├── plugin.rs       - Main plugin implementation
//! └── ...             - Additional implementation files
//! ```
//!
//! This structure keeps plugins modular and makes it easy to add new ones.

pub mod clipboard_manager;
pub mod game_scanner;
pub mod system_monitor;

// ClipboardManagerPlugin is used in commands/clipboard.rs
#[allow(unused_imports)]
pub use clipboard_manager::ClipboardManagerPlugin;
// GameScannerPlugin is used via game_scanner module in commands/games.rs
#[allow(unused_imports)]
pub use game_scanner::GameScannerPlugin;
pub use system_monitor::SystemMonitorPlugin;

use crate::plugins::api::VoltPluginAPI;
use std::sync::Arc;

/// Get all built-in plugins with API access
///
/// # Arguments
/// * `api` - Shared API instance that plugins will use
///
/// # Returns
/// Vector of boxed plugin instances, all initialized with the API
///
/// # Note
/// ClipboardManagerPlugin is managed separately via clipboard.rs commands
/// and should not be included here to avoid double initialization
pub fn get_builtin_plugins(
    api: Arc<VoltPluginAPI>,
) -> Vec<Box<dyn crate::core::traits::Plugin + Send + Sync>> {
    vec![
        Box::new(SystemMonitorPlugin::new().with_api(api.clone())),
        Box::new(GameScannerPlugin::new().with_api(api.clone())),
        // Add more built-in plugins here as they're developed
        // NOTE: ClipboardManagerPlugin is initialized separately in clipboard.rs
    ]
}

/// Get plugin IDs of all built-in plugins
pub fn get_builtin_plugin_ids() -> Vec<&'static str> {
    vec![
        "system_monitor",
        "game_scanner",
        // Keep this in sync with get_builtin_plugins()
        // NOTE: clipboard_manager is managed separately
    ]
}
