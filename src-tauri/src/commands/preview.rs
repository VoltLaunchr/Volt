//! File preview commands
//!
//! Provides preview data for the Preview Panel (text content, image paths, folder listings).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::core::error::{VoltError, VoltResult};

const MAX_TEXT_PREVIEW_BYTES: usize = 2048;
const MAX_FOLDER_CHILDREN: usize = 20;

/// Path segments that indicate sensitive directories we never want to preview.
/// Matched case-insensitively against canonicalised path components.
const SENSITIVE_DIR_NAMES: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    ".netrc",
    ".npmrc",
    ".docker",
    ".kube",
    ".azure",
];

/// Absolute path prefixes that are never allowed for previewing.
#[cfg(target_os = "windows")]
const FORBIDDEN_PREFIXES: &[&str] = &[
    "c:\\windows",
    "c:\\programdata\\microsoft\\crypto",
    "c:\\programdata\\microsoft\\windows\\start menu", // harmless but noisy
];

#[cfg(not(target_os = "windows"))]
const FORBIDDEN_PREFIXES: &[&str] = &[
    "/etc/",
    "/etc",
    "/root",
    "/root/",
    "/proc/",
    "/proc",
    "/sys/",
    "/sys",
    "/boot/",
    "/boot",
    "/var/lib/docker",
    "/var/log",
];

/// Reject paths that point to obviously sensitive locations (system dirs,
/// dotfiles holding credentials, etc.).
fn is_sensitive_path(canonical: &Path) -> bool {
    // Check each path component for sensitive directory names.
    for component in canonical.components() {
        let part = component.as_os_str().to_string_lossy().to_lowercase();
        if SENSITIVE_DIR_NAMES.contains(&part.as_str()) {
            return true;
        }
    }

    // Check absolute prefixes.
    let path_str = canonical.to_string_lossy().to_lowercase();
    for prefix in FORBIDDEN_PREFIXES {
        if path_str.starts_with(prefix) {
            return true;
        }
    }

    false
}

/// Canonicalise the user-provided path and ensure it is safe to preview.
/// Returns the canonical form on success.
fn validate_preview_path(raw: &str) -> VoltResult<PathBuf> {
    let p = Path::new(raw);
    if !p.exists() {
        return Err(VoltError::NotFound(format!("Path not found: {}", raw)));
    }

    // Resolve symlinks / `..` so traversal attacks can't escape our checks.
    let canonical = p
        .canonicalize()
        .map_err(|e| VoltError::FileSystem(format!("Cannot resolve path '{}': {}", raw, e)))?;

    if is_sensitive_path(&canonical) {
        return Err(VoltError::FileSystem(format!(
            "Preview of '{}' is not allowed (sensitive location)",
            raw
        )));
    }

    Ok(canonical)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewType {
    Text,
    Image,
    Folder,
    Application,
    Binary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: i64,
    pub preview_type: PreviewType,
    pub content: Option<String>,
    pub children: Option<Vec<String>>,
    pub metadata: HashMap<String, String>,
}

const TEXT_EXTENSIONS: &[&str] = &[
    "txt",
    "md",
    "json",
    "ts",
    "tsx",
    "js",
    "jsx",
    "py",
    "rs",
    "css",
    "html",
    "xml",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "log",
    "csv",
    "sh",
    "bash",
    "zsh",
    "bat",
    "ps1",
    "c",
    "cpp",
    "h",
    "hpp",
    "java",
    "kt",
    "go",
    "rb",
    "php",
    "sql",
    "graphql",
    "proto",
    "env",
    "gitignore",
    "dockerfile",
    "makefile",
    "cmake",
    "gradle",
    "lock",
    "svg",
];

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "tif",
];

const APP_EXTENSIONS: &[&str] = &["exe", "msi", "app", "lnk", "desktop", "appimage"];

fn get_extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn detect_preview_type(path: &Path) -> PreviewType {
    if path.is_dir() {
        return PreviewType::Folder;
    }

    let ext = get_extension(path);

    // Check filename without extension for special files
    let filename = path
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("")
        .to_lowercase();

    if TEXT_EXTENSIONS.contains(&ext.as_str())
        || filename == "makefile"
        || filename == "dockerfile"
        || filename == "readme"
        || filename == "license"
        || filename == "changelog"
    {
        PreviewType::Text
    } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        PreviewType::Image
    } else if APP_EXTENSIONS.contains(&ext.as_str()) {
        PreviewType::Application
    } else {
        PreviewType::Binary
    }
}

