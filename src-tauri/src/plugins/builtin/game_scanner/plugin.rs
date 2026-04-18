//! Multi-platform Game Scanner Plugin
//!
//! Aggregates games from all supported platforms and provides
//! a unified interface for searching and launching games.

use super::amazon::AmazonScanner;
use super::battlenet::BattleNetScanner;
use super::ea::EAScanner;
use super::epic::EpicScanner;
use super::gog::GOGScanner;
use super::riot::RiotScanner;
use super::rockstar::RockstarScanner;
use super::steam::SteamScanner;
use super::types::{GameInfo, GamePlatform, GameScanner};
use super::ubisoft::UbisoftScanner;
use super::xbox::XboxScanner;

use crate::core::traits::Plugin;
use crate::plugins::api::VoltPluginAPI;

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::sync::{Arc, RwLock};

/// Unified Game Scanner Plugin
pub struct GameScannerPlugin {
    games_cache: Arc<RwLock<Vec<GameInfo>>>,
    last_scan: Arc<RwLock<Option<std::time::Instant>>>,
    cache_duration: std::time::Duration,
    api: Option<Arc<VoltPluginAPI>>,
}

impl GameScannerPlugin {
    pub fn new() -> Self {
        Self {
            games_cache: Arc::new(RwLock::new(Vec::new())),
            last_scan: Arc::new(RwLock::new(None)),
            cache_duration: std::time::Duration::from_secs(300), // 5 minutes
            api: None,
        }
    }

    /// Set the plugin API
    pub fn with_api(mut self, api: Arc<VoltPluginAPI>) -> Self {
        self.api = Some(api);
        self
    }

    /// Check if cache is valid
    fn is_cache_valid(&self) -> bool {
        if let Ok(last_scan) = self.last_scan.read()
            && let Some(time) = *last_scan
        {
            return time.elapsed() < self.cache_duration;
        }
        false
    }

    /// Add games to the collection, deduplicating by name
    fn add_games_deduplicated(
        games: &mut Vec<GameInfo>,
        seen_names: &mut HashMap<String, ()>,
        new_games: Vec<GameInfo>,
    ) {
        for game in new_games {
            let key = game.name.to_lowercase();
            if let Entry::Vacant(e) = seen_names.entry(key) {
                e.insert(());
                games.push(game);
            }
        }
    }

    /// Scan all platforms for games (parallelised across platforms)
    pub fn scan_all_games(&self) -> Vec<GameInfo> {
        // Return cached if valid
        if self.is_cache_valid()
            && let Ok(cache) = self.games_cache.read()
        {
            return cache.clone();
        }

        // Build the list of scanners to run
        let scanners: Vec<Box<dyn GameScanner>> = vec![
            Box::new(SteamScanner::new()),
            Box::new(EpicScanner::new()),
            Box::new(GOGScanner::new()),
            Box::new(UbisoftScanner::new()),
            Box::new(EAScanner::new()),
            Box::new(XboxScanner::new()),
            Box::new(RiotScanner::new()),
            Box::new(BattleNetScanner::new()),
            Box::new(AmazonScanner::new()),
            Box::new(RockstarScanner::new()),
        ];

        // Scan all platforms in parallel using scoped threads
        let results: Vec<Vec<GameInfo>> = std::thread::scope(|s| {
            let handles: Vec<_> = scanners
                .iter()
                .map(|scanner| {
                    s.spawn(|| {
                        if scanner.is_installed() {
                            scanner.scan_games().unwrap_or_default()
                        } else {
                            Vec::new()
                        }
                    })
                })
                .collect();

            handles
                .into_iter()
                .map(|h| h.join().unwrap_or_default())
                .collect()
        });

        // Merge and deduplicate
        let mut all_games = Vec::new();
        let mut seen_names: HashMap<String, ()> = HashMap::new();
        for platform_games in results {
            Self::add_games_deduplicated(&mut all_games, &mut seen_names, platform_games);
        }

        // Filter out non-game applications (anticheat, launchers, etc.)
        all_games.retain(Self::is_actual_game);

        // Sort by name
        all_games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        // Update cache
        if let Ok(mut cache) = self.games_cache.write() {
            *cache = all_games.clone();
        }
        if let Ok(mut last_scan) = self.last_scan.write() {
            *last_scan = Some(std::time::Instant::now());
        }

        all_games
    }

    /// Check if an entry is an actual game (not launcher, anticheat, etc.)
    fn is_actual_game(game: &GameInfo) -> bool {
        let name_lower = game.name.to_lowercase();

        // Filter out known non-game applications
        let non_game_keywords = [
            "launcher",
            "anticheat",
            "anti-cheat",
            "easyanticheat",
            "battleye",
            "crash reporter",
            "updater",
            "patcher",
            "installer",
            "uninstall",
            "redistributable",
            "vcredist",
            "directx",
            "setup",
            "config",
            "tool",
            "service",
            "bootstrap",
            "editor",
        ];

        for keyword in &non_game_keywords {
            if name_lower.contains(keyword) {
                return false;
            }
        }

        // Filter out specific known non-games
        let non_game_exact = [
            "ea desktop",
            "ea app",
            "origin",
            "epic games launcher",
            "ubisoft connect",
            "gog galaxy",
            "riot client",
            "xbox app",
        ];

        for exact_name in &non_game_exact {
            if name_lower == *exact_name {
                return false;
            }
        }

        true
    }

