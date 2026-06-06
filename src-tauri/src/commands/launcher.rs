//! Launcher commands for Tauri
//!
//! Provides commands for launching applications, managing history, and tracking usage.

use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tracing::{info, warn};

use crate::core::error::{VoltError, VoltResult};
use crate::launcher::{
    LaunchError, LaunchHistory, LaunchOptions, LaunchRecord, QueryBindingStore, launch,
    launch_with_options,
};

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

/// Canonical launch routine shared by `launch_app` and `launch_application`.
///
/// Validates the path, launches with optional elevation, then records the
/// launch in history (so frecency / recents stay accurate regardless of which
/// command the caller used). Returns mapped `VoltError` variants instead of
/// the raw `LaunchError` so the IPC boundary surfaces typed errors to the
/// frontend (`isVoltError()`).
pub(crate) fn execute_launch(
    path: &str,
    as_admin: bool,
    history: &LaunchHistory,
) -> VoltResult<()> {
    // Validate the path before launching to block dangerous executables and
    // ensure only legitimate application paths are executed.
    crate::utils::launch_validation::validate_launch_path(path).map_err(VoltError::Launch)?;

    let result = if as_admin {
        let opts = LaunchOptions {
            elevated: true,
            ..LaunchOptions::default()
        };
        launch_with_options(path, opts)
    } else {
        launch(path)
    };

    match result {
        Ok(launched) => {
            let name = PathBuf::from(path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string());
            info!(
                "Launched application: {} (PID: {:?}, elevated: {})",
                name, launched.pid, as_admin
            );
            if let Err(e) = history.record_launch(path, &name) {
                warn!("Failed to record launch in history: {}", e);
            }
            Ok(())
        }
        Err(e) => Err(map_launch_error(e)),
    }
}

fn map_launch_error(e: LaunchError) -> VoltError {
    match e {
        LaunchError::NotFound { path } => {
            VoltError::NotFound(format!("Application not found: {}", path))
        }
        LaunchError::PermissionDenied { path, message } => {
            VoltError::PermissionDenied(format!("Permission denied for '{}': {}", path, message))
        }
        LaunchError::SpawnFailed { path, message } => {
            VoltError::Launch(format!("Failed to launch '{}': {}", path, message))
        }
        _ => VoltError::Launch(format!("Failed to launch application: {}", e)),
    }
}

/// Launch an application and track it in history.
///
/// Canonical launch command. Pass `as_admin: Some(true)` to elevate on
/// Windows (ShellExecuteW "runas"). The legacy `launch_application` command
/// is a thin wrapper around the same `execute_launch` helper so frecency is
/// consistent across both call sites.
#[tauri::command]
pub async fn launch_app(
    path: String,
    as_admin: Option<bool>,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<()> {
    execute_launch(&path, as_admin.unwrap_or(false), &history_state.history)
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
    if limit == 0 {
        return Ok(Vec::new());
    }

    // Rank under the lock on a cheap projection (`pinned`, frecency score, and
    // a borrowed key) so we never clone the whole `HashMap<String,
    // LaunchRecord>` — each record owns two `String`s and a `Vec<String>`.
    // Only the top-N survivors are cloned out of the map afterwards.
    let records = history_state.history.with_records(|records| {
        // (pinned, frecency_date, key) — `&String` borrow lives only inside the closure.
        let mut ranked: Vec<(bool, i64, &String)> = records
            .iter()
            .map(|(key, record)| (record.pinned, record.frecency_date, key))
            .collect();

        // Compound-key sort: pinned first, then by frecency_date descending
        // (the Mozilla-style monotonic timestamp — no query-time math needed).
        let order = |a: &(bool, i64, &String), b: &(bool, i64, &String)| {
            b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1))
        };

        if ranked.len() > limit {
            // `len > limit` guarantees index `limit` is in bounds. Mirrors the
            // partial-sort pattern in `get_recent`/`get_frequent`.
            ranked.select_nth_unstable_by(limit, order);
            ranked.truncate(limit);
        }
        ranked.sort_by(order);

        // Clone only the top-N survivors.
        ranked
            .into_iter()
            .filter_map(|(_, _, key)| records.get(key).cloned())
            .collect::<Vec<LaunchRecord>>()
    });

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

/// Open a file using the OS "Open With" dialog so the user can choose which
/// application to use. On Windows this triggers the native shell "Open With"
/// dialog via the "openas" verb. Other platforms fall back to the default
/// opener (same as `open_path`).
///
/// Rejects UNC paths (which would trigger SMB auth and leak NTLM credentials)
/// and `.lnk` shortcuts (which `ShellExecuteW("openas", ...)` would silently
/// resolve, defeating the dialog). Resolves the path through `canonicalize`
/// to defeat traversal/relative-path tricks before invoking ShellExecute.
#[tauri::command]
pub async fn open_file_with_dialog(path: String) -> VoltResult<()> {
    let p = std::path::Path::new(&path);

    if path.starts_with("\\\\") || path.starts_with("//") {
        return Err(VoltError::PermissionDenied(
            "UNC paths are not allowed".into(),
        ));
    }
    if p.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("lnk"))
        .unwrap_or(false)
    {
        return Err(VoltError::PermissionDenied(
            ".lnk shortcuts are not allowed".into(),
        ));
    }

    let canon = p
        .canonicalize()
        .map_err(|e| VoltError::FileSystem(format!("canonicalize: {}", e)))?;

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;
        use winapi::um::shellapi::ShellExecuteW;

        let operation: Vec<u16> = OsStr::new("openas")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let file: Vec<u16> = canon
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let result = ShellExecuteW(
                ptr::null_mut(),
                operation.as_ptr(),
                file.as_ptr(),
                ptr::null(),
                ptr::null(),
                1, // SW_SHOWNORMAL
            );
            if (result as usize) <= 32 {
                return Err(VoltError::Launch(format!(
                    "Open With dialog failed (code {})",
                    result as usize
                )));
            }
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        tauri_plugin_opener::open_path(canon.to_string_lossy().as_ref(), None::<&str>)
            .map_err(|e| VoltError::Launch(format!("Failed to open: {}", e)))
    }
}

/// Open a file or folder in the system's default handler (Explorer on Windows,
/// Finder on macOS, xdg-open on Linux).
///
/// Used by the Games view's "Open Folder" button and any UI affordance that
/// needs to reveal a path on disk.
///
/// Refuses executable file types so attackers cannot abuse this command to
/// bypass `launch_app`'s LOLBIN/extension validation. Callers that need to
/// run an executable must use `launch_app`.
#[tauri::command]
pub async fn open_path(path: String) -> VoltResult<()> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(VoltError::NotFound(format!("Path not found: {}", path)));
    }
    if p.is_file()
        && let Some(ext) = p.extension().and_then(|e| e.to_str())
    {
        const BLOCKED_OPEN_EXT: &[&str] = &[
            "exe",
            "msi",
            "scr",
            "com",
            "bat",
            "cmd",
            "ps1",
            "psm1",
            "vbs",
            "vbe",
            "js",
            "jse",
            "wsf",
            "wsh",
            "cpl",
            "lnk",
            "msc",
            "jar",
            "reg",
            "hta",
            "appref-ms",
            "url",
        ];
        let lower = ext.to_ascii_lowercase();
        if BLOCKED_OPEN_EXT.contains(&lower.as_str()) {
            return Err(VoltError::PermissionDenied(format!(
                "open_path refuses executable type '.{}'; use launch_app instead",
                ext
            )));
        }
    }
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| VoltError::Launch(format!("Failed to open path: {}", e)))?;
    Ok(())
}
