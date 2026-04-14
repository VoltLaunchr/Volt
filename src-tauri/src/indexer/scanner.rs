use super::types::{FileCategory, FileInfo, IndexConfig};
#[cfg(target_os = "windows")]
use crate::utils::extract_icon;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use crate::utils::path::is_executable;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tracing::warn;

/// Directories that are known to be inaccessible or should be skipped silently
#[cfg(target_os = "windows")]
const SENSITIVE_DIRECTORIES: &[&str] = &[
    "WindowsApps",
    "System Volume Information",
    "$Recycle.Bin",
    "$RECYCLE.BIN",
    "Recovery",
    "Config.Msi",
    "Documents and Settings",
    "ProgramData\\Microsoft\\Windows\\Containers",
    "Windows\\CSC",
    "Windows\\System32\\LogFiles\\WMI",
];

/// Check if a directory is a known sensitive/protected Windows directory
#[cfg(target_os = "windows")]
fn is_sensitive_directory(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    SENSITIVE_DIRECTORIES.iter().any(|sensitive| {
        path_str.ends_with(sensitive) || path_str.contains(&format!("\\{}\\", sensitive))
    })
}

#[cfg(not(target_os = "windows"))]
fn is_sensitive_directory(_path: &Path) -> bool {
    false
}

/// Get icon for a file based on its extension or type
fn get_file_icon(path: &Path) -> Option<String> {
    let _path_str = path.to_string_lossy().to_string();

    // For Windows, use the system icon extraction for all files
    #[cfg(target_os = "windows")]
    {
        extract_icon(&_path_str)
    }

    // For other platforms, use emoji-based icons for common types
    #[cfg(not(target_os = "windows"))]
    {
        if path.is_dir() {
            return Some("📁".to_string());
        }

        // Check if file is executable (Unix systems, linux + macOS where is_executable is available)
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        if path.is_file() && is_executable(path) {
            return Some("⚙️".to_string());
        }

        let extension = path.extension()?.to_string_lossy().to_lowercase();

        let icon = match extension.as_str() {
            // Documents
            "pdf" => "📄",
            "doc" | "docx" => "📝",
            "txt" | "md" => "📃",
            "xls" | "xlsx" | "csv" => "📊",
            "ppt" | "pptx" => "📊",

            // Images
            "jpg" | "jpeg" | "png" | "gif" | "bmp" | "svg" | "webp" => "🖼️",

            // Audio
            "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" => "🎵",

            // Video
            "mp4" | "avi" | "mkv" | "mov" | "wmv" | "flv" | "webm" => "🎬",

            // Archives
            "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" => "📦",

            // Code
            "rs" | "py" | "js" | "ts" | "jsx" | "tsx" | "java" | "c" | "cpp" | "h" | "hpp" => "💻",
            "html" | "css" | "scss" | "json" | "xml" | "yaml" | "toml" => "💻",

            // Executables
            "exe" | "msi" | "app" | "dmg" => "⚙️",

            _ => "📄",
        };

        Some(icon.to_string())
    }
}

/// Scans directories and builds a file index based on configuration
pub fn scan_files(config: &IndexConfig) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();

    for folder in &config.folders {
        let path = PathBuf::from(folder);
        if !path.exists() {
            warn!("Folder does not exist: {}", folder);
            continue;
        }

        if let Ok(scanned) = scan_directory(&path, config, 0) {
            files.extend(scanned);
        }
    }

    Ok(files)
}

