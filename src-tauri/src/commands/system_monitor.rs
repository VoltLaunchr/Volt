use crate::PluginState;
/// System Monitor plugin commands
use crate::core::error::VoltResult;
use serde::{Deserialize, Serialize};
use tauri::State;

/// System metrics information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub cpu_usage: f32,
    pub memory_usage: f32,
    pub disk_usage: f32,
    pub memory_total_gb: f32,
    pub memory_used_gb: f32,
    pub disk_total_gb: f32,
    pub disk_used_gb: f32,
}

/// Get CPU usage percentage
#[tauri::command]
pub fn get_cpu_usage(plugin_state: State<PluginState>) -> VoltResult<f32> {
    use crate::plugins::builtin::SystemMonitorPlugin;

    let monitor = SystemMonitorPlugin::new().with_api(plugin_state.api.clone());
    Ok(monitor.cpu_usage())
}

/// Get memory usage percentage
#[tauri::command]
pub fn get_memory_usage(plugin_state: State<PluginState>) -> VoltResult<f32> {
    use crate::plugins::builtin::SystemMonitorPlugin;

    let monitor = SystemMonitorPlugin::new().with_api(plugin_state.api.clone());
    Ok(monitor.memory_usage())
}

/// Get disk usage percentage
#[tauri::command]
pub fn get_disk_usage(plugin_state: State<PluginState>) -> VoltResult<f32> {
    use crate::plugins::builtin::SystemMonitorPlugin;

    let monitor = SystemMonitorPlugin::new().with_api(plugin_state.api.clone());
    Ok(monitor.disk_usage())
}

/// Get all system metrics at once
#[tauri::command]
pub fn get_system_metrics(plugin_state: State<PluginState>) -> VoltResult<SystemMetrics> {
    use crate::plugins::builtin::SystemMonitorPlugin;

    let monitor = SystemMonitorPlugin::new().with_api(plugin_state.api.clone());
    let info = monitor.get_system_info();

    Ok(SystemMetrics {
        cpu_usage: info.cpu_usage,
        memory_usage: info.memory_usage_percent,
        disk_usage: if info.disk_total == 0 {
            0.0
        } else {
            ((info.disk_used as f64 / info.disk_total as f64) * 100.0) as f32
        },
        memory_total_gb: (info.memory_total as f64 / 1024.0 / 1024.0 / 1024.0) as f32,
        memory_used_gb: (info.memory_used as f64 / 1024.0 / 1024.0 / 1024.0) as f32,
        disk_total_gb: (info.disk_total as f64 / 1024.0 / 1024.0 / 1024.0) as f32,
        disk_used_gb: (info.disk_used as f64 / 1024.0 / 1024.0 / 1024.0) as f32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_metrics_creation() {
        let metrics = SystemMetrics {
            cpu_usage: 45.5,
            memory_usage: 60.2,
            disk_usage: 75.8,
            memory_total_gb: 16.0,
            memory_used_gb: 9.6,
            disk_total_gb: 512.0,
            disk_used_gb: 388.0,
        };

        assert_eq!(metrics.cpu_usage, 45.5);
        assert_eq!(metrics.memory_usage, 60.2);
        assert_eq!(metrics.disk_usage, 75.8);
        assert_eq!(metrics.memory_total_gb, 16.0);
    }
}
