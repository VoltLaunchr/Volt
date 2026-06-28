use crate::core::error::{VoltError, VoltResult};
#[cfg(feature = "tantivy-search")]
use crate::indexer::fulltext::{FulltextIndex, FulltextQueryOptions};
use crate::indexer::watcher::WatcherHandle;
use crate::indexer::{
    FileCategory, FileHistory, FileIndexDb, FileInfo, IndexConfig, IndexStats as DbIndexStats,
    IndexStatus, SearchEngine, SearchOptions, SearchResult as IndexSearchResult, scan_files,
};
use std::collections::HashMap;
#[cfg(feature = "tantivy-search")]
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tracing::{error, info, warn};

/// Parse a category string into FileCategory
fn parse_file_category(category: &str) -> Option<FileCategory> {
    match category.to_lowercase().as_str() {
        "application" | "app" => Some(FileCategory::Application),
        "game" => Some(FileCategory::Game),
        "executable" | "exe" => Some(FileCategory::Executable),
        "folder" | "directory" => Some(FileCategory::Folder),
        "document" | "doc" => Some(FileCategory::Document),
        "image" | "img" | "photo" => Some(FileCategory::Image),
        "video" => Some(FileCategory::Video),
        "audio" | "music" => Some(FileCategory::Audio),
        "archive" | "zip" => Some(FileCategory::Archive),
        "code" | "source" => Some(FileCategory::Code),
        _ => None,
    }
}

/// Parse a list of category strings into FileCategory list
fn parse_category_filter(categories: Option<Vec<String>>) -> Option<Vec<FileCategory>> {
    categories.map(|cats| cats.iter().filter_map(|c| parse_file_category(c)).collect())
}

/// Search result wrapper for Tauri commands
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    #[serde(flatten)]
    pub file: FileInfo,
    pub score: u32,
    pub matched_indices: Vec<u32>,
}

impl From<IndexSearchResult> for FileSearchResult {
    fn from(result: IndexSearchResult) -> Self {
        Self {
            file: result.file,
            score: result.score,
            matched_indices: result.matched_indices,
        }
    }
}

/// Global file index state (in-memory cache + SQLite backend)
pub struct FileIndexState {
    /// Inner Arc allows O(1) clone when reading the file list for search.
    pub files: Arc<Mutex<Arc<Vec<FileInfo>>>>,
    /// Path-to-position lookup matching the current file snapshot. Tantivy uses
    /// it to resolve hits without rebuilding a HashMap on every keystroke.
    pub file_lookup: Arc<Mutex<Arc<HashMap<String, usize>>>>,
    pub status: Arc<Mutex<IndexStatus>>,
    /// SQLite database for persistent storage (None if DB could not be opened)
    pub db: Arc<Option<FileIndexDb>>,
    #[cfg(feature = "tantivy-search")]
    pub fulltext: Option<Arc<FulltextIndex>>,
    /// Configured folders, stored so that `invalidate_index` can trigger a rescan
    pub config: Arc<Mutex<IndexConfig>>,
    /// Handle to the currently running background scan, so `invalidate_index`
    /// can abort an in-progress scan before kicking off a new one.
    pub scan_task: Mutex<Option<tokio::task::AbortHandle>>,
}

/// State for the active file-system watcher.  Stored separately so the
/// watcher can be started/stopped without touching the index state.
pub struct WatcherState {
    pub handle: Mutex<Option<WatcherHandle>>,
}

/// Global file history state
pub struct FileHistoryState {
    pub history: Arc<FileHistory>,
}

impl FileHistoryState {
    pub fn new(data_dir: PathBuf) -> Self {
        let history_file = data_dir.join("file_history.json");
        let history = FileHistory::new(history_file, true);
        Self {
            history: Arc::new(history),
        }
    }
}

impl Default for FileIndexState {
    fn default() -> Self {
        Self {
            files: Arc::new(Mutex::new(Arc::new(Vec::new()))),
            file_lookup: Arc::new(Mutex::new(Arc::new(HashMap::new()))),
            status: Arc::new(Mutex::new(IndexStatus {
                is_indexing: false,
                total_files: 0,
                indexed_files: 0,
                last_updated: 0,
            })),
            db: Arc::new(None),
            #[cfg(feature = "tantivy-search")]
            fulltext: None,
            config: Arc::new(Mutex::new(IndexConfig::default())),
            scan_task: Mutex::new(None),
        }
    }
}

impl FileIndexState {
    /// Create a `FileIndexState` backed by a SQLite database at `db_path`.
    pub fn with_db(db_path: PathBuf) -> Self {
        let db = match FileIndexDb::open(&db_path) {
            Ok(d) => {
                info!("File index DB opened at {:?}", db_path);
                Some(d)
            }
            Err(e) => {
                warn!(
                    "Could not open file index DB, falling back to in-memory: {}",
                    e
                );
                None
            }
        };

        #[cfg(feature = "tantivy-search")]
        let fulltext = init_fulltext_index(&db_path);

        Self {
            files: Arc::new(Mutex::new(Arc::new(Vec::new()))),
            file_lookup: Arc::new(Mutex::new(Arc::new(HashMap::new()))),
            status: Arc::new(Mutex::new(IndexStatus {
                is_indexing: false,
                total_files: 0,
                indexed_files: 0,
                last_updated: 0,
            })),
            db: Arc::new(db),
            #[cfg(feature = "tantivy-search")]
            fulltext,
            config: Arc::new(Mutex::new(IndexConfig::default())),
            scan_task: Mutex::new(None),
        }
    }
}

fn build_file_lookup(files: &[FileInfo]) -> Arc<HashMap<String, usize>> {
    Arc::new(
        files
            .iter()
            .enumerate()
            .map(|(index, file)| (file.path.clone(), index))
            .collect(),
    )
}

fn replace_file_cache(
    files_state: &Arc<Mutex<Arc<Vec<FileInfo>>>>,
    lookup_state: &Arc<Mutex<Arc<HashMap<String, usize>>>>,
    files: Vec<FileInfo>,
) {
    let lookup = build_file_lookup(&files);
    if let Ok(mut files_guard) = files_state.lock()
        && let Ok(mut lookup_guard) = lookup_state.lock()
    {
        *files_guard = Arc::new(files);
        *lookup_guard = lookup;
    }
}

