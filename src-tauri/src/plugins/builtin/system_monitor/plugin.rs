use crate::core::traits::Plugin;
use crate::plugins::api::{LogLevel, VoltPluginAPI};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use sysinfo::{
    Components, CpuRefreshKind, DiskKind, Disks, MINIMUM_CPU_UPDATE_INTERVAL, MemoryRefreshKind,
    Networks, Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System,
};

/// System monitoring plugin
///
/// Monitors system resources like CPU, memory, disk usage, etc.
/// This plugin demonstrates how to create a plugin with configuration
/// and periodic background tasks.
pub struct SystemMonitorPlugin {
    enabled: bool,
    api: Option<Arc<VoltPluginAPI>>,
    config: SystemMonitorConfig,
    system: Mutex<System>,
    disks: Mutex<Disks>,
    networks: Mutex<Networks>,
    components: Mutex<Components>,
    /// Tracks the last CPU refresh so we can dual-sample when the cached
    /// reading is stale (>1s old). sysinfo requires two `refresh_cpu_usage()`
    /// calls separated by `MINIMUM_CPU_UPDATE_INTERVAL` for meaningful values.
    last_cpu_refresh: Mutex<Option<Instant>>,
    /// Previous network totals keyed by interface name, with the timestamp of
    /// the last sample. Used to derive per-second rates across ticker cycles.
    last_network_sample: Mutex<Option<NetworkSample>>,
    /// In-memory metrics cache populated by the background ticker so that
    /// frontend queries are served instantly without running a sysinfo refresh
    /// per keystroke.
    cache: RwLock<CachedMetrics>,
}

struct NetworkSample {
    at: Instant,
    totals: HashMap<String, (u64, u64)>,
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

/// Per-core CPU snapshot.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuCoreInfo {
    pub name: String,
    pub usage_percent: f32,
    pub frequency_mhz: u64,
}

/// Per-disk snapshot. `available_gb` is derived for convenience; consumers can
/// verify against `used_gb = total_gb - available_gb` (within f32 rounding).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub mount_point: String,
    pub total_gb: f32,
    pub used_gb: f32,
    pub available_gb: f32,
    pub file_system: String,
    /// Storage kind: "SSD", "HDD", or "Unknown".
    pub kind: String,
}

/// Aggregate + per-interface network throughput.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub received_bytes_per_sec: u64,
    pub transmitted_bytes_per_sec: u64,
    pub interfaces: Vec<NetworkInterfaceInfo>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub received_bytes_per_sec: u64,
    pub transmitted_bytes_per_sec: u64,
    pub total_received_bytes: u64,
    pub total_transmitted_bytes: u64,
}

/// Process summary used for the top-CPU and top-memory lists.
///
/// `cpu_usage_percent` is a single-core percentage (sysinfo convention matches
/// htop / Task Manager "Details" tab) — values can exceed 100% on multithreaded
/// processes.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage_percent: f32,
    pub memory_bytes: u64,
}

/// Hardware component (CPU package, GPU, SSD, etc) temperature reading. May be
/// empty on platforms without sensor support (e.g. Windows without vendor
/// drivers).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentInfo {
    pub label: String,
    pub temperature_c: Option<f32>,
    pub max_c: Option<f32>,
    pub critical_c: Option<f32>,
}

/// Cached snapshot of the latest metrics. Populated by `refresh_cache()` and
/// returned by `cached_metrics()` so frontend queries never trigger a sysinfo
/// refresh per keystroke. `last_updated` is internal bookkeeping and is not
/// serialized to the frontend.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMetrics {
    pub cpu_usage: f32,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_usage_percent: f32,
    pub disk_total: u64,
    pub disk_used: u64,
    pub per_core_cpu: Vec<CpuCoreInfo>,
    pub per_disk: Vec<DiskInfo>,
    pub network: NetworkInfo,
    pub top_cpu_processes: Vec<ProcessInfo>,
    pub top_memory_processes: Vec<ProcessInfo>,
    pub uptime_seconds: u64,
    pub components: Vec<ComponentInfo>,
    #[serde(skip)]
    pub last_updated: Option<Instant>,
}