    /// Get all games (cached)
    pub fn get_games(&self) -> Vec<GameInfo> {
        self.scan_all_games()
    }

    /// Search games by query
    pub fn search_games(&self, query: &str) -> Vec<GameInfo> {
        let games = self.get_games();
        let query_lower = query.to_lowercase();

        games
            .into_iter()
            .filter(|game| {
                game.name.to_lowercase().contains(&query_lower)
                    || game
                        .alias
                        .as_ref()
                        .map(|a| a.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
            })
            .collect()
    }

    /// Launch a game by its ID
    pub fn launch_game(&self, game_id: &str) -> Result<(), String> {
        let games = self.get_games();

        let game = games
            .iter()
            .find(|g| g.id == game_id)
            .ok_or("Game not found")?;

        // Determine which scanner to use based on platform
        match game.platform {
            GamePlatform::Steam => {
                let app_id = game_id
                    .strip_prefix("steam_")
                    .ok_or("Invalid Steam game ID")?;

                let uri = format!("steam://rungameid/{}", app_id);
                self.open_uri(&uri)
            }
            GamePlatform::Epic => EpicScanner::new().launch_game(game_id),
            GamePlatform::Gog => GOGScanner::new().launch_game(game_id),
            GamePlatform::Ubisoft => UbisoftScanner::new().launch_game(game_id),
            GamePlatform::EA => EAScanner::new().launch_game(game_id),
            GamePlatform::Xbox => XboxScanner::new().launch_game(game_id),
            GamePlatform::Riot => RiotScanner::new().launch_game(game_id),
            GamePlatform::Battlenet => BattleNetScanner::new().launch_game(game_id),
            GamePlatform::Amazon => AmazonScanner::new().launch_game(game_id),
            GamePlatform::Rockstar => RockstarScanner::new().launch_game(game_id),
            GamePlatform::Other => {
                if let Some(exe) = &game.executable {
                    std::process::Command::new(exe)
                        .spawn()
                        .map_err(|e| format!("Failed to launch game: {}", e))?;
                    Ok(())
                } else {
                    Err("No launch method available for this game".to_string())
                }
            }
        }
    }

    /// Open a URI (platform-specific)
    fn open_uri(&self, uri: &str) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", uri])
                .spawn()
                .map_err(|e| format!("Failed to open URI: {}", e))?;
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(uri)
                .spawn()
                .map_err(|e| format!("Failed to open URI: {}", e))?;
        }

        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(uri)
                .spawn()
                .map_err(|e| format!("Failed to open URI: {}", e))?;
        }

        Ok(())
    }

    /// Get installed platforms
    pub fn get_installed_platforms(&self) -> Vec<GamePlatform> {
        let mut platforms = Vec::new();

        // Check each platform
        if SteamScanner::new().is_installed() {
            platforms.push(GamePlatform::Steam);
        }
        if EpicScanner::new().is_installed() {
            platforms.push(GamePlatform::Epic);
        }
        if GOGScanner::new().is_installed() {
            platforms.push(GamePlatform::Gog);
        }
        if UbisoftScanner::new().is_installed() {
            platforms.push(GamePlatform::Ubisoft);
        }
        if EAScanner::new().is_installed() {
            platforms.push(GamePlatform::EA);
        }
        if XboxScanner::new().is_installed() {
            platforms.push(GamePlatform::Xbox);
        }
        if RiotScanner::new().is_installed() {
            platforms.push(GamePlatform::Riot);
        }
        if BattleNetScanner::new().is_installed() {
            platforms.push(GamePlatform::Battlenet);
        }
        if AmazonScanner::new().is_installed() {
            platforms.push(GamePlatform::Amazon);
        }
        if RockstarScanner::new().is_installed() {
            platforms.push(GamePlatform::Rockstar);
        }

        platforms
    }

    /// Rescan all games (invalidate cache)
    pub fn rescan(&self) -> Vec<GameInfo> {
        // Invalidate cache
        if let Ok(mut last_scan) = self.last_scan.write() {
            *last_scan = None;
        }

        self.scan_all_games()
    }
}

impl Default for GameScannerPlugin {
    fn default() -> Self {
        Self::new()
    }
}

impl Plugin for GameScannerPlugin {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "game_scanner"
    }

    fn name(&self) -> &str {
        "Games"
    }

    fn description(&self) -> &str {
        "Scan and launch games from Steam, Epic, GOG, Ubisoft, EA, Xbox, and Riot"
    }
}
