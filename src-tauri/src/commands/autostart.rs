use crate::core::error::{VoltError, VoltResult};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_positioner::{Position, WindowExt};
use tracing::info;

/// Enable autostart on system boot
#[tauri::command]
pub async fn enable_autostart(app_handle: AppHandle) -> VoltResult<()> {
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
    app_handle
        .autolaunch()
        .is_enabled()
        .map_err(|e| VoltError::Unknown(format!("Failed to check autostart status: {}", e)))
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