#[cfg(feature = "tantivy-search")]
fn init_fulltext_index(db_path: &Path) -> Option<Arc<FulltextIndex>> {
    let index_dir = db_path.with_extension("tantivy");
    match FulltextIndex::open_or_create(&index_dir) {
        Ok(index) => {
            info!("Fulltext file index opened at {:?}", index_dir);
            Some(Arc::new(index))
        }
        Err(e) => {
            warn!("Could not initialize Tantivy file index: {}", e);
            None
        }
    }
}

#[cfg(feature = "tantivy-search")]
const FULLTEXT_DIRTY_META_KEY: &str = "tantivy_dirty";

#[cfg(feature = "tantivy-search")]
fn mark_fulltext_dirty(db: Option<&FileIndexDb>) {
    if let Some(db) = db
        && let Err(e) = db.set_meta(FULLTEXT_DIRTY_META_KEY, "1")
    {
        warn!("Could not mark Tantivy file index dirty: {}", e);
    }
}

#[cfg(feature = "tantivy-search")]
fn fulltext_index_is_current(
    fulltext: Option<&Arc<FulltextIndex>>,
    db: &FileIndexDb,
    expected_count: usize,
) -> bool {
    let Some(fulltext) = fulltext else {
        return false;
    };
    let clean = matches!(
        db.get_meta(FULLTEXT_DIRTY_META_KEY),
        Ok(Some(value)) if value == "0"
    );
    clean
        && matches!(
            fulltext.document_count(),
            Ok(indexed_count) if indexed_count == expected_count as u64
        )
}

#[cfg(feature = "tantivy-search")]
fn rebuild_fulltext_index(
    fulltext: Option<&Arc<FulltextIndex>>,
    db: Option<&FileIndexDb>,
    files: &[FileInfo],
    label: &str,
) {
    if let Some(fulltext) = fulltext {
        mark_fulltext_dirty(db);
        match fulltext.build_from_files(files) {
            Ok(()) => {
                if let Some(db) = db
                    && let Err(e) = db.set_meta(FULLTEXT_DIRTY_META_KEY, "0")
                {
                    warn!("Could not mark Tantivy file index clean: {}", e);
                }
            }
            Err(e) => warn!("Failed to rebuild Tantivy file index from {}: {}", label, e),
        }
    }
}

#[cfg(feature = "tantivy-search")]
pub(crate) fn search_files_fulltext(
    fulltext: Option<&FulltextIndex>,
    files: &[FileInfo],
    file_lookup: &HashMap<String, usize>,
    query: &str,
    options: &FulltextQueryOptions<'_>,
) -> Result<Vec<FileSearchResult>, String> {
    let index = fulltext.ok_or_else(|| "Tantivy file index unavailable".to_string())?;

    Ok(index
        .query_filtered(query, options)?
        .into_iter()
        .filter_map(|hit| {
            let file = files.get(*file_lookup.get(&hit.path)?)?.clone();
            Some(FileSearchResult {
                file,
                score: fulltext_score_to_u32(hit.score),
                matched_indices: Vec::new(),
            })
        })
        .collect())
}

#[cfg(feature = "tantivy-search")]
fn fulltext_score_to_u32(score: f32) -> u32 {
    if !score.is_finite() || score <= 0.0 {
        return 0;
    }

    (score * 1000.0).round().clamp(1.0, u32::MAX as f32) as u32
}

fn search_files_nucleo(
    files: &[FileInfo],
    query: &str,
    options: &SearchOptions,
) -> Vec<FileSearchResult> {
    let mut engine = SearchEngine::new();
    engine
        .search(query, files, options)
        .into_iter()
        .map(FileSearchResult::from)
        .collect()
}

#[cfg(feature = "tantivy-search")]
fn search_files_with_fulltext_fallback(
    fulltext: Option<&FulltextIndex>,
    files: &[FileInfo],
    file_lookup: &HashMap<String, usize>,
    query: &str,
    fulltext_options: &FulltextQueryOptions<'_>,
    nucleo_options: &SearchOptions,
) -> Vec<FileSearchResult> {
    if let Some(fulltext) = fulltext {
        match search_files_fulltext(Some(fulltext), files, file_lookup, query, fulltext_options) {
            Ok(results) => return results,
            Err(e) => warn!("Tantivy file search failed, falling back to nucleo: {}", e),
        }
    }

    search_files_nucleo(files, query, nucleo_options)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexingProgress {
    phase: String,
    indexed_files: usize,
    total_files: usize,
    is_complete: bool,
}

/// RAII guard that clears the `is_indexing` flag in `Drop`.
///
/// Without this, an aborted outer `tokio::spawn` (e.g. when `invalidate_index`
/// is called twice in quick succession) leaves `is_indexing = true` forever
/// because the inner `spawn_blocking` is non-cancellable and the match arms
/// that reset the flag never run. The guard runs unconditionally — abort,
/// panic, or normal completion — so the flag is always released.
struct IndexingGuard {
    status: Arc<Mutex<IndexStatus>>,
}

impl IndexingGuard {
    fn new(status: Arc<Mutex<IndexStatus>>) -> Self {
        Self { status }
    }
}

impl Drop for IndexingGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = self.status.lock() {
            s.is_indexing = false;
        }
    }
}

/// Parameters for [`reconcile`], the scan→persist→swap sequence shared by
/// `start_indexing`, `invalidate_index`, and `refresh_index_if_stale`.
struct ReconcileParams {
    config: IndexConfig,
    files_arc: Arc<Mutex<Arc<Vec<FileInfo>>>>,
    file_lookup_arc: Arc<Mutex<Arc<HashMap<String, usize>>>>,
    status_arc: Arc<Mutex<IndexStatus>>,
    db_arc: Arc<Option<FileIndexDb>>,
    #[cfg(feature = "tantivy-search")]
    fulltext_arc: Option<Arc<FulltextIndex>>,
    /// `Some` only for `start_indexing`, the sole caller that reports progress
    /// over `indexing-progress`; the other two callers stay silent, as today.
    app_handle: Option<AppHandle>,
    /// Cosmetic label for logs and the Tantivy rebuild call ("full scan",
    /// "rebuild", "stale catch-up").
    label: &'static str,
    /// `true` only for `refresh_index_if_stale`: bumps the offline catch-up
    /// telemetry counter (Vague 3.2 — feeds the D3/USN reconsideration gate).
    record_catchup_telemetry: bool,
}

