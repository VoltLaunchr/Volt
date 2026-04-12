//! Plugin loader for dynamic plugin loading
//!
//! This module handles loading plugins from external sources.
//! Currently a placeholder for future extensibility.

use crate::core::constants::APP_VERSION;
use crate::core::error::{VoltError, VoltResult};
use crate::core::traits::Plugin;
use std::path::{Path, PathBuf};
use tracing::warn;

/// Plugin loader
pub struct PluginLoader {
    plugins_dir: PathBuf,
}

impl PluginLoader {
    /// Create a new plugin loader
    pub fn new(plugins_dir: PathBuf) -> Self {
        Self { plugins_dir }
    }

    /// Get the plugins directory
    pub fn plugins_directory(&self) -> &Path {
        &self.plugins_dir
    }

    /// Load a plugin from a file path (placeholder)
    ///
    /// # Future Implementation
    /// This could load compiled plugin DLLs/SOs using a well-defined plugin API.
    /// For now, it's a placeholder for future extensibility.
    pub fn load_from_path(&self, _path: &Path) -> VoltResult<Box<dyn Plugin + Send + Sync>> {
        // Validate plugin before loading
        self.validate_plugin(_path)?;

        Err(VoltError::Plugin(
            "Dynamic plugin loading not yet implemented".to_string(),
        ))
    }

    /// Load all plugins from a directory (placeholder)
    pub fn load_from_directory(
        &self,
        _dir: &Path,
    ) -> VoltResult<Vec<Box<dyn Plugin + Send + Sync>>> {
        // Validate directory exists
        if !_dir.exists() {
            return Err(VoltError::Plugin(format!(
                "Plugin directory does not exist: {:?}",
                _dir
            )));
        }

        if !_dir.is_dir() {
            return Err(VoltError::Plugin(format!(
                "Path is not a directory: {:?}",
                _dir
            )));
        }

        // Future: Scan directory for plugin files and load them
        Err(VoltError::Plugin(
            "Dynamic plugin loading not yet implemented".to_string(),
        ))
    }

    /// Validate plugin before loading
    pub fn validate_plugin(&self, path: &Path) -> VoltResult<()> {
        // Check if file exists
        if !path.exists() {
            return Err(VoltError::Plugin(format!(
                "Plugin file does not exist: {:?}",
                path
            )));
        }

        // Future: Check plugin signature, version compatibility, etc.
        // For now, just basic validation
        Ok(())
    }

    /// List all available external plugins in the plugins directory
    pub fn list_available_plugins(&self) -> VoltResult<Vec<PluginMetadata>> {
        if !self.plugins_dir.exists() {
            return Ok(Vec::new());
        }

        // Future: Scan directory and read metadata from plugin manifests
        Ok(Vec::new())
    }
}

impl Default for PluginLoader {
    fn default() -> Self {
        Self::new(PathBuf::from("plugins"))
    }
}

/// Plugin metadata for external plugins
#[derive(Debug, Clone)]
pub struct PluginMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub min_volt_version: String,
}

impl PluginMetadata {
    /// Check if plugin is compatible with current Volt version
    pub fn is_compatible(&self) -> bool {
        // Parse versions and compare using semver
        let current_version = APP_VERSION;

        // Parse the current Volt version
        let current = match semver::Version::parse(current_version) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    "Failed to parse current Volt version '{}': {}",
                    current_version, e
                );
                return false;
            }
        };

        // Parse the minimum required version
        let min_required = match semver::Version::parse(&self.min_volt_version) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    "Failed to parse plugin min version '{}': {}",
                    self.min_volt_version, e
                );
                return false;
            }
        };

        // Plugin is compatible if current version >= minimum required version
        current >= min_required
    }

    /// Create metadata from a plugin
    pub fn from_plugin(plugin: &dyn Plugin, version: &str, author: &str) -> Self {
        Self {
            id: plugin.id().to_string(),
            name: plugin.name().to_string(),
            version: version.to_string(),
            author: author.to_string(),
            description: plugin.description().to_string(),
            min_volt_version: "0.1.0".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metadata_compatibility() {
        // Use a very low min_volt_version so this test stays valid as the app version evolves.
        let metadata = PluginMetadata {
            id: "test".to_string(),
            name: "Test".to_string(),
            version: "1.0.0".to_string(),
            author: "Test Author".to_string(),
            description: "Test plugin".to_string(),
            min_volt_version: "0.0.1".to_string(),
        };

        assert!(metadata.is_compatible());
    }

    #[test]
    fn test_metadata_incompatible_version() {
        let metadata = PluginMetadata {
            id: "test".to_string(),
            name: "Test".to_string(),
            version: "1.0.0".to_string(),
            author: "Test Author".to_string(),
            description: "Test plugin".to_string(),
            min_volt_version: "99.0.0".to_string(),
        };

        assert!(!metadata.is_compatible());
    }

    #[test]
    fn test_loader_creation() {
        let loader = PluginLoader::new(PathBuf::from("test_plugins"));
        assert_eq!(loader.plugins_directory(), Path::new("test_plugins"));
    }

    #[test]
    fn test_loader_default() {
        let loader = PluginLoader::default();
        assert_eq!(loader.plugins_directory(), Path::new("plugins"));
    }

    #[test]
    fn test_validate_nonexistent_plugin() {
        let loader = PluginLoader::default();
        let result = loader.validate_plugin(Path::new("nonexistent_plugin.dll"));
        assert!(result.is_err());
    }

    #[test]
    fn test_load_from_nonexistent_path() {
        let loader = PluginLoader::default();
        let result = loader.load_from_path(Path::new("nonexistent.dll"));
        assert!(result.is_err());
    }

    #[test]
    fn test_load_from_invalid_directory() {
        let loader = PluginLoader::default();
        let result = loader.load_from_directory(Path::new("nonexistent_dir"));
        assert!(result.is_err());
    }

    #[test]
    fn test_list_plugins_nonexistent_dir() {
        let loader = PluginLoader::new(PathBuf::from("definitely_does_not_exist_12345"));
        let result = loader.list_available_plugins();
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn test_metadata_from_plugin() {
        use crate::plugins::builtin::GameScannerPlugin;

        let plugin = GameScannerPlugin::new();
        let metadata = PluginMetadata::from_plugin(&plugin, "1.0.0", "Volt Team");

        assert_eq!(metadata.id, plugin.id());
        assert_eq!(metadata.name, plugin.name());
        assert_eq!(metadata.version, "1.0.0");
        assert_eq!(metadata.author, "Volt Team");
    }
}
