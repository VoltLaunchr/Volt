use super::ignore_policy::IgnorePolicy;
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

/// Pre-built `\name\` wrapped patterns for single-segment entries.
/// Multi-segment entries (already containing `\`) are matched via `ends_with` only.
#[cfg(target_os = "windows")]
const SENSITIVE_DIRECTORIES_WRAPPED: &[&str] = &[
    "\\WindowsApps\\",
    "\\System Volume Information\\",
    "\\$Recycle.Bin\\",
    "\\$RECYCLE.BIN\\",
    "\\Recovery\\",
    "\\Config.Msi\\",
    "\\Documents and Settings\\",
    "", // multi-segment — ends_with covers it
    "", // multi-segment — ends_with covers it
    "", // multi-segment — ends_with covers it
];

/// Check if a directory is a known sensitive/protected Windows directory
#[cfg(target_os = "windows")]
pub(super) fn is_sensitive_directory(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    SENSITIVE_DIRECTORIES
        .iter()
        .zip(SENSITIVE_DIRECTORIES_WRAPPED.iter())
        .any(|(sensitive, wrapped)| {
            path_str.ends_with(sensitive) || (!wrapped.is_empty() && path_str.contains(*wrapped))
        })
}

#[cfg(not(target_os = "windows"))]
pub(super) fn is_sensitive_directory(_path: &Path) -> bool {
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
    let policy = IgnorePolicy::new(config);

    // Build lowercased extension set once — O(1) lookup per file instead of O(n) per-extension alloc.
    let extensions_lower: std::collections::HashSet<String> = config
        .file_extensions
        .iter()
        .map(|e| e.to_lowercase())
        .collect();

    for folder in dedup_roots(&config.folders) {
        let path = PathBuf::from(&folder);
        if !path.exists() {
            warn!("Folder does not exist: {}", folder);
            continue;
        }

        if path.ancestors().any(|ancestor| {
            fs::symlink_metadata(ancestor).is_ok_and(|m| m.file_type().is_symlink())
        }) {
            continue;
        }
        if let Ok(scanned) = scan_directory(&path, config, 0, &extensions_lower, &policy) {
            files.extend(scanned);
        }
    }

    let mut seen = std::collections::HashSet::new();
    files.retain(|file| seen.insert(policy.normalize_path(Path::new(&file.path))));
    Ok(files)
}

/// Deduplicate identical roots. Keep explicit nested roots because an ignore
/// rule can prune their parent during the outer walk. Results are deduplicated
/// separately so overlapping roots never produce duplicate SQLite records.
fn dedup_roots(folders: &[String]) -> Vec<String> {
    let canonical: Vec<(String, PathBuf)> = folders
        .iter()
        .map(|f| {
            let p = Path::new(f);
            (
                f.clone(),
                p.canonicalize().unwrap_or_else(|_| p.to_path_buf()),
            )
        })
        .collect();

    // Shortest canonical path first so parents are kept before their children
    // are checked against them.
    let mut sorted = canonical.clone();
    sorted.sort_by_key(|(_, c)| c.as_os_str().len());

    let mut kept: Vec<PathBuf> = Vec::new();
    let mut result = Vec::new();
    for (original, candidate) in sorted {
        if kept.contains(&candidate) {
            continue;
        }
        kept.push(candidate);
        result.push(original);
    }
    result
}