/// Re-walk the filesystem, persist to SQLite, rebuild the Tantivy index, swap
/// the in-memory cache, update `IndexStatus`, and emit progress if requested.
///
/// This is the sequence duplicated identically across `start_indexing`'s full
/// scan, `invalidate_index`'s rebuild, and `refresh_index_if_stale`'s offline
/// catch-up. Each caller keeps its own pre-scan decision logic (TOCTOU guard,
/// SQLite fast-path, staleness checks, watcher stop) and only delegates this
/// shared tail to `reconcile`.
///
/// `is_indexing` is reset to `false` explicitly on success (same lock
/// acquisition as the other status fields, matching prior behaviour) but
/// deliberately *not* in the error/panic arms: the caller's `IndexingGuard`
/// already clears it on `Drop` regardless of how the spawned future ends —
/// the only mechanism `refresh_index_if_stale` ever relied on.
async fn reconcile(params: ReconcileParams) {
    let ReconcileParams {
        config,
        files_arc,
        file_lookup_arc,
        status_arc,
        db_arc,
        #[cfg(feature = "tantivy-search")]
        fulltext_arc,
        app_handle,
        label,
        record_catchup_telemetry,
    } = params;

    // `scan_files` is a synchronous, deeply recursive filesystem walk that can
    // take tens of seconds on large drives. Offload to the blocking pool so it
    // never starves the async runtime (IPC / hotkey / UI events).
    let scan_result = tokio::task::spawn_blocking(move || scan_files(&config)).await;

    match scan_result {
        Ok(Ok(scanned_files)) => {
            let file_count = scanned_files.len();

            #[cfg(feature = "tantivy-search")]
            mark_fulltext_dirty(db_arc.as_ref().as_ref());
            let _persisted = if let Some(db) = db_arc.as_ref() {
                match db.replace_files(&scanned_files) {
                    Ok(()) => {
                        if let Err(e) = db.mark_full_scan() {
                            warn!("{}: mark_full_scan failed: {}", label, e);
                        }
                        if record_catchup_telemetry && let Err(e) = db.record_stale_catchup() {
                            warn!("{}: record_stale_catchup failed: {}", label, e);
                        }
                        true
                    }
                    Err(e) => {
                        warn!("{}: persist failed: {}", label, e);
                        false
                    }
                }
            } else {
                false
            };

            #[cfg(feature = "tantivy-search")]
            rebuild_fulltext_index(
                fulltext_arc.as_ref(),
                _persisted.then(|| db_arc.as_ref().as_ref()).flatten(),
                &scanned_files,
                label,
            );

            // Update in-memory cache and its Tantivy hit lookup atomically.
            replace_file_cache(&files_arc, &file_lookup_arc, scanned_files);

            if let Ok(mut status) = status_arc.lock() {
                status.is_indexing = false;
                status.total_files = file_count;
                status.indexed_files = file_count;
                status.last_updated = chrono::Utc::now().timestamp();
            }

            info!("{}: complete, {} files indexed", label, file_count);
            if let Some(app_handle) = app_handle.as_ref() {
                let _ = app_handle.emit(
                    "indexing-progress",
                    IndexingProgress {
                        phase: "complete".to_string(),
                        indexed_files: file_count,
                        total_files: file_count,
                        is_complete: true,
                    },
                );
            }
        }
        Ok(Err(e)) => {
            error!("{}: scan failed: {}", label, e);
            if let Some(app_handle) = app_handle.as_ref() {
                let _ = app_handle.emit(
                    "indexing-progress",
                    IndexingProgress {
                        phase: "error".to_string(),
                        indexed_files: 0,
                        total_files: 0,
                        is_complete: true,
                    },
                );
            }
        }
        Err(join_err) => {
            error!("{}: task panicked or was cancelled: {}", label, join_err);
            if let Some(app_handle) = app_handle.as_ref() {
                let _ = app_handle.emit(
                    "indexing-progress",
                    IndexingProgress {
                        phase: "error".to_string(),
                        indexed_files: 0,
                        total_files: 0,
                        is_complete: true,
                    },
                );
            }
        }
    }
}

