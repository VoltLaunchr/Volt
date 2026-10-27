use crate::core::error::{VoltError, VoltResult};
#[cfg(feature = "tantivy-search")]
use crate::indexer::fulltext::{FulltextIndex, FulltextQueryOptions};
use crate::indexer::watcher::WatcherHandle;
use crate::indexer::{
    FileCategory, FileHistory, FileIndexDb, FileInfo, IndexConfig, IndexStats as DbIndexStats,
    IndexStatus, SearchEngine, SearchOptions, SearchResult as IndexSearchResult, scan_files,
};
use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
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
    /// Serializes scan lifecycle transitions (claim/cancel/store handle).
    pub scan_control: tokio::sync::Mutex<()>,
    /// Identifies the scan that currently owns `is_indexing`. An obsolete
    /// task must never clear the flag belonging to its replacement.
    pub scan_generation: Arc<AtomicU64>,
    /// Serializes full-snapshot replacement with incremental watcher flushes.
    /// The watcher keeps receiving OS events while waiting, then applies them
    /// after the new snapshot so no event is lost at the scan/commit boundary.
    pub mutation_gate: Arc<tokio::sync::Mutex<()>>,
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
            scan_control: tokio::sync::Mutex::new(()),
            scan_generation: Arc::new(AtomicU64::new(0)),
            mutation_gate: Arc::new(tokio::sync::Mutex::new(())),
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
            scan_control: tokio::sync::Mutex::new(()),
            scan_generation: Arc::new(AtomicU64::new(0)),
            mutation_gate: Arc::new(tokio::sync::Mutex::new(())),
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
    // Recover from poison instead of skipping: this is a wholesale snapshot
    // replacement, so overwriting heals whatever the panicking holder left
    // behind. Skipping here while SQLite+Tantivy advanced would desynchronize
    // the three stores (audit passe 2, sujet 6).
    let mut files_guard = files_state.lock().unwrap_or_else(|poisoned| {
        warn!("File cache mutex poisoned during swap; recovering");
        poisoned.into_inner()
    });
    let mut lookup_guard = lookup_state.lock().unwrap_or_else(|poisoned| {
        warn!("File lookup mutex poisoned during swap; recovering");
        poisoned.into_inner()
    });
    *files_guard = Arc::new(files);
    *lookup_guard = lookup;
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
    generation: Arc<AtomicU64>,
    owner: u64,
}

impl IndexingGuard {
    fn new(status: Arc<Mutex<IndexStatus>>, generation: Arc<AtomicU64>, owner: u64) -> Self {
        Self {
            status,
            generation,
            owner,
        }
    }
}

impl Drop for IndexingGuard {
    fn drop(&mut self) {
        // Recover from poison: clearing a boolean flag is always safe and a
        // stuck `is_indexing = true` bricks "Rebuild Index" until restart.
        if self.generation.load(Ordering::Acquire) == self.owner {
            let mut s = self.status.lock().unwrap_or_else(|poisoned| {
                warn!("Index status mutex poisoned in IndexingGuard::drop; recovering");
                poisoned.into_inner()
            });
            s.is_indexing = false;
        }
    }
}

struct ScanDiagnosticBaseline {
    kind: crate::indexer::database::ScanKind,
    added: usize,
    removed: usize,
    modified: usize,
}

