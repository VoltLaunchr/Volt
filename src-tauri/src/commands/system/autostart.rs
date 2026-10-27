use crate::core::error::{VoltError, VoltResult};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_positioner::{Position, WindowExt};
use tracing::info;

/// Enable autostart on system boot
#[tauri::command]
pub async fn enable_autostart(app_handle: AppHandle) -> VoltResult<()> {
    // The dev binary requires the Vite dev server (localhost:1420) which is not
    // running at boot, so registering it for autostart causes ERR_CONNECTION_REFUSED
    // on every system start. Block this in dev builds; use a release build instead.
    if cfg!(debug_assertions) {
        return Err(VoltError::InvalidConfig(
            "Autostart is not supported in development mode. Build a release binary first."
                .to_string(),
        ));
    }

    #[cfg(all(windows, feature = "store"))]
    if msix_startup::has_package_identity() {
        tauri::async_runtime::spawn_blocking(msix_startup::enable)
            .await
            .map_err(|e| VoltError::Unknown(format!("Autostart task panicked: {}", e)))??;
        info!("Autostart enabled (MSIX startup task)");
        return Ok(());
    }

    app_handle
        .autolaunch()
        .enable()
        .map_err(|e| VoltError::Unknown(format!("Failed to enable autostart: {}", e)))?;

    info!("Autostart enabled");
    Ok(())
}

/// Disable autostart on system boot
#[tauri::command]
pub async fn disable_autostart(app_handle: AppHandle) -> VoltResult<()> {
    #[cfg(all(windows, feature = "store"))]
    if msix_startup::has_package_identity() {
        tauri::async_runtime::spawn_blocking(msix_startup::disable)
            .await
            .map_err(|e| VoltError::Unknown(format!("Autostart task panicked: {}", e)))??;
        info!("Autostart disabled (MSIX startup task)");
        return Ok(());
    }

    app_handle
        .autolaunch()
        .disable()
        .map_err(|e| VoltError::Unknown(format!("Failed to disable autostart: {}", e)))?;

    info!("Autostart disabled");
    Ok(())
}

/// Check if autostart is currently enabled
#[tauri::command]
pub async fn is_autostart_enabled(app_handle: AppHandle) -> VoltResult<bool> {
    if cfg!(debug_assertions) {
        return Ok(false);
    }

    #[cfg(all(windows, feature = "store"))]
    if msix_startup::has_package_identity() {
        return tauri::async_runtime::spawn_blocking(msix_startup::is_enabled)
            .await
            .map_err(|e| VoltError::Unknown(format!("Autostart task panicked: {}", e)))?;
    }

    app_handle
        .autolaunch()
        .is_enabled()
        .map_err(|e| VoltError::Unknown(format!("Failed to check autostart status: {}", e)))
}

/// Microsoft Store (MSIX) autostart.
///
/// Under MSIX, `tauri-plugin-autostart` (HKCU `...\CurrentVersion\Run`) is
/// ineffective: every HKCU write of a packaged app is copied-on-write into a
/// private per-package hive that Explorer never reads, and the exe path inside
/// `WindowsApps` changes on every update anyway. Packaged apps must declare a
/// `windows.startupTask` in the manifest and drive it through the WinRT
/// `StartupTask` API instead.
///
/// The task is declared on the hidden `VoltStartup` application in
/// `packaging/msix/AppxManifest.template.xml`, which passes `--hidden` so the
/// launcher stays in the background at logon (same contract as the regular
/// autostart registration).
#[cfg(all(windows, feature = "store"))]
mod msix_startup {
    use crate::core::error::{VoltError, VoltResult};
    use windows::ApplicationModel::{Package, StartupTask, StartupTaskState};
    use windows::core::HSTRING;

    /// Must match `desktop:StartupTask/@TaskId` in the MSIX manifest template.
    const TASK_ID: &str = "VoltStartup";

    /// True when the process runs with MSIX package identity. A `store` binary
    /// started outside a package (e.g. `cargo run --features store`) falls
    /// back to the regular autostart plugin.
    pub fn has_package_identity() -> bool {
        Package::Current().is_ok()
    }

    fn winrt_err(context: &str, e: windows::core::Error) -> VoltError {
        VoltError::Unknown(format!("{}: {}", context, e))
    }

    fn task() -> VoltResult<StartupTask> {
        StartupTask::GetAsync(&HSTRING::from(TASK_ID))
            .and_then(|op| op.get())
            .map_err(|e| winrt_err("MSIX startup task not found", e))
    }

    fn is_on(state: StartupTaskState) -> bool {
        state == StartupTaskState::Enabled || state == StartupTaskState::EnabledByPolicy
    }