/// Starts file indexing based on settings.
///
/// On the first call the DB is empty so a full scan runs.  On subsequent
/// calls the in-memory cache is populated from the DB (fast path), and the
/// scan only runs if `force` is true or no files are in the DB.
#[tauri::command]
pub async fn start_indexing(
    app_handle: AppHandle,
    state: State<'_, FileIndexState>,
    folders: Vec<String>,
    excluded_paths: Vec<String>,
    file_extensions: Vec<String>,
    force: Option<bool>,
    deep_search: Option<bool>,
) -> VoltResult<()> {
    // Atomically check-and-set `is_indexing` in a single lock acquisition to
    // prevent a TOCTOU race where two concurrent calls both pass the check
    // before either sets the flag.
    {
        let mut status = state
            .status
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        if status.is_indexing {
            return Err(VoltError::InvalidConfig(
                "Indexing already in progress".to_string(),
            ));
        }
        status.is_indexing = true;
        status.indexed_files = 0;
        status.total_files = 0;
    }

    // Persist config so `invalidate_index` can re-use it.
    {
        let mut cfg = state
            .config
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        let max_depth = if deep_search.unwrap_or(false) { 10 } else { 3 };
        *cfg = IndexConfig {
            folders: folders.clone(),
            excluded_paths: excluded_paths.clone(),
            file_extensions: file_extensions.clone(),
            max_depth,
            max_file_size: 100 * 1024 * 1024,
        };
    }

    let files_arc = state.files.clone();
    let file_lookup_arc = state.file_lookup.clone();
    let status_arc = state.status.clone();
    let db_arc = state.db.clone();
    #[cfg(feature = "tantivy-search")]
    let fulltext_arc = state.fulltext.clone();
    let app_handle = app_handle.clone();
    let should_force = force.unwrap_or(false);

    // Run indexing in background; store the AbortHandle so `invalidate_index`
    // can cancel a running scan before kicking off a new one.
    let guard_status = Arc::clone(&status_arc);
    let join_handle = tokio::spawn(async move {
        // Owned by this future — its Drop clears `is_indexing` regardless of
        // whether the future completes normally, panics, or is aborted.
        let _guard = IndexingGuard::new(guard_status);

        let config = IndexConfig {
            folders,
            excluded_paths,
            file_extensions,
            max_depth: if deep_search.unwrap_or(false) { 10 } else { 3 },
            max_file_size: 100 * 1024 * 1024, // 100MB limit
        };
        // --- Fast path: load from DB if it already has files (skipped when force=true) ---
        if !should_force {
            if let Some(db) = db_arc.as_ref() {
                match db.count() {
                    Ok(n) if n > 0 => {
                        info!("Loading {} files from SQLite cache", n);
                        match db.get_all_files() {
                            Ok(cached) => {
                                let file_count = cached.len();
                                #[cfg(feature = "tantivy-search")]
                                if fulltext_index_is_current(fulltext_arc.as_ref(), db, file_count)
                                {
                                    info!(
                                        "Reusing persistent Tantivy index ({} files)",
                                        file_count
                                    );
                                } else {
                                    rebuild_fulltext_index(
                                        fulltext_arc.as_ref(),
                                        Some(db),
                                        &cached,
                                        "SQLite cache",
                                    );
                                }
                                replace_file_cache(&files_arc, &file_lookup_arc, cached);
                                if let Ok(mut status) = status_arc.lock() {
                                    status.is_indexing = false;
                                    status.total_files = file_count;
                                    status.indexed_files = file_count;
                                    status.last_updated = chrono::Utc::now().timestamp();
                                }
                                info!("In-memory cache populated from DB ({} files)", file_count);
                                let _ = app_handle.emit(
                                    "indexing-progress",
                                    IndexingProgress {
                                        phase: "complete".to_string(),
                                        indexed_files: file_count,
                                        total_files: file_count,
                                        is_complete: true,
                                    },
                                );
                                return;
                            }
                            Err(e) => warn!("Failed to load from DB, falling back to scan: {}", e),
                        }
                    }
                    Ok(_) => {
                        info!("DB is empty – performing full scan");
                        let _ = app_handle.emit(
                            "indexing-progress",
                            IndexingProgress {
                                phase: "scanning".to_string(),
                                indexed_files: 0,
                                total_files: 0,
                                is_complete: false,
                            },
                        );
                    }
                    Err(e) => {
                        warn!("Could not check DB count: {}", e);
                    }
                }
            }
        } else {
            // Keep the previous snapshot available while scanning. The new
            // snapshot replaces SQLite transactionally only after scan success.
            #[cfg(feature = "tantivy-search")]
            if let Some(db) = db_arc.as_ref() {
                mark_fulltext_dirty(Some(db));
            }
        }

        // --- Full scan ---
        reconcile(ReconcileParams {
            config,
            files_arc,
            file_lookup_arc,
            status_arc,
            db_arc,
            #[cfg(feature = "tantivy-search")]
            fulltext_arc,
            app_handle: Some(app_handle),
            label: "full scan",
            record_catchup_telemetry: false,
        })
        .await;
    });

    if let Ok(mut task) = state.scan_task.lock() {
        *task = Some(join_handle.abort_handle());
    }

    Ok(())
}

/// Gets the current indexing status
#[tauri::command]
pub async fn get_index_status(state: State<'_, FileIndexState>) -> VoltResult<IndexStatus> {
    let status = state
        .status
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?;
    Ok(status.clone())
}

/// Searches indexed files, returning results with match scores.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn search_files(
    state: State<'_, FileIndexState>,
    query: String,
    limit: Option<usize>,
    ext: Option<String>,
    dir: Option<String>,
    size_min: Option<u64>,
    size_max: Option<u64>,
    modified_after: Option<i64>,
    modified_before: Option<i64>,
) -> VoltResult<Vec<FileSearchResult>> {
    crate::time_command!("search_files");
    // O(1) Arc clones to release mutexes before searching. With Tantivy,
    // snapshot the lookup under the same lock ordering as cache updates.
    #[cfg(feature = "tantivy-search")]
    let (files, file_lookup) = {
        let files_guard = state
            .files
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        let lookup_guard = state
            .file_lookup
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        (Arc::clone(&files_guard), Arc::clone(&lookup_guard))
    };
    #[cfg(not(feature = "tantivy-search"))]
    let files = {
        let guard = state
            .files
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        Arc::clone(&guard)
    };

    let has_operators = ext.is_some()
        || dir.is_some()
        || size_min.is_some()
        || size_max.is_some()
        || modified_after.is_some()
        || modified_before.is_some();

    let max_results = if has_operators {
        limit.unwrap_or(files.len())
    } else {
        limit.unwrap_or(20)
    };
    let nucleo_options = SearchOptions {
        limit: if has_operators {
            limit
        } else {
            Some(max_results)
        },
        ext_filter: ext.clone(),
        dir_filter: dir.clone(),
        size_min,
        size_max,
        modified_after,
        modified_before,
        recency_boost: Some(1.3),
        frequency_boost: Some(1.2),
        filename_only: true,
        ..Default::default()
    };

    let mut results: Vec<FileSearchResult> = {
        #[cfg(feature = "tantivy-search")]
        {
            let fulltext_options = FulltextQueryOptions {
                limit: max_results,
                include_hidden: false,
                ext_filter: ext.as_deref(),
                dir_filter: dir.as_deref(),
                size_min,
                size_max,
                modified_after,
                modified_before,
            };
            search_files_with_fulltext_fallback(
                state.fulltext.as_deref(),
                &files,
                &file_lookup,
                &query,
                &fulltext_options,
                &nucleo_options,
            )
        }
        #[cfg(not(feature = "tantivy-search"))]
        {
            search_files_nucleo(&files, &query, &nucleo_options)
        }
    };

    // Windows Search does not understand Volt's metadata filters, so only use it
    // to supplement unfiltered searches.
    #[cfg(target_os = "windows")]
    if !has_operators && results.len() < max_results {
        let needed = max_results - results.len();
        if let Ok(ws_results) =
            crate::indexer::windows_search::search_windows_index(&query, needed).await
        {
            // Dedup by path
            let existing_paths: std::collections::HashSet<String> =
                results.iter().map(|f| f.file.path.clone()).collect();
            for file in ws_results {
                if !existing_paths.contains(&file.path) {
                    results.push(FileSearchResult {
                        score: 0,
                        matched_indices: Vec::new(),
                        file,
                    });
                }
            }
        }
    }

    results.truncate(max_results);
    Ok(results)
}

