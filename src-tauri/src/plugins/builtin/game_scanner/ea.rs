//! EA App (Origin) scanner
//!
//! Scans for games installed via EA App (formerly Origin)

#[allow(unused_imports)]
use super::types::{GameInfo, GamePlatform, GameScanner};
#[allow(unused_imports)]
use crate::utils::game_icon::find_game_icon;
use std::path::{Path, PathBuf};
#[allow(unused_imports)]
use tracing::{debug, warn};

/// Build the modern EA App launch URI from one or more offer IDs.
///
/// Since the EA App replaced Origin, games must be launched via the
/// `origin2://game/launch/` protocol with every `<contentID>` from the
/// installer manifest joined as a comma-separated `offerIds` parameter.
/// Passing only a subset (or using `link2ea://launchgame/`, which is the
/// Steam-side protocol) produces EA App's "A required parameter is missing"
/// dialog when the user's entitlement matches a different edition/region
/// than the single ID passed.
///
/// Returns `None` if `content_ids` is empty.
fn ea_launch_uri(content_ids: &[String]) -> Option<String> {
    if content_ids.is_empty() {
        return None;
    }
    Some(format!(
        "origin2://game/launch/?offerIds={}",
        content_ids.join(",")
    ))
}

/// Read every non-empty `<contentID>` value from the EA installer manifest
/// at `<install_path>/__Installer/installerdata.xml`.
pub(crate) fn read_content_ids_from_manifest(install_path: &Path) -> Vec<String> {
    let manifest_path = install_path.join("__Installer").join("installerdata.xml");
    std::fs::read_to_string(&manifest_path)
        .map(|c| extract_content_ids_from_manifest_str(&c))
        .unwrap_or_default()
}

