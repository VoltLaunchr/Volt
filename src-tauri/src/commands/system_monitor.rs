/// System Monitor plugin commands
use crate::core::error::{VoltError, VoltResult};
use crate::plugins::builtin::SystemMonitorPlugin;
use crate::plugins::builtin::system_monitor::{
    ComponentInfo, CpuCoreInfo, DiskInfo, NetworkInfo, ProcessInfo,
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

/// Persistent system monitor instance for accurate readings (especially CPU).
/// A single instance is reused across calls so that `sysinfo::System` can
/// produce meaningful CPU readings (requires at least two refresh cycles).
pub struct SystemMonitorState {
    pub monitor: Mutex<SystemMonitorPlugin>,
}

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

/// Get CPU usage percentage from the cached metrics.
#[tauri::command]
pub fn get_cpu_usage(monitor_state: State<SystemMonitorState>) -> VoltResult<f32> {
    let monitor = monitor_state
        .monitor
        .lock()
        .map_err(|e| VoltError::Unknown(format!("Monitor lock poisoned: {}", e)))?;
    monitor.cpu_usage().map_err(VoltError::Unknown)
}

/// Get memory usage percentage from the cached metrics.
#[tauri::command]
pub fn get_memory_usage(monitor_state: State<SystemMonitorState>) -> VoltResult<f32> {
    let monitor = monitor_state
        .monitor
        .lock()
        .map_err(|e| VoltError::Unknown(format!("Monitor lock poisoned: {}", e)))?;
    monitor.memory_usage().map_err(VoltError::Unknown)
}

/// Get disk usage percentage from the cached metrics.
#[tauri::command]
pub fn get_disk_usage(monitor_state: State<SystemMonitorState>) -> VoltResult<f32> {
    let monitor = monitor_state
        .monitor
        .lock()
        .map_err(|e| VoltError::Unknown(format!("Monitor lock poisoned: {}", e)))?;
    monitor.disk_usage().map_err(VoltError::Unknown)
}

/// Get all system metrics at once.
///
/// Reads from the in-memory cache populated by the background ticker.
/// Falls back to a live `get_system_info()` refresh on cache miss (before the
/// first ticker iteration completes) so the first user query never returns
/// zeros while the cache is still cold.
#[tauri::command]
pub fn get_system_metrics(monitor_state: State<SystemMonitorState>) -> VoltResult<SystemMetrics> {
    let monitor = monitor_state
        .monitor
        .lock()
        .map_err(|e| VoltError::Unknown(format!("Monitor lock poisoned: {}", e)))?;

    let cached = monitor.cached_metrics().map_err(VoltError::Unknown)?;

    let (cpu_usage, memory_total, memory_used, memory_usage_percent, disk_total, disk_used) =
        if cached.last_updated.is_some() {
            (
                cached.cpu_usage,
                cached.memory_total,
                cached.memory_used,
                cached.memory_usage_percent,
                cached.disk_total,
                cached.disk_used,
            )
        } else {
            // Cache miss: fall back to a live refresh so the first query
            // doesn't return zeros before the background ticker fires.
            let info = monitor.get_system_info().map_err(VoltError::Unknown)?;
            (
                info.cpu_usage,
                info.memory_total,
                info.memory_used,
                info.memory_usage_percent,
                info.disk_total,
                info.disk_used,
            )
        };

    Ok(SystemMetrics {
        cpu_usage,
        memory_usage: memory_usage_percent,
        disk_usage: if disk_total == 0 {
            0.0
        } else {
            ((disk_used as f64 / disk_total as f64) * 100.0) as f32
        },
        memory_total_gb: (memory_total as f64 / 1024.0 / 1024.0 / 1024.0) as f32,
        memory_used_gb: (memory_used as f64 / 1024.0 / 1024.0 / 1024.0) as f32,
        disk_total_gb: (disk_total as f64 / 1024.0 / 1024.0 / 1024.0) as f32,
        disk_used_gb: (disk_used as f64 / 1024.0 / 1024.0 / 1024.0) as f32,
    })
}

/// Extended metrics payload returned by `get_system_metrics_v2`.
///
/// Purely additive to `SystemMetrics`: includes the same top-level scalars
/// (so existing callers can be migrated painlessly) plus per-core CPU,
/// per-disk breakdown, network throughput, top processes, uptime, and
/// hardware temperatures.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetricsV2 {
    pub cpu_usage: f32,
    pub memory_usage: f32,
    pub disk_usage: f32,
    pub memory_total_gb: f32,
    pub memory_used_gb: f32,
    pub disk_total_gb: f32,
    pub disk_used_gb: f32,
    pub per_core_cpu: Vec<CpuCoreInfo>,
    pub per_disk: Vec<DiskInfo>,
    pub network: NetworkInfo,
    pub top_cpu_processes: Vec<ProcessInfo>,
    pub top_memory_processes: Vec<ProcessInfo>,
    pub uptime_seconds: u64,
    pub components: Vec<ComponentInfo>,
}

