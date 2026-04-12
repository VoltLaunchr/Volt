//! Multi-platform game scanner plugin
//!
//! Scans and manages games from multiple platforms:
//! - Steam (via existing SteamScanner)
//! - Epic Games Store
//! - GOG Galaxy
//! - Ubisoft Connect
//! - EA App (Origin)
//! - Xbox/Microsoft Store
//! - Riot Games

pub mod ea;
pub mod epic;
pub mod gog;
pub mod plugin;
pub mod riot;
pub mod steam;
pub mod types;
pub mod ubisoft;
pub mod xbox;

pub use plugin::GameScannerPlugin;
pub use types::GameInfo;