/// Pure helper extracted for unit testing.
pub(crate) fn extract_content_ids_from_manifest_str(xml: &str) -> Vec<String> {
    // Manifests contain a self-closing `<contentID />` inside `<launcher>` as
    // well as populated tags inside `<contentIDs>`. Match only tags with a
    // non-whitespace body; preserve source order.
    let Ok(re) = regex::Regex::new(r"<contentID>\s*([^<\s][^<]*?)\s*</contentID>") else {
        return Vec::new();
    };
    re.captures_iter(xml)
        .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// EA App scanner
pub struct EAScanner;

impl EAScanner {
    pub fn new() -> Self {
        Self
    }

    /// True if the uninstall entry's publisher string looks like an EA entry.
    /// Pure helper extracted for unit testing.
    #[allow(dead_code)]
    pub(crate) fn is_ea_publisher(publisher: &str, key_name: &str) -> bool {
        let pub_lc = publisher.to_lowercase();
        pub_lc.contains("electronic arts")
            || pub_lc.contains("ea ")
            || key_name.starts_with("Origin ")
    }

    /// True if an uninstall display-name represents the launcher / a
    /// non-game helper component (and should be skipped).
    #[allow(dead_code)]
    pub(crate) fn is_non_game_display_name(name: &str) -> bool {
        let name_lc = name.to_lowercase();
        name_lc.contains("ea desktop")
            || name_lc.contains("ea app")
            || name_lc.contains("origin")
            || name_lc.contains("redistributable")
    }

    /// Check if EA App or Origin is installed
    fn check_is_installed() -> bool {
        #[cfg(target_os = "windows")]
        {
            let ea_paths = [
                PathBuf::from(r"C:\Program Files\Electronic Arts"),
                PathBuf::from(r"C:\Program Files (x86)\Origin"),
                PathBuf::from(r"C:\Program Files\EA"),
            ];
            ea_paths.iter().any(|p| p.exists())
        }

        #[cfg(target_os = "macos")]
        {
            PathBuf::from("/Applications/EA.app").exists()
                || PathBuf::from("/Applications/Origin.app").exists()
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

        // EA stores install info in Uninstall registry
        let uninstall_key = hklm
            .open_subkey(r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")
            .or_else(|_| hklm.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"));

        if let Ok(uninstall) = uninstall_key {
            for key_name in uninstall.enum_keys().flatten() {
                if let Ok(app_key) = uninstall.open_subkey(&key_name) {
                    let publisher: String = app_key.get_value("Publisher").unwrap_or_default();

                    if Self::is_ea_publisher(&publisher, &key_name) {
                        let name: String = app_key.get_value("DisplayName").unwrap_or_default();
                        let path: String = app_key.get_value("InstallLocation").unwrap_or_default();

                        if !name.is_empty() && !path.is_empty() {
                            if Self::is_non_game_display_name(&name) {
                                continue;
                            }

                            let install_path = PathBuf::from(&path);

                            let mut game = GameInfo::new(
                                format!("ea_{}", key_name.replace(' ', "_").to_lowercase()),
                                name,
                                GamePlatform::EA,
                                install_path.clone(),
                            );

                            // Resolve the EA content IDs for launch. The installer manifest is
                            // the authoritative source: it lists every edition/region offer ID
                            // for the title, and EA App requires the full comma-separated set
                            // (not just one) to match the user's entitlement. Without it, EA
                            // App responds with "A required parameter is missing".
                            let mut content_ids = read_content_ids_from_manifest(&install_path);
                            if content_ids.is_empty() {
                                if let Ok(id) = app_key.get_value::<String, _>("ContentID") {
                                    content_ids.push(id);
                                } else if let Ok(id) = app_key.get_value::<String, _>("ProductID") {
                                    content_ids.push(id);
                                }
                            }

                            game.launch_uri = ea_launch_uri(&content_ids);

                            game.is_installed = install_path.exists();
                            game.executable = Self::find_executable(&install_path);

                            // Find icon: search in game directory, then extract from exe
                            game.icon_path =
                                find_game_icon(&install_path, game.executable.as_ref());

                            debug!(game = %game.name, id = %game.id, "EA game found");
                            games.push(game);
                        }
                    }
                }
            }
        } else {
            warn!("Failed to open EA uninstall registry key");
        }

        Ok(games)
    }

    #[cfg(not(target_os = "windows"))]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        Ok(Vec::new())
    }

    /// Scan EA games directories
    fn scan_directories(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = Vec::new();

        // Common EA game directories
        let ea_dirs = vec![
            PathBuf::from(r"C:\Program Files\EA Games"),
            PathBuf::from(r"C:\Program Files (x86)\EA Games"),
            PathBuf::from(r"C:\Program Files\Electronic Arts"),
            PathBuf::from(r"C:\Program Files (x86)\Electronic Arts"),
            PathBuf::from(r"C:\Program Files\Origin Games"),
            PathBuf::from(r"C:\Program Files (x86)\Origin Games"),
        ];

        for dir in ea_dirs {
            if !dir.exists() {
                continue;
            }

            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("Unknown")
                            .to_string();

                        // Skip if it's just "EA" directory or similar
                        if name.len() < 3 || name.to_lowercase() == "ea" {
                            continue;
                        }

                        let game_id = format!("ea_dir_{}", name.replace(' ', "_").to_lowercase());

                        let mut game = GameInfo::new(game_id, name, GamePlatform::EA, path.clone());

                        game.executable = Self::find_executable(&path);
                        game.is_installed = true;

                        // Use installer manifest content IDs when available so that directory-
                        // scanned games can still be launched via EA App.
                        let ids = read_content_ids_from_manifest(&path);
                        game.launch_uri = ea_launch_uri(&ids);

                        // Find icon: search in game directory, then extract from exe
                        game.icon_path = find_game_icon(&path, game.executable.as_ref());

                        games.push(game);
                    }
                }
            }
        }

        Ok(games)
    }

    /// Find executable in game directory
    /// Searches more thoroughly than before
    fn find_executable(install_path: &Path) -> Option<PathBuf> {
        if !install_path.exists() {
            return None;
        }

        // Common EA game executable locations (in priority order)
        let search_dirs = vec![
            install_path.to_path_buf(),
            install_path.join("Game"),
            install_path.join("Binaries"),
            install_path.join("Binaries/Win64"),
            install_path.join("Binaries/Win32"),
            install_path.join("Bin"),
            install_path.join("x64"),
            install_path.join("x86"),
            install_path.join("__Installer"), // EA specific
        ];

        // Try to find an executable in each directory
        for dir in search_dirs {
            if !dir.exists() {
                continue;
            }

            // Read directory entries
            if let Ok(entries) = std::fs::read_dir(&dir) {
                let mut exe_candidates: Vec<PathBuf> = Vec::new();

                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("exe") {
                        let filename = path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .to_lowercase();

                        // Skip common non-game executables
                        if filename.contains("unins")
                            || filename.contains("crash")
                            || filename.contains("report")
                            || filename.contains("redist")
                            || filename.contains("setup")
                            || filename.contains("vcredist")
                            || filename.contains("directx")
                            || filename.contains("installer")
                            || filename.contains("update")
                            || filename.contains("repair")
                            || filename.contains("eauninstall")
                        {
                            continue;
                        }

                        exe_candidates.push(path);
                    }
                }

                // If we found executables, return the best candidate
                if !exe_candidates.is_empty() {
                    // Prioritize: main game exe > launcher exe
                    // Usually the largest .exe file is the main game executable
                    exe_candidates.sort_by_key(|path| {
                        std::fs::metadata(path)
                            .map(|m| std::cmp::Reverse(m.len()))
                            .unwrap_or(std::cmp::Reverse(0))
                    });

                    return Some(exe_candidates[0].clone());
                }
            }
        }

        None
    }
}

