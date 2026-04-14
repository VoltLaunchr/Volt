//! GOG Galaxy scanner
//!
//! Scans for games installed via GOG Galaxy by reading the registry
//! and galaxy database.

#[allow(unused_imports)]
use super::types::{GameInfo, GamePlatform, GameScanner};
#[allow(unused_imports)]
use crate::utils::game_icon::find_game_icon;
use std::path::PathBuf;
#[allow(unused_imports)]
use tracing::{debug, warn};

/// GOG Galaxy scanner
pub struct GOGScanner {
    gog_path: Option<PathBuf>,
    database_path: Option<PathBuf>,
}

impl GOGScanner {
    pub fn new() -> Self {
        let (gog_path, database_path) = Self::find_gog_paths();
        Self {
            gog_path,
            database_path,
        }
    }

    /// Find GOG Galaxy installation paths
    fn find_gog_paths() -> (Option<PathBuf>, Option<PathBuf>) {
        #[cfg(target_os = "windows")]
        {
            // GOG Galaxy database location
            let local_app_data = std::env::var("LOCALAPPDATA").ok();
            let database = local_app_data
                .map(|p| PathBuf::from(p).join("GOG.com/Galaxy/storage/galaxy-2.0.db"));

            // GOG Galaxy installation
            let gog_paths = vec![
                PathBuf::from(r"C:\Program Files (x86)\GOG Galaxy"),
                PathBuf::from(r"C:\Program Files\GOG Galaxy"),
            ];

            let gog_path = gog_paths.into_iter().find(|p| p.exists());
            let database_path = database.filter(|p| p.exists());

            (gog_path, database_path)
        }

        #[cfg(target_os = "macos")]
        {
            let home = dirs::home_dir();
            let database = home.as_ref().map(|h| {
                h.join("Library/Application Support/GOG.com/Galaxy/storage/galaxy-2.0.db")
            });
            let gog = Some(PathBuf::from("/Applications/GOG Galaxy.app"));

            (gog.filter(|p| p.exists()), database.filter(|p| p.exists()))
        }

        #[cfg(target_os = "linux")]
        {
            // GOG Galaxy via Wine/Lutris
            let home = dirs::home_dir();
            let database = home.as_ref().and_then(|h| {
                // Check common Wine prefix locations
                let paths = vec![
                    h.join(".wine/drive_c/users/steamuser/AppData/Local/GOG.com/Galaxy/storage/galaxy-2.0.db"),
                    h.join(".local/share/lutris/runners/wine/gog-galaxy/drive_c/users/steamuser/AppData/Local/GOG.com/Galaxy/storage/galaxy-2.0.db"),
                ];
                paths.into_iter().find(|p| p.exists())
            });

            (None, database)
        }
    }

    /// Build a `GameInfo` from raw GOG registry values.
    ///
    /// Pure helper extracted from [`scan_from_registry`] so it can be unit
    /// tested without hitting the Windows registry. Returns `None` if the
    /// required `game_name`/`path` values are missing (GOG registry entries
    /// with empty fields are stale / uninstalled).
    #[allow(dead_code)]
    pub(crate) fn build_game_info(
        game_id: &str,
        game_name: &str,
        path: &str,
        exe: &str,
    ) -> Option<GameInfo> {
        if game_name.is_empty() || path.is_empty() {
            return None;
        }

        let install_path = PathBuf::from(path);
        let mut game = GameInfo::new(
            format!("gog_{}", game_id),
            game_name.to_string(),
            GamePlatform::Gog,
            install_path.clone(),
        );

        if !exe.is_empty() {
            game.executable = Some(install_path.join(exe));
        }

        // GOG Galaxy launch URI
        game.launch_uri = Some(format!("goggalaxy://openGameView/{}", game_id));
        game.is_installed = install_path.exists();

        Some(game)
    }

    /// Scan games from Windows Registry (fallback method)
    #[cfg(target_os = "windows")]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        use winreg::RegKey;
        use winreg::enums::*;

        let mut games = Vec::new();

        // GOG stores game info in registry
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

        let gog_keys = vec![
            r"SOFTWARE\WOW6432Node\GOG.com\Games",
            r"SOFTWARE\GOG.com\Games",
        ];

