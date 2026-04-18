//! Battle.net (Blizzard) scanner
//!
//! Scans for games installed via the Battle.net desktop client. Launch is
//! performed via the `battlenet://<ProductId>` URL scheme which is the
//! approach Playnite and the bnetlauncher community tool both use — passing
//! `Battle.net.exe --exec="launch <code>"` works but triggers Battle.net's
//! v1 compatibility code-path, while the URL scheme hits the current
//! launcher directly.

#[allow(unused_imports)]
use super::types::{GameInfo, GamePlatform, GameScanner};
#[allow(unused_imports)]
use crate::utils::game_icon::find_game_icon;
use std::path::PathBuf;
#[allow(unused_imports)]
use tracing::{debug, warn};

/// Battle.net scanner
pub struct BattleNetScanner;

impl BattleNetScanner {
    pub fn new() -> Self {
        Self
    }

    /// Map an install directory or uninstall display name onto a Battle.net
    /// ProductId. Only games whose product code is known to the Battle.net
    /// launcher can be started via `battlenet://`; the mapping below mirrors
    /// the one maintained by Playnite's BattleNetLibrary.
    ///
    /// Exposed as a pure helper for unit testing.
    pub(crate) fn resolve_product_code(display_name: &str, install_folder: &str) -> Option<&'static str> {
        // Drop punctuation that inconsistently appears between titles and
        // subtitles ("Diablo II: Resurrected" vs "Diablo II Resurrected"),
        // then collapse whitespace so substring matching is robust.
        let raw = format!("{} {}", display_name, install_folder).to_lowercase();
        let needle: String = raw
            .chars()
            .map(|c| if c == ':' || c == '-' || c == '.' { ' ' } else { c })
            .collect();
        let needle = needle.split_whitespace().collect::<Vec<_>>().join(" ");

        // Ordered from most specific to least specific: "diablo ii" is a
        // substring of "diablo ii resurrected" so the latter must come
        // first, and all keys must be punctuation-free to match `needle`.
        const MAPPING: &[(&str, &str)] = &[
            ("diablo ii resurrected", "OSI"),
            ("diablo ii lord of destruction", "D2X"),
            ("diablo iv", "Fen"),
            ("diablo iii", "D3"),
            ("diablo immortal", "ANBS"),
            ("diablo ii", "D2"),
            ("diablo", "D1"),
            ("world of warcraft classic", "WoWC"),
            ("world of warcraft", "WoW"),
            ("starcraft ii", "S2"),
            ("starcraft remastered", "S1"),
            ("starcraft", "S1"),
            ("hearthstone", "WTCG"),
            ("heroes of the storm", "Hero"),
            ("overwatch 2", "Pro"),
            ("overwatch", "Pro"),
            ("warcraft iii reforged", "W3"),
            ("warcraft iii", "W3"),
            ("warcraft rumble", "GRY"),
            ("warcraft ii", "W2"),
            ("warcraft orcs", "W1"),
            ("black ops cold war", "ZEUS"),
            ("black ops 4", "VIPR"),
            ("modern warfare iii", "PNTA"),
            ("modern warfare ii", "AUKS"),
            ("modern warfare", "ODIN"),
            ("vanguard", "FORE"),
            ("crash bandicoot 4", "WLBY"),
            ("sea of thieves", "SCOR"),
            ("doom the dark ages", "ARIS"),
            ("the outer worlds 2", "ARK"),
            ("tony hawk", "LBRA"),
            ("avowed", "AQUA"),
        ];