impl SystemMonitorPlugin {
    pub fn new() -> Self {
        Self {
            enabled: true,
            api: None,
            config: SystemMonitorConfig::default(),
            // Use lightweight constructors - data will be refreshed on-demand
            system: Mutex::new(System::new()),
            disks: Mutex::new(Disks::new()),
            networks: Mutex::new(Networks::new()),
            components: Mutex::new(Components::new()),
            last_cpu_refresh: Mutex::new(None),
            last_network_sample: Mutex::new(None),
            cache: RwLock::new(CachedMetrics::default()),
        }
    }

    /// Set the plugin API
    pub fn with_api(mut self, api: Arc<VoltPluginAPI>) -> Self {
        self.api = Some(api);
        self
    }

    /// Prime the CPU baseline by performing a second `refresh_cpu_usage()`
    /// after the required `MINIMUM_CPU_UPDATE_INTERVAL` has elapsed. Intended
    /// to be called once at startup from a background task so the first user
    /// query returns meaningful data instead of 0.0.
    pub fn prime_cpu(&self) -> Result<(), String> {
        let mut system = self
            .system
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        system.refresh_cpu_usage();
        let mut last = self
            .last_cpu_refresh
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        *last = Some(Instant::now());
        Ok(())
    }

    /// Performs the dual-sample CPU refresh required by sysinfo. If the cached
    /// reading is fresh (< 1s old) we skip the sleep to keep the command
    /// responsive; otherwise we refresh, sleep `MINIMUM_CPU_UPDATE_INTERVAL`,
    /// and refresh again so `global_cpu_usage()` returns a meaningful value.
    fn refresh_cpu_dual_sample(&self, system: &mut System) {
        let mut last = match self.last_cpu_refresh.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        let needs_warmup = last
            .map(|t| t.elapsed() > std::time::Duration::from_secs(1))
            .unwrap_or(true);
        system.refresh_cpu_usage();
        if needs_warmup {
            std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
            system.refresh_cpu_usage();
        }
        *last = Some(Instant::now());
    }

    /// Get CPU usage percentage from the cache.
    ///
    /// Returns the global CPU usage as a percentage (0.0 to 100.0). Values are
    /// refreshed by the background ticker; on cache miss the caller should
    /// invoke `refresh_cache()` first (see `get_system_metrics` fallback).
    pub fn cpu_usage(&self) -> Result<f32, String> {
        Ok(self.cached_metrics()?.cpu_usage)
    }

    /// Get memory usage percentage from the cache.
    pub fn memory_usage(&self) -> Result<f32, String> {
        Ok(self.cached_metrics()?.memory_usage_percent)
    }

    /// Get disk usage percentage from the cache.
    pub fn disk_usage(&self) -> Result<f32, String> {
        let cached = self.cached_metrics()?;
        Ok(if cached.disk_total > 0 {
            ((cached.disk_used as f64 / cached.disk_total as f64) * 100.0) as f32
        } else {
            0.0
        })
    }

    /// Get detailed system information via a live sysinfo refresh. Used as a
    /// fallback by `get_system_metrics` on cache miss (before the first
    /// background tick completes).
    pub fn get_system_info(&self) -> Result<SystemInfo, String> {
        let mut system = self
            .system
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        // Narrow refresh: only memory + CPU usage (no process/disk/network).
        // `new()` returns an empty kind (no fields set); we opt in to just
        // CPU usage + RAM so we skip processes/network/swap/disks scanning.
        let refresh_kind = RefreshKind::new()
            .with_cpu(CpuRefreshKind::new().with_cpu_usage())
            .with_memory(MemoryRefreshKind::new().with_ram());
        system.refresh_specifics(refresh_kind);
        // CPU still needs the dual-sample dance.
        self.refresh_cpu_dual_sample(&mut system);

        let mut disks = self
            .disks
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        disks.refresh_list();

        Ok(SystemInfo {
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
                .map(|d| d.total_space().saturating_sub(d.available_space()))
                .sum(),
        })
    }

    /// Perform a live sysinfo refresh and store the result in the cache.
    /// Intended to be called by the background ticker every ~5s.
    pub fn refresh_cache(&self) -> Result<(), String> {
        let mut system = self
            .system
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        // Granular refresh: CPU usage (per-core) + RAM. Processes are refreshed
        // below with their own dedicated call so we can opt into cpu_usage only.
        let refresh_kind = RefreshKind::new()
            .with_cpu(CpuRefreshKind::new().with_cpu_usage().with_frequency())
            .with_memory(MemoryRefreshKind::new().with_ram());
        system.refresh_specifics(refresh_kind);
        // CPU needs the dual-sample dance for meaningful values.
        self.refresh_cpu_dual_sample(&mut system);
        // Processes: refresh with CPU usage so top-CPU rankings are meaningful.
        // `update_all=true` removes processes that have disappeared.
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::new().with_cpu().with_memory(),
        );

