//! Xbox/Microsoft Store scanner
//!
//! Scans for games installed via Xbox app or Microsoft Store

use super::types::{GameInfo, GamePlatform, GameScanner};
use std::path::PathBuf;
#[allow(unused_imports)]
use tracing::{debug, warn};

/// Xbox/Microsoft Store scanner
pub struct XboxScanner;

impl XboxScanner {
    pub fn new() -> Self {
        Self
    }

    /// Extract a human-readable game name from an MSIX package full name.
    ///
    /// Package full names look like
    /// `Microsoft.254428597CFE2_1.0.50.0_x64__8wekyb3d8bbwe`. The first
    /// underscore-separated segment is `Publisher.GameIdentifier`; we strip
    /// the publisher prefix where present. Exposed for unit testing.
    #[allow(dead_code)]
    pub(crate) fn clean_package_name(package_name: &str) -> String {
        let head = package_name.split('_').next().unwrap_or(package_name);
        head.split('.').next_back().unwrap_or(head).to_string()
    }

    /// Format a stable game id from a package name (lowercased, dots → _).
    #[allow(dead_code)]
    pub(crate) fn format_package_id(package_name: &str) -> String {
        format!("xbox_{}", package_name.replace('.', "_").to_lowercase())
    }

    /// Derive the PackageFamilyName from a PackageFullName.
    ///
    /// `shell:AppsFolder\<PFN>!App` only resolves when given a *family* name
    /// (`Name_PublisherId`) — feeding it the full name
    /// (`Name_Version_Arch_Resource_PublisherId`) silently fails and the game
    /// never launches. Windows' own API (`PackageFamilyNameFromFullName`)
    /// strips the three middle segments; this mirrors that transformation in
    /// pure Rust so we don't need an extra Win32 dependency.
    ///
    /// Returns `None` if `full_name` doesn't have the expected 5 underscore-
    /// separated segments.
    pub(crate) fn package_family_name_from_full_name(full_name: &str) -> Option<String> {
        let parts: Vec<&str> = full_name.split('_').collect();
        if parts.len() != 5 {
            return None;
        }
        Some(format!("{}_{}", parts[0], parts[4]))
    }

    /// Get PackageFamilyName from Get-AppxPackage PowerShell
    #[cfg(target_os = "windows")]
    fn get_package_family_names() -> Result<std::collections::HashMap<String, String>, String> {
        use std::collections::HashMap;
        use std::process::Command;

        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-AppxPackage -PackageTypeFilter Bundle | Select-Object -ExpandProperty Name,PackageFamilyName | ConvertTo-Csv -NoTypeInformation",
            ])
            .output()
            .map_err(|e| format!("PowerShell execution failed: {}", e))?;

        let mut pfn_map = HashMap::new();

        if !output.status.success() {
            debug!("PowerShell Get-AppxPackage failed, skipping PackageFamilyName resolution");
            return Ok(pfn_map);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut lines = stdout.lines();
        lines.next(); // Skip header

        for line in lines {
            let parts: Vec<&str> = line.split(',').map(|s| s.trim_matches('"')).collect();
            if parts.len() >= 2 {
                let name = parts[0].to_string();
                let pfn = parts[1].to_string();
                pfn_map.insert(name, pfn);
            }
        }

        Ok(pfn_map)
    }

    #[cfg(not(target_os = "windows"))]
    fn get_package_family_names() -> Result<std::collections::HashMap<String, String>, String> {
        Ok(std::collections::HashMap::new())
    }

    /// Scan XboxGames directory
    fn scan_xbox_games_dir(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = Vec::new();

        let xbox_dir = PathBuf::from(r"C:\XboxGames");
        if !xbox_dir.exists() {
            debug!("C:\\XboxGames does not exist, skipping directory scan");
            return Ok(games);
        }

        // Try to get PackageFamilyNames for launch URI resolution
        let pfn_map = Self::get_package_family_names().unwrap_or_default();

        let entries = match std::fs::read_dir(&xbox_dir) {
            Ok(e) => e,
            Err(e) => {
                warn!(error = %e, "Failed to read C:\\XboxGames");
                return Ok(games);
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();

            // Look for Content directory which indicates a game
            let content_dir = path.join("Content");
            if !content_dir.exists() {
                continue;
            }

            let game_id = format!("xbox_{}", name.replace(' ', "_").to_lowercase());

            let mut game = GameInfo::new(game_id, name.clone(), GamePlatform::Xbox, path.clone());

            // Resolve PackageFamilyName for launch URI. If found, construct the proper
            // shell:AppsFolder URI; otherwise, try to match by installed package name patterns
            if let Some(pfn) = pfn_map
                .values()
                .find(|pfn| pfn.to_lowercase().contains(&name.to_lowercase()))
            {
                game.launch_uri = Some(format!("shell:AppsFolder\\{}!App", pfn));
                debug!(game = %name, pfn = %pfn, "Xbox game directory found with launch URI");
            } else {
                debug!(game = %name, "Xbox game directory found (awaiting PackageFamilyName resolution)");
            }

            game.is_installed = true;
            games.push(game);
        }

        Ok(games)
    }

    /// Scan Windows Registry for Xbox games
    #[cfg(target_os = "windows")]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        use winreg::RegKey;
        use winreg::enums::*;

        let mut games = Vec::new();

        // Xbox Game Pass games are registered in gaming services
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

        // Modern Xbox games
        let gaming_key =
            hklm.open_subkey(r"SOFTWARE\Microsoft\GamingServices\PackageRepository\Package");

        if let Ok(packages) = gaming_key {
            for package_name in packages.enum_keys().flatten() {
                if let Ok(package_key) = packages.open_subkey(&package_name) {
                    let root: String = package_key.get_value("Root").unwrap_or_default();

                    if !root.is_empty() {
                        let install_path = PathBuf::from(&root);

                        let clean_name = Self::clean_package_name(&package_name);
                        let game_id = Self::format_package_id(&package_name);

                        let mut game = GameInfo::new(
                            game_id,
                            clean_name,
                            GamePlatform::Xbox,
                            install_path.clone(),
                        );

                        // Xbox games launch via shell:AppsFolder, which
                        // requires the PackageFamilyName (not the full name).
                        if let Some(pfn) =
                            Self::package_family_name_from_full_name(&package_name)
                        {
                            game.launch_uri = Some(format!("shell:AppsFolder\\{}!App", pfn));
                        }
                        game.is_installed = install_path.exists();

                        debug!(game = %game.name, id = %game.id, "Xbox gaming services game found");
                        games.push(game);
                    }
                }
            }
        } else {
            debug!("Xbox gaming services registry key not present");
        }

        // Also check Uninstall registry for Xbox games
        let uninstall_key =
            hklm.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall");

        if let Ok(uninstall) = uninstall_key {
            for key_name in uninstall.enum_keys().flatten() {
                if let Ok(app_key) = uninstall.open_subkey(&key_name) {
                    let publisher: String = app_key.get_value("Publisher").unwrap_or_default();
                    let name: String = app_key.get_value("DisplayName").unwrap_or_default();

                    // Check if it's an Xbox/Microsoft game
                    if (publisher.to_lowercase().contains("xbox")
                        || publisher.to_lowercase().contains("microsoft studios")
                        || key_name.contains("Microsoft."))
                        && !name.is_empty()
                    {
                        // Skip if already found
                        if games
                            .iter()
                            .any(|g| g.name.to_lowercase() == name.to_lowercase())
                        {
                            continue;
                        }

                        let path: String = app_key.get_value("InstallLocation").unwrap_or_default();
                        let install_path = PathBuf::from(&path);

                        // Skip non-game apps
                        if name.to_lowercase().contains("xbox")
                            && !name.to_lowercase().contains("game")
                        {
                            continue;
                        }

                        let game_id = format!("xbox_{}", key_name.replace('.', "_").to_lowercase());

                        let mut game =
                            GameInfo::new(game_id, name, GamePlatform::Xbox, install_path.clone());

                        game.is_installed = !path.is_empty() && install_path.exists();

                        games.push(game);
                    }
                }
            }
        }

        Ok(games)
    }

    #[cfg(not(target_os = "windows"))]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        Ok(Vec::new())
    }
}

