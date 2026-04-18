//! Riot Games scanner
//!
//! Scans for games installed via Riot Client (League of Legends, Valorant, etc.)

use super::types::{GameInfo, GamePlatform, GameScanner};
use crate::utils::game_icon::find_game_icon;
use std::path::PathBuf;

/// Riot Games scanner
pub struct RiotScanner {
    riot_path: Option<PathBuf>,
}

impl RiotScanner {
    pub fn new() -> Self {
        let riot_path = Self::find_riot_path();
        Self { riot_path }
    }

    /// Find Riot Games installation path
    fn find_riot_path() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            let paths = vec![
                PathBuf::from(r"C:\Riot Games"),
                PathBuf::from(r"D:\Riot Games"),
            ];

            paths.into_iter().find(|p| p.exists())
        }

        #[cfg(target_os = "macos")]
        {
            let home = dirs::home_dir()?;
            let path = home.join("Applications/Riot Games");
            if path.exists() { Some(path) } else { None }
        }

        #[cfg(target_os = "linux")]
        {
            None
        }
    }

    /// Known Riot games
    fn known_games() -> Vec<(&'static str, &'static str, &'static str)> {
        vec![
            ("League of Legends", "league_of_legends", "leagueclient"),
            ("VALORANT", "valorant", "VALORANT"),
            ("Legends of Runeterra", "bacon", "LoR"),
            ("Teamfight Tactics", "league_of_legends", "tft"),
        ]
    }
}

impl Default for RiotScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for RiotScanner {
    fn is_installed(&self) -> bool {
        self.riot_path.is_some()
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let riot_path = self.riot_path.as_ref().ok_or("Riot Games not installed")?;

        let mut games = Vec::new();

        // Scan for known Riot games
        for (name, folder, _product) in Self::known_games() {
            let game_path = riot_path.join(folder);

            if game_path.exists() {
                let game_id = format!("riot_{}", folder.replace(' ', "_").to_lowercase());

                let mut game = GameInfo::new(
                    game_id,
                    name.to_string(),
                    GamePlatform::Riot,
                    game_path.clone(),
                );

                // Riot games launch via riotclient protocol
                game.launch_uri = Some(format!("riotclient://launch-product/{}", folder));

                game.is_installed = true;

                // Try to find executable
                #[cfg(target_os = "windows")]
                {
                    let exe_path = game_path.join(format!("{}.exe", name.replace(' ', "")));
                    if exe_path.exists() {
                        game.executable = Some(exe_path);
                    }
                }

                // Find icon: search in game directory, then extract from exe
                game.icon_path = find_game_icon(&game_path, game.executable.as_ref());

                games.push(game);
            }
        }

        // Also scan for any other games in Riot Games folder
        if let Ok(entries) = std::fs::read_dir(riot_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let folder_name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();

                    // Skip if already added or is Riot Client itself
                    if folder_name.to_lowercase() == "riot client"
                        || games.iter().any(|g| g.install_path == path)
                    {
                        continue;
                    }

                    let game_id = format!("riot_{}", folder_name.replace(' ', "_").to_lowercase());

                    let mut game = GameInfo::new(
                        game_id,
                        folder_name.clone(),
                        GamePlatform::Riot,
                        path.clone(),
                    );

                    game.launch_uri = Some(format!(
                        "riotclient://launch-product/{}",
                        folder_name.to_lowercase().replace(' ', "_")
                    ));
                    game.is_installed = true;

                    games.push(game);
                }
            }
        }

        // Sort by name
        games.sort_by_key(|a| a.name.to_lowercase());

        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        let games = self.scan_games()?;
        let _game = games
            .iter()
            .find(|g| g.id == game_id)
            .ok_or("Riot game not found")?;

        // `riotclient://launch-product/` isn't an officially registered URL
        // scheme. Riot's supported integration path is passing
        // `--launch-product` and `--launch-patchline` directly to
        // RiotClientServices.exe (see Riot Client FAQ / community docs).
        #[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
        let product = game_id
            .strip_prefix("riot_")
            .ok_or("Invalid Riot game ID")?;

        #[cfg(target_os = "windows")]
        {
            let riot_services = self
                .riot_path
                .as_ref()
                .map(|p| p.join("Riot Client").join("RiotClientServices.exe"))
                .filter(|p| p.exists())
                .ok_or("RiotClientServices.exe not found")?;

            std::process::Command::new(riot_services)
                .arg(format!("--launch-product={}", product))
                .arg("--launch-patchline=live")
                .spawn()
                .map_err(|e| format!("Failed to launch Riot game: {}", e))?;
            Ok(())
        }

        #[cfg(not(target_os = "windows"))]
        {
            let exe = _game
                .executable
                .as_ref()
                .ok_or("No executable available for this Riot game on this platform")?;
            std::process::Command::new(exe)
                .spawn()
                .map_err(|e| format!("Failed to launch Riot game: {}", e))?;
            Ok(())
        }
    }
}
