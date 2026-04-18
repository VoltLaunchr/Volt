//! Epic Games Store scanner
//!
//! Scans for games installed via Epic Games Launcher by reading
//! the launcher's manifest files.

use super::types::{GameInfo, GamePlatform, GameScanner};
use crate::utils::game_icon::find_game_icon;
use std::path::{Path, PathBuf};
use tracing::{debug, warn};

/// Epic Games scanner
pub struct EpicScanner {
    manifests_path: Option<PathBuf>,
}

impl EpicScanner {
    pub fn new() -> Self {
        let manifests_path = Self::find_manifests_path();
        if manifests_path.is_none() {
            debug!("Epic Games manifests path not found");
        }
        Self { manifests_path }
    }

    /// Find Epic Games manifests path
    fn find_manifests_path() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            // Prefer PROGRAMDATA env var since the drive letter may not be C:
            let programdata =
                std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".to_string());
            let manifests =
                PathBuf::from(programdata).join("Epic/EpicGamesLauncher/Data/Manifests");
            if manifests.exists() {
                Some(manifests)
            } else {
                None
            }
        }

        #[cfg(target_os = "macos")]
        {
            dirs::home_dir().and_then(|h| {
                let path =
                    h.join("Library/Application Support/Epic/EpicGamesLauncher/Data/Manifests");
                if path.exists() { Some(path) } else { None }
            })
        }

        #[cfg(target_os = "linux")]
        {
            // Epic Games doesn't have official Linux support, but some use Heroic launcher
            dirs::home_dir().and_then(|h| {
                let path = h.join(".config/heroic/store_cache/legendary_library.json");
                if path.exists() { Some(path) } else { None }
            })
        }
    }

    /// Parse the raw contents of an Epic `.item` manifest (JSON string).
    ///
    /// Returns a partially-populated `GameInfo` (no icon, no `is_installed`
    /// check). The caller is expected to verify install path existence and
    /// attach an icon. Exposed as pure function for unit testing.
    pub(crate) fn parse_manifest_json(content: &str) -> Result<GameInfo, String> {
        let json: serde_json::Value = serde_json::from_str(content)
            .map_err(|e| format!("Failed to parse manifest JSON: {}", e))?;

        let app_name = json
            .get("AppName")
            .and_then(|v| v.as_str())
            .ok_or("No AppName found")?
            .to_string();

        let display_name = json
            .get("DisplayName")
            .and_then(|v| v.as_str())
            .unwrap_or(&app_name)
            .to_string();

        let install_location = json
            .get("InstallLocation")
            .and_then(|v| v.as_str())
            .ok_or("No InstallLocation found")?;

        let install_path = PathBuf::from(install_location);

        // Get launch executable
        let launch_exe = json
            .get("LaunchExecutable")
            .and_then(|v| v.as_str())
            .map(|exe| install_path.join(exe));

        let mut game = GameInfo::new(
            format!("epic_{}", app_name),
            display_name,
            GamePlatform::Epic,
            install_path,
        );

        game.executable = launch_exe;
        game.launch_uri = Some(format!(
            "com.epicgames.launcher://apps/{}?action=launch&silent=true",
            app_name
        ));

        Ok(game)
    }

    /// Parse an Epic manifest file (.item) from disk
    fn parse_manifest(&self, path: &Path) -> Result<GameInfo, String> {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read manifest: {}", e))?;

        let mut game = Self::parse_manifest_json(&content)?;
        game.is_installed = game.install_path.exists();

        // Find icon: search in game directory, then extract from exe
        game.icon_path = find_game_icon(&game.install_path, game.executable.as_ref());

        Ok(game)
    }
}