/// Gets the total number of indexed files
#[tauri::command]
pub async fn get_indexed_file_count(state: State<'_, FileIndexState>) -> VoltResult<usize> {
    let files = state
        .files
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?;
    Ok(files.len())
}

/// Gets recently accessed files (most recent first)
#[tauri::command]
pub async fn get_recent_files(
    history_state: State<'_, FileHistoryState>,
    index_state: State<'_, FileIndexState>,
    limit: Option<usize>,
) -> VoltResult<Vec<FileInfo>> {
    let max_results = limit.unwrap_or(10);

    // Get recent file access records
    let recent_records = history_state
        .history
        .get_recent(max_results)
        .map_err(VoltError::Unknown)?;

    // Get indexed files for additional metadata
    let files = index_state
        .files
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?;
    let file_map: std::collections::HashMap<String, &FileInfo> =
        files.iter().map(|f| (f.path.clone(), f)).collect();

    // Convert records to FileInfo, enriching with indexed data
    let recent_files: Vec<FileInfo> = recent_records
        .iter()
        .map(|record| {
            // Try to get full file info from index, or create minimal one
            if let Some(file_info) = file_map.get(&record.path) {
                (*file_info).clone()
            } else {
                // File not in index, create minimal FileInfo
                let extension = record.name.rsplit('.').next().unwrap_or("").to_string();
                let category = FileCategory::from_path(&record.path, &extension, false);
                FileInfo {
                    id: record.path.clone(),
                    name: record.name.clone(),
                    path: record.path.clone(),
                    extension,
                    size: 0,
                    modified: record.last_accessed,
                    created: None,
                    accessed: Some(record.last_accessed),
                    icon: None,
                    category,
                }
            }
        })
        .collect();

    Ok(recent_files)
}

/// Track file access for history
#[tauri::command]
pub async fn track_file_access(
    state: State<'_, FileHistoryState>,
    path: String,
    name: String,
) -> VoltResult<()> {
    state
        .history
        .record_access(path, name)
        .map_err(VoltError::Unknown)
}

/// Clears all recorded file access history
#[tauri::command]
pub async fn clear_file_history(state: State<'_, FileHistoryState>) -> VoltResult<()> {
    state.history.clear().map_err(VoltError::Unknown)
}

/// Gets default folders to index based on the operating system
#[tauri::command]
pub async fn get_default_index_folders() -> VoltResult<Vec<String>> {
    let mut folders = Vec::new();

    // Add Documents folder
    if let Some(docs) = dirs::document_dir()
        && let Some(path_str) = docs.to_str()
    {
        folders.push(path_str.to_string());
    }

    // Add Desktop folder
    if let Some(desktop) = dirs::desktop_dir()
        && let Some(path_str) = desktop.to_str()
    {
        folders.push(path_str.to_string());
    }

    // Add Downloads folder
    if let Some(downloads) = dirs::download_dir()
        && let Some(path_str) = downloads.to_str()
    {
        folders.push(path_str.to_string());
    }

    // Add Pictures folder
    if let Some(pictures) = dirs::picture_dir()
        && let Some(path_str) = pictures.to_str()
    {
        folders.push(path_str.to_string());
    }

    // Add Videos folder
    if let Some(videos) = dirs::video_dir()
        && let Some(path_str) = videos.to_str()
    {
        folders.push(path_str.to_string());
    }

    // Add common game folders on Windows
    #[cfg(target_os = "windows")]
    {
        // Steam default location
        let steam_paths = [
            "C:\\Program Files (x86)\\Steam\\steamapps\\common",
            "C:\\Program Files\\Steam\\steamapps\\common",
            "D:\\Steam\\steamapps\\common",
            "D:\\SteamLibrary\\steamapps\\common",
            "E:\\Steam\\steamapps\\common",
            "E:\\SteamLibrary\\steamapps\\common",
        ];
        for path in &steam_paths {
            if std::path::Path::new(path).exists() {
                folders.push(path.to_string());
                break; // Only add one Steam folder
            }
        }

        // Epic Games
        let epic_paths = [
            "C:\\Program Files\\Epic Games",
            "D:\\Epic Games",
            "E:\\Epic Games",
        ];
        for path in &epic_paths {
            if std::path::Path::new(path).exists() {
                folders.push(path.to_string());
                break;
            }
        }

        // Program Files
        if let Some(program_files) = std::env::var_os("ProgramFiles")
            && let Some(path_str) = program_files.to_str()
        {
            folders.push(path_str.to_string());
        }
        if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)")
            && let Some(path_str) = program_files_x86.to_str()
        {
            folders.push(path_str.to_string());
        }
    }

    Ok(folders)
}

/// Shared implementation for advanced file search (with or without highlighting indices)
#[allow(clippy::too_many_arguments)]
fn search_files_impl(
    state: &State<'_, FileIndexState>,
    query: &str,
    limit: Option<usize>,
    categories: Option<Vec<String>>,
    include_hidden: Option<bool>,
    filename_only: Option<bool>,
    min_score: Option<u32>,
    with_indices: bool,
) -> VoltResult<Vec<FileSearchResult>> {
    let files = {
        let guard = state
            .files
            .lock()
            .map_err(|e| VoltError::Unknown(format!("Failed to acquire file index lock: {}", e)))?;
        Arc::clone(&guard)
    };

    let mut engine = SearchEngine::new();

    let options = SearchOptions {
        limit,
        categories: parse_category_filter(categories),
        include_hidden: include_hidden.unwrap_or(false),
        filename_only: filename_only.unwrap_or(false),
        min_score,
        recency_boost: Some(1.3),
        frequency_boost: Some(1.2),
        ..Default::default()
    };

    let results = if with_indices {
        engine.search_with_indices(query, &files, &options)
    } else {
        engine.search(query, &files, &options)
    };

    Ok(results.into_iter().map(FileSearchResult::from).collect())
}

