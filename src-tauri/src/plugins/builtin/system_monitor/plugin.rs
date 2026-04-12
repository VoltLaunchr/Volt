use crate::core::traits::Plugin;
use crate::plugins::api::{LogLevel, VoltPluginAPI};
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use sysinfo::{Disks, System};

/// System monitoring plugin
///
/// Monitors system resources like CPU, memory, disk usage, etc.
/// This plugin demonstrates how to create a plugin with configuration
/// and periodic background tasks.
pub struct SystemMonitorPlugin {
    enabled: bool,
    api: Option<Arc<VoltPluginAPI>>,
    config: SystemMonitorConfig,
    system: Arc<Mutex<System>>,
    disks: Arc<Mutex<Disks>>,
}

/// Configuration for the system monitor plugin
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct SystemMonitorConfig {
    /// Update interval in seconds
    update_interval: u64,
    /// Show CPU usage
    show_cpu: bool,
    /// Show memory usage
    show_memory: bool,
    /// Show disk usage
    show_disk: bool,
}

impl Default for SystemMonitorConfig {
    fn default() -> Self {
        Self {
            update_interval: 5,
            show_cpu: true,
            show_memory: true,
            show_disk: false,
        }
    }
}

/// Detailed system information snapshot
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// CPU usage percentage (0.0 to 100.0)
    pub cpu_usage: f32,
    /// Total memory in bytes
    pub memory_total: u64,
    /// Used memory in bytes
    pub memory_used: u64,
    /// Memory usage percentage (0.0 to 100.0)
    pub memory_usage_percent: f32,
    /// Total disk space in bytes
    pub disk_total: u64,
    /// Used disk space in bytes
    pub disk_used: u64,
}

impl SystemMonitorPlugin {
    pub fn new() -> Self {
        Self {
            enabled: true,
            api: None,
            config: SystemMonitorConfig::default(),
            // Use lightweight constructors - data will be refreshed on-demand
            system: Arc::new(Mutex::new(System::new())),
            disks: Arc::new(Mutex::new(Disks::new())),
        }
    }

    /// Set the plugin API
    pub fn with_api(mut self, api: Arc<VoltPluginAPI>) -> Self {
        self.api = Some(api);
        self
    }

    /// Get CPU usage percentage
    ///
    /// Returns the global CPU usage as a percentage (0.0 to 100.0)
    pub fn cpu_usage(&self) -> f32 {
        let mut system = self.system.lock().unwrap();
        system.refresh_cpu_all();
        system.global_cpu_usage()
    }

    /// Get memory usage percentage
    ///
    /// Returns memory usage as a percentage (0.0 to 100.0)
    pub fn memory_usage(&self) -> f32 {
        let mut system = self.system.lock().unwrap();
        system.refresh_memory();
        let used = system.used_memory() as f64;
        let total = system.total_memory() as f64;
        if total > 0.0 {
            ((used / total) * 100.0) as f32
        } else {
            0.0
        }
    }

    /// Get disk usage percentage
    ///
    /// Returns the average disk usage across all mounted disks as a percentage (0.0 to 100.0)
    pub fn disk_usage(&self) -> f32 {
        let mut disks = self.disks.lock().unwrap();
        disks.refresh_list();

        let mut total_space = 0u64;
        let mut used_space = 0u64;

        for disk in disks.iter() {
            total_space += disk.total_space();
            used_space += disk.total_space() - disk.available_space();
        }

        if total_space > 0 {
            ((used_space as f64 / total_space as f64) * 100.0) as f32
        } else {
            0.0
        }
    }

    /// Get detailed system information
    pub fn get_system_info(&self) -> SystemInfo {
        let mut system = self.system.lock().unwrap();
        system.refresh_all();

        let mut disks = self.disks.lock().unwrap();
        disks.refresh_list();

        SystemInfo {
            cpu_usage: system.global_cpu_usage(),
            memory_total: system.total_memory(),
            memory_used: system.used_memory(),
            memory_usage_percent: {
                let used = system.used_memory() as f64;
                let total = system.total_memory() as f64;
                if total > 0.0 {
                    ((used / total) * 100.0) as f32
                } else {
                    0.0
                }
            },
            disk_total: disks.iter().map(|d| d.total_space()).sum(),
            disk_used: disks
                .iter()
                .map(|d| d.total_space() - d.available_space())
                .sum(),
        }
    }

    /// Load configuration from file
    async fn load_config(&mut self) -> Result<(), String> {
        if let Some(api) = &self.api {
            match api.load_config(self.id(), "settings") {
                Ok(config_value) => {
                    self.config = serde_json::from_value(config_value)
                        .unwrap_or_else(|_| SystemMonitorConfig::default());
                    api.log(
                        self.id(),
                        LogLevel::Info,
                        "Configuration loaded successfully",
                    );
                }
                Err(_) => {
                    api.log(self.id(), LogLevel::Warn, "No config found, using defaults");
                }
            }
        }
        Ok(())
    }

    /// Save configuration to file
    async fn save_config(&self) -> Result<(), String> {
        if let Some(api) = &self.api {
            let config_value = serde_json::to_value(&self.config)
                .map_err(|e| format!("Failed to serialize config: {}", e))?;

            api.save_config(self.id(), "settings", &config_value)?;
            api.log(
                self.id(),
                LogLevel::Info,
                "Configuration saved successfully",
            );
        }
        Ok(())
    }
}

impl Default for SystemMonitorPlugin {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Plugin for SystemMonitorPlugin {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "system_monitor"
    }

    fn name(&self) -> &str {
        "System Monitor"
    }

    fn description(&self) -> &str {
        "Monitors system resources like CPU, memory, and disk usage"
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn required_capabilities(&self) -> Vec<crate::plugins::api::PluginCapability> {
        use crate::plugins::api::PluginCapability;
        vec![PluginCapability::SystemInfo, PluginCapability::FileSystem]
    }

    async fn initialize(&mut self) -> Result<(), String> {
        let has_api = self.api.is_some();

        if has_api {
            if let Some(api) = &self.api {
                api.log(
                    self.id(),
                    LogLevel::Info,
                    "Initializing System Monitor plugin...",
                );

                // Create plugin directories
                let _ = api.get_plugin_data_dir(self.id())?;
                let _ = api.get_plugin_cache_dir(self.id())?;
            }

            // Load configuration
            self.load_config().await?;

            if let Some(api) = &self.api {
                api.log(
                    self.id(),
                    LogLevel::Info,
                    &format!(
                        "System Monitor initialized (update interval: {}s)",
                        self.config.update_interval
                    ),
                );
            }
        }

        Ok(())
    }

    async fn shutdown(&mut self) -> Result<(), String> {
        if let Some(api) = &self.api {
            api.log(
                self.id(),
                LogLevel::Info,
                "Shutting down System Monitor plugin...",
            );

            // Save configuration
            self.save_config().await?;

            api.log(self.id(), LogLevel::Info, "System Monitor shut down");
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_creation() {
        let plugin = SystemMonitorPlugin::new();
        assert_eq!(plugin.id(), "system_monitor");
        assert_eq!(plugin.name(), "System Monitor");
        assert!(plugin.is_enabled());
    }

    #[test]
    fn test_default_config() {
        let config = SystemMonitorConfig::default();
        assert_eq!(config.update_interval, 5);
        assert!(config.show_cpu);
        assert!(config.show_memory);
        assert!(!config.show_disk);
    }
}
