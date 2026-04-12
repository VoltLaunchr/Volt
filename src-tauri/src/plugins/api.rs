/// Plugin API for interacting with Volt's core functionality
///
/// This module provides a comprehensive API that plugins can use to interact
/// with Volt's features, including search, window management, settings, and more.
// Note: These types are used in doc comments and future functionality
// They are defined in commands/apps.rs and indexer/mod.rs
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tracing::{debug, error, info, warn};

/// Main API interface provided to plugins
///
/// This struct gives plugins access to Volt's core functionality in a safe,
/// controlled manner. Each plugin receives a reference to this API during
/// initialization.
#[derive(Clone)]
pub struct VoltPluginAPI {
    /// Internal state shared across all plugins
    state: Arc<RwLock<PluginAPIState>>,
}

/// Internal state for the plugin API
struct PluginAPIState {
    /// Application data directory
    app_data_dir: PathBuf,
    /// Cache directory for plugins
    cache_dir: PathBuf,
    /// Configuration directory
    config_dir: PathBuf,
}

impl VoltPluginAPI {
    /// Create a new plugin API instance
    pub fn new(app_data_dir: PathBuf) -> Self {
        let cache_dir = app_data_dir.join("cache");
        let config_dir = app_data_dir.join("config");

        Self {
            state: Arc::new(RwLock::new(PluginAPIState {
                app_data_dir,
                cache_dir,
                config_dir,
            })),
        }
    }

    /// Validate plugin_id to prevent path traversal attacks
    ///
    /// # Arguments
    /// * `plugin_id` - The plugin identifier to validate
    ///
    /// # Returns
    /// Ok(()) if valid, Err with message if invalid
    fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
        // Check if empty
        if plugin_id.is_empty() {
            return Err("Plugin ID cannot be empty".to_string());
        }

        // Check length (max 64 characters)
        if plugin_id.len() > 64 {
            return Err("Plugin ID too long (max 64 characters)".to_string());
        }

        // Check for path traversal components
        if plugin_id == "." || plugin_id == ".." {
            return Err("Plugin ID cannot be '.' or '..'".to_string());
        }

        // Check for path separators
        if plugin_id.contains('/') || plugin_id.contains('\\') {
            return Err("Plugin ID cannot contain path separators".to_string());
        }