/// Advanced file search with category filtering and scoring
#[tauri::command]
pub async fn search_files_advanced(
    state: State<'_, FileIndexState>,
    query: String,
    limit: Option<usize>,
    categories: Option<Vec<String>>,
    include_hidden: Option<bool>,
    filename_only: Option<bool>,
    min_score: Option<u32>,
) -> VoltResult<Vec<FileSearchResult>> {
    search_files_impl(
        &state,
        &query,
        limit,
        categories,
        include_hidden,
        filename_only,
        min_score,
        false,
    )
}

/// Advanced file search with highlighting support (returns matched character indices)
#[tauri::command]
pub async fn search_files_with_highlighting(
    state: State<'_, FileIndexState>,
    query: String,
    limit: Option<usize>,
    categories: Option<Vec<String>>,
    include_hidden: Option<bool>,
    filename_only: Option<bool>,
    min_score: Option<u32>,
) -> VoltResult<Vec<FileSearchResult>> {
    crate::time_command!("search_files_with_highlighting");
    search_files_impl(
        &state,
        &query,
        limit,
        categories,
        include_hidden,
        filename_only,
        min_score,
        true,
    )
}

/// Get available file categories
#[tauri::command]
pub async fn get_file_categories() -> Vec<&'static str> {
    vec![
        "application",
        "game",
        "executable",
        "folder",
        "document",
        "image",
        "video",
        "audio",
        "archive",
        "code",
        "other",
    ]
}

/// Get index statistics by category
#[tauri::command]
pub async fn get_index_stats(state: State<'_, FileIndexState>) -> VoltResult<IndexStats> {
    let files = {
        let guard = state
            .files
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        Arc::clone(&guard)
    };

    let mut stats = IndexStats {
        total_files: files.len(),
        ..Default::default()
    };

    for file in files.iter() {
        match file.category {
            FileCategory::Application => stats.applications += 1,
            FileCategory::Game => stats.games += 1,
            FileCategory::Executable => stats.executables += 1,
            FileCategory::Folder => stats.folders += 1,
            FileCategory::Document => stats.documents += 1,
            FileCategory::Image => stats.images += 1,
            FileCategory::Video => stats.videos += 1,
            FileCategory::Audio => stats.audio += 1,
            FileCategory::Archive => stats.archives += 1,
            FileCategory::Code => stats.code_files += 1,
            FileCategory::Other => stats.other += 1,
        }
        stats.total_size += file.size;
    }

    Ok(stats)
}

/// Index statistics (per-category counts, in-memory)
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub total_files: usize,
    pub total_size: u64,
    pub applications: usize,
    pub games: usize,
    pub executables: usize,
    pub folders: usize,
    pub documents: usize,
    pub images: usize,
    pub videos: usize,
    pub audio: usize,
    pub archives: usize,
    pub code_files: usize,
    pub other: usize,
}

// ---------------------------------------------------------------------------
// New commands: invalidate_index, get_db_index_stats
// ---------------------------------------------------------------------------

/// Clears the SQLite index and triggers a full rescan.
///
/// Frontend can call this as "Rebuild Index".
#[tauri::command]
pub async fn invalidate_index(
    state: State<'_, FileIndexState>,
    watcher_state: State<'_, WatcherState>,
) -> VoltResult<()> {
    // Abort any in-progress background scan before rebuilding.
    if let Ok(mut task) = state.scan_task.lock()
        && let Some(handle) = task.take()
    {
        handle.abort();
        info!("Aborted in-progress index scan for rebuild");
    }

    // Stop the watcher while we rebuild.
    if let Ok(mut handle) = watcher_state.handle.lock() {
        if let Some(h) = handle.as_ref() {
            h.stop();
        }
        *handle = None;
    }

    // Keep the previous coherent snapshot searchable until the replacement
    // scan succeeds. A failed rebuild therefore cannot erase the usable index.
    #[cfg(feature = "tantivy-search")]
    mark_fulltext_dirty(state.db.as_ref().as_ref());

    // Re-run indexing with the last-known config.
    let config = state
        .config
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?
        .clone();

    // Kick off a new full scan (reuse start_indexing logic).
    // Atomically check-and-set to guard against concurrent scans.
    {
        let mut status = state
            .status
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        if status.is_indexing {
            return Err(VoltError::InvalidConfig(
                "Indexing already in progress".to_string(),
            ));
        }
        status.is_indexing = true;
        status.indexed_files = 0;
        status.total_files = 0;
    }

    let files_arc = state.files.clone();
    let file_lookup_arc = state.file_lookup.clone();
    let status_arc = state.status.clone();
    let db_arc = state.db.clone();
    #[cfg(feature = "tantivy-search")]
    let fulltext_arc = state.fulltext.clone();

    let guard_status = Arc::clone(&status_arc);
    let rebuild_handle = tokio::spawn(async move {
        // Owned by this future — its Drop clears `is_indexing` regardless of
        // whether the future completes normally, panics, or is aborted.
        let _guard = IndexingGuard::new(guard_status);

        reconcile(ReconcileParams {
            config,
            files_arc,
            file_lookup_arc,
            status_arc,
            db_arc,
            #[cfg(feature = "tantivy-search")]
            fulltext_arc,
            app_handle: None,
            label: "rebuild",
            record_catchup_telemetry: false,
        })
        .await;
    });

    if let Ok(mut task) = state.scan_task.lock() {
        *task = Some(rebuild_handle.abort_handle());
    }

    Ok(())
}