/// Recursively scans a directory
fn scan_directory(
    dir_path: &Path,
    config: &IndexConfig,
    current_depth: usize,
    extensions_lower: &std::collections::HashSet<String>,
    policy: &IgnorePolicy,
) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();

    // Check depth limit
    if current_depth >= config.max_depth {
        return Ok(files);
    }

    if !policy.allows(dir_path, true) {
        return Ok(files);
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
        // `file_type()` reads from the already-loaded DirEntry — no extra
        // syscall and no symlink-following. The previous `entry.metadata()`
        // call followed symlinks, which on Windows triggered a network round
        // trip on OneDrive cloud-only files (hydrating them just to find out
        // whether they were files or dirs). For directory traversal we only
        // need the file_type; metadata for `size` / `modified` is fetched
        // below only when we actually keep the file.
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        // Filter before inserting directory entries, not only before recursion.
        if !policy.allows(&path, file_type.is_dir())
            || (file_type.is_dir() && is_sensitive_directory(&path))
        {
            continue;
        }

        if file_type.is_dir() {
            // Always index directories at the first two levels (game folders and subfolders)
            // This allows searching for game directories like "Battlefield 6"
            if (current_depth <= 1 || config.file_extensions.is_empty())
                && let Ok(metadata) = entry.metadata()
                && let Some(dir_info) = create_directory_info(&path, &metadata)
            {
                files.push(dir_info);
            }

            // Recursively scan subdirectory
            if let Ok(sub_files) =
                scan_directory(&path, config, current_depth + 1, extensions_lower, policy)
            {
                files.extend(sub_files);
            }
        } else if file_type.is_file() {
            // Check file extension filter BEFORE the metadata syscall — cheapest
            // possible rejection path for excluded extensions.
            if !extensions_lower.is_empty() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if !extensions_lower.contains(&ext_str) {
                        continue;
                    }
                } else {
                    // Skip files without extension if filter is set
                    continue;
                }
            }

            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            // Check file size limit
            if config.max_file_size > 0 && metadata.len() > config.max_file_size {
                continue;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scanner_filters_ignored_directory_entries_and_generated_subtrees() {
        let root = crate::indexer::test_tempdir();
        for name in ["ignored", "node_modules", "node_modules-old", "target"] {
            fs::create_dir(root.path().join(name)).unwrap();
            fs::write(root.path().join(name).join("note.txt"), b"x").unwrap();
        }
        fs::write(root.path().join("Cargo.toml"), "[package]").unwrap();
        fs::write(root.path().join(".voltignore"), "ignored/\n").unwrap();
        let config = IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            file_extensions: vec!["txt".into()],
            ..IndexConfig::default()
        };
        let files = scan_files(&config).unwrap();
        assert_eq!(
            files.len(),
            2,
            "only node_modules-old and its note are indexed"
        );
        assert!(files.iter().all(|file| Path::new(&file.path).starts_with(root.path().join("node_modules-old"))));
    }

    #[test]
    fn explicit_nested_root_under_pruned_parent_is_scanned_without_duplicates() {
        let root = crate::indexer::test_tempdir();
        let nested = root.path().join("node_modules/target");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("keep.txt"), b"x").unwrap();
        let allowed = root.path().join("normal");
        fs::create_dir(&allowed).unwrap();
        fs::write(allowed.join("other.txt"), b"x").unwrap();
        let config = IndexConfig {
            folders: vec![
                root.path().to_string_lossy().into_owned(),
                nested.to_string_lossy().into_owned(),
                allowed.to_string_lossy().into_owned(),
            ],
            file_extensions: vec!["txt".into()],
            ..IndexConfig::default()
        };
        let files = scan_files(&config).unwrap();
        assert_eq!(
            files.iter().filter(|file| file.name == "keep.txt").count(),
            1
        );
        assert_eq!(
            files.iter().filter(|file| file.name == "other.txt").count(),
            1
        );
    }

    #[test]
    fn read_dir_scanner_remains_the_cross_platform_fallback() {
        let root = crate::indexer::test_tempdir();
        let nested = root.path().join("nested");
        fs::create_dir(&nested).expect("create nested directory");
        let expected = nested.join("resume.txt");
        fs::write(&expected, b"fallback").expect("write fixture");

        let config = IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: Vec::new(),
            file_extensions: vec!["txt".to_string()],
            max_depth: 10,
            max_file_size: 1024,
            ..IndexConfig::default()
        };

        let files = scan_files(&config).expect("read_dir fallback scan");
        let expected = expected.to_string_lossy();
        assert!(files.iter().any(|file| file.path == expected));
    }
}
