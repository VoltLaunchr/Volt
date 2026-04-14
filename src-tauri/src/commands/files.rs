use crate::core::error::{VoltError, VoltResult};
use crate::indexer::watcher::WatcherHandle;
use crate::indexer::{
    FileCategory, FileHistory, FileIndexDb, FileInfo, IndexConfig, IndexStats as DbIndexStats,
    IndexStatus, SearchEngine, SearchOptions, SearchResult as IndexSearchResult, scan_files,
};
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
    pub status: Arc<Mutex<IndexStatus>>,
    /// SQLite database for persistent storage (None if DB could not be opened)
    pub db: Arc<Option<FileIndexDb>>,
    /// Configured folders, stored so that `invalidate_index` can trigger a rescan
    pub config: Arc<Mutex<IndexConfig>>,
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
            status: Arc::new(Mutex::new(IndexStatus {
                is_indexing: false,
                total_files: 0,
                indexed_files: 0,
                last_updated: 0,
            })),
            db: Arc::new(None),
            config: Arc::new(Mutex::new(IndexConfig::default())),
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

        Self {
            files: Arc::new(Mutex::new(Arc::new(Vec::new()))),
            status: Arc::new(Mutex::new(IndexStatus {
                is_indexing: false,
                total_files: 0,
                indexed_files: 0,
                last_updated: 0,
            })),
            db: Arc::new(db),
            config: Arc::new(Mutex::new(IndexConfig::default())),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexingProgress {
    phase: String,
    indexed_files: usize,
    total_files: usize,
    is_complete: bool,
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
) -> VoltResult<()> {
    // Check if already indexing
    {
        let status = state
            .status
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        if status.is_indexing {
            return Err(VoltError::InvalidConfig(
                "Indexing already in progress".to_string(),
            ));
        }
    }

    // Persist config so `invalidate_index` can re-use it.
    {
        let mut cfg = state
            .config
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        *cfg = IndexConfig {
            folders: folders.clone(),
            excluded_paths: excluded_paths.clone(),
            file_extensions: file_extensions.clone(),
            max_depth: 10,
            max_file_size: 100 * 1024 * 1024,
        };
    }

    // Mark as indexing
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
    let status_arc = state.status.clone();
    let db_arc = state.db.clone();
    let app_handle = app_handle.clone();

    // Run indexing in background
    tauri::async_runtime::spawn(async move {
        let config = IndexConfig {
            folders,
            excluded_paths,
            file_extensions,
            max_depth: 10,
            max_file_size: 100 * 1024 * 1024, // 100MB limit
        };

        // --- Fast path: load from DB if it already has files ---
        if let Some(db) = db_arc.as_ref() {
            match db.count() {
                Ok(n) if n > 0 => {
                    info!("Loading {} files from SQLite cache", n);
                    match db.get_all_files() {
                        Ok(cached) => {
                            let file_count = cached.len();
                            if let Ok(mut files) = files_arc.lock() {
                                *files = Arc::new(cached);
                            }
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
                Err(e) => warn!("Could not check DB count: {}", e),
            }
        }

        // --- Full scan ---
        match scan_files(&config) {
            Ok(scanned_files) => {
                let file_count = scanned_files.len();

                // Persist to SQLite.
                if let Some(db) = db_arc.as_ref() {
                    if let Err(e) = db.upsert_files(&scanned_files) {
                        warn!("Failed to persist index to DB: {}", e);
                    } else if let Err(e) = db.mark_full_scan() {
                        warn!("Failed to mark full scan: {}", e);
                    }
                }

                // Update in-memory cache.
                if let Ok(mut files) = files_arc.lock() {
                    *files = Arc::new(scanned_files);
                }

                // Update status
                if let Ok(mut status) = status_arc.lock() {
                    status.is_indexing = false;
                    status.total_files = file_count;
                    status.indexed_files = file_count;
                    status.last_updated = chrono::Utc::now().timestamp();
                }

                info!("Full scan complete: {} files indexed", file_count);
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
            Err(e) => {
                error!("Indexing failed: {}", e);
                let _ = app_handle.emit(
                    "indexing-progress",
                    IndexingProgress {
                        phase: "error".to_string(),
                        indexed_files: 0,
                        total_files: 0,
                        is_complete: true,
                    },
                );
                if let Ok(mut status) = status_arc.lock() {
                    status.is_indexing = false;
                }
            }
        }
    });

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
    // O(1) Arc clone to release the mutex before searching
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

    if has_operators {
        // Use advanced search engine with operator filters
        use crate::indexer::search_engine::{SearchEngine, SearchOptions};
        let mut engine = SearchEngine::new();
        let options = SearchOptions {
            limit,
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
        let results = engine.search(&query, &files, &options);
        Ok(results.into_iter().map(FileSearchResult::from).collect())
    } else {
        // Use advanced search engine for scoring (instead of simple search)
        use crate::indexer::search_engine::{SearchEngine, SearchOptions};
        let max_results = limit.unwrap_or(20);
        let mut engine = SearchEngine::new();
        let options = SearchOptions {
            limit: Some(max_results),
            recency_boost: Some(1.3),
            frequency_boost: Some(1.2),
            ..Default::default()
        };
        let mut results: Vec<FileSearchResult> = engine
            .search(&query, &files, &options)
            .into_iter()
            .map(FileSearchResult::from)
            .collect();

        // Supplement with Windows Search Index if our results are sparse
        #[cfg(target_os = "windows")]
        if results.len() < max_results {
            let needed = max_results - results.len();
            if let Ok(ws_results) =
                crate::indexer::windows_search::search_windows_index(&query, needed)
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
    // Stop the watcher while we rebuild.
    if let Ok(mut handle) = watcher_state.handle.lock() {
        if let Some(h) = handle.as_ref() {
            h.stop();
        }
        *handle = None;
    }

    // Clear the SQLite DB.
    if let Some(db) = state.db.as_ref() {
        db.clear_all().map_err(VoltError::Unknown)?;
    }

    // Clear in-memory cache.
    if let Ok(mut files) = state.files.lock() {
        *files = Arc::new(Vec::new());
    }

    // Re-run indexing with the last-known config.
    let config = state
        .config
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?
        .clone();

    // Kick off a new full scan (reuse start_indexing logic).
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
    let status_arc = state.status.clone();
    let db_arc = state.db.clone();

    tauri::async_runtime::spawn(async move {
        match scan_files(&config) {
            Ok(scanned_files) => {
                let file_count = scanned_files.len();

                if let Some(db) = db_arc.as_ref() {
                    if let Err(e) = db.upsert_files(&scanned_files) {
                        warn!("Failed to persist rebuilt index: {}", e);
                    } else if let Err(e) = db.mark_full_scan() {
                        warn!("Failed to mark full scan: {}", e);
                    }
                }

                if let Ok(mut files) = files_arc.lock() {
                    *files = Arc::new(scanned_files);
                }

                if let Ok(mut status) = status_arc.lock() {
                    status.is_indexing = false;
                    status.total_files = file_count;
                    status.indexed_files = file_count;
                    status.last_updated = chrono::Utc::now().timestamp();
                }

                info!("Index rebuilt: {} files", file_count);
            }
            Err(e) => {
                error!("Index rebuild failed: {}", e);
                if let Ok(mut status) = status_arc.lock() {
                    status.is_indexing = false;
                }
            }
        }
    });

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

    if let Some(db) = state.db.as_ref() {
        db.get_stats(is_watching).map_err(VoltError::Unknown)
    } else {
        // No DB – synthesise stats from in-memory state.
        let indexed_count = state.files.lock().map(|f| f.len()).unwrap_or(0);
        Ok(DbIndexStats {
            indexed_count,
            db_size_bytes: 0,
            last_full_scan: 0,
            is_watching,
        })
    }
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

    match start_watcher(folders.clone(), db_arc, in_memory_files) {
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
