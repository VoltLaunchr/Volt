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
use crate::search::{FileRelevanceScorer, LearnedMatch, SearchSensitivity, SearchTier};

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
    /// Settings -> Search Sensitivity (`'low' | 'medium' | 'high'`). Optional
    /// on the wire; defaults to `medium`.
    #[serde(default)]
    pub sensitivity: SearchSensitivity,
    /// Settings -> Launcher -> include files in the root search. When `false` the file
    /// source is skipped (an empty `files` batch is still sent so consumers see it complete).
    #[serde(default = "default_include_files")]
    pub include_files: bool,
}

fn default_include_files() -> bool {
    true
}

/// Combined result from all search sources (batch mode).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAllResult {
    pub apps: Vec<AppInfoWithScore>,
    pub files: Vec<FileSearchResultCompact>,
    pub frecency_suggestions: Vec<LaunchRecord>,
    /// Learned query bindings for this query (plugin commands included).
    pub learned: Vec<LearnedMatch>,
}

/// Compact file search result for the batch / streaming endpoints.
///
/// `tier` places the file on the shared search ladder (`crate::search::SearchTier`);
/// `score` is the filename match quality inside that tier (100 exact, 90
/// prefix, 50-89 fuzzy, 0 path-only), never a raw engine score.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResultCompact {
    #[serde(flatten)]
    pub file: FileInfo,
    pub score: u32,
    pub tier: SearchTier,
}