/// The cache may still be empty on a forced startup scan. SQLite remains the
/// baseline authority; failures suppress diagnostics instead of inventing an
/// empty prior snapshot. Call on the blocking pool before replacing SQLite.
fn scan_diagnostic_baseline(
    db: Option<&FileIndexDb>,
    cached_files: &[FileInfo],
    scanned_files: &[FileInfo],
    catchup: bool,
) -> Result<ScanDiagnosticBaseline, String> {
    let persisted_files;
    let (before, last_full_scan) = if let Some(db) = db {
        persisted_files = db.get_all_files()?;
        let last_full_scan = db
            .get_meta("last_full_scan")?
            .map(|value| value.parse::<i64>())
            .transpose()
            .map_err(|e| format!("Invalid previous scan timestamp: {}", e))?
            .unwrap_or(0);
        (persisted_files.as_slice(), last_full_scan)
    } else {
        (cached_files, 0)
    };
    let kind = if before.is_empty() && last_full_scan == 0 {
        crate::indexer::database::ScanKind::Initial
    } else if catchup {
        crate::indexer::database::ScanKind::Catchup
    } else {
        crate::indexer::database::ScanKind::Rebuild
    };
    let (added, removed, modified) =
        crate::indexer::database::snapshot_delta(before, scanned_files);
    Ok(ScanDiagnosticBaseline {
        kind,
        added,
        removed,
        modified,
    })
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
    mutation_gate: Arc<tokio::sync::Mutex<()>>,
    generation: Arc<AtomicU64>,
    owner: u64,
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
        mutation_gate,
        generation,
        owner,
    } = params;

    // Watcher flushes wait behind this guard. notify continues queueing raw
    // events, so they are applied after the replacement snapshot is committed.
    let _mutation_guard = mutation_gate.lock().await;

    let started = std::time::Instant::now();
    let root_count = config.folders.len();
    let diagnostics_enabled = config.diagnostics_enabled;
    let snapshot_before = diagnostics_enabled.then(|| {
        files_arc
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    });

    // `scan_files` is a synchronous, deeply recursive filesystem walk that can
    // take tens of seconds on large drives. Offload to the blocking pool so it
    // never starves the async runtime (IPC / hotkey / UI events).
    let scan_result = tokio::task::spawn_blocking(move || scan_files(&config)).await;
    let scan_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

    // An invalidate/restart may have superseded this scan while the blocking
    // filesystem walk was finishing. Never let an obsolete snapshot commit.
    if generation.load(Ordering::Acquire) != owner {
        info!("{}: discarded obsolete scan generation {}", label, owner);
        return;
    }

    match scan_result {
        Ok(Ok(scanned_files)) => {
            let file_count = scanned_files.len();

            #[cfg(feature = "tantivy-search")]
            mark_fulltext_dirty(db_arc.as_ref().as_ref());
            // `replace_files` (tens of thousands of inserts in ONE transaction
            // holding a std Mutex) and the Tantivy rebuild (seconds of commit
            // I/O) are synchronous and blocking: run them on the blocking
            // pool, never on the Tokio worker that drives IPC/hotkeys (audit
            // passe 2, sujet 3). The mutation gate stays held across the
            // await, so watcher flushes keep queueing behind it.
            let persist_db = db_arc.clone();
            let persist_result = tokio::task::spawn_blocking(move || {
                let persist_started = std::time::Instant::now();
                let diagnostic_baseline =
                    snapshot_before.as_ref().and_then(
                        |cached_files| match scan_diagnostic_baseline(
                            persist_db.as_ref().as_ref(),
                            cached_files,
                            &scanned_files,
                            record_catchup_telemetry,
                        ) {
                            Ok(baseline) => Some(baseline),
                            Err(e) => {
                                warn!(
                                    "{}: skipped scan diagnostics, baseline unavailable: {}",
                                    label, e
                                );
                                None
                            }
                        },
                    );
                let persisted = if let Some(db) = persist_db.as_ref() {
                    match db.replace_files(&scanned_files) {
                        Ok(()) => {
                            let persist_ms = u64::try_from(persist_started.elapsed().as_millis())
                                .unwrap_or(u64::MAX);
                            if let Some(baseline) = diagnostic_baseline {
                                let diagnostic = crate::indexer::database::ScanDiagnostic {
                                    kind: baseline.kind,
                                    completed_at: chrono::Utc::now().timestamp(),
                                    scan_ms,
                                    persist_ms,
                                    total_ms: u64::try_from(started.elapsed().as_millis())
                                        .unwrap_or(u64::MAX),
                                    indexed_count: file_count,
                                    root_count,
                                    added: baseline.added,
                                    removed: baseline.removed,
                                    modified: baseline.modified,
                                };
                                if let Err(e) = db.record_scan(diagnostic) {
                                    warn!("{}: scan diagnostics failed: {}", label, e);
                                }
                            }
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
                if persisted || persist_db.is_none() {
                    rebuild_fulltext_index(
                        fulltext_arc.as_ref(),
                        persisted.then(|| persist_db.as_ref().as_ref()).flatten(),
                        &scanned_files,
                        label,
                    );
                }

                (persisted, scanned_files)
            })
            .await;

            let (persisted, scanned_files) = match persist_result {
                Ok(parts) => parts,
                Err(join_err) => {
                    error!(
                        "{}: persist task panicked or was cancelled: {}",
                        label, join_err
                    );
                    return;
                }
            };

            // SQLite is authoritative when available. A failed replacement
            // must preserve both the prior cache and successful-scan status.
            if db_arc.is_some() && !persisted {
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
                return;
            }

            // Re-check after the blocking persist: an invalidate/restart may
            // have superseded this scan while it was committing. The DB may
            // already hold this (now obsolete) snapshot — the replacement
            // scan overwrites it when IT commits — but the in-memory cache
            // must never regress to an older generation.
            if generation.load(Ordering::Acquire) != owner {
                info!("{}: discarded obsolete scan generation {}", label, owner);
                return;
            }

            // Update in-memory cache and its Tantivy hit lookup atomically.
            replace_file_cache(&files_arc, &file_lookup_arc, scanned_files);

            {
                let mut status = status_arc.lock().unwrap_or_else(|poisoned| {
                    warn!("{}: index status mutex poisoned; recovering", label);
                    poisoned.into_inner()
                });
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
// Keep optional filtering fields flat on the existing IPC contract; Tauri
// injects the app handle and state in addition to these user options.
#[allow(clippy::too_many_arguments)]
pub async fn start_indexing(
    app_handle: AppHandle,
    state: State<'_, FileIndexState>,
    folders: Vec<String>,
    excluded_paths: Vec<String>,
    file_extensions: Vec<String>,
    force: Option<bool>,
    deep_search: Option<bool>,
    respect_ignore_files: Option<bool>,
    exclude_generated_dirs: Option<bool>,
    diagnostics_enabled: Option<bool>,
) -> VoltResult<()> {
    let _control = state.scan_control.lock().await;

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
    let owner = state.scan_generation.fetch_add(1, Ordering::AcqRel) + 1;

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
            respect_ignore_files: respect_ignore_files.unwrap_or(true),
            exclude_generated_dirs: exclude_generated_dirs.unwrap_or(true),
            diagnostics_enabled: diagnostics_enabled.unwrap_or(false),
        };
        crate::indexer::set_external_policy(&cfg);
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
    let generation = state.scan_generation.clone();
    let mutation_gate = state.mutation_gate.clone();
    let join_handle = tokio::spawn(async move {
        // Owned by this future — its Drop clears `is_indexing` regardless of
        // whether the future completes normally, panics, or is aborted.
        let _guard = IndexingGuard::new(guard_status, generation.clone(), owner);

        let config = IndexConfig {
            folders,
            excluded_paths,
            file_extensions,
            max_depth: if deep_search.unwrap_or(false) { 10 } else { 3 },
            max_file_size: 100 * 1024 * 1024, // 100MB limit
            respect_ignore_files: respect_ignore_files.unwrap_or(true),
            exclude_generated_dirs: exclude_generated_dirs.unwrap_or(true),
            diagnostics_enabled: diagnostics_enabled.unwrap_or(false),
        };
        // --- Fast path: load from DB if it already has files (skipped when force=true) ---
        // Runs under the mutation gate (audit passe 2, sujets 1+5): without
        // it, a concurrent watcher flush can commit between our DB read and
        // our cache/Tantivy swap, losing that mutation from memory and the
        // derived index. The guard is scoped to this block on purpose —
        // `reconcile` below takes the gate itself (tokio Mutex is not
        // reentrant, holding it across would deadlock).
        // Heavy synchronous work (SQLite load, Tantivy rebuild) is offloaded
        // to the blocking pool (sujet 3), never on this Tokio worker.
        let fast_served: bool = {
            let _fast_gate = mutation_gate.lock().await;
            if should_force {
                false
            } else if let Some(db) = db_arc.as_ref() {
                // Clone the handle (shares the one connection) for the
                // blocking thread; `db` itself is borrowed from `db_arc`.
                let load_db = db.clone();
                let loaded = tokio::task::spawn_blocking(move || {
                    let n = load_db.count().unwrap_or(0);
                    if n == 0 {
                        return None;
                    }
                    load_db.get_all_files().ok()
                })
                .await
                .unwrap_or(None);
                match loaded {
                    Some(cached) => {
                        let file_count = cached.len();
                        info!("Loading {} files from SQLite cache", file_count);
                        #[cfg(feature = "tantivy-search")]
                        {
                            let ft_db = db.clone();
                            let ft_arc = fulltext_arc.clone();
                            let ft_arc_check = ft_arc.clone();
                            let current = tokio::task::spawn_blocking(move || {
                                fulltext_index_is_current(ft_arc_check.as_ref(), &ft_db, file_count)
                            })
                            .await
                            .unwrap_or(false);
                            if current {
                                info!("Reusing persistent Tantivy index ({} files)", file_count);
                            } else {
                                // Cold path only (dirty marker or doc-count
                                // mismatch): one extra snapshot clone so the
                                // rebuild owns its input while the cache swap
                                // below reuses `cached`.
                                let rb_db = db.clone();
                                let rb_ft = ft_arc.clone();
                                let rb_files = cached.clone();
                                tokio::task::spawn_blocking(move || {
                                    rebuild_fulltext_index(
                                        rb_ft.as_ref(),
                                        Some(&rb_db),
                                        &rb_files,
                                        "SQLite cache",
                                    );
                                })
                                .await
                                .unwrap_or(());
                            }
                        }
                        replace_file_cache(&files_arc, &file_lookup_arc, cached);
                        {
                            let mut status = status_arc.lock().unwrap_or_else(|poisoned| {
                                warn!("Fast-path index status mutex poisoned; recovering");
                                poisoned.into_inner()
                            });
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
                        true
                    }
                    None => {
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
                        false
                    }
                }
            } else {
                false
            }
        };
        if fast_served {
            return;
        }
        if should_force {
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
            label: if should_force { "rebuild" } else { "full scan" },
            record_catchup_telemetry: false,
            mutation_gate,
            generation,
            owner,
        })
        .await;
    });

    {
        let mut task = state.scan_task.lock().unwrap_or_else(|poisoned| {
            warn!("Scan task mutex poisoned storing scan handle; recovering");
            poisoned.into_inner()
        });
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
    _watcher_state: State<'_, WatcherState>,
) -> VoltResult<()> {
    let _control = state.scan_control.lock().await;

    // Abort any in-progress background scan before rebuilding. Recover from
    // poison: losing the AbortHandle would orphan a scan that can commit an
    // obsolete snapshot (the generation check usually saves us, but the
    // handle is cheap to preserve).
    {
        let mut task = state.scan_task.lock().unwrap_or_else(|poisoned| {
            warn!("Scan task mutex poisoned in invalidate_index; recovering");
            poisoned.into_inner()
        });
        if let Some(handle) = task.take() {
            handle.abort();
            info!("Aborted in-progress index scan for rebuild");
        }
    }

    // Keep the watcher alive. Its flushes wait on `mutation_gate` while the
    // replacement scan runs, then apply queued OS events to the new snapshot.

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

    // Supersede the prior generation. Its RAII guard is generation-aware and
    // therefore cannot clear the new scan's `is_indexing` flag when it drops.
    let owner = state.scan_generation.fetch_add(1, Ordering::AcqRel) + 1;
    {
        let mut status = state
            .status
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
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
    let generation = state.scan_generation.clone();
    let mutation_gate = state.mutation_gate.clone();
    let rebuild_handle = tokio::spawn(async move {
        // Owned by this future — its Drop clears `is_indexing` regardless of
        // whether the future completes normally, panics, or is aborted.
        let _guard = IndexingGuard::new(guard_status, generation.clone(), owner);

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
            mutation_gate,
            generation,
            owner,
        })
        .await;
    });

    {
        let mut task = state.scan_task.lock().unwrap_or_else(|poisoned| {
            warn!("Scan task mutex poisoned storing rebuild handle; recovering");
            poisoned.into_inner()
        });
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
    let folders = state
        .config
        .lock()
        .map(|cfg| cfg.folders.clone())
        .unwrap_or_default();

    // `get_stats` calls `std::fs::metadata` and a synchronous SQLite COUNT —
    // both are blocking syscalls; offload to avoid parking a Tokio worker.
    let db_arc = state.db.clone();
    let files_arc = state.files.clone();
    tokio::task::spawn_blocking(move || {
        if let Some(db) = db_arc.as_ref() {
            let mut stats = db.get_stats(is_watching).map_err(VoltError::Unknown)?;
            stats.watcher_churn =
                label_watcher_churn(std::mem::take(&mut stats.watcher_churn), &folders);
            Ok(stats)
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
                scan_history: Vec::new(),
                scan_duration_recent_ms: None,
                scan_duration_median_ms: None,
                watcher_churn: Vec::new(),
            })
        }
    })
    .await
    .map_err(|e| VoltError::Unknown(format!("get_db_index_stats task failed: {}", e)))?
}

/// Replace opaque root keys with generic labels before crossing IPC: `Root N`
/// follows the order of the configured folders; roots no longer configured,
/// and the overflow bucket, become `Other roots`. Never returns a path.
fn label_watcher_churn(
    entries: Vec<crate::indexer::database::WatcherChurnDay>,
    folders: &[String],
) -> Vec<crate::indexer::database::WatcherChurnDay> {
    use crate::indexer::database::{WatcherChurnDay, root_diagnostic_key};
    let labels: HashMap<String, String> = folders
        .iter()
        .enumerate()
        .map(|(i, folder)| {
            (
                root_diagnostic_key(Path::new(folder)),
                format!("Root {}", i + 1),
            )
        })
        .collect();
    let mut labelled: Vec<WatcherChurnDay> = Vec::with_capacity(entries.len());
    for entry in entries {
        let root = labels
            .get(&entry.root)
            .cloned()
            .unwrap_or_else(|| "Other roots".to_string());
        match labelled
            .iter_mut()
            .find(|e| e.day == entry.day && e.root == root)
        {
            Some(existing) => existing.events = existing.events.saturating_add(entry.events),
            None => labelled.push(WatcherChurnDay {
                day: entry.day,
                root,
                events: entry.events,
            }),
        }
    }
    labelled
}

/// Start (or restart) the file-system watcher for the configured directories.
///
/// Called by the frontend after the initial index scan completes.
#[tauri::command]
pub async fn start_file_watcher(
    index_state: State<'_, FileIndexState>,
    watcher_state: State<'_, WatcherState>,
) -> VoltResult<()> {
    // Stop any existing watcher. `WatcherHandle::stop` joins the worker
    // thread, which can sit in a multi-second flush or wait behind the
    // mutation gate during a scan — never do that on this Tokio worker
    // (audit passe 2, sujet 3). Take the handle out, then join it on the
    // blocking pool. Sequential stop-before-start is kept: a stale worker
    // flushing concurrently with the replacement watcher could otherwise
    // interleave duplicate mutations.
    let stale: Option<WatcherHandle> = {
        let mut handle = watcher_state.handle.lock().unwrap_or_else(|poisoned| {
            warn!("Watcher state mutex poisoned in start_file_watcher; recovering");
            poisoned.into_inner()
        });
        handle.take()
    };
    if let Some(stale) = stale {
        tokio::task::spawn_blocking(move || stale.stop())
            .await
            .map_err(|e| VoltError::Unknown(format!("watcher stop task failed: {e}")))?;
    }

    // Get the current indexing config. The watcher must enforce the same
    // folders/extensions/exclusions/limits as the initial scan.
    let config = {
        let cfg = index_state
            .config
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        cfg.clone()
    };
    let folders = config.folders.clone();

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

    // We need an Arc<FileIndexDb> for the watcher thread. The state holds
    // `Arc<Option<FileIndexDb>>`; clone the inner handle so the watcher
    // shares the SAME connection (one `Arc<Mutex<Connection>>`) instead of
    // opening a second one. Separate connections hit SQLITE_BUSY against each
    // other under scan+churn contention and dropped watcher mutations as a
    // result (audit passe 2, sujet 1). The tight `busy_timeout` remains as a
    // backstop for out-of-process writers.
    use crate::indexer::watcher::start_watcher;

    let db_arc: Arc<FileIndexDb> = Arc::new(db.clone());

    // Pass the in-memory files Arc so the watcher can keep it in sync.
    let in_memory_files = Some(index_state.files.clone());
    let in_memory_lookup = Some(index_state.file_lookup.clone());

    #[cfg(feature = "tantivy-search")]
    let watcher_result = start_watcher(
        config,
        db_arc,
        index_state.fulltext.clone(),
        in_memory_files,
        in_memory_lookup,
        index_state.mutation_gate.clone(),
    );
    #[cfg(not(feature = "tantivy-search"))]
    let watcher_result = start_watcher(
        config,
        db_arc,
        in_memory_files,
        in_memory_lookup,
        index_state.mutation_gate.clone(),
    );

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
    let handle: Option<WatcherHandle> = {
        let mut guard = watcher_state.handle.lock().unwrap_or_else(|poisoned| {
            warn!("Watcher state mutex poisoned in stop_file_watcher; recovering");
            poisoned.into_inner()
        });
        guard.take()
    };
    if let Some(handle) = handle {
        // `stop` joins the worker thread: offload (see `start_file_watcher`).
        tokio::task::spawn_blocking(move || handle.stop())
            .await
            .map_err(|e| VoltError::Unknown(format!("watcher stop task failed: {e}")))?;
        info!("File watcher stopped");
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
    let _control = state.scan_control.lock().await;

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
    let owner = state.scan_generation.fetch_add(1, Ordering::AcqRel) + 1;

    let files_arc = state.files.clone();
    let file_lookup_arc = state.file_lookup.clone();
    let status_arc = state.status.clone();
    let db_arc = state.db.clone();
    #[cfg(feature = "tantivy-search")]
    let fulltext_arc = state.fulltext.clone();
    let generation = state.scan_generation.clone();
    let mutation_gate = state.mutation_gate.clone();

    // Detached reconcile so the command returns immediately. The guard clears
    // `is_indexing` whatever happens (success, scan error, or task panic).
    //
    // The shared mutation gate makes watcher flushes wait for this snapshot
    // commit. notify keeps queueing raw events and applies them afterwards.
    let catchup_handle = tokio::spawn(async move {
        let _guard = IndexingGuard::new(status_arc.clone(), generation.clone(), owner);

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
            mutation_gate,
            generation,
            owner,
        })
        .await;
    });

    {
        let mut task = state.scan_task.lock().unwrap_or_else(|poisoned| {
            warn!("Scan task mutex poisoned storing catch-up handle; recovering");
            poisoned.into_inner()
        });
        *task = Some(catchup_handle.abort_handle());
    }

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
    fn scan_diagnostics_use_persisted_snapshot_when_startup_cache_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("files.db")).unwrap();
        let keep = test_file("keep.txt", "/keep.txt");
        let old_modified = test_file("changed.txt", "/changed.txt");
        db.upsert_files(&[
            keep.clone(),
            old_modified.clone(),
            test_file("removed.txt", "/removed.txt"),
        ])
        .unwrap();
        db.mark_full_scan().unwrap();
        let mut modified = old_modified;
        modified.size += 1;
        let after = [keep, modified, test_file("added.txt", "/added.txt")];
        let baseline = scan_diagnostic_baseline(Some(&db), &[], &after, false).unwrap();
        assert_eq!(baseline.kind, crate::indexer::database::ScanKind::Rebuild);
        assert_eq!(
            (baseline.added, baseline.removed, baseline.modified),
            (1, 1, 1)
        );
        let catchup = scan_diagnostic_baseline(Some(&db), &[], &after, true).unwrap();
        assert_eq!(catchup.kind, crate::indexer::database::ScanKind::Catchup);
    }

    #[test]
    fn scan_diagnostics_identify_initial_scan_from_persisted_state() {
        let dir = tempfile::tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("files.db")).unwrap();
        let after = [test_file("first.txt", "/first.txt")];
        let first = scan_diagnostic_baseline(Some(&db), &[], &after, false).unwrap();
        assert_eq!(first.kind, crate::indexer::database::ScanKind::Initial);
        assert_eq!((first.added, first.removed, first.modified), (1, 0, 0));
        // A previous successful empty scan is still a previous scan.
        db.mark_full_scan().unwrap();
        let next = scan_diagnostic_baseline(Some(&db), &[], &after, false).unwrap();
        assert_eq!(next.kind, crate::indexer::database::ScanKind::Rebuild);
        // Without SQLite, use the cache instead of inventing an empty baseline.
        let cached = scan_diagnostic_baseline(None, &after, &after, false).unwrap();
        assert_eq!((cached.added, cached.removed, cached.modified), (0, 0, 0));
    }

    #[test]
    fn scan_diagnostics_reject_unavailable_authoritative_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("files.db");
        let db = FileIndexDb::open(&path).unwrap();
        db.set_meta("last_full_scan", "invalid timestamp").unwrap();
        assert!(scan_diagnostic_baseline(Some(&db), &[], &[], false).is_err());
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute_batch("DROP TABLE files;")
            .unwrap();
        assert!(scan_diagnostic_baseline(Some(&db), &[], &[], false).is_err());
    }

    #[tokio::test]
    async fn reconcile_persist_failure_preserves_snapshot_and_does_not_record_success() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("root");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("new.txt"), "new snapshot").unwrap();
        let db_path = dir.path().join("files.db");
        let db = FileIndexDb::open(&db_path).unwrap();
        let old = test_file("old.txt", "/old.txt");
        db.upsert_file(&old).unwrap();
        rusqlite::Connection::open(&db_path)
            .unwrap()
            .execute_batch("CREATE TRIGGER reject_scan BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT, 'simulated persistence failure'); END;")
            .unwrap();
        let files = Arc::new(Mutex::new(Arc::new(vec![old])));
        let lookup = Arc::new(Mutex::new(Arc::new(HashMap::from([(
            "/old.txt".to_string(),
            0,
        )]))));
        let status = Arc::new(Mutex::new(IndexStatus {
            is_indexing: true,
            total_files: 1,
            indexed_files: 1,
            last_updated: 123,
        }));
        let config = IndexConfig {
            folders: vec![root.to_string_lossy().into_owned()],
            diagnostics_enabled: true,
            ..IndexConfig::default()
        };
        reconcile(ReconcileParams {
            config,
            files_arc: files.clone(),
            file_lookup_arc: lookup.clone(),
            status_arc: status.clone(),
            db_arc: Arc::new(Some(db.clone())),
            #[cfg(feature = "tantivy-search")]
            fulltext_arc: None,
            app_handle: None,
            label: "rebuild",
            record_catchup_telemetry: true,
            mutation_gate: Arc::new(tokio::sync::Mutex::new(())),
            generation: Arc::new(AtomicU64::new(1)),
            owner: 1,
        })
        .await;
        assert_eq!(files.lock().unwrap()[0].path, "/old.txt");
        assert_eq!(lookup.lock().unwrap().get("/old.txt"), Some(&0));
        assert_eq!(status.lock().unwrap().last_updated, 123);
        assert_eq!(db.get_all_files().unwrap()[0].path, "/old.txt");
        let stats = db.get_stats(false).unwrap();
        assert!(stats.scan_history.is_empty());
        assert_eq!(stats.stale_catchup_count, 0);
        assert_eq!(stats.last_full_scan, 0);
    }

    #[test]
    fn watcher_churn_labels_are_generic_and_never_paths() {
        use crate::indexer::database::{WatcherChurnDay, root_diagnostic_key};
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let folders = vec![
            first.path().to_string_lossy().into_owned(),
            second.path().to_string_lossy().into_owned(),
        ];
        let entry = |root: String, events| WatcherChurnDay {
            day: 1,
            root,
            events,
        };
        let labelled = label_watcher_churn(
            vec![
                entry(root_diagnostic_key(second.path()), 4),
                entry(root_diagnostic_key(first.path()), 2),
                entry("removed-root-key".into(), 1),
                entry("other".into(), 3),
            ],
            &folders,
        );
        let json = serde_json::to_string(&labelled).unwrap();
        for folder in &folders {
            assert!(!json.contains(folder.as_str()));
        }
        assert!(!json.contains("removed-root-key"));
        assert_eq!(labelled[0].root, "Root 2");
        assert_eq!(labelled[1].root, "Root 1");
        assert_eq!(labelled[2].root, "Other roots");
        assert_eq!(labelled[2].events, 4, "unknown roots fold together");
        assert_eq!(labelled.len(), 3);
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
        let generation = Arc::new(AtomicU64::new(1));
        {
            let _guard = IndexingGuard::new(Arc::clone(&status), generation, 1);
            // Simulate the spawn closure being aborted before reaching its
            // success/error arms — `_guard` still drops at scope exit.
        }
        assert!(!status.lock().unwrap().is_indexing);
    }

    /// Even if the guard's drop runs after a panic-poisoned mutex, it must
    /// not panic itself AND must still clear the flag (sujet 6). Poison is
    /// produced deterministically: the panic unwinds through the guard,
    /// poisoning the mutex, and `catch_unwind` contains it.
    #[test]
    fn indexing_guard_drop_recovers_from_poisoned_status() {
        let status = Arc::new(Mutex::new(IndexStatus {
            is_indexing: true,
            total_files: 0,
            indexed_files: 0,
            last_updated: 0,
        }));
        let generation = Arc::new(AtomicU64::new(1));
        {
            let status = Arc::clone(&status);
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = status.lock().unwrap();
                panic!("intentional poison for test");
            }));
        }
        assert!(status.lock().is_err());
        drop(IndexingGuard::new(Arc::clone(&status), generation, 1));
        assert!(
            !status
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .is_indexing
        );
    }

    /// `replace_file_cache` must swap even when the cache mutexes are
    /// poisoned (sujet 6): skipping the swap while SQLite+Tantivy advanced
    /// would desynchronize the three stores.
    #[test]
    fn replace_file_cache_recovers_from_poison() {
        let files_state = Arc::new(Mutex::new(Arc::new(Vec::new())));
        let lookup_state = Arc::new(Mutex::new(Arc::new(HashMap::new())));
        {
            let state = Arc::clone(&files_state);
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = state.lock().unwrap();
                panic!("intentional poison for test");
            }));
            let state = Arc::clone(&lookup_state);
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = state.lock().unwrap();
                panic!("intentional poison for test");
            }));
        }
        replace_file_cache(
            &files_state,
            &lookup_state,
            vec![test_file("healed.txt", "/x/healed.txt")],
        );
        let files = files_state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let lookup = lookup_state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(files.len(), 1);
        assert_eq!(lookup.get("/x/healed.txt"), Some(&0));
    }

    #[test]
    fn obsolete_indexing_guard_does_not_clear_replacement_flag() {
        let status = Arc::new(Mutex::new(IndexStatus {
            is_indexing: true,
            total_files: 0,
            indexed_files: 0,
            last_updated: 0,
        }));
        let generation = Arc::new(AtomicU64::new(2));
        drop(IndexingGuard::new(
            Arc::clone(&status),
            Arc::clone(&generation),
            1,
        ));
        assert!(status.lock().unwrap().is_indexing);
    }
}
