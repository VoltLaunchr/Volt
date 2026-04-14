//! Streaming search command using Tauri Channels.
//!
//! Sends results incrementally as each search source completes,
//! so the UI can render partial results without waiting for all sources.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::commands::apps::{AppInfo, AppInfoWithScore};
use crate::commands::files::FileIndexState;
use crate::commands::launcher::LaunchHistoryState;
use crate::indexer::search_files as search_indexed_files;

/// A batch of results streamed to the frontend via a Tauri Channel.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum SearchBatch {
    /// Application search results with frecency scoring.
    Apps { results: Vec<AppInfoWithScore> },
    /// File search results.
    Files { results: Vec<crate::indexer::FileInfo> },
    /// All sources have finished.
    Done,
}

/// Perform a streaming search: apps and files run concurrently and their
/// results are sent to the frontend as each source completes.
///
/// The frontend passes a `Channel<SearchBatch>` which receives ordered
/// messages. The command returns `Ok(())` only after all sources have
/// been processed and a `Done` event has been sent.
#[tauri::command]
pub async fn search_streaming(
    query: String,
    apps: Vec<AppInfo>,
    limit: Option<usize>,
    // Operator filters forwarded from the frontend query parser
    ext: Option<String>,
    dir: Option<String>,
    size_min: Option<u64>,
    size_max: Option<u64>,
    modified_after: Option<i64>,
    modified_before: Option<i64>,
    on_event: Channel<SearchBatch>,
    file_state: State<'_, FileIndexState>,
    history_state: State<'_, LaunchHistoryState>,
) -> Result<(), String> {
    let max_files = limit.unwrap_or(20);

    // ---------------------------------------------------------------
    // Extract data from State<'_> so we can move into spawned tasks.
    // State borrows are not Send/'static, so we must clone the inner
    // Arc values before spawning.
    // ---------------------------------------------------------------

    // App search data
    let history = history_state.history.clone();
    let query_for_apps = query.clone();
    let apps_owned = apps;

    // File search data — clone the Vec<FileInfo> out of the mutex
    let files_snapshot: Vec<crate::indexer::FileInfo> = {
        file_state
            .files
            .lock()
            .map_err(|e| format!("Failed to lock file index: {}", e))?
            .clone()
    };
    let query_for_files = query.clone();

    // Check if we have operator filters
    let has_operators = ext.is_some()
        || dir.is_some()
        || size_min.is_some()
        || size_max.is_some()
        || modified_after.is_some()
        || modified_before.is_some();

    // ---------------------------------------------------------------
    // Spawn concurrent tasks via tokio, collect results with mpsc
    // ---------------------------------------------------------------
    let (tx, mut rx) = tokio::sync::mpsc::channel::<SearchBatch>(4);

    // --- App search task ---
    let tx_apps = tx.clone();
    tokio::spawn(async move {
        let history_records = history.get_all();
        let results =
            crate::search::search_applications_with_frecency(&query_for_apps, apps_owned, &history_records);
        let scored: Vec<AppInfoWithScore> = results
            .into_iter()
            .map(|(app, score)| AppInfoWithScore { app, score })
            .collect();
        let _ = tx_apps.send(SearchBatch::Apps { results: scored }).await;
    });

    // --- File search task ---
    let tx_files = tx.clone();
    tokio::spawn(async move {
        let file_results = if has_operators {
            // Advanced search with operator filters
            use crate::indexer::search_engine::{SearchEngine, SearchOptions};
            let mut engine = SearchEngine::new();
            let options = SearchOptions {
                limit: Some(max_files),
                ext_filter: ext,
                dir_filter: dir,
                size_min,
                size_max,
                modified_after,
                modified_before,
                recency_boost: Some(1.3),
                frequency_boost: Some(1.2),
                ..Default::default()
            };
            let results = engine.search(&query_for_files, &files_snapshot, &options);
            results.into_iter().map(|r| r.file).collect::<Vec<_>>()
        } else {
            // Simple search (no operators)
            let mut results = search_indexed_files(&query_for_files, &files_snapshot);

            // Supplement with Windows Search Index if results are sparse
            #[cfg(target_os = "windows")]
            if results.len() < max_files {
                let needed = max_files - results.len();
                if let Ok(ws_results) =
                    crate::indexer::windows_search::search_windows_index(&query_for_files, needed)
                {
                    let existing_paths: std::collections::HashSet<String> =
                        results.iter().map(|f| f.path.clone()).collect();
                    for file in ws_results {
                        if !existing_paths.contains(&file.path) {
                            results.push(file);
                        }
                    }
                }
            }

            results.truncate(max_files);
            results
        };
        let _ = tx_files
            .send(SearchBatch::Files {
                results: file_results,
            })
            .await;
    });

    // Drop our copy of tx so the channel closes after both tasks finish.
    drop(tx);

    // ---------------------------------------------------------------
    // Forward results to the frontend Channel as they arrive
    // ---------------------------------------------------------------
    while let Some(batch) = rx.recv().await {
        on_event.send(batch).map_err(|e| e.to_string())?;
    }

    // Signal completion
    on_event
        .send(SearchBatch::Done)
        .map_err(|e| e.to_string())?;

    Ok(())
}
