//! Steam library scanner and game launcher

use super::types::{GameInfo, GamePlatform, GameScanner};
use crate::utils::game_icon::{find_game_icon, get_steam_cached_icon};
use std::path::{Path, PathBuf};

/// Steam game information
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SteamGame {
    /// Game App ID
    pub app_id: String,
    /// Game name
    pub name: String,
    /// Installation path
    pub install_dir: PathBuf,
    /// Path to the executable
    pub executable: Option<PathBuf>,
    /// Last played timestamp
    pub last_played: Option<i64>,
}

/// Steam library scanner
#[derive(Clone)]
pub struct SteamScanner {
    steam_path: Option<PathBuf>,
}

impl SteamScanner {
    /// Create a new Steam scanner
    pub fn new() -> Self {
        Self {
            steam_path: Self::find_steam_path(),
        }
    }

    /// Find Steam installation path
    fn find_steam_path() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            // First, try Windows Registry
            if let Some(reg_path) = Self::get_steam_path_from_registry()
                && reg_path.exists()
            {
                return Some(reg_path);
            }

            // Fallback to common installation paths
            let paths = vec![
                PathBuf::from(r"C:\Program Files (x86)\Steam"),
                PathBuf::from(r"C:\Program Files\Steam"),
            ];

            for path in paths {
                if path.exists() {
                    return Some(path);
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            let path = PathBuf::from(dirs::home_dir()?.join("Library/Application Support/Steam"));
            if path.exists() {
                return Some(path);
            }
        }

        #[cfg(target_os = "linux")]
        {
            let home = dirs::home_dir()?;

            let paths = vec![
                // Standard Linux installations
                home.join(".steam/steam"),
                home.join(".local/share/Steam"),
                // Flatpak Steam
                home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
                home.join(".var/app/com.valvesoftware.Steam/data/Steam"),
                // Snap Steam
                home.join("snap/steam/common/.steam/steam"),
                home.join("snap/steam/common/.local/share/Steam"),
                // Steam Deck default location
                PathBuf::from("/home/deck/.local/share/Steam"),
            ];

            for path in paths {
                if path.exists() {
                    return Some(path);
                }
            }
        }

        None
    }

    /// Get Steam path from Windows Registry
    #[cfg(target_os = "windows")]
    fn get_steam_path_from_registry() -> Option<PathBuf> {
        use std::ffi::CString;
        use std::ptr::null_mut;
        use winapi::um::winnt::{KEY_READ, REG_SZ};
        use winapi::um::winreg::{HKEY_CURRENT_USER, RegOpenKeyExA, RegQueryValueExA};

        unsafe {
            let key_path = CString::new("Software\\Valve\\Steam").ok()?;
            let value_name = CString::new("SteamPath").ok()?;

            let mut hkey = null_mut();
            let result =
                RegOpenKeyExA(HKEY_CURRENT_USER, key_path.as_ptr(), 0, KEY_READ, &mut hkey);

            if result != 0 {
                return None;
            }

            let mut buffer = vec![0u8; 512];
            let mut size = buffer.len() as u32;
            let mut value_type = REG_SZ;

            let result = RegQueryValueExA(
                hkey,
                value_name.as_ptr(),
                null_mut(),
                &mut value_type,
                buffer.as_mut_ptr(),
                &mut size,
            );

            winapi::um::winreg::RegCloseKey(hkey);

            if result == 0 && value_type == REG_SZ {
                let path_str = String::from_utf8_lossy(&buffer[..size as usize - 1]);
                return Some(PathBuf::from(path_str.to_string()));
            }
        }

        None
    }

    /// Check if Steam is installed
    pub fn is_steam_installed(&self) -> bool {
        self.steam_path.is_some()
    }

    /// Get Steam installation path
    pub fn get_steam_path(&self) -> Option<&Path> {
        self.steam_path.as_deref()
    }

    /// Scan for installed Steam games
    pub fn scan_steam_games(&self) -> Result<Vec<SteamGame>, String> {
        let steam_path = self.steam_path.as_ref().ok_or("Steam not installed")?;

        let mut games = Vec::new();

        // Main steamapps directory
        let steamapps = steam_path.join("steamapps");
        if steamapps.exists() {
            games.extend(self.scan_library_folder(&steamapps)?);
        }

        // Additional library folders from libraryfolders.vdf
        let libraryfolders_vdf = steamapps.join("libraryfolders.vdf");
        if libraryfolders_vdf.exists()
            && let Ok(library_paths) = self.parse_library_folders(&libraryfolders_vdf)
        {
            for library_path in library_paths {
                let lib_steamapps = library_path.join("steamapps");
                if lib_steamapps.exists()
                    && let Ok(lib_games) = self.scan_library_folder(&lib_steamapps)
                {
                    games.extend(lib_games);
                }
            }
        }

        Ok(games)
    }

