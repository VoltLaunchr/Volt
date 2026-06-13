use crate::PluginState;
/// Plugin management commands
use crate::core::error::{VoltError, VoltResult};
use crate::plugins::api::PluginCapability;
use crate::plugins::builtin;
use crate::plugins::loader::{PluginLoader, PluginMetadata};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

/// Plugin information for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub capabilities: Vec<String>,
}

/// Plugin capability information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityInfo {
    pub name: String,
    pub description: String,
    pub is_sensitive: bool,
}

/// External plugin metadata for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub min_volt_version: String,
    pub is_compatible: bool,
}

impl From<PluginMetadata> for ExternalPluginInfo {
    fn from(metadata: PluginMetadata) -> Self {
        let is_compatible = metadata.is_compatible();
        Self {
            id: metadata.id,
            name: metadata.name,
            version: metadata.version,
            author: metadata.author,
            description: metadata.description,
            min_volt_version: metadata.min_volt_version,
            is_compatible,
        }
    }
}

/// List all registered plugins
#[tauri::command]
pub fn list_plugins(plugin_state: State<PluginState>) -> VoltResult<Vec<String>> {
    plugin_state
        .registry
        .list_plugins()
        .map_err(VoltError::Plugin)
}

/// Get information about all registered plugins
#[tauri::command]
pub fn get_all_plugins_info(plugin_state: State<PluginState>) -> VoltResult<Vec<PluginInfo>> {
    // Get built-in plugin IDs
    let plugin_ids = builtin::get_builtin_plugin_ids();

    let mut plugins_info = Vec::new();

    for id in plugin_ids {
        let (name, description, capabilities) = match id {
            "system_monitor" => (
                "System Monitor",
                "Monitors system resources like CPU, memory, and disk usage",
                vec![PluginCapability::SystemInfo, PluginCapability::FileSystem],
            ),
            _ => continue,
        };

        // Check if plugin is registered and enabled in the registry
        let enabled = plugin_state
            .registry
            .has_plugin(id)
            .map_err(VoltError::Plugin)?;

        plugins_info.push(PluginInfo {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            enabled,
            capabilities: capabilities.iter().map(|c| format!("{:?}", c)).collect(),
        });
    }

    Ok(plugins_info)
}

/// Get plugin count
#[tauri::command]
pub fn get_plugin_count(plugin_state: State<PluginState>) -> VoltResult<usize> {
    plugin_state.registry.count().map_err(VoltError::Plugin)
}

/// Get enabled plugin count
#[tauri::command]
pub fn get_enabled_plugin_count(plugin_state: State<PluginState>) -> VoltResult<usize> {
    plugin_state
        .registry
        .enabled_count()
        .map_err(VoltError::Plugin)
}

/// Check if a plugin is registered
#[tauri::command]
pub fn is_plugin_registered(
    plugin_state: State<PluginState>,
    plugin_id: String,
) -> VoltResult<bool> {
    plugin_state
        .registry
        .has_plugin(&plugin_id)
        .map_err(VoltError::Plugin)
}

/// Get all available plugin capabilities
#[tauri::command]
pub fn get_plugin_capabilities() -> VoltResult<Vec<CapabilityInfo>> {
    let capabilities = [
        PluginCapability::FileSystem,
        PluginCapability::Network,
        PluginCapability::SystemInfo,
        PluginCapability::ExecuteCommands,
        PluginCapability::ApplicationData,
        PluginCapability::ModifySearch,
    ];

    Ok(capabilities
        .iter()
        .map(|cap| CapabilityInfo {
            name: format!("{:?}", cap),
            description: cap.description().to_string(),
            is_sensitive: cap.is_sensitive(),
        })
        .collect())
}

/// List available external plugins
#[tauri::command]
pub fn list_external_plugins(plugins_dir: Option<String>) -> VoltResult<Vec<ExternalPluginInfo>> {
    let dir = plugins_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("plugins"));

    let loader = PluginLoader::new(dir);

    let metadata_list = loader
        .list_available_plugins()
        .map_err(|e| VoltError::Plugin(e.to_string()))?;

    Ok(metadata_list
        .into_iter()
        .map(ExternalPluginInfo::from)
        .collect())
}

/// Get the default plugins directory
#[tauri::command]
pub fn get_plugins_directory() -> VoltResult<String> {
    let loader = PluginLoader::default();
    Ok(loader.plugins_directory().to_string_lossy().to_string())
}

/// Validate an external plugin
#[tauri::command]
pub fn validate_external_plugin(plugin_path: String) -> VoltResult<bool> {
    let loader = PluginLoader::default();
    let path = PathBuf::from(plugin_path);

    loader
        .validate_plugin(&path)
        .map_err(|e| VoltError::Plugin(e.to_string()))?;

    Ok(true)
}

/// Attempt to load a plugin from a file (returns error as not yet implemented)
#[tauri::command]
pub fn load_plugin_from_file(plugin_path: String) -> VoltResult<String> {
    let loader = PluginLoader::default();
    let path = PathBuf::from(plugin_path);

    loader
        .load_from_path(&path)
        .map(|_| "Plugin loaded successfully".to_string())
        .map_err(|e| VoltError::Plugin(e.to_string()))
}

/// Scan and attempt to load plugins from a directory
#[tauri::command]
pub fn load_plugins_from_directory(dir_path: String) -> VoltResult<usize> {
    let loader = PluginLoader::default();
    let path = PathBuf::from(dir_path);

    loader
        .load_from_directory(&path)
        .map(|plugins| plugins.len())
        .map_err(|e| VoltError::Plugin(e.to_string()))
}

/// Get metadata for a built-in plugin
#[tauri::command]
pub fn get_builtin_plugin_metadata(plugin_id: String) -> VoltResult<ExternalPluginInfo> {
    let metadata = match plugin_id.as_str() {
        "system_monitor" => {
            use crate::plugins::builtin::SystemMonitorPlugin;
            let plugin = SystemMonitorPlugin::new();
            PluginMetadata::from_plugin(&plugin, "1.0.0", "Volt Team")
        }
        _ => {
            return Err(VoltError::NotFound(format!(
                "Unknown plugin: {}",
                plugin_id
            )));
        }
    };

    Ok(ExternalPluginInfo::from(metadata))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capability_info() {
        let cap = PluginCapability::FileSystem;
        assert_eq!(cap.description(), "Read and write files on your computer");
        assert!(cap.is_sensitive());
    }
}