        MAPPING
            .iter()
            .find(|(key, _)| needle.contains(key))
            .map(|(_, code)| *code)
    }

    /// Detect Battle.net install presence.
    fn check_is_installed() -> bool {
        #[cfg(target_os = "windows")]
        {
            let paths = [
                PathBuf::from(r"C:\Program Files (x86)\Battle.net"),
                PathBuf::from(r"C:\Program Files\Battle.net"),
            ];
            paths.iter().any(|p| p.exists())
        }
        #[cfg(target_os = "macos")]
        {
            PathBuf::from("/Applications/Battle.net.app").exists()
        }
        #[cfg(target_os = "linux")]
        {
            false
        }
    }

    /// Scan installed Blizzard games by walking the Windows uninstall
    /// registry for Blizzard Entertainment entries.
    #[cfg(target_os = "windows")]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        use winreg::RegKey;
        use winreg::enums::*;

        let mut games = Vec::new();
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

        let uninstall_key = hklm
            .open_subkey(r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")
            .or_else(|_| hklm.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"));

        let Ok(uninstall) = uninstall_key else {
            warn!("Failed to open uninstall registry for Battle.net scan");
            return Ok(games);
        };

        for key_name in uninstall.enum_keys().flatten() {
            let Ok(app_key) = uninstall.open_subkey(&key_name) else { continue };

            let publisher: String = app_key.get_value("Publisher").unwrap_or_default();
            let pub_lc = publisher.to_lowercase();
            // Blizzard publisher tags. Activision titles (recent CoD, Crash,
            // THPS) ship via Battle.net too and are published as
            // "Activision" / "Blizzard Entertainment".
            let is_blizzard = pub_lc.contains("blizzard")
                || pub_lc.contains("activision")
                || key_name.contains("Blizzard");
            if !is_blizzard {
                continue;
            }

            let name: String = app_key.get_value("DisplayName").unwrap_or_default();
            let path: String = app_key.get_value("InstallLocation").unwrap_or_default();
            if name.is_empty() || path.is_empty() {
                continue;
            }

            // Skip the launcher itself and shared runtimes.
            let name_lc = name.to_lowercase();
            if name_lc.contains("battle.net")
                || name_lc.contains("redistributable")
                || name_lc.contains("runtime")
            {
                continue;
            }

            let Some(product_code) =
                Self::resolve_product_code(&name, PathBuf::from(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(""))
            else {
                debug!(name = %name, "Skipping unrecognised Blizzard product");
                continue;
            };

            let install_path = PathBuf::from(&path);
            let mut game = GameInfo::new(
                format!("battlenet_{}", product_code.to_lowercase()),
                name.clone(),
                GamePlatform::Battlenet,
                install_path.clone(),
            );
            game.launch_uri = Some(format!("battlenet://{}", product_code));
            game.is_installed = install_path.exists();
            game.icon_path = find_game_icon(&install_path, None);
            debug!(name = %name, code = %product_code, "Battle.net game found");
            games.push(game);
        }

        Ok(games)
    }

    #[cfg(not(target_os = "windows"))]
    fn scan_from_registry(&self) -> Result<Vec<GameInfo>, String> {
        Ok(Vec::new())
    }
}

impl Default for BattleNetScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameScanner for BattleNetScanner {
    fn is_installed(&self) -> bool {
        Self::check_is_installed()
    }

    fn scan_games(&self) -> Result<Vec<GameInfo>, String> {
        let mut games = self.scan_from_registry()?;
        games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        games.dedup_by(|a, b| a.id == b.id);
        Ok(games)
    }

    fn launch_game(&self, game_id: &str) -> Result<(), String> {
        let code = game_id
            .strip_prefix("battlenet_")
            .ok_or("Invalid Battle.net game ID")?;
        // Reuse upper-case code by scanning products: ID is stored lowercase.
        let uri = format!("battlenet://{}", code.to_uppercase());

        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &uri])
                .spawn()
                .map_err(|e| format!("Failed to launch Battle.net game: {}", e))?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch Battle.net game: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&uri)
                .spawn()
                .map_err(|e| format!("Failed to launch Battle.net game: {}", e))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_diablo_iv() {
        assert_eq!(
            BattleNetScanner::resolve_product_code("Diablo IV", "Diablo IV"),
            Some("Fen")
        );
    }

    #[test]
    fn resolve_d2r_not_d2() {
        // "Diablo II: Resurrected" contains "Diablo II" so ordering matters.
        assert_eq!(
            BattleNetScanner::resolve_product_code("Diablo II: Resurrected", ""),
            Some("OSI")
        );
    }

    #[test]
    fn resolve_world_of_warcraft() {
        assert_eq!(
            BattleNetScanner::resolve_product_code("World of Warcraft", "World of Warcraft"),
            Some("WoW")
        );
    }

    #[test]
    fn resolve_wow_classic_before_retail() {
        assert_eq!(
            BattleNetScanner::resolve_product_code(
                "World of Warcraft Classic",
                "World of Warcraft"
            ),
            Some("WoWC")
        );
    }

    #[test]
    fn resolve_unknown_returns_none() {
        assert_eq!(BattleNetScanner::resolve_product_code("Random Indie Game", ""), None);
    }
}
