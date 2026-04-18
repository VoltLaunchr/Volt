//! Common types for game scanning

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Supported game platforms
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GamePlatform {
    Steam,
    Epic,
    Gog,
    Ubisoft,
    EA,
    Xbox,
    Riot,
    Battlenet,
    Amazon,
    Rockstar,
    Other,
}

impl GamePlatform {
    /// Get display name for the platform
    pub fn display_name(&self) -> &'static str {
        match self {
            GamePlatform::Steam => "Steam",
            GamePlatform::Epic => "Epic Games",
            GamePlatform::Gog => "GOG Galaxy",
            GamePlatform::Ubisoft => "Ubisoft Connect",
            GamePlatform::EA => "EA App",
            GamePlatform::Xbox => "Xbox",
            GamePlatform::Riot => "Riot Games",
            GamePlatform::Battlenet => "Battle.net",
            GamePlatform::Amazon => "Amazon Games",
            GamePlatform::Rockstar => "Rockstar Games",
            GamePlatform::Other => "Other",
        }
    }

    /// Get icon/emoji for the platform
    pub fn icon(&self) -> &'static str {
        match self {
            GamePlatform::Steam => "🎮",
            GamePlatform::Epic => "🟡",
            GamePlatform::Gog => "🟣",
            GamePlatform::Ubisoft => "🔷",
            GamePlatform::EA => "🔵",
            GamePlatform::Xbox => "🟢",
            GamePlatform::Riot => "🔴",
            GamePlatform::Battlenet => "❄️",
            GamePlatform::Amazon => "📦",
            GamePlatform::Rockstar => "⭐",
            GamePlatform::Other => "🎮",
        }
    }
}

impl std::fmt::Display for GamePlatform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

/// Unified game information across all platforms
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    /// Unique identifier (platform-specific, e.g., "steam_12345" or "epic_fortnite")
    pub id: String,
    /// Game name
    pub name: String,
    /// Platform the game is from
    pub platform: GamePlatform,
    /// Installation directory
    pub install_path: PathBuf,
    /// Path to executable (if known)
    pub executable: Option<PathBuf>,
    /// Platform-specific launch URI (e.g., "steam://rungameid/12345")
    pub launch_uri: Option<String>,
    /// Icon path or URL
    pub icon_path: Option<String>,
    /// Last played timestamp (Unix timestamp)
    pub last_played: Option<i64>,
    /// Whether the game is installed
    pub is_installed: bool,
    /// Optional user-defined alias for quick search
    pub alias: Option<String>,
}

impl GameInfo {
    /// Create a new game info
    pub fn new(id: String, name: String, platform: GamePlatform, install_path: PathBuf) -> Self {
        Self {
            id,
            name,
            platform,
            install_path,
            executable: None,
            launch_uri: None,
            icon_path: None,
            last_played: None,
            is_installed: true,
            alias: None,
        }
    }

    /// Generate a display subtitle for the game
    pub fn subtitle(&self) -> String {
        format!(
            "{} {} • {}",
            self.platform.icon(),
            self.platform.display_name(),
            if self.is_installed {
                "Installed"
            } else {
                "Not Installed"
            }
        )
    }
}

/// Trait for platform-specific game scanners
pub trait GameScanner: Send + Sync {
    /// Check if this platform's client is installed
    fn is_installed(&self) -> bool;

    /// Scan for installed games
    fn scan_games(&self) -> Result<Vec<GameInfo>, String>;

    /// Launch a game by its ID
    fn launch_game(&self, game_id: &str) -> Result<(), String>;
}
