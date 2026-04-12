//! Window management module
//!
//! Provides commands for controlling the application window:
//! - show/hide/toggle visibility
//! - centering
//! - focus management

use tauri::{AppHandle, Manager, Window};

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
