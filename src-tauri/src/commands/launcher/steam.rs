use crate::PluginState;
/// Steam Scanner plugin commands
use crate::core::error::{VoltError, VoltResult};
use crate::plugins::builtin::game_scanner::steam::SteamGame;
use serde::{Deserialize, Serialize};
use tauri::State;

/// Steam game information for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamGameInfo {
    pub app_id: String,
    pub name: String,
    pub install_dir: String,
    pub executable: Option<String>,
    pub last_played: Option<i64>,
}

impl From<&SteamGame> for SteamGameInfo {
    fn from(game: &SteamGame) -> Self {
        Self {
            app_id: game.app_id.clone(),
            name: game.name.clone(),
            install_dir: game.install_dir.to_string_lossy().to_string(),
            executable: game
                .executable
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            last_played: game.last_played,
        }
    }
}

/// Check if Steam is installed
#[tauri::command]
pub fn is_steam_installed(_plugin_state: State<PluginState>) -> VoltResult<bool> {
    use crate::plugins::builtin::game_scanner::steam::SteamScanner;

    let scanner = SteamScanner::new();
    Ok(scanner.is_steam_installed())
}

/// Get all Steam games
#[tauri::command]
pub fn get_steam_games(_plugin_state: State<PluginState>) -> VoltResult<Vec<SteamGameInfo>> {
    use crate::plugins::builtin::game_scanner::steam::SteamScanner;

    // Create a new scanner instance
    let scanner = SteamScanner::new();

    if !scanner.is_steam_installed() {
        return Ok(Vec::new());
    }

    // Get games from scanner
    let games = scanner.scan_steam_games().map_err(VoltError::Plugin)?;

    Ok(games.iter().map(SteamGameInfo::from).collect())
}

/// Launch a Steam game by App ID
#[tauri::command]
pub fn launch_steam_game(_plugin_state: State<PluginState>, app_id: String) -> VoltResult<()> {
    use crate::plugins::builtin::game_scanner::steam::SteamScanner;

    let scanner = SteamScanner::new();
    scanner.launch_game(&app_id).map_err(VoltError::Launch)
}

/// Rescan Steam library
#[tauri::command]
pub async fn rescan_steam_library(_plugin_state: State<'_, PluginState>) -> VoltResult<usize> {
    use crate::plugins::builtin::game_scanner::steam::SteamScanner;

    let scanner = SteamScanner::new();

    if !scanner.is_steam_installed() {
        return Ok(0);
    }

    // Rescan
    let games = scanner.scan_steam_games().map_err(VoltError::Plugin)?;

    Ok(games.len())
}

/// Get Steam installation path (useful for debugging/info)
#[tauri::command]
pub fn get_steam_installation_path(
    _plugin_state: State<PluginState>,
) -> VoltResult<Option<String>> {
    use crate::plugins::builtin::game_scanner::steam::SteamScanner;

    let scanner = SteamScanner::new();
    Ok(scanner
        .get_steam_path()
        .map(|p| p.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_steam_game_info_conversion() {
        use std::path::PathBuf;

        let game = SteamGame {
            app_id: "123".to_string(),
            name: "Test Game".to_string(),
            install_dir: PathBuf::from("/path/to/game"),
            executable: Some(PathBuf::from("/path/to/game/game.exe")),
            last_played: Some(1234567890),
        };

        let info = SteamGameInfo::from(&game);
        assert_eq!(info.app_id, "123");
        assert_eq!(info.name, "Test Game");
        assert!(info.executable.is_some());
        assert_eq!(info.last_played, Some(1234567890));
    }
}