        let mut disks = self
            .disks
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        disks.refresh_list();

        let mut networks = self
            .networks
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        networks.refresh_list();
        networks.refresh();

        let mut components = self
            .components
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        components.refresh_list();
        components.refresh();

        // Aggregate scalars ---------------------------------------------------
        let memory_total = system.total_memory();
        let memory_used = system.used_memory();
        let memory_usage_percent = if memory_total > 0 {
            ((memory_used as f64 / memory_total as f64) * 100.0) as f32
        } else {
            0.0
        };
        let disk_total: u64 = disks.iter().map(|d| d.total_space()).sum();
        let disk_used: u64 = disks
            .iter()
            .map(|d| d.total_space().saturating_sub(d.available_space()))
            .sum();

        // Per-core CPU --------------------------------------------------------
        let per_core_cpu: Vec<CpuCoreInfo> = system
            .cpus()
            .iter()
            .map(|c| CpuCoreInfo {
                name: c.name().to_string(),
                usage_percent: c.cpu_usage(),
                frequency_mhz: c.frequency(),
            })
            .collect();

        // Per-disk ------------------------------------------------------------
        let per_disk: Vec<DiskInfo> = disks
            .iter()
            .filter(|d| d.total_space() > 0)
            .map(|d| {
                let total = d.total_space();
                let available = d.available_space();
                let used = total.saturating_sub(available);
                DiskInfo {
                    mount_point: d.mount_point().to_string_lossy().into_owned(),
                    total_gb: bytes_to_gb(total),
                    used_gb: bytes_to_gb(used),
                    available_gb: bytes_to_gb(available),
                    file_system: d.file_system().to_string_lossy().into_owned(),
                    kind: match d.kind() {
                        DiskKind::SSD => "SSD".to_string(),
                        DiskKind::HDD => "HDD".to_string(),
                        DiskKind::Unknown(_) => "Unknown".to_string(),
                    },
                }
            })
            .collect();

        // Network rates -------------------------------------------------------
        let now = Instant::now();
        let mut current_totals: HashMap<String, (u64, u64)> = HashMap::new();
        for (name, data) in networks.iter() {
            current_totals.insert(
                name.clone(),
                (data.total_received(), data.total_transmitted()),
            );
        }
        let network = {
            let mut last = self
                .last_network_sample
                .lock()
                .map_err(|e| format!("lock poisoned: {}", e))?;

            let (rates, aggregate): (Vec<NetworkInterfaceInfo>, (u64, u64)) = match last.as_ref() {
                Some(prev) => {
                    let elapsed = now
                        .saturating_duration_since(prev.at)
                        .as_secs_f64()
                        .max(0.001);
                    let mut interfaces: Vec<NetworkInterfaceInfo> = current_totals
                        .iter()
                        .map(|(name, &(rx, tx))| {
                            let (prev_rx, prev_tx) =
                                prev.totals.get(name).copied().unwrap_or((rx, tx));
                            let rx_rate = ((rx.saturating_sub(prev_rx)) as f64 / elapsed) as u64;
                            let tx_rate = ((tx.saturating_sub(prev_tx)) as f64 / elapsed) as u64;
                            NetworkInterfaceInfo {
                                name: name.clone(),
                                received_bytes_per_sec: rx_rate,
                                transmitted_bytes_per_sec: tx_rate,
                                total_received_bytes: rx,
                                total_transmitted_bytes: tx,
                            }
                        })
                        .collect();
                    interfaces.sort_by(|a, b| a.name.cmp(&b.name));
                    let agg = interfaces.iter().fold((0u64, 0u64), |acc, i| {
                        (
                            acc.0.saturating_add(i.received_bytes_per_sec),
                            acc.1.saturating_add(i.transmitted_bytes_per_sec),
                        )
                    });
                    (interfaces, agg)
                }
                None => {
                    // First sample: rates are 0 until we have a baseline.
                    let mut interfaces: Vec<NetworkInterfaceInfo> = current_totals
                        .iter()
                        .map(|(name, &(rx, tx))| NetworkInterfaceInfo {
                            name: name.clone(),
                            received_bytes_per_sec: 0,
                            transmitted_bytes_per_sec: 0,
                            total_received_bytes: rx,
                            total_transmitted_bytes: tx,
                        })
                        .collect();
                    interfaces.sort_by(|a, b| a.name.cmp(&b.name));
                    (interfaces, (0u64, 0u64))
                }
            };

            *last = Some(NetworkSample {
                at: now,
                totals: current_totals,
            });

            NetworkInfo {
                received_bytes_per_sec: aggregate.0,
                transmitted_bytes_per_sec: aggregate.1,
                interfaces: rates,
            }
        };

