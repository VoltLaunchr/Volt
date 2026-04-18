//! System monitoring plugin
//!
//! Provides system resource monitoring capabilities (CPU, RAM, etc.)

mod plugin;

pub use plugin::{
    ComponentInfo, CpuCoreInfo, DiskInfo, NetworkInfo, ProcessInfo, SystemMonitorPlugin,
};