impl Default for EAScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for EAScanner {
    fn is_installed(&self) -> bool {
        Self::check_is_installed()
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = Vec::new();

        // Scan from registry
        if let Ok(registry_games) = self.scan_from_registry() {
            games.extend(registry_games);
        }

        // Scan directories for any missed games
        if let Ok(dir_games) = self.scan_directories() {
            for game in dir_games {
                if !games.iter().any(|g| g.name == game.name) {
                    games.push(game);
                }
            }
        }

        // Sort and deduplicate
        games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        games.dedup_by(|a, b| a.name.to_lowercase() == b.name.to_lowercase());

        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        // Try to find the game and use its launch_uri
        let games = self.scan_games()?;

        if let Some(game) = games.iter().find(|g| g.id == game_id) {
            // For EA games, we MUST use the launch_uri to properly authenticate
            // Launching the exe directly will cause "You don't have access" errors
            if let Some(uri) = &game.launch_uri {
                #[cfg(target_os = "windows")]
                {
                    // Use PowerShell's Start-Process for better URI handling
                    // This properly opens the URI with the registered protocol handler (EA App)
                    std::process::Command::new("powershell")
                        .args([
                            "-NoProfile",
                            "-Command",
                            &format!("Start-Process '{}'", uri),
                        ])
                        .creation_flags(0x08000000) // CREATE_NO_WINDOW
                        .spawn()
                        .map_err(|e| format!("Failed to launch EA game: {}", e))?;
                    return Ok(());
                }

                #[cfg(target_os = "macos")]
                {
                    std::process::Command::new("open")
                        .arg(uri)
                        .spawn()
                        .map_err(|e| format!("Failed to launch EA game: {}", e))?;
                    return Ok(());
                }

                #[cfg(target_os = "linux")]
                {
                    // Try xdg-open for Linux
                    std::process::Command::new("xdg-open")
                        .arg(uri)
                        .spawn()
                        .map_err(|e| format!("Failed to launch EA game: {}", e))?;
                    return Ok(());
                }
            }

            // If no launch_uri is available, return an error instead of launching exe directly
            // Launching exe directly bypasses EA App authentication and causes permission errors
            return Err("Cannot launch EA game: no valid launch URI found. \
                Please ensure the game is properly registered with EA App."
                .to_string());
        }

        Err("EA game not found".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_ea_publisher_matches_electronic_arts() {
        assert!(EAScanner::is_ea_publisher("Electronic Arts", "Battlefield"));
        assert!(EAScanner::is_ea_publisher("ELECTRONIC ARTS Inc.", "x"));
        assert!(EAScanner::is_ea_publisher("EA Sports", "x"));
    }

    #[test]
    fn test_is_ea_publisher_matches_origin_key_prefix() {
        assert!(EAScanner::is_ea_publisher("", "Origin Games"));
    }

    #[test]
    fn test_is_ea_publisher_rejects_unrelated() {
        assert!(!EAScanner::is_ea_publisher("Valve", "Steam"));
        assert!(!EAScanner::is_ea_publisher("Microsoft Corporation", "Xbox"));
    }

    #[test]
    fn test_is_non_game_display_name_filters_launcher() {
        assert!(EAScanner::is_non_game_display_name("EA Desktop"));
        assert!(EAScanner::is_non_game_display_name("EA app"));
        assert!(EAScanner::is_non_game_display_name("Origin"));
        assert!(EAScanner::is_non_game_display_name(
            "Microsoft Visual C++ Redistributable"
        ));
    }

    #[test]
    fn test_is_non_game_display_name_keeps_games() {
        assert!(!EAScanner::is_non_game_display_name("Battlefield V"));
        assert!(!EAScanner::is_non_game_display_name("Apex Legends"));
    }

    #[test]
    fn test_extract_content_ids_skips_self_closing_tag() {
        // Mirrors the real skate. manifest layout: populated tag inside
        // <contentIDs>, self-closing tag inside <launcher>.
        let xml = r#"
            <DiPManifest version="4.0">
              <contentIDs>
                <contentID>1184493</contentID>
              </contentIDs>
              <runtime>
                <launcher uid="1-1">
                  <contentID />
                </launcher>
              </runtime>
            </DiPManifest>
        "#;
        assert_eq!(
            extract_content_ids_from_manifest_str(xml),
            vec!["1184493".to_string()]
        );
    }

    #[test]
    fn test_extract_content_ids_returns_all_ids_in_order() {
        // Titles like Dead Space ship multiple offer IDs in the manifest —
        // EA App needs the full set to match the user's entitlement.
        let xml = r#"
            <contentIDs>
              <contentID>1002975</contentID>
              <contentID>1003943</contentID>
              <contentID>deadspace_eu1</contentID>
            </contentIDs>
        "#;
        assert_eq!(
            extract_content_ids_from_manifest_str(xml),
            vec![
                "1002975".to_string(),
                "1003943".to_string(),
                "deadspace_eu1".to_string(),
            ]
        );
    }

    #[test]
    fn test_extract_content_ids_empty_when_missing() {
        let xml = r#"<DiPManifest version="4.0"><contentIDs></contentIDs></DiPManifest>"#;
        assert!(extract_content_ids_from_manifest_str(xml).is_empty());
    }

    #[test]
    fn test_ea_launch_uri_uses_origin2_protocol() {
        assert_eq!(
            ea_launch_uri(&["1184493".to_string()]).unwrap(),
            "origin2://game/launch/?offerIds=1184493"
        );
    }

    #[test]
    fn test_ea_launch_uri_joins_multiple_ids() {
        let ids = vec!["1002975".to_string(), "1003943".to_string()];
        assert_eq!(
            ea_launch_uri(&ids).unwrap(),
            "origin2://game/launch/?offerIds=1002975,1003943"
        );
    }

    #[test]
    fn test_ea_launch_uri_none_when_empty() {
        assert_eq!(ea_launch_uri(&[]), None);
    }
}
