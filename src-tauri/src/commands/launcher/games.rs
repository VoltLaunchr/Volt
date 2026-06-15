//! Game Scanner commands
//!
//! Tauri commands for the multi-platform game scanner

use crate::core::error::{VoltError, VoltResult};
use crate::plugins::builtin::game_scanner::{GameInfo, GameScannerPlugin};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// Global game scanner instance (singleton with internal caching)
static GAME_SCANNER: OnceLock<GameScannerPlugin> = OnceLock::new();

/// Get or initialize the game scanner singleton
fn get_game_scanner() -> &'static GameScannerPlugin {
    GAME_SCANNER.get_or_init(GameScannerPlugin::new)
}

/// Game information for frontend (serializable)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfoResponse {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub platform_icon: String,
    pub install_path: String,
    pub executable: Option<String>,
    pub launch_uri: Option<String>,
    pub icon_path: Option<String>,
    pub last_played: Option<i64>,
    pub is_installed: bool,
    pub subtitle: String,
}

impl From<&GameInfo> for GameInfoResponse {
    fn from(game: &GameInfo) -> Self {
        Self {
            id: game.id.clone(),
            name: game.name.clone(),
            platform: game.platform.display_name().to_string(),
            platform_icon: game.platform.icon().to_string(),
            install_path: game.install_path.to_string_lossy().to_string(),
            executable: game
                .executable
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            launch_uri: game.launch_uri.clone(),
            icon_path: game.icon_path.clone(),
            last_played: game.last_played,
            is_installed: game.is_installed,
            subtitle: game.subtitle(),
        }
    }
}

/// Platform info for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub is_installed: bool,
    pub game_count: usize,
}

/// Get all installed games from all platforms
#[tauri::command]
pub fn get_all_games() -> VoltResult<Vec<GameInfoResponse>> {
    let scanner = get_game_scanner();
    let games = scanner.get_games();

    Ok(games.iter().map(GameInfoResponse::from).collect())
}

/// Search games by query
#[tauri::command]
pub fn search_games(query: String, limit: Option<usize>) -> VoltResult<Vec<GameInfoResponse>> {
    let scanner = get_game_scanner();
    let mut games = scanner.search_games(&query);

    // Apply limit if specified
    if let Some(limit) = limit {
        games.truncate(limit);
    }

    Ok(games.iter().map(GameInfoResponse::from).collect())
}

/// Get games by platform
#[tauri::command]
pub fn get_games_by_platform(platform: String) -> VoltResult<Vec<GameInfoResponse>> {
    let scanner = get_game_scanner();
    let games = scanner.get_games();

    let platform_lower = platform.to_lowercase();
    let filtered: Vec<GameInfoResponse> = games
        .iter()
        .filter(|g| {
            g.platform.display_name().to_lowercase() == platform_lower
                || format!("{:?}", g.platform).to_lowercase() == platform_lower
        })
        .map(GameInfoResponse::from)
        .collect();

    Ok(filtered)
}

/// Launch a game by its ID
#[tauri::command]
pub fn launch_game(game_id: String) -> VoltResult<()> {
    let scanner = get_game_scanner();
    scanner.launch_game(&game_id).map_err(VoltError::Launch)
}

/// Get all installed platforms with game counts
#[tauri::command]
pub fn get_game_platforms() -> VoltResult<Vec<PlatformInfo>> {
    let scanner = get_game_scanner();
    let games = scanner.get_games();
    let platforms = scanner.get_installed_platforms();

    let mut platform_infos = Vec::new();

    for platform in platforms {
        let game_count = games.iter().filter(|g| g.platform == platform).count();
        platform_infos.push(PlatformInfo {
            id: format!("{:?}", platform).to_lowercase(),
            name: platform.display_name().to_string(),
            icon: platform.icon().to_string(),
            is_installed: true,
            game_count,
        });
    }

    Ok(platform_infos)
}

/// Rescan all games (invalidate cache)
#[tauri::command]
pub fn rescan_all_games() -> VoltResult<usize> {
    let scanner = get_game_scanner();
    let games = scanner.rescan();
    Ok(games.len())
}

/// Get total game count
#[tauri::command]
pub fn get_game_count() -> VoltResult<usize> {
    let scanner = get_game_scanner();
    let games = scanner.get_games();
    Ok(games.len())
}