        // Whitelist validation: only ASCII alphanumerics, hyphen, and underscore
        if !plugin_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(
                "Plugin ID can only contain letters, numbers, hyphens, and underscores".to_string(),
            );
        }

        Ok(())
    }

    /// Validate cache_key to prevent path traversal attacks
    ///
    /// # Arguments
    /// * `cache_key` - The cache key to validate
    ///
    /// # Returns
    /// Ok(()) if valid, Err with message if invalid
    fn validate_cache_key(cache_key: &str) -> Result<(), String> {
        // Check if empty
        if cache_key.is_empty() {
            return Err("Cache key cannot be empty".to_string());
        }

        // Check length (max 255 characters for filesystem compatibility)
        if cache_key.len() > 255 {
            return Err("Cache key too long (max 255 characters)".to_string());
        }

        // Reject absolute paths (check for drive letters on Windows or leading slash on Unix)
        if cache_key.contains(':') || cache_key.starts_with('/') || cache_key.starts_with('\\') {
            return Err("Cache key cannot be an absolute path".to_string());
        }

        // Check for path traversal components
        if cache_key == "."
            || cache_key == ".."
            || cache_key.contains("/.")
            || cache_key.contains("\\.")
        {
            return Err("Cache key cannot contain path traversal components".to_string());
        }

        // Check for path separators (only allow single filename)
        if cache_key.contains('/') || cache_key.contains('\\') {
            return Err("Cache key cannot contain path separators".to_string());
        }

        Ok(())
    }

    /// Validate config_name to prevent path traversal attacks
    ///
    /// # Arguments
    /// * `config_name` - The configuration name to validate
    ///
    /// # Returns
    /// Ok(()) if valid, Err with message if invalid
    fn validate_config_name(config_name: &str) -> Result<(), String> {
        // Check if empty
        if config_name.is_empty() {
            return Err("Config name cannot be empty".to_string());
        }

        // Check length (max 255 characters for filesystem compatibility)
        if config_name.len() > 255 {
            return Err("Config name too long (max 255 characters)".to_string());
        }

        // Reject absolute paths (check for drive letters on Windows or leading slash on Unix)
        if config_name.contains(':')
            || config_name.starts_with('/')
            || config_name.starts_with('\\')
        {
            return Err("Config name cannot be an absolute path".to_string());
        }

        // Check for path traversal components
        if config_name == "."
            || config_name == ".."
            || config_name.contains("/.")
            || config_name.contains("\\.")
        {
            return Err("Config name cannot contain path traversal components".to_string());
        }

        // Check for path separators (only allow single filename)
        if config_name.contains('/') || config_name.contains('\\') {
            return Err("Config name cannot contain path separators".to_string());
        }

        // Whitelist validation: only ASCII alphanumerics, hyphen, underscore, and dot
        // Dots are allowed for names like "config.backup" but not at start/end
        if config_name.starts_with('.') || config_name.ends_with('.') {
            return Err("Config name cannot start or end with a dot".to_string());
        }

        if !config_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        {
            return Err(
                "Config name can only contain letters, numbers, hyphens, underscores, and dots"
                    .to_string(),
            );
        }

        Ok(())
    }

    // ========== File System Access ==========

    /// Get the plugin's data directory
    ///
    /// Each plugin gets its own isolated directory for storing data.
    /// The directory is created if it doesn't exist.
    ///
    /// # Arguments
    /// * `plugin_id` - Unique identifier of the plugin
    ///
    /// # Returns
    /// Path to the plugin's data directory
    pub fn get_plugin_data_dir(&self, plugin_id: &str) -> Result<PathBuf, String> {
        // Validate plugin_id to prevent path traversal
        Self::validate_plugin_id(plugin_id)?;

        let state = self
            .state
            .read()
            .map_err(|e| format!("Failed to acquire read lock: {}", e))?;

        let plugin_dir = state.app_data_dir.join("plugins").join(plugin_id);

        if !plugin_dir.exists() {
            std::fs::create_dir_all(&plugin_dir)
                .map_err(|e| format!("Failed to create plugin directory: {}", e))?;
        }

        Ok(plugin_dir)
    }

    /// Get the plugin's cache directory
    ///
    /// Use this for temporary data that can be regenerated.
    ///
    /// # Arguments
    /// * `plugin_id` - Unique identifier of the plugin
    pub fn get_plugin_cache_dir(&self, plugin_id: &str) -> Result<PathBuf, String> {
        // Validate plugin_id to prevent path traversal
        Self::validate_plugin_id(plugin_id)?;

        let state = self
            .state
            .read()
            .map_err(|e| format!("Failed to acquire read lock: {}", e))?;

        let cache_dir = state.cache_dir.join("plugins").join(plugin_id);

        if !cache_dir.exists() {
            std::fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("Failed to create cache directory: {}", e))?;
        }

        Ok(cache_dir)
    }

    /// Get the plugin's configuration directory
    ///
    /// Use this for configuration files.
    ///
    /// # Arguments
    /// * `plugin_id` - Unique identifier of the plugin
    pub fn get_plugin_config_dir(&self, plugin_id: &str) -> Result<PathBuf, String> {
        // Validate plugin_id to prevent path traversal
        Self::validate_plugin_id(plugin_id)?;

        let state = self
            .state
            .read()
            .map_err(|e| format!("Failed to acquire read lock: {}", e))?;

        let config_dir = state.config_dir.join("plugins").join(plugin_id);

        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        Ok(config_dir)
    }

    // ========== Search Integration ==========

    /// Add search results from a plugin
    ///
    /// Plugins can contribute their own search results that will be merged
    /// with Volt's built-in search results.
    ///
    /// # Arguments
    /// * `results` - Vector of search results to add
    ///
    /// # Example
    /// ```no_run
    /// use serde_json::json;
    /// let results = vec![
    ///     json!({"type": "app", "name": "MyApp", "path": "/path/to/app"}),
    /// ];
    /// api.add_search_results(results)?;
    /// ```
    pub fn add_search_results(&self, _results: Vec<serde_json::Value>) -> Result<(), String> {
        // TODO: Implement search result aggregation
        // This would integrate with the main search system
        Ok(())
    }

    // ========== Configuration Management ==========

    /// Load plugin configuration from JSON file
    ///
    /// # Arguments
    /// * `plugin_id` - Unique identifier of the plugin
    /// * `config_name` - Name of the configuration file (without .json extension)
    ///
    /// # Returns
    /// Deserialized configuration as serde_json::Value
    pub fn load_config(
        &self,
        plugin_id: &str,
        config_name: &str,
    ) -> Result<serde_json::Value, String> {
        // Validate config_name to prevent path traversal
        Self::validate_config_name(config_name)?;

        let config_dir = self.get_plugin_config_dir(plugin_id)?;
        let config_path = config_dir.join(format!("{}.json", config_name));

        if !config_path.exists() {
            return Ok(serde_json::json!({}));
        }

        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;

        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))
    }

    /// Save plugin configuration to JSON file
    ///
    /// # Arguments
    /// * `plugin_id` - Unique identifier of the plugin
    /// * `config_name` - Name of the configuration file (without .json extension)
    /// * `config` - Configuration data to save
    pub fn save_config(
        &self,
        plugin_id: &str,
        config_name: &str,
        config: &serde_json::Value,
    ) -> Result<(), String> {
        // Validate config_name to prevent path traversal
        Self::validate_config_name(config_name)?;

        let config_dir = self.get_plugin_config_dir(plugin_id)?;
        let config_path = config_dir.join(format!("{}.json", config_name));

        let content = serde_json::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        std::fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write config: {}", e))?;

        Ok(())
    }

    // ========== Logging ==========

    /// Log a message from a plugin
    ///
    /// # Arguments
    /// * `plugin_id` - Unique identifier of the plugin
    /// * `level` - Log level (info, warn, error)
    /// * `message` - Message to log
    pub fn log(&self, plugin_id: &str, level: LogLevel, message: &str) {
        match level {
            LogLevel::Info => info!("[{}] {}", plugin_id, message),
            LogLevel::Warn => warn!("[{}] {}", plugin_id, message),
            LogLevel::Error => error!("[{}] {}", plugin_id, message),
            LogLevel::Debug => debug!("[{}] {}", plugin_id, message),
        }
    }

    // ========== Cache Management ==========

    /// Read data from cache
    ///
    /// # Arguments
    /// * `plugin_id` - Unique identifier of the plugin
    /// * `cache_key` - Key to identify the cached data
    pub fn read_cache(&self, plugin_id: &str, cache_key: &str) -> Result<Vec<u8>, String> {
        // Validate cache_key to prevent path traversal
        Self::validate_cache_key(cache_key)?;

        let cache_dir = self.get_plugin_cache_dir(plugin_id)?;
        let cache_path = cache_dir.join(cache_key);

        // Additional safety check: canonicalize and verify path is within cache_dir
        if let Ok(canonical_cache_path) = cache_path.canonicalize()
            && let Ok(canonical_cache_dir) = cache_dir.canonicalize()
            && !canonical_cache_path.starts_with(&canonical_cache_dir)
        {
            return Err("Cache path is outside plugin cache directory".to_string());
        } else if !cache_path.exists() {
            return Err("Cache entry not found".to_string());
        }

        std::fs::read(&cache_path).map_err(|e| format!("Failed to read cache: {}", e))
    }

    /// Write data to cache
    ///
    /// # Arguments
    /// * `plugin_id` - Unique identifier of the plugin
    /// * `cache_key` - Key to identify the cached data
    /// * `data` - Data to cache
    pub fn write_cache(&self, plugin_id: &str, cache_key: &str, data: &[u8]) -> Result<(), String> {
        // Validate cache_key to prevent path traversal
        Self::validate_cache_key(cache_key)?;

        let cache_dir = self.get_plugin_cache_dir(plugin_id)?;
        let cache_path = cache_dir.join(cache_key);

        // Additional safety check: verify path would be within cache_dir
        // Note: Can't canonicalize before file exists, so we check the parent
        if let Some(parent) = cache_path.parent()
            && let Ok(canonical_parent) = parent.canonicalize()
            && let Ok(canonical_cache_dir) = cache_dir.canonicalize()
            && !canonical_parent.starts_with(&canonical_cache_dir)
        {
            return Err("Cache path is outside plugin cache directory".to_string());
        }

        std::fs::write(&cache_path, data).map_err(|e| format!("Failed to write cache: {}", e))
    }

    /// Clear plugin cache
    ///
    /// # Arguments
    /// * `plugin_id` - Unique identifier of the plugin
    pub fn clear_cache(&self, plugin_id: &str) -> Result<(), String> {
        let cache_dir = self.get_plugin_cache_dir(plugin_id)?;

        if cache_dir.exists() {
            std::fs::remove_dir_all(&cache_dir)
                .map_err(|e| format!("Failed to clear cache: {}", e))?;
            std::fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("Failed to recreate cache directory: {}", e))?;
        }

        Ok(())
    }

    // ========== Application Information ==========

    /// Get Volt's version
    pub fn get_volt_version(&self) -> &str {
        crate::core::constants::APP_VERSION
    }

    /// Get application data directory
    pub fn get_app_data_dir(&self) -> Result<PathBuf, String> {
        let state = self
            .state
            .read()
            .map_err(|e| format!("Failed to acquire read lock: {}", e))?;

        Ok(state.app_data_dir.clone())
    }
}