/// Get extended system metrics (per-core CPU, per-disk, network, top
/// processes, uptime, hardware temperatures).
///
/// Reads the same cache as `get_system_metrics` with the same live-refresh
/// fallback, so the first query after startup is never empty.
#[tauri::command]
pub fn get_system_metrics_v2(
    monitor_state: State<SystemMonitorState>,
) -> VoltResult<SystemMetricsV2> {
    let monitor = monitor_state
        .monitor
        .lock()
        .map_err(|e| VoltError::Unknown(format!("Monitor lock poisoned: {}", e)))?;

    // Prime the cache on miss so the v2 payload is never hollow on first call.
    let cached = monitor.cached_metrics().map_err(VoltError::Unknown)?;
    if cached.last_updated.is_none() {
        monitor.refresh_cache().map_err(VoltError::Unknown)?;
    }
    let cached = monitor.cached_metrics().map_err(VoltError::Unknown)?;

    let disk_usage = if cached.disk_total == 0 {
        0.0
    } else {
        ((cached.disk_used as f64 / cached.disk_total as f64) * 100.0) as f32
    };

    Ok(SystemMetricsV2 {
        cpu_usage: cached.cpu_usage,
        memory_usage: cached.memory_usage_percent,
        disk_usage,
        memory_total_gb: bytes_to_gb(cached.memory_total),
        memory_used_gb: bytes_to_gb(cached.memory_used),
        disk_total_gb: bytes_to_gb(cached.disk_total),
        disk_used_gb: bytes_to_gb(cached.disk_used),
        per_core_cpu: cached.per_core_cpu,
        per_disk: cached.per_disk,
        network: cached.network,
        top_cpu_processes: cached.top_cpu_processes,
        top_memory_processes: cached.top_memory_processes,
        uptime_seconds: cached.uptime_seconds,
        components: cached.components,
    })
}

fn bytes_to_gb(bytes: u64) -> f32 {
    (bytes as f64 / 1024.0 / 1024.0 / 1024.0) as f32
}

/// Terminate a process by its PID.
///
/// PID 0 is rejected as a safety guard (on some platforms it represents the
/// kernel/scheduler). Returns `VoltError::NotFound` when the process no longer
/// exists at the time the kill signal is sent.
#[tauri::command]
pub fn kill_process_by_pid(pid: u32, monitor_state: State<SystemMonitorState>) -> VoltResult<()> {
    if pid == 0 {
        return Err(VoltError::InvalidConfig(
            "Refusing to kill pid 0".to_string(),
        ));
    }
    let monitor = monitor_state
        .monitor
        .lock()
        .map_err(|e| VoltError::Unknown(format!("Monitor lock poisoned: {}", e)))?;
    match monitor.kill_process(pid).map_err(VoltError::Unknown)? {
        true => Ok(()),
        false => Err(VoltError::NotFound(format!("Process {} not found", pid))),
    }
}

/// Launch the platform's native system monitor (Task Manager on Windows,
/// Activity Monitor on macOS, first available of gnome/ksysguard/plasma on Linux).
#[tauri::command]
pub fn open_task_manager() -> VoltResult<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("taskmgr")
            .spawn()
            .map_err(|e| VoltError::Launch(format!("Failed to launch taskmgr: {}", e)))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", "Activity Monitor"])
            .spawn()
            .map_err(|e| VoltError::Launch(format!("Failed to launch Activity Monitor: {}", e)))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        const CANDIDATES: &[&str] = &["gnome-system-monitor", "ksysguard", "plasma-systemmonitor"];
        for cmd in CANDIDATES {
            if std::process::Command::new(cmd).spawn().is_ok() {
                return Ok(());
            }
        }
        Err(VoltError::Unknown("No system monitor found".to_string()))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err(VoltError::Unknown(
            "Unsupported platform for open_task_manager".to_string(),
        ))
    }
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
