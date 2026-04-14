//! Batch search command that combines app search, file search, and frecency
//! suggestions into a single IPC call, eliminating multiple roundtrips.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

use crate::commands::apps::{AppInfo, AppInfoWithScore};
use crate::commands::files::FileIndexState;
use crate::commands::launcher::{LaunchHistoryState, QueryBindingState};
use crate::core::error::{VoltError, VoltResult};
use crate::indexer::{
    FileInfo, SearchEngine, SearchOptions,
};
use crate::launcher::LaunchRecord;

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

/// Combined result from all search sources.
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

    // Apps + history for frecency search
    let history = history_state.history.clone();
    let apps_for_search = apps;

    // Query bindings for learned preferences (scoped to drop MutexGuard before await)
    let bindings_snapshot = {
        let bindings = binding_state.store.lock()
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

    // Clone query strings for the parallel tasks
    let query_apps = query.clone();
    let query_files = query.clone();

    // ---- Run all three searches concurrently ----

    let (app_results, file_results, frecency_results) = tokio::join!(
        // 1. App search with frecency scoring
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
        // 2. File search
        async {
            search_files_batch(&query_files, &files_snapshot, &options, max_results)
        },
        // 3. Frecency suggestions (top N)
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
        // Fast path: use SearchEngine for scored results
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
