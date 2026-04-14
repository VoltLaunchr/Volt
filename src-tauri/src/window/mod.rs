//! Window management module
//!
//! Provides commands for controlling the application window:
//! - show/hide/toggle visibility
//! - centering
//! - focus management
//! - multi-monitor positioning

use tauri::{AppHandle, Manager, Window};
use tracing::warn;

/// Shows the main window and sets focus
#[tauri::command]
pub fn show_window(window: Window) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Hides the main window
#[tauri::command]
pub fn hide_window(window: Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggles window visibility
///
/// If visible: hides the window
/// If hidden: shows and focuses the window
#[tauri::command]
pub fn toggle_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Window not found")?;

    if window.is_visible().map_err(|e| e.to_string())? {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Centers the window on the screen
#[tauri::command]
pub fn center_window(window: Window) -> Result<(), String> {
    window.center().map_err(|e| e.to_string())?;
    Ok(())
}

/// Core logic to center a window on the target monitor.
/// Can be called from both commands and the hotkey handler.
pub fn center_on_target_monitor(
    window: &tauri::WebviewWindow,
    show_on_screen: &str,
) -> Result<(), String> {
    let target = get_target_monitor_rect(show_on_screen);

    if let Some((mx, my, mw, mh)) = target {
        let win_size = window.outer_size().map_err(|e| e.to_string())?;
        let win_w = win_size.width as i32;
        let win_h = win_size.height as i32;

        let x = mx + (mw - win_w) / 2;
        let y = my + (mh - win_h) / 2;

        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    } else {
        window.center().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Position the window centered on the target monitor based on the
/// `show_on_screen` setting: "cursor", "focusedWindow", or "primaryScreen".
#[tauri::command]
pub async fn position_on_target_monitor(
    app: AppHandle,
    show_on_screen: String,
) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Window not found")?;

    center_on_target_monitor(&window, &show_on_screen)
}

/// Update the cached show_on_screen state so the hotkey handler uses the latest value.
#[tauri::command]
pub fn update_show_on_screen(app: AppHandle, value: String) -> Result<(), String> {
    if let Some(state) = app.try_state::<crate::ShowOnScreenState>() {
        if let Ok(mut current) = state.value.lock() {
            *current = value;
            Ok(())
        } else {
            Err("Failed to lock ShowOnScreenState".to_string())
        }
    } else {
        Err("ShowOnScreenState not found".to_string())
    }
}

/// Returns (x, y, width, height) of the target monitor based on the setting.
#[cfg(target_os = "windows")]
fn get_target_monitor_rect(show_on_screen: &str) -> Option<(i32, i32, i32, i32)> {
    use winapi::shared::windef::POINT;
    use winapi::um::winuser::{
        GetCursorPos, GetForegroundWindow, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
        MonitorFromPoint, MonitorFromWindow,
    };

    unsafe {
        match show_on_screen {
            "cursor" => {
                let mut pt = POINT { x: 0, y: 0 };
                if GetCursorPos(&mut pt) == 0 {
                    warn!("GetCursorPos failed");
                    return None;
                }
                let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
                monitor_rect(hmon)
            }
            "focusedWindow" => {
                let hwnd = GetForegroundWindow();
                if hwnd.is_null() {
                    warn!("No foreground window found, falling back to cursor");
                    return get_target_monitor_rect("cursor");
                }
                let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                monitor_rect(hmon)
            }
            "primaryScreen" => {
                let pt = POINT { x: 0, y: 0 };
                let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTOPRIMARY);
                monitor_rect(hmon)
            }
            _ => {
                warn!("Unknown show_on_screen value: {}", show_on_screen);
                None
            }
        }
    }
}

/// Helper to extract the work area rectangle from a monitor handle.
#[cfg(target_os = "windows")]
unsafe fn monitor_rect(hmon: winapi::shared::windef::HMONITOR) -> Option<(i32, i32, i32, i32)> {
    use std::mem;
    use winapi::um::winuser::{GetMonitorInfoW, MONITORINFO};

    if hmon.is_null() {
        return None;
    }
    unsafe {
        let mut mi: MONITORINFO = mem::zeroed();
        mi.cbSize = mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hmon, &mut mi) == 0 {
            return None;
        }
        // Use rcWork (work area, excludes taskbar) for better positioning
        let rc = mi.rcWork;
        Some((rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top))
    }
}

/// Non-Windows fallback: always returns None so the caller uses `window.center()`.
#[cfg(not(target_os = "windows"))]
fn get_target_monitor_rect(_show_on_screen: &str) -> Option<(i32, i32, i32, i32)> {
    None
}
