//! Search commands: batch (`search_all`) and streaming (`search_streaming`).
//!
//! `search_all` combines app search, file search, and frecency suggestions
//! into a single IPC call via `tokio::join!`.
//!
//! `search_streaming` sends results incrementally via a Tauri Channel as each
//! search source completes, so the UI can render partial results immediately.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tauri::ipc::Channel;

use crate::commands::apps::{AppInfo, AppInfoWithScore};
use crate::commands::files::FileIndexState;
use crate::commands::launcher::{LaunchHistoryState, QueryBindingState};
use crate::core::error::{VoltError, VoltResult};
use crate::indexer::{FileInfo, SearchEngine, SearchOptions};
use crate::launcher::LaunchRecord;

// ============================================================
// Shared types
// ============================================================

/// Options for the unified search command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAllOptions {
    pub query: String,
    pub max_results: usize,
    pub ext_filter: Option<String>,
    pub dir_filter: Option<String>,
    pub size_min: Option<u64>,
    pub size_max: Option<u64>,
    pub modified_after: Option<i64>,
    pub modified_before: Option<i64>,
}

/// Combined result from all search sources (batch mode).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAllResult {
    pub apps: Vec<AppInfoWithScore>,
    pub files: Vec<FileSearchResultCompact>,
    pub frecency_suggestions: Vec<LaunchRecord>,
}

/// Compact file search result with score for the batch endpoint.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResultCompact {
    #[serde(flatten)]
    pub file: FileInfo,
    pub score: u32,
}

/// A batch of results streamed to the frontend via a Tauri Channel.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum SearchBatch {
    /// Application search results with frecency scoring.
    Apps { results: Vec<AppInfoWithScore> },
    /// File search results.
    Files {
        results: Vec<FileSearchResultCompact>,
    },
    /// All sources have finished.
    Done,
}

// ============================================================
// Batch search command (search_all)
// ============================================================

/// Perform app search, file search, and frecency suggestions in a single IPC
/// call.  The three searches run concurrently via `tokio::join!`.
#[tauri::command]
pub async fn search_all(
    options: SearchAllOptions,
    apps: Vec<AppInfo>,
    file_state: State<'_, FileIndexState>,
    history_state: State<'_, LaunchHistoryState>,
    binding_state: State<'_, QueryBindingState>,
) -> VoltResult<SearchAllResult> {
    let query = options.query.clone();
    let max_results = options.max_results;

    // ---- Prepare shared data (all cheap clones) ----

    let history = history_state.history.clone();
    let apps_for_search = apps;

    // Query bindings for learned preferences (scoped to drop MutexGuard before await)
    let bindings_snapshot = {
        let bindings = binding_state
            .store
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        bindings.clone()
    };

    // File index snapshot (O(1) Arc clone)
    let files_snapshot = {
        let guard = file_state
            .files
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        Arc::clone(&guard)
    };

    let query_apps = query.clone();
    let query_files = query.clone();

    // ---- Run all three searches concurrently ----

    let (app_results, file_results, frecency_results) = tokio::join!(
        async {
            let all_history = history.get_all();
            crate::search::search_applications_with_frecency(
                &query_apps,
                apps_for_search,
                &all_history,
                Some(&bindings_snapshot),
            )
            .into_iter()
            .map(|(app, score)| AppInfoWithScore { app, score })
            .collect::<Vec<_>>()
        },
        async { search_files_batch(&query_files, &files_snapshot, &options, max_results) },
        async {
            let mut records = history.get_all();
            records.sort_by(|a, b| {
                let fa = crate::search::calculate_frecency(a);
                let fb = crate::search::calculate_frecency(b);
                fb.partial_cmp(&fa).unwrap_or(std::cmp::Ordering::Equal)
            });
            records.sort_by(|a, b| b.pinned.cmp(&a.pinned));
            records.truncate(5);
            records
        },
    );

    Ok(SearchAllResult {
        apps: app_results,
        files: file_results,
        frecency_suggestions: frecency_results,
    })
}

