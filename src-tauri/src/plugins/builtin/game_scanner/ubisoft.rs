//! Ubisoft Connect scanner
//!
//! Scans for games installed via Ubisoft Connect by reading
//! the launcher's configuration and registry.

#[allow(unused_imports)]
use super::types::{GameInfo, GamePlatform, GameScanner};
#[allow(unused_imports)]
use crate::utils::game_icon::find_game_icon;
use std::path::{Path, PathBuf};
#[allow(unused_imports)]
use tracing::debug;

/// Ubisoft Connect scanner
pub struct UbisoftScanner;

impl UbisoftScanner {
    pub fn new() -> Self {
        Self
    }

    /// Build the Ubisoft Connect (uplay) launch URI for a given install id.
    /// Exposed as pure helper for unit testing.
    pub(crate) fn build_launch_uri(install_id: &str) -> String {
        format!("uplay://launch/{}/0", install_id)
    }

    /// Build the stable game id used by Volt for Ubisoft entries.
    #[allow(dead_code)]
    pub(crate) fn build_game_id(install_id: &str) -> String {
        format!("ubisoft_{}", install_id)
    }

    /// Check if Ubisoft Connect is installed
    fn check_is_installed() -> bool {
        #[cfg(target_os = "windows")]
        {
            let ubisoft_paths = [
                PathBuf::from(r"C:\Program Files (x86)\Ubisoft\Ubisoft Game Launcher"),
                PathBuf::from(r"C:\Program Files\Ubisoft\Ubisoft Game Launcher"),
            ];
            ubisoft_paths.iter().any(|p| p.exists())
        }

        #[cfg(target_os = "macos")]
        {
            PathBuf::from("/Applications/Ubisoft Connect.app").exists()
        }

        #[cfg(target_os = "linux")]
        {
            false
        }
    }

    /// Scan games from Windows Registry
    #[cfg(target_os = "windows")]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        use winreg::RegKey;
        use winreg::enums::*;

        let mut games = Vec::new();

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

        // Ubisoft stores install info in registry
        let ubisoft_keys = vec![
            r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs",
            r"SOFTWARE\Ubisoft\Launcher\Installs",
        ];

        for key_path in ubisoft_keys {
            if let Ok(installs_key) = hklm.open_subkey(key_path) {
                for install_id in installs_key.enum_keys().flatten() {
                    if let Ok(install_key) = installs_key.open_subkey(&install_id) {
                        let path: String = install_key.get_value("InstallDir").unwrap_or_default();

                        if !path.is_empty() {
                            let install_path = PathBuf::from(&path);

                            // Try to get game name from path or look up
                            let name = install_path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or(&install_id)
                                .to_string();

                            let mut game = GameInfo::new(
                                Self::build_game_id(&install_id),
                                name,
                                GamePlatform::Ubisoft,
                                install_path.clone(),
                            );

                            // Ubisoft Connect launch URI
                            game.launch_uri = Some(Self::build_launch_uri(&install_id));
                            game.is_installed = install_path.exists();

                            // Try to find executable
                            game.executable = Self::find_executable(&install_path);

                            // Find icon: search in game directory, then extract from exe
                            game.icon_path =
                                find_game_icon(&install_path, game.executable.as_ref());

                            debug!(game = %game.name, id = %game.id, "Ubisoft game found (Installs)");
                            games.push(game);
                        }
                    }
                }
            }
        }

        // Also check for games in Ubisoft's game config registry
        let config_keys = vec![
            r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Configurations",
            r"SOFTWARE\Ubisoft\Launcher\Configurations",
        ];

        for key_path in config_keys {
            if let Ok(config_key) = hklm.open_subkey(key_path) {
                for game_id in config_key.enum_keys().flatten() {
                    // Skip if already added
                    if games.iter().any(|g| g.id == Self::build_game_id(&game_id)) {
                        continue;
                    }

                    if let Ok(game_key) = config_key.open_subkey(&game_id) {
                        let name: String = game_key.get_value("name").unwrap_or_default();
                        let path: String = game_key.get_value("InstallDir").unwrap_or_default();

                        if !name.is_empty() || !path.is_empty() {
                            let install_path = PathBuf::from(&path);
                            let display_name = if name.is_empty() {
                                install_path
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or(&game_id)
                                    .to_string()
                            } else {
                                name
                            };

                            let mut game = GameInfo::new(
                                Self::build_game_id(&game_id),
                                display_name,
                                GamePlatform::Ubisoft,
                                install_path.clone(),
                            );

                            game.launch_uri = Some(Self::build_launch_uri(&game_id));
                            game.is_installed = !path.is_empty() && install_path.exists();
                            game.executable = Self::find_executable(&install_path);

                            // Find icon: search in game directory, then extract from exe
                            game.icon_path =
                                find_game_icon(&install_path, game.executable.as_ref());

                            debug!(game = %game.name, id = %game.id, "Ubisoft game found (Configurations)");
                            games.push(game);
                        }
                    }
                }
            }
        }

        if games.is_empty() {
            debug!("No Ubisoft games found in registry");
        }

        Ok(games)
    }

    #[cfg(not(target_os = "windows"))]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        Ok(Vec::new())
    }

    /// Find executable in game directory
    #[allow(dead_code)]
    fn find_executable(install_path: &Path) -> Option<PathBuf> {
        if !install_path.exists() {
            return None;
        }

        // Look for .exe files in the root
        if let Ok(entries) = std::fs::read_dir(install_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("exe") {
                    let filename = path.file_stem()?.to_str()?.to_lowercase();
                    // Skip common non-game executables
                    if !filename.contains("unins")
                        && !filename.contains("crash")
                        && !filename.contains("report")
                        && !filename.contains("redist")
                        && !filename.contains("setup")
                    {
                        return Some(path);
                    }
                }
            }
        }

        None
    }
}

impl Default for UbisoftScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for UbisoftScanner {
    fn is_installed(&self) -> bool {
        Self::check_is_installed()
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = self.scan_from_registry()?;

        // Sort by name
        games.sort_by_key(|a| a.name.to_lowercase());

        // Filter out duplicates and non-installed
        games.retain(|g| g.is_installed);
        games.dedup_by(|a, b| a.name == b.name);

        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        // Extract Ubisoft product ID from game_id (format: "ubisoft_12345")
        let product_id = game_id
            .strip_prefix("ubisoft_")
            .ok_or("Invalid Ubisoft game ID")?;

        let uri = Self::build_launch_uri(product_id);

        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &uri])
                .spawn()
                .map_err(|e| format!("Failed to launch Ubisoft game: {}", e))?;
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch Ubisoft game: {}", e))?;
        }

        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch Ubisoft game: {}", e))?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_launch_uri() {
        assert_eq!(
            UbisoftScanner::build_launch_uri("635"),
            "uplay://launch/635/0"
        );
    }

    #[test]
    fn test_build_game_id() {
        assert_eq!(UbisoftScanner::build_game_id("635"), "ubisoft_635");
    }

    #[test]
    fn test_launch_game_invalid_id_prefix() {
        let scanner = UbisoftScanner::new();
        let err = scanner.launch_game("steam_635").unwrap_err();
        assert!(err.contains("Invalid Ubisoft"));
    }
}