    /// Scan a single library folder for games
    fn scan_library_folder(&self, library_path: &Path) -> Result<Vec<SteamGame>, String> {
        let mut games = Vec::new();

        if !library_path.exists() {
            return Ok(games);
        }

        // Read all .acf manifest files
        let entries = std::fs::read_dir(library_path)
            .map_err(|e| format!("Failed to read library folder: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();

            // Only process .acf files (app manifest files)
            if path.extension().and_then(|s| s.to_str()) == Some("acf")
                && let Ok(game) = self.parse_acf_file(&path)
            {
                games.push(game);
            }
        }

        Ok(games)
    }

    /// Parse a Steam .acf manifest file
    ///
    /// ACF files are in Valve's KeyValues format (similar to JSON)
    fn parse_acf_file(&self, acf_path: &Path) -> Result<SteamGame, String> {
        let content = std::fs::read_to_string(acf_path)
            .map_err(|e| format!("Failed to read ACF file: {}", e))?;

        // Simple key-value extraction (not a full VDF parser)
        let app_id = Self::extract_value(&content, "appid").ok_or("No appid found")?;

        let name = Self::extract_value(&content, "name").ok_or("No name found")?;

        let install_dir_name =
            Self::extract_value(&content, "installdir").ok_or("No installdir found")?;

        // Construct full install path
        let install_dir = acf_path
            .parent()
            .ok_or("Invalid ACF path")?
            .join("common")
            .join(&install_dir_name);

        // Try to find the executable
        let executable = self.find_game_executable(&install_dir, &name);

        Ok(SteamGame {
            app_id,
            name,
            install_dir,
            executable,
            last_played: None,
        })
    }

    /// Extract a value from ACF content
    fn extract_value(content: &str, key: &str) -> Option<String> {
        // Look for "key" "value" pattern
        let pattern = format!(r#""{}"\s+"([^"]+)""#, key);
        let re = regex::Regex::new(&pattern).ok()?;

        re.captures(content)
            .and_then(|cap| cap.get(1))
            .map(|m| m.as_str().to_string())
    }

    /// Parse libraryfolders.vdf to get additional Steam library locations
    ///
    /// VDF format example:
    /// ```
    /// "libraryfolders"
    /// {
    ///     "0"
    ///     {
    ///         "path"  "C:\\Program Files (x86)\\Steam"
    ///     }
    ///     "1"
    ///     {
    ///         "path"  "D:\\SteamLibrary"
    ///     }
    /// }
    /// ```
    fn parse_library_folders(&self, vdf_path: &Path) -> Result<Vec<PathBuf>, String> {
        let content = std::fs::read_to_string(vdf_path)
            .map_err(|e| format!("Failed to read libraryfolders.vdf: {}", e))?;

        let mut libraries = Vec::new();

        // Match all "path" values in the VDF file
        let path_pattern = regex::Regex::new(r#""path"\s+"([^"]+)""#)
            .map_err(|e| format!("Invalid regex pattern: {}", e))?;

        for capture in path_pattern.captures_iter(&content) {
            if let Some(path_match) = capture.get(1) {
                let path_str = path_match.as_str();

                // VDF paths may use double backslashes, normalize them
                #[cfg(target_os = "windows")]
                let path_str = path_str.replace("\\\\", "\\");

                #[cfg(not(target_os = "windows"))]
                let path_str = path_str.to_string();

                let path = PathBuf::from(path_str);
                if path.exists() && !libraries.contains(&path) {
                    libraries.push(path);
                }
            }
        }

        Ok(libraries)
    }

    /// Find the main executable for a game
    fn find_game_executable(&self, install_dir: &Path, _game_name: &str) -> Option<PathBuf> {
        if !install_dir.exists() {
            return None;
        }

        // Look for common executable patterns
        #[cfg(target_os = "windows")]
        {
            // Try to find .exe files
            if let Ok(entries) = std::fs::read_dir(install_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("exe") {
                        // Skip common non-game executables
                        let filename = path.file_stem()?.to_str()?;
                        if !filename.to_lowercase().contains("unins")
                            && !filename.to_lowercase().contains("crash")
                            && !filename.to_lowercase().contains("report")
                        {
                            return Some(path);
                        }
                    }
                }
            }
        }

        #[cfg(unix)]
        {
            // On Linux/macOS, look for executable files
            if let Ok(entries) = std::fs::read_dir(install_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if crate::utils::path::is_executable(&path) {
                        return Some(path);
                    }
                }
            }
        }

        None
    }

    /// Launch a Steam game by App ID
    pub fn launch_game(&self, app_id: &str) -> Result<(), String> {
        // Validate and sanitize app_id to prevent command injection
        let app_id = app_id.trim();

        // Check non-empty
        if app_id.is_empty() {
            return Err("App ID cannot be empty".to_string());
        }

        // Check max length (Steam App IDs are typically 6-7 digits, max 10 for safety)
        if app_id.len() > 10 {
            return Err(format!("App ID too long (max 10 digits): {}", app_id.len()));
        }

        // Validate that app_id contains only ASCII digits
        if !app_id.chars().all(|c| c.is_ascii_digit()) {
            return Err(format!(
                "Invalid App ID '{}': must contain only digits",
                app_id
            ));
        }

        // Build URL with validated app_id
        let url = format!("steam://rungameid/{}", app_id);

        #[cfg(target_os = "windows")]
        {
            use std::process::Command;

            // Use empty string as window title before URL to handle URIs with special chars
            Command::new("cmd")
                .args(["/C", "start", "", &url])
                .spawn()
                .map_err(|e| format!("Failed to launch game: {}", e))?;
        }

        #[cfg(target_os = "macos")]
        {
            use std::process::Command;

            Command::new("open")
                .arg(&url)
                .spawn()
                .map_err(|e| format!("Failed to launch game: {}", e))?;
        }

        #[cfg(target_os = "linux")]
        {
            use std::process::Command;

            Command::new("xdg-open")
                .arg(&url)
                .spawn()
                .map_err(|e| format!("Failed to launch game: {}", e))?;
        }

        Ok(())
    }
}

impl Default for SteamScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for SteamScanner {
    fn is_installed(&self) -> bool {
        self.is_steam_installed()
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let steam_games = self.scan_steam_games()?;
        let steam_path = self.steam_path.clone();

        let games = steam_games
            .into_iter()
            .map(|steam_game| {
                // Try to get icon in priority order:
                // 1. Steam's cached library images
                // 2. Icon files in game directory
                // 3. Extract from executable
                let icon_path = steam_path
                    .as_ref()
                    .and_then(|path| get_steam_cached_icon(path, &steam_game.app_id))
                    .or_else(|| {
                        find_game_icon(&steam_game.install_dir, steam_game.executable.as_ref())
                    });

                GameInfo {
                    id: format!("steam_{}", steam_game.app_id),
                    name: steam_game.name,
                    platform: GamePlatform::Steam,
                    install_path: steam_game.install_dir,
                    executable: steam_game.executable,
                    launch_uri: Some(format!("steam://rungameid/{}", steam_game.app_id)),
                    icon_path,
                    last_played: steam_game.last_played,
                    is_installed: true,
                    alias: None,
                }
            })
            .collect();

        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        // Extract app_id from the game_id (format: "steam_APPID")
        if let Some(app_id) = game_id.strip_prefix("steam_") {
            self.launch_game(app_id)
        } else {
            Err("Invalid Steam game ID format".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_steam_scanner_creation() {
        let scanner = SteamScanner::new();
        // Can't guarantee Steam is installed in test environment
        println!("Steam installed: {}", scanner.is_steam_installed());
    }

    #[test]
    fn test_extract_value() {
        let content = r#"
            "appid"  "12345"
            "name"   "Test Game"
            "installdir"  "testgame"
        "#;

        assert_eq!(
            SteamScanner::extract_value(content, "appid"),
            Some("12345".to_string())
        );
        assert_eq!(
            SteamScanner::extract_value(content, "name"),
            Some("Test Game".to_string())
        );
    }

    #[test]
    fn test_launch_game_valid_app_id() {
        let scanner = SteamScanner::new();
        // Valid app IDs should pass validation (actual launch may fail without Steam)
        let result = scanner.launch_game("440");
        // We can't test the actual launch, but validation should pass
        assert!(result.is_ok() || result.unwrap_err().contains("Failed to launch"));
    }

    #[test]
    fn test_launch_game_empty_app_id() {
        let scanner = SteamScanner::new();
        let result = scanner.launch_game("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be empty"));
    }

    #[test]
    fn test_launch_game_whitespace_app_id() {
        let scanner = SteamScanner::new();
        let result = scanner.launch_game("   ");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be empty"));
    }

    #[test]
    fn test_launch_game_invalid_characters() {
        let scanner = SteamScanner::new();

        // Test with letters
        let result = scanner.launch_game("abc123");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must contain only digits"));

        // Test with special characters
        let result = scanner.launch_game("123;cmd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must contain only digits"));

        // Test with spaces
        let result = scanner.launch_game("123 456");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must contain only digits"));
    }

    #[test]
    fn test_launch_game_too_long() {
        let scanner = SteamScanner::new();
        let result = scanner.launch_game("12345678901"); // 11 digits
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too long"));
    }

    #[test]
    fn test_launch_game_trimming() {
        let scanner = SteamScanner::new();
        // Valid app ID with surrounding whitespace should be trimmed
        let result = scanner.launch_game("  440  ");
        // Validation should pass (actual launch may fail without Steam)
        assert!(result.is_ok() || result.unwrap_err().contains("Failed to launch"));
    }
}