impl Default for XboxScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for XboxScanner {
    fn is_installed(&self) -> bool {
        // Xbox app is usually always present on Windows 10/11
        #[cfg(target_os = "windows")]
        {
            true
        }
        #[cfg(not(target_os = "windows"))]
        {
            false
        }
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = Vec::new();

        // Scan XboxGames directory
        if let Ok(dir_games) = self.scan_xbox_games_dir() {
            games.extend(dir_games);
        }

        // Scan registry
        if let Ok(registry_games) = self.scan_from_registry() {
            for game in registry_games {
                if !games
                    .iter()
                    .any(|g| g.name.to_lowercase() == game.name.to_lowercase())
                {
                    games.push(game);
                }
            }
        }

        // Sort by name
        games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        // Xbox games launch via URI
        let games = self.scan_games()?;

        if let Some(game) = games.iter().find(|g| g.id == game_id)
            && let Some(_uri) = &game.launch_uri
        {
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("cmd")
                    .args(["/C", "start", "", _uri])
                    .spawn()
                    .map_err(|e| format!("Failed to launch Xbox game: {}", e))?;
                return Ok(());
            }
        }

        Err("Xbox game not found or cannot be launched".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_package_name_strips_publisher() {
        assert_eq!(
            XboxScanner::clean_package_name("Microsoft.254428597CFE2_1.0.50.0_x64__8wekyb3d8bbwe"),
            "254428597CFE2"
        );
    }

    #[test]
    fn test_clean_package_name_without_publisher() {
        assert_eq!(
            XboxScanner::clean_package_name("Forza_1.0.0.0_x64__publisher"),
            "Forza"
        );
    }

    #[test]
    fn test_clean_package_name_with_multiple_dots() {
        // Should return the last dotted segment
        assert_eq!(
            XboxScanner::clean_package_name("Microsoft.Gaming.Forza_1_x_p"),
            "Forza"
        );
    }

    #[test]
    fn test_format_package_id_lowercases_and_replaces_dots() {
        assert_eq!(
            XboxScanner::format_package_id("Microsoft.Forza5_1_x_p"),
            "xbox_microsoft_forza5_1_x_p"
        );
    }

    #[test]
    fn test_package_family_name_strips_version_arch_resource() {
        // Canonical PackageFullName layout: name_version_arch_resource_publisher
        assert_eq!(
            XboxScanner::package_family_name_from_full_name(
                "Microsoft.254428597CFE2_1.0.50.0_x64__8wekyb3d8bbwe"
            ),
            Some("Microsoft.254428597CFE2_8wekyb3d8bbwe".to_string())
        );
    }

    #[test]
    fn test_package_family_name_rejects_malformed_input() {
        // Already a family name (no version/arch) — 2 segments, reject.
        assert_eq!(
            XboxScanner::package_family_name_from_full_name(
                "Microsoft.254428597CFE2_8wekyb3d8bbwe"
            ),
            None
        );
        assert_eq!(XboxScanner::package_family_name_from_full_name(""), None);
    }
}