/// Recursively scans a directory
fn scan_directory(
    dir_path: &Path,
    config: &IndexConfig,
    current_depth: usize,
) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();

    // Check depth limit
    if current_depth >= config.max_depth {
        return Ok(files);
    }

    // Check if path is excluded using proper path-based comparison
    for excluded in &config.excluded_paths {
        let excluded_path = Path::new(excluded);

        // Try to canonicalize both paths for accurate comparison
        // Fall back to original paths if canonicalization fails (e.g., path doesn't exist)
        let dir_canonical = dir_path
            .canonicalize()
            .unwrap_or_else(|_| dir_path.to_path_buf());
        let excluded_canonical = excluded_path
            .canonicalize()
            .unwrap_or_else(|_| excluded_path.to_path_buf());

        // If excluded path is absolute, check if current path is a descendant
        if excluded_canonical.is_absolute() {
            if dir_canonical.starts_with(&excluded_canonical) {
                return Ok(files);
            }
        } else {
            // For relative/component-based exclusions, check if any component matches exactly
            for component in dir_canonical.components() {
                if let Some(comp_str) = component.as_os_str().to_str()
                    && comp_str == excluded
                {
                    return Ok(files);
                }
            }
        }
    }

    // Skip sensitive directories silently
    if is_sensitive_directory(dir_path) {
        return Ok(files);
    }

    // Read directory entries
    let entries = match fs::read_dir(dir_path) {
        Ok(entries) => entries,
        Err(e) => {
            // Only warn for unexpected access errors, not for known protected directories
            if !is_sensitive_directory(dir_path) {
                warn!("Failed to read directory {:?}: {}", dir_path, e);
            }
            return Ok(files);
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();

        // Skip symlinks to avoid infinite loops
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if metadata.is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            // Always index directories at the first two levels (game folders and subfolders)
            // This allows searching for game directories like "Battlefield 6"
            if (current_depth <= 1 || config.file_extensions.is_empty())
                && let Some(dir_info) = create_directory_info(&path, &metadata)
            {
                files.push(dir_info);
            }

            // Recursively scan subdirectory
            if let Ok(sub_files) = scan_directory(&path, config, current_depth + 1) {
                files.extend(sub_files);
            }
        } else if metadata.is_file() {
            // Check file size limit
            if config.max_file_size > 0 && metadata.len() > config.max_file_size {
                continue;
            }

            // Check file extension filter - if empty, index all files
            if !config.file_extensions.is_empty() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    // Check if this extension is in our allowed list
                    if !config
                        .file_extensions
                        .iter()
                        .any(|e| e.to_lowercase() == ext_str)
                    {
                        continue;
                    }
                } else {
                    // Skip files without extension if filter is set
                    continue;
                }
            }

            // Create FileInfo
            if let Some(file_info) = create_file_info(&path, &metadata) {
                files.push(file_info);
            }
        }
    }

    Ok(files)
}

/// Public wrapper for use by the file watcher module.
pub fn create_file_info_pub(path: &Path, metadata: &fs::Metadata) -> Option<FileInfo> {
    create_file_info(path, metadata)
}

/// Public wrapper for use by the file watcher module.
pub fn create_directory_info_pub(path: &Path, metadata: &fs::Metadata) -> Option<FileInfo> {
    create_directory_info(path, metadata)
}

/// Creates a FileInfo from a file path and metadata
fn create_file_info(path: &Path, metadata: &fs::Metadata) -> Option<FileInfo> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let path_str = path.to_string_lossy().to_string();
    let extension = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let modified = metadata
        .modified()
        .ok()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;

    let created = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);

    let accessed = metadata
        .accessed()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);

    let id = crate::utils::hash_id(&path_str);
    let icon = get_file_icon(path);

    // Detect file category based on extension and path
    let category = {
        let base = FileCategory::from_path(&path_str, &extension, false);
        // On Unix systems, verify executable permissions for files without extension
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            if extension.is_empty() && is_executable(path) {
                FileCategory::Executable
            } else {
                base
            }
        }
        #[cfg(target_os = "windows")]
        {
            base
        }
    };

    Some(FileInfo {
        id,
        name,
        path: path_str,
        extension,
        size: metadata.len(),
        modified,
        created,
        accessed,
        icon,
        category,
    })
}

/// Creates a FileInfo from a directory path and metadata
fn create_directory_info(path: &Path, metadata: &fs::Metadata) -> Option<FileInfo> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let path_str = path.to_string_lossy().to_string();

    let modified = metadata
        .modified()
        .ok()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;

    let created = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);

    let accessed = metadata
        .accessed()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);

    let id = crate::utils::hash_id(&path_str);
    let icon = get_file_icon(path);

    // Detect if this is a game folder
    let category = FileCategory::from_path(&path_str, "folder", true);

    Some(FileInfo {
        id,
        name,
        path: path_str,
        extension: String::from("folder"),
        size: 0,
        modified,
        created,
        accessed,
        icon,
        category,
    })
}
