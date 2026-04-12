/// Core type definitions used across the application

use serde::{Deserialize, Serialize};

/// Application category enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AppCategory {
    Development,
    Productivity,
    Media,
    Gaming,
    System,
    Internet,
    Graphics,
    Office,
    Utilities,
    Other,
}

impl Default for AppCategory {
    fn default() -> Self {
        Self::Other
    }
}

impl AppCategory {
    /// Convert string to category
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "development" | "dev" | "programming" => Self::Development,
            "productivity" | "work" => Self::Productivity,
            "media" | "audio" | "video" | "music" => Self::Media,
            "gaming" | "game" | "games" => Self::Gaming,
            "system" | "os" => Self::System,
            "internet" | "web" | "browser" | "network" => Self::Internet,
            "graphics" | "design" | "photo" => Self::Graphics,
            "office" | "document" => Self::Office,
            "utilities" | "tools" | "util" => Self::Utilities,
            _ => Self::Other,
        }
    }

    /// Get category as string
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Development => "development",
            Self::Productivity => "productivity",
            Self::Media => "media",
            Self::Gaming => "gaming",
            Self::System => "system",
            Self::Internet => "internet",
            Self::Graphics => "graphics",
            Self::Office => "office",
            Self::Utilities => "utilities",
            Self::Other => "other",
        }
    }

    /// Get display name for UI
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Development => "Development",
            Self::Productivity => "Productivity",
            Self::Media => "Media",
            Self::Gaming => "Gaming",
            Self::System => "System",
            Self::Internet => "Internet",
            Self::Graphics => "Graphics",
            Self::Office => "Office",
            Self::Utilities => "Utilities",
            Self::Other => "Other",
        }
    }
}

/// Search result type enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchResultType {
    Application,
    File,
    Folder,
    Plugin,
    Command,
    Calculator,
    WebSearch,
    SystemCommand,
    Timer,
}

/// Platform enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOS,
    Linux,
}

impl Platform {
    /// Get current platform
    pub fn current() -> Self {
        #[cfg(target_os = "windows")]
        return Self::Windows;

        #[cfg(target_os = "macos")]
        return Self::MacOS;

        #[cfg(target_os = "linux")]
        return Self::Linux;

        // Fallback for other Unix-like platforms (FreeBSD, NetBSD, etc.)
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        return Self::Linux;
    }

    /// Check if current platform matches
    pub fn is_current(&self) -> bool {
        *self == Self::current()
    }

    /// Get platform name as string
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::MacOS => "macos",
            Self::Linux => "linux",
        }
    }
}

/// Application launch mode
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchMode {
    /// Launch normally (default)
    Normal,
    /// Launch as administrator/root
    Elevated,
    /// Launch minimized
    Minimized,
    /// Launch maximized
    Maximized,
}

impl Default for LaunchMode {
    fn default() -> Self {
        Self::Normal
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_category_from_str() {
        assert_eq!(AppCategory::from_str("development"), AppCategory::Development);
        assert_eq!(AppCategory::from_str("gaming"), AppCategory::Gaming);
        assert_eq!(AppCategory::from_str("unknown"), AppCategory::Other);
    }

    #[test]
    fn test_platform_current() {
        let platform = Platform::current();
        assert!(platform.is_current());
    }
}