        for key_path in gog_keys {
            let games_key = match hklm.open_subkey(key_path) {
                Ok(k) => k,
                Err(_) => continue,
            };

            for game_id in games_key.enum_keys().flatten() {
                let game_key = match games_key.open_subkey(&game_id) {
                    Ok(k) => k,
                    Err(e) => {
                        warn!(game_id = %game_id, error = %e, "Failed to open GOG game subkey");
                        continue;
                    }
                };

                let name: String = game_key.get_value("gameName").unwrap_or_default();
                let path: String = game_key.get_value("path").unwrap_or_default();
                let exe: String = game_key.get_value("exe").unwrap_or_default();

                if let Some(mut game) = Self::build_game_info(&game_id, &name, &path, &exe) {
                    // Find icon: search in game directory, then extract from exe
                    game.icon_path = find_game_icon(&game.install_path, game.executable.as_ref());
                    debug!(game = %game.name, id = %game.id, "GOG game found");
                    games.push(game);
                }
            }
        }

        if games.is_empty() {
            debug!("No GOG games found in registry");
        }

        Ok(games)
    }

    #[cfg(not(target_os = "windows"))]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        Ok(Vec::new())
    }

    /// Scan games from GOG Galaxy database (SQLite)
    fn scan_from_database(&self) -> Result<Vec<GameInfo>, String> {
        let _db_path = self
            .database_path
            .as_ref()
            .ok_or("GOG Galaxy database not found")?;

        // Note: Reading SQLite database would require rusqlite dependency
        // For now, we'll rely on registry scanning on Windows
        // A full implementation would query:
        // SELECT * FROM InstalledBaseProducts WHERE isInstalled = 1

        Ok(Vec::new())
    }
}

impl Default for GOGScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for GOGScanner {
    fn is_installed(&self) -> bool {
        self.gog_path.is_some() || self.database_path.is_some()
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = Vec::new();

        // Try registry first (Windows)
        if let Ok(registry_games) = self.scan_from_registry() {
            games.extend(registry_games);
        }

        // Try database
        if let Ok(db_games) = self.scan_from_database() {
            // Merge, avoiding duplicates
            for game in db_games {
                if !games.iter().any(|g| g.id == game.id) {
                    games.push(game);
                }
            }
        }

        // Sort by name
        games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        // Extract GOG product ID from game_id (format: "gog_12345")
        let product_id = game_id.strip_prefix("gog_").ok_or("Invalid GOG game ID")?;

        let uri = format!("goggalaxy://openGameView/{}", product_id);

        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &uri])
                .spawn()
                .map_err(|e| format!("Failed to launch GOG game: {}", e))?;
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch GOG game: {}", e))?;
        }

        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch GOG game: {}", e))?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_game_info_full() {
        let game = GOGScanner::build_game_info(
            "1207658691",
            "The Witcher 3: Wild Hunt",
            r"C:\GOG Games\The Witcher 3 Wild Hunt",
            "bin/x64/witcher3.exe",
        )
        .expect("expected Some");

        assert_eq!(game.id, "gog_1207658691");
        assert_eq!(game.name, "The Witcher 3: Wild Hunt");
        assert_eq!(game.platform, GamePlatform::Gog);
        assert_eq!(
            game.launch_uri,
            Some("goggalaxy://openGameView/1207658691".to_string())
        );
        let expected_exe =
            PathBuf::from(r"C:\GOG Games\The Witcher 3 Wild Hunt").join("bin/x64/witcher3.exe");
        assert_eq!(game.executable, Some(expected_exe));
    }

    #[test]
    fn test_build_game_info_missing_name_returns_none() {
        assert!(GOGScanner::build_game_info("12345", "", r"C:\Games\X", "x.exe").is_none());
    }

    #[test]
    fn test_build_game_info_missing_path_returns_none() {
        assert!(GOGScanner::build_game_info("12345", "Name", "", "x.exe").is_none());
    }

    #[test]
    fn test_build_game_info_empty_exe_yields_none_executable() {
        let game = GOGScanner::build_game_info("99", "Foo", "/games/foo", "").expect("some");
        assert!(game.executable.is_none());
        assert_eq!(game.id, "gog_99");
    }
}