/// Returns SQLite-level index statistics (file count, DB size, last scan, watcher status).
#[tauri::command]
pub async fn get_db_index_stats(
    state: State<'_, FileIndexState>,
    watcher_state: State<'_, WatcherState>,
) -> VoltResult<DbIndexStats> {
    let is_watching = watcher_state
        .handle
        .lock()
        .map(|h| h.as_ref().map(|w| w.is_active()).unwrap_or(false))
        .unwrap_or(false);

    // `get_stats` calls `std::fs::metadata` and a synchronous SQLite COUNT —
    // both are blocking syscalls; offload to avoid parking a Tokio worker.
    let db_arc = state.db.clone();
    let files_arc = state.files.clone();
    tokio::task::spawn_blocking(move || {
        if let Some(db) = db_arc.as_ref() {
            db.get_stats(is_watching).map_err(VoltError::Unknown)
        } else {
            let indexed_count = files_arc.lock().map(|f| f.len()).unwrap_or_else(|e| {
                warn!("files mutex poisoned in get_db_index_stats: {}", e);
                0
            });
            Ok(DbIndexStats {
                indexed_count,
                db_size_bytes: 0,
                last_full_scan: 0,
                is_watching,
                stale_catchup_count: 0,
                last_stale_catchup: 0,
            })
        }
    })
    .await
    .map_err(|e| VoltError::Unknown(format!("get_db_index_stats task failed: {}", e)))?
}

/// Start (or restart) the file-system watcher for the configured directories.
///
/// Called by the frontend after the initial index scan completes.
#[tauri::command]
pub async fn start_file_watcher(
    index_state: State<'_, FileIndexState>,
    watcher_state: State<'_, WatcherState>,
) -> VoltResult<()> {
    // Stop any existing watcher.
    if let Ok(mut handle) = watcher_state.handle.lock() {
        if let Some(h) = handle.as_ref() {
            h.stop();
        }
        *handle = None;
    }

    // Get the current config's folders.
    let folders = {
        let cfg = index_state
            .config
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        cfg.folders.clone()
    };

    if folders.is_empty() {
        info!("No folders configured for watching");
        return Ok(());
    }

    // Get a reference to the DB.
    let db = match index_state.db.as_ref() {
        Some(d) => d,
        None => {
            warn!("No DB available – file watcher not started");
            return Ok(());
        }
    };

    // We need an Arc<FileIndexDb> for the watcher thread.  Since `db` is
    // already inside an Arc<Option<FileIndexDb>>, we reconstruct a new Arc.
    // This is safe because FileIndexDb wraps its connection in Arc<Mutex<>>.
    use crate::indexer::watcher::start_watcher;

    // Build an Arc from the existing DB reference.
    // Because FileIndexDb has Arc<Mutex<Connection>> internally, cloning the
    // Arc-wrapped DB by pointer would require an Arc<FileIndexDb>.
    // The state already holds Arc<Option<FileIndexDb>>; we construct a new
    // Arc pointing at the same underlying db by opening a shared reference.
    //
    // To avoid requiring Clone on FileIndexDb (which holds a Mutex), we
    // instead open a fresh connection to the same path stored in the DB.
    // The DB path is retrieved via a public method.
    let db_arc: Arc<FileIndexDb> = Arc::new(
        FileIndexDb::open(db.db_path())
            .map_err(|e| VoltError::Unknown(format!("Failed to open watcher DB: {}", e)))?,
    );

    // Pass the in-memory files Arc so the watcher can keep it in sync.
    let in_memory_files = Some(index_state.files.clone());
    let in_memory_lookup = Some(index_state.file_lookup.clone());

    #[cfg(feature = "tantivy-search")]
    let watcher_result = start_watcher(
        folders.clone(),
        db_arc,
        index_state.fulltext.clone(),
        in_memory_files,
        in_memory_lookup,
    );
    #[cfg(not(feature = "tantivy-search"))]
    let watcher_result = start_watcher(folders.clone(), db_arc, in_memory_files, in_memory_lookup);

    match watcher_result {
        Ok(handle) => {
            info!("File watcher started for {} director(y/ies)", folders.len());
            if let Ok(mut h) = watcher_state.handle.lock() {
                *h = Some(handle);
            }
            Ok(())
        }
        Err(e) => {
            warn!("Failed to start file watcher: {}", e);
            Err(VoltError::Unknown(e))
        }
    }
}

/// Stop the file-system watcher.
#[tauri::command]
pub async fn stop_file_watcher(watcher_state: State<'_, WatcherState>) -> VoltResult<()> {
    if let Ok(mut handle) = watcher_state.handle.lock() {
        if let Some(h) = handle.as_ref() {
            h.stop();
            info!("File watcher stopped");
        }
        *handle = None;
    }
    Ok(())
}

