//! Rockstar Games Launcher scanner
//!
//! The Rockstar Launcher doesn't ship a public URL scheme. Playnite's
//! RockstarLibrary launches games by invoking the launcher directly with
//! `Launcher.exe -launchTitleInFolder "<install_dir>"` — we do the same.

#[allow(unused_imports)]
use super::types::{GameInfo, GamePlatform, GameScanner};
#[allow(unused_imports)]
use crate::utils::game_icon::find_game_icon;
use std::path::PathBuf;
#[allow(unused_imports)]
use tracing::{debug, warn};

/// Rockstar Games scanner
pub struct RockstarScanner {
    launcher_exe: Option<PathBuf>,
}

impl RockstarScanner {
    pub fn new() -> Self {
        Self {
            launcher_exe: Self::find_launcher(),
        }
    }

    fn find_launcher() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            let candidates = [
                PathBuf::from(r"C:\Program Files\Rockstar Games\Launcher\Launcher.exe"),
                PathBuf::from(r"C:\Program Files (x86)\Rockstar Games\Launcher\Launcher.exe"),
            ];
            candidates.into_iter().find(|p| p.exists())
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    }

    /// Build the Volt game ID for a Rockstar install folder name. Pure
    /// helper exposed for tests.
    #[allow(dead_code)]
    pub(crate) fn build_game_id(folder_name: &str) -> String {
        format!("rockstar_{}", folder_name.replace(' ', "_").to_lowercase())
    }

    /// Scan Windows registry for Rockstar titles. Each installed game
    /// registers an `InstallFolder` value under
    /// `HKLM\SOFTWARE\WOW6432Node\Rockstar Games\<GameName>`.
    #[cfg(target_os = "windows")]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        use winreg::RegKey;
        use winreg::enums::*;

        let mut games = Vec::new();
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

        let rockstar_keys = [
            r"SOFTWARE\WOW6432Node\Rockstar Games",
            r"SOFTWARE\Rockstar Games",
        ];

        for key_path in rockstar_keys {
            let Ok(root) = hklm.open_subkey(key_path) else {
                continue;
            };
            for game_name in root.enum_keys().flatten() {
                // Skip launcher meta-entries.
                let name_lc = game_name.to_lowercase();
                if name_lc == "launcher" || name_lc == "rockstar games social club" {
                    continue;
                }

                let Ok(game_key) = root.open_subkey(&game_name) else {
                    continue;
                };
                let install_folder: String =
                    game_key.get_value("InstallFolder").unwrap_or_default();
                if install_folder.is_empty() {
                    continue;
                }

                let install_path = PathBuf::from(&install_folder);
                if !install_path.exists() {
                    continue;
                }

                let mut game = GameInfo::new(
                    Self::build_game_id(&game_name),
                    game_name.clone(),
                    GamePlatform::Rockstar,
                    install_path.clone(),
                );
                game.is_installed = true;
                game.icon_path = find_game_icon(&install_path, None);
                debug!(name = %game_name, path = %install_folder, "Rockstar game found");
                games.push(game);
            }
        }

        Ok(games)
    }

    #[cfg(not(target_os = "windows"))]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        Ok(Vec::new())
    }
}

impl Default for RockstarScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for RockstarScanner {
    fn is_installed(&self) -> bool {
        self.launcher_exe.is_some()
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = self.scan_from_registry()?;
        games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        games.dedup_by(|a, b| a.id == b.id);
        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        let games = self.scan_games()?;
        let game = games
            .iter()
            .find(|g| g.id == game_id)
            .ok_or("Rockstar game not found")?;

        #[cfg(target_os = "windows")]
        {
            let launcher = self
                .launcher_exe
                .as_ref()
                .ok_or("Rockstar Games Launcher not found")?;
            // -launchTitleInFolder is the flag Playnite uses. Passing the
            // install dir tells Launcher.exe which registered title to start
            // without needing to know the internal title ID.
            std::process::Command::new(launcher)
                .arg("-launchTitleInFolder")
                .arg(game.install_path.as_os_str())
                .spawn()
                .map_err(|e| format!("Failed to launch Rockstar game: {}", e))?;
            Ok(())
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = game;
            Err("Rockstar Games Launcher is Windows-only".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_game_id_lowercases_and_replaces_spaces() {
        assert_eq!(
            RockstarScanner::build_game_id("Grand Theft Auto V"),
            "rockstar_grand_theft_auto_v"
        );
    }

    #[test]
    fn build_game_id_preserves_non_space_punctuation() {
        assert_eq!(
            RockstarScanner::build_game_id("Red Dead Redemption 2"),
            "rockstar_red_dead_redemption_2"
        );
    }
}
