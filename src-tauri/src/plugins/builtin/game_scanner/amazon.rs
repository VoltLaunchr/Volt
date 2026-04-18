//! Amazon Games scanner
//!
//! Scans for games installed via the Amazon Games desktop app. Launch goes
//! through the `amazon-games://play/<gameId>` URL scheme — the format used
//! by Playnite's AmazonGamesLibrary extension.

use super::types::{GameInfo, GamePlatform, GameScanner};
use crate::utils::game_icon::find_game_icon;
use std::path::PathBuf;
use tracing::debug;

/// Amazon Games scanner
pub struct AmazonScanner {
    /// Resolved install root for the Amazon Games client, if present.
    client_path: Option<PathBuf>,
}

impl AmazonScanner {
    pub fn new() -> Self {
        Self {
            client_path: Self::find_client_path(),
        }
    }

    fn find_client_path() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            // Default Amazon Games install locations.
            let local_app_data = std::env::var("LOCALAPPDATA").ok()?;
            let candidates = [
                PathBuf::from(&local_app_data).join("Amazon Games"),
                PathBuf::from(r"C:\Program Files\Amazon Games"),
            ];
            candidates.into_iter().find(|p| p.exists())
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    }

    /// Parse the CSV-like line of Amazon's `GameInstallInfo` into
    /// `(game_id, title, install_path)`. Exposed as pure helper for testing.
    ///
    /// Amazon Games store a per-install JSON file at
    /// `<LOCALAPPDATA>\Amazon Games\Data\Games\Sql\GameInstallInfo.sqlite`
    /// when possible, but every game also drops a `fuel.json` manifest into
    /// its install directory containing `{ "Main": { "Command": "…" } }` and
    /// a `metadata.json` with `{ "Id": "<game_id>", "DisplayName": "…" }`.
    /// We rely on the latter since it doesn't require a SQLite dependency.
    #[allow(dead_code)]
    pub(crate) fn parse_metadata_json(content: &str) -> Option<(String, String)> {
        let json: serde_json::Value = serde_json::from_str(content).ok()?;
        let id = json.get("Id").and_then(|v| v.as_str())?.to_string();
        let display_name = json
            .get("DisplayName")
            .and_then(|v| v.as_str())
            .unwrap_or(&id)
            .to_string();
        Some((id, display_name))
    }

    /// Scan the default Amazon Games install directory for game folders.
    fn scan_install_dir(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = Vec::new();

        // Games installed by the Amazon client land under
        // `<LOCALAPPDATA>\Amazon Games\Library\<Game>` by default, though the
        // user can choose any directory. We only scan the default root to
        // avoid false positives; games installed elsewhere will still be
        // picked up via the registry branch below.
        let Some(ref client_path) = self.client_path else {
            return Ok(games);
        };
        let library = client_path.join("Library");
        if !library.exists() {
            return Ok(games);
        }

        let Ok(entries) = std::fs::read_dir(&library) else {
            return Ok(games);
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let metadata_path = path.join("metadata.json");
            let (id, display_name) = match std::fs::read_to_string(&metadata_path)
                .ok()
                .and_then(|c| Self::parse_metadata_json(&c))
            {
                Some(v) => v,
                None => {
                    debug!(path = %path.display(), "Skipping Amazon dir without metadata");
                    continue;
                }
            };

            let mut game = GameInfo::new(
                format!("amazon_{}", id),
                display_name.clone(),
                GamePlatform::Amazon,
                path.clone(),
            );
            game.launch_uri = Some(format!("amazon-games://play/{}", id));
            game.is_installed = true;
            game.icon_path = find_game_icon(&path, None);
            debug!(name = %display_name, id = %id, "Amazon game found");
            games.push(game);
        }

        Ok(games)
    }

    /// Scan Windows uninstall registry for Amazon Games entries. Covers
    /// games installed to non-default directories.
    #[cfg(target_os = "windows")]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        use winreg::RegKey;
        use winreg::enums::*;

        let mut games = Vec::new();
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // Amazon writes to HKCU uninstall key when installing per-user.
        let subkeys = [
            hklm.open_subkey(r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            hklm.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            hkcu.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ];

        for uninstall in subkeys.into_iter().flatten() {
            for key_name in uninstall.enum_keys().flatten() {
                // Amazon per-game uninstall keys start with `AmazonGames/`.
                if !key_name.starts_with("AmazonGames/") {
                    continue;
                }
                let Ok(app_key) = uninstall.open_subkey(&key_name) else {
                    continue;
                };

                let name: String = app_key.get_value("DisplayName").unwrap_or_default();
                let path: String = app_key.get_value("InstallLocation").unwrap_or_default();
                if name.is_empty() || path.is_empty() {
                    continue;
                }

                // Re-read the metadata.json at this path to recover the game id.
                let metadata = PathBuf::from(&path).join("metadata.json");
                let id = std::fs::read_to_string(&metadata)
                    .ok()
                    .and_then(|c| Self::parse_metadata_json(&c))
                    .map(|(id, _)| id);

                let Some(id) = id else {
                    debug!(name = %name, "Amazon game missing metadata.json, skipping");
                    continue;
                };

                let install_path = PathBuf::from(&path);
                let mut game = GameInfo::new(
                    format!("amazon_{}", id),
                    name.clone(),
                    GamePlatform::Amazon,
                    install_path.clone(),
                );
                game.launch_uri = Some(format!("amazon-games://play/{}", id));
                game.is_installed = install_path.exists();
                game.icon_path = find_game_icon(&install_path, None);
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

impl Default for AmazonScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for AmazonScanner {
    fn is_installed(&self) -> bool {
        self.client_path.is_some()
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = self.scan_install_dir()?;
        if let Ok(registry_games) = self.scan_from_registry() {
            for g in registry_games {
                if !games.iter().any(|existing| existing.id == g.id) {
                    games.push(g);
                }
            }
        }
        games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        let id = game_id
            .strip_prefix("amazon_")
            .ok_or("Invalid Amazon game ID")?;
        let uri = format!("amazon-games://play/{}", id);

        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &uri])
                .spawn()
                .map_err(|e| format!("Failed to launch Amazon game: {}", e))?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch Amazon game: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch Amazon game: {}", e))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_metadata_full() {
        let json = r#"{
            "Id": "abc-123-def",
            "DisplayName": "Sample Game",
            "Version": "1.0"
        }"#;
        let (id, name) = AmazonScanner::parse_metadata_json(json).unwrap();
        assert_eq!(id, "abc-123-def");
        assert_eq!(name, "Sample Game");
    }

    #[test]
    fn parse_metadata_falls_back_to_id_when_no_display_name() {
        let json = r#"{"Id": "only-id"}"#;
        let (id, name) = AmazonScanner::parse_metadata_json(json).unwrap();
        assert_eq!(id, "only-id");
        assert_eq!(name, "only-id");
    }

    #[test]
    fn parse_metadata_rejects_missing_id() {
        assert!(AmazonScanner::parse_metadata_json(r#"{"DisplayName":"X"}"#).is_none());
    }

    #[test]
    fn parse_metadata_rejects_invalid_json() {
        assert!(AmazonScanner::parse_metadata_json("not json").is_none());
    }
}