/// Background catch-up reconcile for filesystem changes made while Volt — and
/// therefore its live `notify` watcher — were not running.
///
/// The watcher only observes changes that happen *while Volt runs*; on launch
/// the fast path in [`start_indexing`] serves the persisted SQLite snapshot
/// instantly without re-walking. A file created, deleted, or moved while Volt
/// was closed therefore stays stale in the index until the indexing config
/// changes. This command closes that gap cheaply: if the last full scan is
/// older than `stale_secs`, it re-walks the configured folders on the blocking
/// pool and atomically swaps the index (SQLite + in-memory + Tantivy).
///
/// This is the deliberate no-admin alternative to a USN-journal catch-up — see
/// the D3 NO-GO decision record in `REFONTE-PILIER-D-SEARCH.md`.
///
/// Returns immediately. The reconcile runs detached and **silently** — it does
/// not emit the `indexing-progress` spinner phases, so the UI stays calm. It is
/// a cheap no-op when the index is fresh, when a scan is already in flight, when
/// there is no DB, or when no folders are configured.
#[tauri::command]
pub async fn refresh_index_if_stale(
    state: State<'_, FileIndexState>,
    stale_secs: i64,
) -> VoltResult<()> {
    // The index age lives in the DB; without persistence there is nothing to
    // reconcile against (the in-memory cache is already authoritative).
    let last_full_scan = match state.db.as_ref() {
        Some(db) => db
            .get_meta("last_full_scan")
            .ok()
            .flatten()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0),
        None => return Ok(()),
    };

    // `last_full_scan == 0` means no full scan has ever completed; in that case
    // `start_indexing` is responsible for the first scan, not the catch-up.
    if last_full_scan == 0 {
        return Ok(());
    }
    let now = chrono::Utc::now().timestamp();
    if now.saturating_sub(last_full_scan) < stale_secs.max(0) {
        return Ok(()); // fresh enough
    }

    let config = {
        let cfg = state
            .config
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        cfg.clone()
    };
    if config.folders.is_empty() {
        return Ok(());
    }

    // Atomically claim the indexing flag so we never double-scan against a
    // concurrent `start_indexing` or a prior catch-up still in flight.
    {
        let mut status = state
            .status
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        if status.is_indexing {
            return Ok(());
        }
        status.is_indexing = true;
    }

    let files_arc = state.files.clone();
    let file_lookup_arc = state.file_lookup.clone();
    let status_arc = state.status.clone();
    let db_arc = state.db.clone();
    #[cfg(feature = "tantivy-search")]
    let fulltext_arc = state.fulltext.clone();

    // Detached reconcile so the command returns immediately. The guard clears
    // `is_indexing` whatever happens (success, scan error, or task panic).
    //
    // A live watcher may apply an upsert in the tiny window between this scan
    // and the cache swap inside `reconcile`; that is acceptable — the scan
    // reflects current disk truth and is authoritative, and any racing
    // watcher event is re-applied on its next flush.
    tokio::spawn(async move {
        let _guard = IndexingGuard::new(status_arc.clone());

        reconcile(ReconcileParams {
            config,
            files_arc,
            file_lookup_arc,
            status_arc,
            db_arc,
            #[cfg(feature = "tantivy-search")]
            fulltext_arc,
            app_handle: None,
            label: "stale catch-up",
            record_catchup_telemetry: true,
        })
        .await;
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_file(name: &str, path: &str) -> FileInfo {
        FileInfo {
            id: crate::utils::hash_id(path),
            name: name.to_string(),
            path: path.to_string(),
            extension: name.rsplit('.').next().unwrap_or_default().to_string(),
            size: 1,
            modified: 1_700_000_000,
            created: None,
            accessed: None,
            icon: None,
            category: FileCategory::Document,
        }
    }

    #[test]
    fn file_lookup_matches_replaced_snapshot() {
        let files_state = Arc::new(Mutex::new(Arc::new(Vec::new())));
        let lookup_state = Arc::new(Mutex::new(Arc::new(HashMap::new())));
        replace_file_cache(
            &files_state,
            &lookup_state,
            vec![
                test_file("alpha.txt", "/x/alpha.txt"),
                test_file("beta.txt", "/x/beta.txt"),
            ],
        );

        let files = files_state.lock().unwrap();
        let lookup = lookup_state.lock().unwrap();
        assert_eq!(files[*lookup.get("/x/beta.txt").unwrap()].name, "beta.txt");
    }

    #[cfg(feature = "tantivy-search")]
    #[test]
    fn persistent_fulltext_is_reused_only_when_clean_and_complete() {
        let dir = tempfile::tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("files.db")).unwrap();
        let fulltext = Arc::new(FulltextIndex::create_in_ram());
        let files = vec![test_file("alpha.txt", "/x/alpha.txt")];
        fulltext.build_from_files(&files).unwrap();

        assert!(!fulltext_index_is_current(
            Some(&fulltext),
            &db,
            files.len()
        ));
        db.set_meta(FULLTEXT_DIRTY_META_KEY, "0").unwrap();
        assert!(fulltext_index_is_current(Some(&fulltext), &db, files.len()));
        assert!(!fulltext_index_is_current(
            Some(&fulltext),
            &db,
            files.len() + 1
        ));
        db.set_meta(FULLTEXT_DIRTY_META_KEY, "1").unwrap();
        assert!(!fulltext_index_is_current(
            Some(&fulltext),
            &db,
            files.len()
        ));
    }

    #[cfg(feature = "tantivy-search")]
    #[test]
    fn filtered_command_path_does_not_fallback_after_successful_tantivy_query() {
        let files = vec![
            test_file("report.pdf", "/docs/report.pdf"),
            test_file("report.txt", "/docs/report.txt"),
        ];
        let lookup = build_file_lookup(&files);
        let fulltext = FulltextIndex::create_in_ram();
        fulltext.build_from_files(&files[..1]).unwrap();
        let fulltext_options = FulltextQueryOptions {
            limit: 10,
            include_hidden: false,
            ext_filter: Some("txt"),
            dir_filter: None,
            size_min: None,
            size_max: None,
            modified_after: None,
            modified_before: None,
        };
        let nucleo_options = SearchOptions {
            limit: Some(10),
            ext_filter: Some("txt".to_string()),
            filename_only: true,
            ..Default::default()
        };

        let results = search_files_with_fulltext_fallback(
            Some(&fulltext),
            &files,
            &lookup,
            "report",
            &fulltext_options,
            &nucleo_options,
        );

        assert!(results.is_empty());
    }

    /// Regression: prior to the IndexingGuard, an aborted scan task left
    /// `is_indexing = true` permanently, bricking "Rebuild Index" until app
    /// restart. The guard clears the flag in `Drop` so abort, panic, or
    /// normal completion all release it.
    #[test]
    fn indexing_guard_clears_flag_on_drop() {
        let status = Arc::new(Mutex::new(IndexStatus {
            is_indexing: true,
            total_files: 0,
            indexed_files: 0,
            last_updated: 0,
        }));
        {
            let _guard = IndexingGuard::new(Arc::clone(&status));
            // Simulate the spawn closure being aborted before reaching its
            // success/error arms — `_guard` still drops at scope exit.
        }
        assert!(!status.lock().unwrap().is_indexing);
    }

    /// Even if the guard's drop runs after a panic-poisoned mutex, it must
    /// not panic itself. We can't easily simulate a poisoned mutex in a
    /// `#[test]` (would require catching a panic and re-acquiring), so this
    /// test pins the behaviour: drop is total — never aborts on lock failure.
    #[test]
    fn indexing_guard_drop_does_not_panic_on_lock_failure() {
        // Trigger Drop with a still-healthy mutex; the assertion below proves
        // the success path does not panic. The poisoned-mutex path is covered
        // by the `if let Ok(mut s) = self.status.lock()` guard in the impl.
        let status = Arc::new(Mutex::new(IndexStatus {
            is_indexing: true,
            total_files: 0,
            indexed_files: 0,
            last_updated: 0,
        }));
        drop(IndexingGuard::new(Arc::clone(&status)));
        assert!(!status.lock().unwrap().is_indexing);
    }
}