impl Default for EpicScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for EpicScanner {
    fn is_installed(&self) -> bool {
        self.manifests_path.is_some()
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let manifests_path = self.manifests_path.as_ref().ok_or_else(|| {
            warn!("Epic Games Launcher not detected: no manifests directory");
            "Epic Games manifests not found".to_string()
        })?;

        let mut games = Vec::new();

        // Read all .item manifest files
        let entries = std::fs::read_dir(manifests_path)
            .map_err(|e| format!("Failed to read manifests directory: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();

            // Epic manifest files have .item extension
            if path.extension().and_then(|s| s.to_str()) != Some("item") {
                continue;
            }

            match self.parse_manifest(&path) {
                Ok(game) => {
                    if game.is_installed {
                        debug!(game = %game.name, id = %game.id, "Epic game found");
                        games.push(game);
                    }
                }
                Err(e) => {
                    warn!(path = %path.display(), error = %e, "Failed to parse Epic manifest");
                }
            }
        }

        // Sort by name
        games.sort_by_key(|a| a.name.to_lowercase());

        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        // Extract app name from game_id (format: "epic_appname")
        let app_name = game_id
            .strip_prefix("epic_")
            .ok_or("Invalid Epic game ID")?;

        let uri = format!(
            "com.epicgames.launcher://apps/{}?action=launch&silent=true",
            app_name
        );

        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &uri])
                .spawn()
                .map_err(|e| format!("Failed to launch Epic game: {}", e))?;
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch Epic game: {}", e))?;
        }

        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch Epic game: {}", e))?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_MANIFEST: &str = r#"{
        "FormatVersion": 0,
        "AppName": "Fortnite",
        "AppVersionString": "32.20",
        "DisplayName": "Fortnite",
        "InstallLocation": "C:\\Program Files\\Epic Games\\Fortnite",
        "LaunchExecutable": "FortniteGame/Binaries/Win64/FortniteLauncher.exe",
        "LaunchCommand": ""
    }"#;

    #[test]
    fn test_parse_manifest_json_extracts_all_fields() {
        let game = EpicScanner::parse_manifest_json(SAMPLE_MANIFEST).unwrap();
        assert_eq!(game.id, "epic_Fortnite");
        assert_eq!(game.name, "Fortnite");
        assert_eq!(game.platform, GamePlatform::Epic);
        assert_eq!(
            game.install_path,
            PathBuf::from(r"C:\Program Files\Epic Games\Fortnite")
        );
        // Executable is joined with install path
        assert_eq!(
            game.executable,
            Some(
                PathBuf::from(r"C:\Program Files\Epic Games\Fortnite")
                    .join("FortniteGame/Binaries/Win64/FortniteLauncher.exe")
            )
        );
        assert_eq!(
            game.launch_uri,
            Some("com.epicgames.launcher://apps/Fortnite?action=launch&silent=true".to_string())
        );
    }

    #[test]
    fn test_parse_manifest_json_falls_back_to_app_name_for_display() {
        let json = r#"{
            "AppName": "MyApp",
            "InstallLocation": "/games/MyApp"
        }"#;
        let game = EpicScanner::parse_manifest_json(json).unwrap();
        assert_eq!(game.name, "MyApp");
        assert_eq!(game.id, "epic_MyApp");
    }

    #[test]
    fn test_parse_manifest_json_rejects_missing_app_name() {
        let json = r#"{
            "DisplayName": "X",
            "InstallLocation": "/tmp/x"
        }"#;
        let err = EpicScanner::parse_manifest_json(json).unwrap_err();
        assert!(err.contains("AppName"), "unexpected error: {}", err);
    }

    #[test]
    fn test_parse_manifest_json_rejects_missing_install_location() {
        let json = r#"{
            "AppName": "X",
            "DisplayName": "X"
        }"#;
        let err = EpicScanner::parse_manifest_json(json).unwrap_err();
        assert!(err.contains("InstallLocation"), "unexpected error: {}", err);
    }

    #[test]
    fn test_parse_manifest_json_rejects_invalid_json() {
        let err = EpicScanner::parse_manifest_json("{ not valid }").unwrap_err();
        assert!(err.contains("Failed to parse"), "unexpected error: {}", err);
    }

    #[test]
    fn test_parse_manifest_json_missing_launch_exe_is_ok() {
        let json = r#"{
            "AppName": "NoExe",
            "DisplayName": "No Exe",
            "InstallLocation": "C:\\Games\\NoExe"
        }"#;
        let game = EpicScanner::parse_manifest_json(json).unwrap();
        assert_eq!(game.executable, None);
        assert_eq!(game.name, "No Exe");
    }
}
