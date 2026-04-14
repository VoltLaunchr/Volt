pub mod game_icon;
pub mod hash;
pub mod icon;
pub mod matching;
pub mod path;
#[cfg(target_os = "windows")]
pub mod shell_apps;

pub use hash::hash_id;
pub use icon::*;