fn read_text_preview(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let len = bytes.len().min(MAX_TEXT_PREVIEW_BYTES);
    let slice = &bytes[..len];

    // Try UTF-8, fallback to lossy
    match std::str::from_utf8(slice) {
        Ok(s) => Some(s.to_string()),
        Err(_) => Some(String::from_utf8_lossy(slice).to_string()),
    }
}

fn list_folder_children(path: &Path) -> Option<Vec<String>> {
    let entries = fs::read_dir(path).ok()?;
    let mut children: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(if is_dir { format!("{}/", name) } else { name })
        })
        .collect();

    children.sort();
    children.truncate(MAX_FOLDER_CHILDREN);
    Some(children)
}

fn format_size(size: u64) -> String {
    if size < 1024 {
        format!("{} B", size)
    } else if size < 1024 * 1024 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else if size < 1024 * 1024 * 1024 {
        format!("{:.1} MB", size as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.1} GB", size as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

/// Get a preview of a file or folder
#[tauri::command]
pub async fn get_file_preview(path: String) -> VoltResult<FilePreview> {
    // Reject sensitive paths (credentials, system dirs) and resolve symlinks.
    let canonical = validate_preview_path(&path)?;
    let p = canonical.as_path();

    let meta = fs::metadata(p).map_err(|e| VoltError::FileSystem(e.to_string()))?;
    let size = meta.len();
    let modified = meta
        .modified()
        .map(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64
        })
        .unwrap_or(0);

    let name = p
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let preview_type = detect_preview_type(p);
    let mut metadata = HashMap::new();
    metadata.insert("size_formatted".to_string(), format_size(size));
    metadata.insert("extension".to_string(), get_extension(p));

    let (content, children) = match &preview_type {
        PreviewType::Text => {
            let text = read_text_preview(p);
            if let Some(ref t) = text {
                let line_count = t.lines().count();
                metadata.insert("line_count".to_string(), line_count.to_string());
                if t.len() >= MAX_TEXT_PREVIEW_BYTES {
                    metadata.insert("truncated".to_string(), "true".to_string());
                }
            }
            (text, None)
        }
        PreviewType::Image => {
            // Return the path as content for frontend to render via asset protocol
            metadata.insert("image_path".to_string(), path.clone());
            (None, None)
        }
        PreviewType::Folder => {
            let kids = list_folder_children(p);
            if let Some(ref k) = kids {
                metadata.insert("child_count".to_string(), k.len().to_string());
            }
            (None, kids)
        }
        PreviewType::Application => {
            metadata.insert("type".to_string(), "application".to_string());
            (None, None)
        }
        PreviewType::Binary => (None, None),
    };

    Ok(FilePreview {
        path,
        name,
        size,
        modified,
        preview_type,
        content,
        children,
        metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_detect_preview_type_text() {
        assert!(matches!(
            detect_preview_type(Path::new("test.txt")),
            PreviewType::Text
        ));
        assert!(matches!(
            detect_preview_type(Path::new("code.rs")),
            PreviewType::Text
        ));
        assert!(matches!(
            detect_preview_type(Path::new("config.json")),
            PreviewType::Text
        ));
    }

    #[test]
    fn test_detect_preview_type_image() {
        assert!(matches!(
            detect_preview_type(Path::new("photo.png")),
            PreviewType::Image
        ));
        assert!(matches!(
            detect_preview_type(Path::new("photo.jpg")),
            PreviewType::Image
        ));
    }

    #[test]
    fn test_detect_preview_type_app() {
        assert!(matches!(
            detect_preview_type(Path::new("app.exe")),
            PreviewType::Application
        ));
    }

    #[test]
    fn test_detect_preview_type_binary() {
        assert!(matches!(
            detect_preview_type(Path::new("data.bin")),
            PreviewType::Binary
        ));
    }

    #[test]
    fn test_format_size() {
        assert_eq!(format_size(500), "500 B");
        assert_eq!(format_size(1536), "1.5 KB");
        assert_eq!(format_size(2_621_440), "2.5 MB");
    }

    #[test]
    fn test_read_text_preview() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.txt");
        let mut f = fs::File::create(&file_path).unwrap();
        write!(f, "Hello, world!\nLine 2").unwrap();

        let preview = read_text_preview(&file_path);
        assert!(preview.is_some());
        assert!(preview.unwrap().contains("Hello, world!"));
    }

    #[test]
    fn test_read_text_preview_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("big.txt");
        let content = "x".repeat(5000);
        fs::write(&file_path, &content).unwrap();

        let preview = read_text_preview(&file_path).unwrap();
        assert_eq!(preview.len(), MAX_TEXT_PREVIEW_BYTES);
    }
}