    /// Blocking: call through `spawn_blocking`.
    pub fn enable() -> VoltResult<()> {
        let task = task()?;
        let state = task
            .State()
            .map_err(|e| winrt_err("Failed to read startup task state", e))?;
        if is_on(state) {
            return Ok(());
        }
        if state == StartupTaskState::DisabledByUser {
            // Windows forbids re-enabling programmatically once the user has
            // turned it off; only the user can flip it back.
            return Err(VoltError::InvalidConfig(
                "Volt startup was disabled in Windows. Re-enable it in Settings > Apps > Startup (or Task Manager > Startup apps)."
                    .to_string(),
            ));
        }
        if state == StartupTaskState::DisabledByPolicy {
            return Err(VoltError::InvalidConfig(
                "Volt startup is disabled by a system policy.".to_string(),
            ));
        }
        let new_state = task
            .RequestEnableAsync()
            .and_then(|op| op.get())
            .map_err(|e| winrt_err("Failed to enable startup task", e))?;
        if is_on(new_state) {
            Ok(())
        } else {
            Err(VoltError::InvalidConfig(format!(
                "Windows refused to enable the startup task (state {})",
                new_state.0
            )))
        }
    }

    /// Blocking: call through `spawn_blocking`.
    pub fn disable() -> VoltResult<()> {
        let task = task()?;
        let state = task
            .State()
            .map_err(|e| winrt_err("Failed to read startup task state", e))?;
        if state == StartupTaskState::EnabledByPolicy {
            return Err(VoltError::InvalidConfig(
                "Volt startup is enabled by a system policy and cannot be disabled from Volt."
                    .to_string(),
            ));
        }
        // `Disable()` is only valid from `Enabled`; every other state is
        // already off or not ours to change (EnabledByPolicy).
        if state == StartupTaskState::Enabled {
            task.Disable()
                .map_err(|e| winrt_err("Failed to disable startup task", e))?;
        }
        Ok(())
    }

    /// Blocking: call through `spawn_blocking`.
    pub fn is_enabled() -> VoltResult<bool> {
        let state = task()?
            .State()
            .map_err(|e| winrt_err("Failed to read startup task state", e))?;
        Ok(is_on(state))
    }
}

/// Set window position based on settings
#[tauri::command]
pub async fn set_window_position(
    app_handle: AppHandle,
    position: String,
    custom_x: Option<i32>,
    custom_y: Option<i32>,
) -> VoltResult<()> {
    let window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| VoltError::NotFound("Main window not found".to_string()))?;

    match position.as_str() {
        "center" => {
            window
                .as_ref()
                .window()
                .move_window(Position::Center)
                .map_err(|e| VoltError::Unknown(format!("Failed to center window: {}", e)))?;
        }
        "topLeft" => {
            window
                .as_ref()
                .window()
                .move_window(Position::TopLeft)
                .map_err(|e| {
                    VoltError::Unknown(format!("Failed to move window to top-left: {}", e))
                })?;
        }
        "topCenter" => {
            window
                .as_ref()
                .window()
                .move_window(Position::TopCenter)
                .map_err(|e| {
                    VoltError::Unknown(format!("Failed to move window to top-center: {}", e))
                })?;
        }
        "topRight" => {
            window
                .as_ref()
                .window()
                .move_window(Position::TopRight)
                .map_err(|e| {
                    VoltError::Unknown(format!("Failed to move window to top-right: {}", e))
                })?;
        }
        "bottomLeft" => {
            window
                .as_ref()
                .window()
                .move_window(Position::BottomLeft)
                .map_err(|e| {
                    VoltError::Unknown(format!("Failed to move window to bottom-left: {}", e))
                })?;
        }
        "bottomCenter" => {
            window
                .as_ref()
                .window()
                .move_window(Position::BottomCenter)
                .map_err(|e| {
                    VoltError::Unknown(format!("Failed to move window to bottom-center: {}", e))
                })?;
        }
        "bottomRight" => {
            window
                .as_ref()
                .window()
                .move_window(Position::BottomRight)
                .map_err(|e| {
                    VoltError::Unknown(format!("Failed to move window to bottom-right: {}", e))
                })?;
        }
        "leftCenter" => {
            window
                .as_ref()
                .window()
                .move_window(Position::LeftCenter)
                .map_err(|e| {
                    VoltError::Unknown(format!("Failed to move window to left-center: {}", e))
                })?;
        }
        "rightCenter" => {
            window
                .as_ref()
                .window()
                .move_window(Position::RightCenter)
                .map_err(|e| {
                    VoltError::Unknown(format!("Failed to move window to right-center: {}", e))
                })?;
        }
        "custom" => {
            if let (Some(x), Some(y)) = (custom_x, custom_y) {
                window
                    .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
                        x, y,
                    )))
                    .map_err(|e| {
                        VoltError::Unknown(format!("Failed to set custom position: {}", e))
                    })?;
            } else {
                return Err(VoltError::InvalidConfig(
                    "Custom position requires x and y coordinates".to_string(),
                ));
            }
        }
        _ => {
            return Err(VoltError::InvalidConfig(format!(
                "Invalid window position: {}",
                position
            )));
        }
    }

    Ok(())
}

/// Get current window position
#[tauri::command]
pub async fn get_window_position(app_handle: AppHandle) -> VoltResult<(i32, i32)> {
    let window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| VoltError::NotFound("Main window not found".to_string()))?;

    let position = window
        .outer_position()
        .map_err(|e| VoltError::Unknown(format!("Failed to get window position: {}", e)))?;

    Ok((position.x, position.y))
}