/// Log levels for plugin logging
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    /// Informational messages
    Info,
    /// Warning messages
    Warn,
    /// Error messages
    Error,
    /// Debug messages
    Debug,
}

/// Plugin capabilities that can be requested
///
/// Plugins should declare which capabilities they need for security and transparency
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginCapability {
    /// Access to file system
    FileSystem,
    /// Network access
    Network,
    /// Access to system information
    SystemInfo,
    /// Ability to execute commands
    ExecuteCommands,
    /// Access to user's application data
    ApplicationData,
    /// Modify search results
    ModifySearch,
}

impl PluginCapability {
    /// Get human-readable description of the capability
    pub fn description(&self) -> &str {
        match self {
            PluginCapability::FileSystem => "Read and write files on your computer",
            PluginCapability::Network => "Access the internet and make network requests",
            PluginCapability::SystemInfo => "Read system information (CPU, memory, etc.)",
            PluginCapability::ExecuteCommands => "Execute programs and commands",
            PluginCapability::ApplicationData => "Access your application data and history",
            PluginCapability::ModifySearch => "Modify and add to search results",
        }
    }

    /// Check if this capability is considered sensitive
    pub fn is_sensitive(&self) -> bool {
        matches!(
            self,
            PluginCapability::FileSystem
                | PluginCapability::Network
                | PluginCapability::ExecuteCommands
                | PluginCapability::ApplicationData
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_plugin_directories() {
        let temp_dir = env::temp_dir().join("volt_test");
        let api = VoltPluginAPI::new(temp_dir.clone());

        let data_dir = api.get_plugin_data_dir("test_plugin").unwrap();
        assert!(data_dir.exists());
        assert!(data_dir.ends_with("plugins/test_plugin"));

        let cache_dir = api.get_plugin_cache_dir("test_plugin").unwrap();
        assert!(cache_dir.exists());
        assert!(cache_dir.to_string_lossy().contains("cache"));

        // Cleanup
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_config_save_load() {
        let temp_dir = env::temp_dir().join("volt_test_config");
        let api = VoltPluginAPI::new(temp_dir.clone());

        let config = serde_json::json!({
            "enabled": true,
            "api_key": "test123"
        });

        api.save_config("test_plugin", "settings", &config).unwrap();
        let loaded = api.load_config("test_plugin", "settings").unwrap();

        assert_eq!(config, loaded);

        // Cleanup
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_cache_operations() {
        let temp_dir = env::temp_dir().join("volt_test_cache");
        let api = VoltPluginAPI::new(temp_dir.clone());

        let data = b"test data";
        api.write_cache("test_plugin", "test_key", data).unwrap();

        let read_data = api.read_cache("test_plugin", "test_key").unwrap();
        assert_eq!(data.to_vec(), read_data);

        api.clear_cache("test_plugin").unwrap();
        assert!(api.read_cache("test_plugin", "test_key").is_err());

        // Cleanup
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
