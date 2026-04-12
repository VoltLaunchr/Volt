use serde::{Deserialize, Serialize};

/// File category for intelligent filtering and scoring
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum FileCategory {
    /// Executable applications (.exe, .app, .msi)
    Application,
    /// Games (detected from common game folders or Steam)
    Game,
    /// Generic executable files
    Executable,
    /// Directories/Folders
    Folder,
    /// Documents (pdf, doc, txt, etc.)
    Document,
    /// Images (jpg, png, gif, etc.)
    Image,
    /// Video files (mp4, mkv, avi, etc.)
    Video,
    /// Audio files (mp3, wav, flac, etc.)
    Audio,
    /// Archives (zip, rar, 7z, etc.)
    Archive,
    /// Source code files
    Code,
    /// Everything else
    #[default]
    Other,
}

impl FileCategory {
    /// Detect category from file extension and path
    pub fn from_path(path: &str, extension: &str, is_dir: bool) -> Self {
        if is_dir {
            // Check if it's a game folder
            let path_lower = path.to_lowercase();
            if Self::is_game_path(&path_lower) {
                return Self::Game;
            }
            return Self::Folder;
        }

        let ext_lower = extension.to_lowercase();
        let path_lower = path.to_lowercase();

        // Check for applications first
        if matches!(ext_lower.as_str(), "exe" | "msi" | "app" | "appimage") {
            // Check if it's in a game folder
            if Self::is_game_path(&path_lower) {
                return Self::Game;
            }
            return Self::Application;
        }

        // On Unix, files without extension might be executables
        // This will be verified later with is_executable() check
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        if extension.is_empty() {
            // Could be an executable, will be determined by permissions
            return Self::Executable;
        }

        // Match by extension
        match ext_lower.as_str() {
            // Documents
            "pdf" | "doc" | "docx" | "txt" | "md" | "rtf" | "odt" | "xls" | "xlsx" | "csv"
            | "ppt" | "pptx" | "epub" | "mobi" => Self::Document,

            // Images
            "jpg" | "jpeg" | "png" | "gif" | "bmp" | "svg" | "webp" | "ico" | "tiff" | "tif"
            | "psd" | "ai" | "raw" | "cr2" | "nef" | "heic" | "heif" => Self::Image,

            // Video
            "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m4v" | "mpeg" | "mpg"
            | "3gp" | "ogv" => Self::Video,

            // Audio
            "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" | "opus" | "aiff" | "ape" => {
                Self::Audio
            }

            // Archives
            "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" | "dmg" => Self::Archive,

            // Code
            "rs" | "py" | "js" | "ts" | "jsx" | "tsx" | "java" | "c" | "cpp" | "h" | "hpp"
            | "cs" | "go" | "rb" | "php" | "swift" | "kt" | "scala" | "vue" | "svelte" | "html"
            | "css" | "scss" | "sass" | "less" | "json" | "xml" | "yaml" | "yml" | "toml"
            | "ini" | "sql" => Self::Code,

            // Scripts and shell (also code but may be executable)
            "sh" | "bash" | "zsh" | "ps1" | "bat" | "cmd" => Self::Code,

            // Executables/Libraries (non-app)
            "com" | "dll" | "so" | "dylib" => Self::Executable,

            _ => Self::Other,
        }
    }

    /// Check if a path looks like a game installation
    fn is_game_path(path_lower: &str) -> bool {
        // Common game folder patterns
        let game_patterns = [
            "steamapps",
            "steam\\steamapps",
            "steam/steamapps",
            "program files (x86)\\steam",
            "program files\\steam",
            "epic games",
            "gog galaxy",
            "ubisoft game launcher",
            "origin games",
            "ea games",
            "battle.net",
            "riot games",
            "games\\",
            "games/",
            "\\games\\",
            "/games/",
        ];

        game_patterns
            .iter()
            .any(|pattern| path_lower.contains(pattern))
    }
}

/// Represents a file in the index
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub extension: String,
    pub size: u64,
    pub modified: i64,
    pub created: Option<i64>,
    pub accessed: Option<i64>,
    pub icon: Option<String>,
    /// File category for filtering and scoring
    #[serde(default)]
    pub category: FileCategory,
}

/// Configuration for file indexing
#[derive(Debug, Clone)]
pub struct IndexConfig {
    pub folders: Vec<String>,
    pub excluded_paths: Vec<String>,
    pub file_extensions: Vec<String>,
    pub max_depth: usize,
    pub max_file_size: u64, // in bytes, 0 = no limit
}

impl Default for IndexConfig {
    fn default() -> Self {
        Self {
            folders: vec![],
            excluded_paths: vec![],
            file_extensions: vec![],
            max_depth: 10,
            max_file_size: 0, // No limit by default
        }
    }
}

/// Index status for progress reporting
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub is_indexing: bool,
    pub total_files: usize,
    pub indexed_files: usize,
    pub last_updated: i64,
}
