use crate::core::error::{VoltError, VoltResult};
use crate::indexer::{
    FileCategory, FileHistory, FileInfo, IndexConfig, IndexStatus, SearchEngine, SearchOptions,
    SearchResult as IndexSearchResult, scan_files, search_files as search_indexed_files,
};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;
use tracing::error;

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

/// Global file index state
pub struct FileIndexState {
    pub files: Arc<Mutex<Vec<FileInfo>>>,
    pub status: Arc<Mutex<IndexStatus>>,
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
            files: Arc::new(Mutex::new(Vec::new())),
            status: Arc::new(Mutex::new(IndexStatus {
                is_indexing: false,
                total_files: 0,
                indexed_files: 0,
                last_updated: 0,
            })),
        }
    }
}

/// Starts file indexing based on settings
#[tauri::command]
pub async fn start_indexing(
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

    // Run indexing in background
    tauri::async_runtime::spawn(async move {
        let config = IndexConfig {
            folders,
            excluded_paths,
            file_extensions,
            max_depth: 10,
            max_file_size: 100 * 1024 * 1024, // 100MB limit
        };

        match scan_files(&config) {
            Ok(scanned_files) => {
                let file_count = scanned_files.len();

                // Update files
                if let Ok(mut files) = files_arc.lock() {
                    *files = scanned_files;
                }

                // Update status
                if let Ok(mut status) = status_arc.lock() {
                    status.is_indexing = false;
                    status.total_files = file_count;
                    status.indexed_files = file_count;
                    status.last_updated = chrono::Utc::now().timestamp();
                }
            }
            Err(e) => {
                error!("Indexing failed: {}", e);
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

/// Searches indexed files
#[tauri::command]
pub async fn search_files(
    state: State<'_, FileIndexState>,
    query: String,
    limit: Option<usize>,
) -> VoltResult<Vec<FileInfo>> {
    let files = state
        .files
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?;

    let mut results = search_indexed_files(&query, &files);

    if let Some(max_results) = limit {
        results.truncate(max_results);
    }

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
    let files = state
        .files
        .lock()
        .map_err(|e| VoltError::Unknown(format!("Failed to acquire file index lock: {}", e)))?;

    let mut engine = SearchEngine::new();

    let options = SearchOptions {
        limit,
        categories: parse_category_filter(categories),
        include_hidden: include_hidden.unwrap_or(false),
        filename_only: filename_only.unwrap_or(false),
        min_score,
        recency_boost: Some(1.3),   // 30% boost for recent files
        frequency_boost: Some(1.2), // 20% boost for apps/games
    };

    let results = engine.search(&query, &files, &options);

    Ok(results.into_iter().map(FileSearchResult::from).collect())
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
    let files = state
        .files
        .lock()
        .map_err(|e| VoltError::Unknown(format!("Failed to acquire file index lock: {}", e)))?;

    let mut engine = SearchEngine::new();

    let options = SearchOptions {
        limit,
        categories: parse_category_filter(categories),
        include_hidden: include_hidden.unwrap_or(false),
        filename_only: filename_only.unwrap_or(false),
        min_score,
        recency_boost: Some(1.3),
        frequency_boost: Some(1.2),
    };

    // Use search_with_indices for highlighting support
    let results = engine.search_with_indices(&query, &files, &options);

    Ok(results.into_iter().map(FileSearchResult::from).collect())
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
    let files = state
        .files
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?;

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

/// Index statistics
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
