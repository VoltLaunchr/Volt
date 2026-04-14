//! Launcher commands for Tauri
//!
//! Provides commands for launching applications, managing history, and tracking usage.

use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tracing::{info, warn};

use crate::core::error::{VoltError, VoltResult};
use crate::launcher::{LaunchError, LaunchHistory, LaunchRecord, QueryBindingStore, launch};

/// State wrapper for launch history
pub struct LaunchHistoryState {
    pub history: Arc<LaunchHistory>,
}

impl LaunchHistoryState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            history: Arc::new(LaunchHistory::new(data_dir)),
        }
    }
}

/// State wrapper for query-result bindings
pub struct QueryBindingState {
    pub store: std::sync::Mutex<QueryBindingStore>,
    pub file_path: PathBuf,
}

impl QueryBindingState {
    pub fn new(data_dir: PathBuf) -> Self {
        let file_path = data_dir.join("query_bindings.json");
        let store = QueryBindingStore::load(&file_path);
        Self {
            store: std::sync::Mutex::new(store),
            file_path,
        }
    }
}

/// Launch an application and track it in history
#[tauri::command]
pub async fn launch_app(
    path: String,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<()> {
    // Attempt to launch directly; let the launcher module handle missing-file errors
    match launch(&path) {
        Ok(result) => {
            // Extract app name from path for history
            let name = PathBuf::from(&path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string());

            info!("Launched application: {} (PID: {:?})", name, result.pid);

            // Record in history
            if let Err(e) = history_state.history.record_launch(&path, &name) {
                warn!("Failed to record launch in history: {}", e);
            }

            Ok(())
        }
        Err(e) => match e {
            LaunchError::NotFound { path } => Err(VoltError::NotFound(format!(
                "Application not found: {}",
                path
            ))),
            LaunchError::PermissionDenied { path, message } => Err(VoltError::PermissionDenied(
                format!("Permission denied for '{}': {}", path, message),
            )),
            LaunchError::SpawnFailed { path, message } => Err(VoltError::Launch(format!(
                "Failed to launch '{}': {}",
                path, message
            ))),
            _ => Err(VoltError::Launch(format!(
                "Failed to launch application: {}",
                e
            ))),
        },
    }
}

/// Get recently launched applications
#[tauri::command]
pub async fn get_recent_apps(
    limit: Option<usize>,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<Vec<LaunchRecord>> {
    let limit = limit.unwrap_or(10);
    Ok(history_state.history.get_recent(limit))
}

/// Get most frequently launched applications
#[tauri::command]
pub async fn get_frequent_apps(
    limit: Option<usize>,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<Vec<LaunchRecord>> {
    let limit = limit.unwrap_or(10);
    Ok(history_state.history.get_frequent(limit))
}

/// Get pinned/favorite applications
#[tauri::command]
pub async fn get_pinned_apps(
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<Vec<LaunchRecord>> {
    Ok(history_state.history.get_pinned())
}

/// Pin an application
#[tauri::command]
pub async fn pin_app(path: String, history_state: State<'_, LaunchHistoryState>) -> VoltResult<()> {
    history_state.history.pin(&path).map_err(VoltError::Unknown)
}

/// Unpin an application
#[tauri::command]
pub async fn unpin_app(
    path: String,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<()> {
    history_state
        .history
        .unpin(&path)
        .map_err(VoltError::Unknown)
}

/// Add a tag to an application
#[tauri::command]
pub async fn add_app_tag(
    path: String,
    tag: String,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<()> {
    history_state
        .history
        .add_tag(&path, &tag)
        .map_err(VoltError::Unknown)
}

/// Remove a tag from an application
#[tauri::command]
pub async fn remove_app_tag(
    path: String,
    tag: String,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<()> {
    history_state
        .history
        .remove_tag(&path, &tag)
        .map_err(VoltError::Unknown)
}

/// Get applications by tag
#[tauri::command]
pub async fn get_apps_by_tag(
    tag: String,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<Vec<LaunchRecord>> {
    Ok(history_state.history.get_by_tag(&tag))
}

/// Get all tags used in history
#[tauri::command]
pub async fn get_all_tags(history_state: State<'_, LaunchHistoryState>) -> VoltResult<Vec<String>> {
    Ok(history_state.history.get_all_tags())
}

/// Get launch history for a specific app
#[tauri::command]
pub async fn get_app_history(
    path: String,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<Option<LaunchRecord>> {
    Ok(history_state.history.get(&path))
}

/// Clear all launch history
#[tauri::command]
pub async fn clear_launch_history(history_state: State<'_, LaunchHistoryState>) -> VoltResult<()> {
    history_state.history.clear().map_err(VoltError::Unknown)
}

/// Remove a specific app from history
#[tauri::command]
pub async fn remove_from_history(
    path: String,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<()> {
    history_state
        .history
        .remove(&path)
        .map_err(VoltError::Unknown)
}

/// Get total count of apps in history
#[tauri::command]
pub async fn get_history_count(history_state: State<'_, LaunchHistoryState>) -> VoltResult<usize> {
    Ok(history_state.history.count())
}

/// Get top frecency suggestions (for empty query / predictive results)
#[tauri::command]
pub async fn get_frecency_suggestions(
    limit: Option<usize>,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<Vec<LaunchRecord>> {
    let limit = limit.unwrap_or(8);
    let mut records = history_state.history.get_all();

    // Sort by frecency score descending
    records.sort_by(|a, b| {
        let fa = crate::search::calculate_frecency(a);
        let fb = crate::search::calculate_frecency(b);
        fb.partial_cmp(&fa).unwrap_or(std::cmp::Ordering::Equal)
    });

    // Pinned items always first
    records.sort_by(|a, b| b.pinned.cmp(&a.pinned));

    records.truncate(limit);
    Ok(records)
}

/// Record a query→result binding when the user selects a search result.
/// This enables the system to learn which results the user prefers for
/// specific query prefixes (e.g. "ch" → Chrome).
#[tauri::command]
pub async fn record_search_selection(
    query: String,
    result_id: String,
    binding_state: State<'_, QueryBindingState>,
) -> VoltResult<()> {
    // Clone store snapshot while holding the lock briefly, then release before I/O
    let (store_snapshot, file_path) = {
        let mut store = binding_state
            .store
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        store.record_binding(&query, &result_id);
        (store.clone(), binding_state.file_path.clone())
    }; // MutexGuard dropped here — before disk I/O

    store_snapshot
        .save(&file_path)
        .map_err(VoltError::Unknown)?;

    info!("Recorded query binding: '{}' -> '{}'", query, result_id);

    Ok(())
}