/// A batch of results streamed to the frontend via a Tauri Channel.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum SearchBatch {
    /// Learned query bindings for this query, sent first so the frontend can
    /// give plugin commands the same learned tiers as applications.
    Learned { results: Vec<LearnedMatch> },
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

    let learned = bindings_snapshot.learned_matches(&query, chrono::Utc::now().timestamp_millis());

    let (app_results, file_results, frecency_results) = tokio::join!(
        async {
            let frecency = history.app_frecency();
            crate::search::search_applications_with_frecency(
                &query_apps,
                apps_for_search,
                &frecency,
                Some(&bindings_snapshot),
                &aliases,
                options.sensitivity,
            )
            .into_iter()
            .map(|(app, rank)| AppInfoWithScore::new(app, rank))
            .collect::<Vec<_>>()
        },
        file_results_future,
        async {
            // Compound-key sort: pinned first, then by frecency. Sort over
            // references under the lock and clone only the top 5 survivors
            // instead of cloning every record up front.
            history.with_records(|records| {
                let mut refs: Vec<&LaunchRecord> =
                    records.values().filter(|r| r.is_app()).collect();
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
        learned,
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
    let sensitivity = options.sensitivity;

    // Learned bindings first: a cheap lookup on the snapshot, so the frontend
    // has them before any app / file batch (and before plugins are merged).
    let learned = bindings_snapshot.learned_matches(&query, chrono::Utc::now().timestamp_millis());
    on_event
        .send(SearchBatch::Learned { results: learned })
        .map_err(|e| e.to_string())?;

    // Spawn concurrent tasks, collect via mpsc
    let (tx, mut rx) = tokio::sync::mpsc::channel::<SearchBatch>(4);

    // --- App search task ---
    let tx_apps = tx.clone();
    let aliases_for_apps = aliases;
    tokio::spawn(async move {
        let frecency = history.app_frecency();
        let results = crate::search::search_applications_with_frecency(
            &query_apps,
            apps,
            &frecency,
            Some(&bindings_snapshot),
            &aliases_for_apps,
            sensitivity,
        );
        let scored: Vec<AppInfoWithScore> = results
            .into_iter()
            .map(|(app, rank)| AppInfoWithScore::new(app, rank))
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
    if !options.include_files {
        return Vec::new();
    }
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
                tier: SearchTier::FilePathOnly,
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
                            tier: SearchTier::FilePathOnly,
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
            // Scored with the same filename tiers as Volt's own results by
            // `rank_file_results` below. Appended after Volt results so the
            // stable sort keeps Volt first, then Windows Search's own rank,
            // within each tier.
            for file in ws_results {
                if !existing_paths.contains(&file.path) {
                    results.push(FileSearchResultCompact {
                        file,
                        score: 0,
                        tier: SearchTier::FilePathOnly,
                    });
                }
            }
        }
    }

    results = rank_file_results(query, results, options.sensitivity);
    results.truncate(max_results);
    results
}

/// Replace engine-specific scores (nucleo, Tantivy, Windows Search rank) with
/// absolute, query-relative file tiers on the shared ladder so the frontend
/// can merge files with apps without normalising by the batch maximum.
/// Results rejected by the sensitivity are dropped. The sort is stable: within
/// one tier and quality the incoming engine order is preserved.
fn rank_file_results(
    query: &str,
    results: Vec<FileSearchResultCompact>,
    sensitivity: SearchSensitivity,
) -> Vec<FileSearchResultCompact> {
    let mut scorer = FileRelevanceScorer::new(query, sensitivity);
    let mut ranked: Vec<FileSearchResultCompact> = results
        .into_iter()
        .filter_map(|mut result| {
            let rank = scorer.score(&result.file.name)?;
            result.tier = rank.tier;
            result.score = u32::from(rank.quality);
            Some(result)
        })
        .collect();
    ranked.sort_by_key(|r| (r.tier, std::cmp::Reverse(r.score)));
    ranked
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
            sensitivity: SearchSensitivity::default(),
            include_files: true,
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

#[cfg(test)]
mod ranking_tests {
    use super::*;
    use crate::indexer::FileCategory;

    fn compact(name: &str, engine_score: u32) -> FileSearchResultCompact {
        let path = format!("/docs/{name}");
        FileSearchResultCompact {
            file: FileInfo {
                id: crate::utils::hash_id(&path),
                name: name.to_string(),
                path,
                extension: name.rsplit('.').next().unwrap_or_default().to_string(),
                size: 100,
                modified: 1_700_000_000,
                created: None,
                accessed: None,
                icon: None,
                category: FileCategory::Document,
            },
            score: engine_score,
            tier: SearchTier::FilePathOnly,
        }
    }

    fn ranked(query: &str, input: Vec<FileSearchResultCompact>) -> Vec<(String, SearchTier)> {
        rank_file_results(query, input, SearchSensitivity::Medium)
            .into_iter()
            .map(|r| (r.file.name, r.tier))
            .collect()
    }

    #[test]
    fn exact_filename_outranks_higher_engine_scores() {
        let out = ranked(
            "budget",
            vec![
                compact("budget-2024-final.xlsx", 9_000),
                compact("old_budget_notes.txt", 5_000),
                compact("budget.xlsx", 10),
            ],
        );
        assert_eq!(out[0], ("budget.xlsx".to_string(), SearchTier::FileExact));
        assert_eq!(
            out[1],
            ("budget-2024-final.xlsx".to_string(), SearchTier::FilePrefix)
        );
        assert!(out[2].1 > SearchTier::FilePrefix);
    }

    #[test]
    fn weak_best_match_is_not_promoted_to_the_top_tier() {
        // The only result is a path-only match: it keeps the lowest tier
        // instead of being normalised to the batch maximum.
        let out = ranked("budget", vec![compact("q3.xlsx", 9_000)]);
        assert_eq!(out, vec![("q3.xlsx".to_string(), SearchTier::FilePathOnly)]);
    }

    #[test]
    fn equal_tiers_keep_engine_order_for_windows_search_supplements() {
        // Windows Search supplements arrive after Volt results with score 0;
        // path-only matches must keep that relative order.
        let out = ranked(
            "budget",
            vec![
                compact("a.txt", 50),
                compact("b.txt", 0),
                compact("c.txt", 0),
            ],
        );
        let names: Vec<&str> = out.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["a.txt", "b.txt", "c.txt"]);
    }

    #[test]
    fn low_sensitivity_drops_fuzzy_and_path_only_files() {
        let out = rank_file_results(
            "budget",
            vec![
                compact("budget.xlsx", 1),
                compact("old_budget_notes.txt", 1),
                compact("q3.xlsx", 1),
            ],
            SearchSensitivity::Low,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].file.name, "budget.xlsx");
    }

    #[test]
    fn search_options_accept_missing_or_explicit_sensitivity() {
        let base = serde_json::json!({
            "query": "x",
            "maxResults": 5,
            "extFilter": null,
            "dirFilter": null,
            "sizeMin": null,
            "sizeMax": null,
            "modifiedAfter": null,
            "modifiedBefore": null,
        });
        let missing: SearchAllOptions = serde_json::from_value(base.clone()).unwrap();
        assert_eq!(missing.sensitivity, SearchSensitivity::Medium);

        let mut with_low = base;
        with_low["sensitivity"] = serde_json::json!("low");
        let low: SearchAllOptions = serde_json::from_value(with_low).unwrap();
        assert_eq!(low.sensitivity, SearchSensitivity::Low);
    }
}

#[cfg(test)]
mod include_files_option_tests {
    use super::SearchAllOptions;

    #[test]
    fn files_are_searched_unless_the_option_says_otherwise() {
        let default: SearchAllOptions =
            serde_json::from_value(serde_json::json!({ "query": "a", "maxResults": 3 })).unwrap();
        assert!(default.include_files);

        let disabled: SearchAllOptions = serde_json::from_value(
            serde_json::json!({ "query": "a", "maxResults": 3, "includeFiles": false }),
        )
        .unwrap();
        assert!(!disabled.include_files);
    }
}