        // Top processes -------------------------------------------------------
        let mut processes: Vec<ProcessInfo> = system
            .processes()
            .iter()
            .filter(|(pid, _)| pid.as_u32() != 0)
            .map(|(pid, p)| ProcessInfo {
                pid: pid.as_u32(),
                name: p.name().to_string_lossy().into_owned(),
                cpu_usage_percent: p.cpu_usage(),
                memory_bytes: p.memory(),
            })
            .collect();
        let mut top_cpu_processes = processes.clone();
        top_cpu_processes.sort_by(|a, b| {
            b.cpu_usage_percent
                .partial_cmp(&a.cpu_usage_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        top_cpu_processes.truncate(5);
        processes.sort_by_key(|b| std::cmp::Reverse(b.memory_bytes));
        processes.truncate(5);
        let top_memory_processes = processes;

        // Components (temperatures) ------------------------------------------
        let components_info: Vec<ComponentInfo> = components
            .iter()
            .map(|c| ComponentInfo {
                label: c.label().to_string(),
                temperature_c: finite(c.temperature()),
                max_c: finite(c.max()),
                critical_c: c.critical(),
            })
            .collect();

        let snapshot = CachedMetrics {
            cpu_usage: system.global_cpu_usage(),
            memory_total,
            memory_used,
            memory_usage_percent,
            disk_total,
            disk_used,
            per_core_cpu,
            per_disk,
            network,
            top_cpu_processes,
            top_memory_processes,
            uptime_seconds: System::uptime(),
            components: components_info,
            last_updated: Some(now),
        };

        // Release sysinfo locks before acquiring the cache write lock to keep
        // lock ordering simple (sysinfo -> cache, never the other way).
        drop(components);
        drop(networks);
        drop(disks);
        drop(system);

        let mut cache = self
            .cache
            .write()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        *cache = snapshot;
        Ok(())
    }

    /// Terminate a process by PID. Refreshes only the target entry to keep the
    /// call cheap and returns `Ok(true)` on success, `Ok(false)` if the process
    /// is already gone.
    pub fn kill_process(&self, pid: u32) -> Result<bool, String> {
        let mut system = self
            .system
            .lock()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        let target = Pid::from_u32(pid);
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[target]),
            true,
            ProcessRefreshKind::new(),
        );
        match system.process(target) {
            Some(p) => Ok(p.kill()),
            None => Ok(false),
        }
    }

    /// Read-lock the cache and return a clone of the latest snapshot.
    pub fn cached_metrics(&self) -> Result<CachedMetrics, String> {
        let cache = self
            .cache
            .read()
            .map_err(|e| format!("lock poisoned: {}", e))?;
        Ok(cache.clone())
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

fn bytes_to_gb(bytes: u64) -> f32 {
    (bytes as f64 / 1024.0 / 1024.0 / 1024.0) as f32
}

/// sysinfo 0.32 returns f32 for temperatures; NaN signals unavailable.
fn finite(v: f32) -> Option<f32> {
    if v.is_finite() { Some(v) } else { None }
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

    #[test]
    fn test_cache_starts_empty() {
        let plugin = SystemMonitorPlugin::new();
        let cached = plugin.cached_metrics().expect("cache read");
        assert!(cached.last_updated.is_none());
        assert_eq!(cached.cpu_usage, 0.0);
        assert!(cached.per_core_cpu.is_empty());
        assert!(cached.top_cpu_processes.is_empty());
        assert!(cached.top_memory_processes.is_empty());
        assert_eq!(cached.uptime_seconds, 0);
        assert!(cached.components.is_empty());
        assert_eq!(cached.network.received_bytes_per_sec, 0);
    }
}