// ============================================================
// Streaming search command (search_streaming)
// ============================================================

/// Perform a streaming search: apps and files run concurrently and their
/// results are sent to the frontend as each source completes.
#[tauri::command]
pub async fn search_streaming(
    options: SearchAllOptions,
    apps: Vec<AppInfo>,
    on_event: Channel<SearchBatch>,
    file_state: State<'_, FileIndexState>,
    history_state: State<'_, LaunchHistoryState>,
    binding_state: State<'_, QueryBindingState>,
) -> Result<(), String> {
    let query = options.query.clone();
    let max_results = options.max_results;

    // Extract data from State<'_> before spawning (State is not Send)
    let history = history_state.history.clone();
    let bindings_snapshot = {
        let bindings = binding_state.store.lock().map_err(|e| e.to_string())?;
        bindings.clone()
    };
    let files_snapshot = {
        let guard = file_state.files.lock().map_err(|e| e.to_string())?;
        Arc::clone(&guard)
    };

    let query_apps = query.clone();
    let query_files = query.clone();
    let options_clone = options.clone();

    // Spawn concurrent tasks, collect via mpsc
    let (tx, mut rx) = tokio::sync::mpsc::channel::<SearchBatch>(4);

    // --- App search task ---
    let tx_apps = tx.clone();
    tokio::spawn(async move {
        let history_records = history.get_all();
        let results = crate::search::search_applications_with_frecency(
            &query_apps,
            apps,
            &history_records,
            Some(&bindings_snapshot),
        );
        let scored: Vec<AppInfoWithScore> = results
            .into_iter()
            .map(|(app, score)| AppInfoWithScore { app, score })
            .collect();
        let _ = tx_apps.send(SearchBatch::Apps { results: scored }).await;
    });

    // --- File search task ---
    let tx_files = tx.clone();
    tokio::spawn(async move {
        let file_results =
            search_files_batch(&query_files, &files_snapshot, &options_clone, max_results);
        let _ = tx_files
            .send(SearchBatch::Files {
                results: file_results,
            })
            .await;
    });

    // Drop sender so rx completes after both tasks finish
    drop(tx);

    // Forward results to frontend Channel as they arrive
    while let Some(batch) = rx.recv().await {
        on_event.send(batch).map_err(|e| e.to_string())?;
    }

    // Signal completion
    on_event
        .send(SearchBatch::Done)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================
// Shared helper
// ============================================================

/// Internal helper: search files with optional operator filters.
fn search_files_batch(
    query: &str,
    files: &[FileInfo],
    options: &SearchAllOptions,
    max_results: usize,
) -> Vec<FileSearchResultCompact> {
    let has_operators = options.ext_filter.is_some()
        || options.dir_filter.is_some()
        || options.size_min.is_some()
        || options.size_max.is_some()
        || options.modified_after.is_some()
        || options.modified_before.is_some();

    if has_operators {
        let mut engine = SearchEngine::new();
        let search_opts = SearchOptions {
            limit: Some(max_results),
            ext_filter: options.ext_filter.clone(),
            dir_filter: options.dir_filter.clone(),
            size_min: options.size_min,
            size_max: options.size_max,
            modified_after: options.modified_after,
            modified_before: options.modified_before,
            recency_boost: Some(1.3),
            frequency_boost: Some(1.2),
            ..Default::default()
        };
        engine
            .search(query, files, &search_opts)
            .into_iter()
            .map(|r| FileSearchResultCompact {
                file: r.file,
                score: r.score,
            })
            .collect()
    } else {
        let mut engine = SearchEngine::new();
        let search_opts = SearchOptions {
            limit: Some(max_results),
            ..Default::default()
        };
        engine
            .search(query, files, &search_opts)
            .into_iter()
            .map(|r| FileSearchResultCompact {
                file: r.file,
                score: r.score,
            })
            .collect()
    }
}
