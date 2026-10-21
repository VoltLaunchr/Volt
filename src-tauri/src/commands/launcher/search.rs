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
#[cfg(feature = "tantivy-search")]
use tracing::warn;

use crate::commands::apps::AppInfoWithScore;
use crate::commands::files::FileIndexState;
#[cfg(feature = "tantivy-search")]
use crate::commands::files::search_files_fulltext;
use crate::commands::launcher::apps::scan_applications_with_options;
use crate::commands::launcher::{LaunchHistoryState, QueryBindingState};
use crate::commands::settings::AppShortcut;
use crate::core::error::{VoltError, VoltResult};
#[cfg(feature = "tantivy-search")]
use crate::indexer::fulltext::{FulltextIndex, FulltextQueryOptions};
use crate::indexer::{FileInfo, SearchEngine, SearchOptions};
use crate::launcher::LaunchRecord;

/// Build a `path → alias` map from a list of shortcuts, skipping entries
/// that are disabled or have no alias configured. Used by the cascade ranker
/// to surface alias-exact / alias-prefix tiers.
fn build_alias_map(shortcuts: &[AppShortcut]) -> std::collections::HashMap<String, String> {
    shortcuts
        .iter()
        .filter(|s| s.enabled)
        .filter_map(|s| {
            let alias = s.alias.as_ref()?.trim();
            if alias.is_empty() {
                None
            } else {
                Some((s.path.clone(), alias.to_string()))
            }
        })
        .collect()
}

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
///
/// Reads the app catalog from `SCAN_CACHE` instead of taking it as a
/// parameter — the frontend no longer needs to re-send the full `AppInfo`
/// list (icons included) over IPC on every keystroke.
#[tauri::command]
pub async fn search_all(
    options: SearchAllOptions,
    shortcuts: Option<Vec<AppShortcut>>,
    file_state: State<'_, FileIndexState>,
    history_state: State<'_, LaunchHistoryState>,
    binding_state: State<'_, QueryBindingState>,
) -> VoltResult<SearchAllResult> {
    crate::time_command!("search_all");

    let query = options.query.clone();
    let max_results = options.max_results;

    // ---- Prepare shared data (all cheap clones) ----

    let history = history_state.history.clone();
    let apps_for_search = scan_applications_with_options(false).await?;
    let aliases = shortcuts
        .as_deref()
        .map(build_alias_map)
        .unwrap_or_default();

    // Query bindings for learned preferences (scoped to drop MutexGuard before await)
    let bindings_snapshot = {
        let bindings = binding_state
            .store
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        bindings.clone()
    };

    // File index snapshot (O(1) Arc clones). With Tantivy enabled, take both
    // locks together so lookup positions always match the file vector.
    #[cfg(feature = "tantivy-search")]
    let (files_snapshot, file_lookup) = {
        let files_guard = file_state
            .files
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        let lookup_guard = file_state
            .file_lookup
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        (Arc::clone(&files_guard), Arc::clone(&lookup_guard))
    };
    #[cfg(not(feature = "tantivy-search"))]
    let files_snapshot = {
        let guard = file_state
            .files
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        Arc::clone(&guard)
    };
    #[cfg(feature = "tantivy-search")]
    let file_fulltext = file_state.fulltext.clone();

    let query_apps = query.clone();
    let query_files = query.clone();
    #[cfg(feature = "tantivy-search")]
    let file_results_future = search_files_batch(
        &query_files,
        &files_snapshot,
        &options,
        max_results,
        file_fulltext,
        file_lookup,
    );
    #[cfg(not(feature = "tantivy-search"))]
    let file_results_future =
        search_files_batch(&query_files, &files_snapshot, &options, max_results);

    // ---- Run all three searches concurrently ----

    let (app_results, file_results, frecency_results) = tokio::join!(
        async {
            // Project history into a path→frecency map under the lock; avoids
            // cloning the whole record set just to score app matches.
            let frecency = history.with_records(|records| {
                records
                    .iter()
                    .map(|(path, record)| (path.clone(), record.frecency_date))
                    .collect::<std::collections::HashMap<String, i64>>()
            });
            crate::search::search_applications_with_frecency(
                &query_apps,
                apps_for_search,
                &frecency,
                Some(&bindings_snapshot),
                &aliases,
            )
            .into_iter()
            .map(|(app, score)| AppInfoWithScore { app, score })
            .collect::<Vec<_>>()
        },
        file_results_future,
        async {
            // Compound-key sort: pinned first, then by frecency. Sort over
            // references under the lock and clone only the top 5 survivors
            // instead of cloning every record up front.
            history.with_records(|records| {
                let mut refs: Vec<&LaunchRecord> = records.values().collect();
                refs.sort_by(|a, b| {
                    b.pinned
                        .cmp(&a.pinned)
                        .then_with(|| b.frecency_date.cmp(&a.frecency_date))
                });
                refs.into_iter()
                    .take(5)
                    .cloned()
                    .collect::<Vec<LaunchRecord>>()
            })
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
///
/// Reads the app catalog from `SCAN_CACHE` instead of taking it as a parameter.
#[tauri::command]
pub async fn search_streaming(
    options: SearchAllOptions,
    shortcuts: Option<Vec<AppShortcut>>,
    on_event: Channel<SearchBatch>,
    file_state: State<'_, FileIndexState>,
    history_state: State<'_, LaunchHistoryState>,
    binding_state: State<'_, QueryBindingState>,
) -> Result<(), String> {
    crate::time_command!("search_streaming");

    let apps = scan_applications_with_options(false)
        .await
        .map_err(|e| e.to_string())?;
    let query = options.query.clone();
    let max_results = options.max_results;
    let aliases = shortcuts
        .as_deref()
        .map(build_alias_map)
        .unwrap_or_default();

    // Extract data from State<'_> before spawning (State is not Send)
    let history = history_state.history.clone();
    let bindings_snapshot = {
        let bindings = binding_state.store.lock().map_err(|e| e.to_string())?;
        bindings.clone()
    };
    #[cfg(feature = "tantivy-search")]
    let (files_snapshot, file_lookup) = {
        let files_guard = file_state.files.lock().map_err(|e| e.to_string())?;
        let lookup_guard = file_state.file_lookup.lock().map_err(|e| e.to_string())?;
        (Arc::clone(&files_guard), Arc::clone(&lookup_guard))
    };
    #[cfg(not(feature = "tantivy-search"))]
    let files_snapshot = {
        let guard = file_state.files.lock().map_err(|e| e.to_string())?;
        Arc::clone(&guard)
    };
    #[cfg(feature = "tantivy-search")]
    let file_fulltext = file_state.fulltext.clone();

    let query_apps = query.clone();
    let query_files = query.clone();
    let options_clone = options.clone();

    // Spawn concurrent tasks, collect via mpsc
    let (tx, mut rx) = tokio::sync::mpsc::channel::<SearchBatch>(4);

    // --- App search task ---
    let tx_apps = tx.clone();
    let aliases_for_apps = aliases;
    tokio::spawn(async move {
        // Project history into a path→frecency map under the lock; avoids
        // cloning the whole record set per streaming search.
        let frecency = history.with_records(|records| {
            records
                .iter()
                .map(|(path, record)| (path.clone(), record.frecency_date))
                .collect::<std::collections::HashMap<String, i64>>()
        });
        let results = crate::search::search_applications_with_frecency(
            &query_apps,
            apps,
            &frecency,
            Some(&bindings_snapshot),
            &aliases_for_apps,
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
        #[cfg(feature = "tantivy-search")]
        let file_results = search_files_batch(
            &query_files,
            &files_snapshot,
            &options_clone,
            max_results,
            file_fulltext,
            file_lookup,
        )
        .await;
        #[cfg(not(feature = "tantivy-search"))]
        let file_results =
            search_files_batch(&query_files, &files_snapshot, &options_clone, max_results).await;
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
///
/// For unfiltered searches, Windows Search supplements sparse Volt results while
/// indexing is still in progress. Filtered searches stay entirely within Volt so
/// every returned file respects the requested metadata constraints.
async fn search_files_batch(
    query: &str,
    files: &[FileInfo],
    options: &SearchAllOptions,
    max_results: usize,
    #[cfg(feature = "tantivy-search")] fulltext: Option<Arc<FulltextIndex>>,
    #[cfg(feature = "tantivy-search")] file_lookup: Arc<std::collections::HashMap<String, usize>>,
) -> Vec<FileSearchResultCompact> {
    let has_operators = options.ext_filter.is_some()
        || options.dir_filter.is_some()
        || options.size_min.is_some()
        || options.size_max.is_some()
        || options.modified_after.is_some()
        || options.modified_before.is_some();

    let nucleo_fallback = || {
        let mut engine = SearchEngine::new();
        let search_opts = SearchOptions {
            limit: Some(max_results),
            ext_filter: options.ext_filter.clone(),
            dir_filter: options.dir_filter.clone(),
            size_min: options.size_min,
            size_max: options.size_max,
            modified_after: options.modified_after,
            modified_before: options.modified_before,
            recency_boost: has_operators.then_some(1.3),
            frequency_boost: has_operators.then_some(1.2),
            filename_only: true,
            ..Default::default()
        };
        engine
            .search(query, files, &search_opts)
            .into_iter()
            .map(|r| FileSearchResultCompact {
                file: r.file,
                score: r.score,
            })
            .collect::<Vec<_>>()
    };

    let mut results: Vec<FileSearchResultCompact> = {
        #[cfg(feature = "tantivy-search")]
        {
            if let Some(fulltext) = fulltext.as_ref() {
                let fulltext_options = FulltextQueryOptions {
                    limit: max_results,
                    include_hidden: false,
                    ext_filter: options.ext_filter.as_deref(),
                    dir_filter: options.dir_filter.as_deref(),
                    size_min: options.size_min,
                    size_max: options.size_max,
                    modified_after: options.modified_after,
                    modified_before: options.modified_before,
                };
                match search_files_fulltext(
                    Some(fulltext.as_ref()),
                    files,
                    &file_lookup,
                    query,
                    &fulltext_options,
                ) {
                    Ok(results) => results
                        .into_iter()
                        .map(|r| FileSearchResultCompact {
                            file: r.file,
                            score: r.score,
                        })
                        .collect(),
                    Err(e) => {
                        warn!("Tantivy file search failed, falling back to nucleo: {}", e);
                        nucleo_fallback()
                    }
                }
            } else {
                nucleo_fallback()
            }
        }
        #[cfg(not(feature = "tantivy-search"))]
        {
            nucleo_fallback()
        }
    };

    // Windows Search cannot enforce Volt's metadata constraints, so supplement
    // only unfiltered searches, mirroring the dedicated file-search command.
    #[cfg(target_os = "windows")]
    if !has_operators && results.len() < max_results {
        let needed = max_results - results.len();
        if let Ok(ws_results) =
            crate::indexer::windows_search::search_windows_index(query, needed).await
        {
            let existing_paths: std::collections::HashSet<String> =
                results.iter().map(|f| f.file.path.clone()).collect();
            // Supplement results sit just below Volt fuzzy matches (~50) but
            // above 0 so they aren't sorted to the bottom by the frontend.
            // Decrement to preserve Windows Search's own rank ordering.
            const WS_BASE_SCORE: u32 = 30;
            let mut rank: u32 = 0;
            for file in ws_results {
                if !existing_paths.contains(&file.path) {
                    let score = WS_BASE_SCORE.saturating_sub(rank);
                    results.push(FileSearchResultCompact { file, score });
                    rank += 1;
                }
            }
        }
    }

    results.truncate(max_results);
    results
}

#[cfg(all(test, feature = "tantivy-search"))]
mod tests {
    use super::*;
    use crate::indexer::FileCategory;

    fn test_file(name: &str, path: &str) -> FileInfo {
        FileInfo {
            id: crate::utils::hash_id(path),
            name: name.to_string(),
            path: path.to_string(),
            extension: name.rsplit('.').next().unwrap_or_default().to_string(),
            size: 100,
            modified: 1_700_000_000,
            created: None,
            accessed: None,
            icon: None,
            category: FileCategory::Document,
        }
    }

    #[tokio::test]
    async fn streaming_file_path_uses_filtered_tantivy_without_success_fallback() {
        let files = vec![
            test_file("report.pdf", "/docs/report.pdf"),
            test_file("report.txt", "/docs/report.txt"),
        ];
        let lookup = files
            .iter()
            .enumerate()
            .map(|(index, file)| (file.path.clone(), index))
            .collect();
        let fulltext = Arc::new(FulltextIndex::create_in_ram());
        fulltext.build_from_files(&files[..1]).unwrap();
        let options = SearchAllOptions {
            query: "report".to_string(),
            max_results: 10,
            ext_filter: Some("txt".to_string()),
            dir_filter: None,
            size_min: None,
            size_max: None,
            modified_after: None,
            modified_before: None,
        };

        let results = search_files_batch(
            &options.query,
            &files,
            &options,
            options.max_results,
            Some(fulltext),
            Arc::new(lookup),
        )
        .await;

        assert!(results.is_empty());
    }
}
