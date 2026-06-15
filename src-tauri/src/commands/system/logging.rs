use crate::core::error::{VoltError, VoltResult};
use tauri::{AppHandle, Manager};

/// Returns the absolute path to the directory that contains Volt's log files.
///
/// The frontend uses this to power the "Open logs folder" button.
#[tauri::command]
pub fn get_log_file_path(app: AppHandle) -> VoltResult<String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| VoltError::FileSystem(format!("Failed to get app data dir: {}", e)))?;
    let log_dir = data_dir.join("logs");
    Ok(log_dir.to_string_lossy().to_string())
}
