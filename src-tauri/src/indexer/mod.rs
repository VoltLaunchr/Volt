pub mod database;
pub mod file_history;
pub mod scanner;
pub mod search;
pub mod search_engine;
pub mod types;
pub mod watcher;
#[cfg(target_os = "windows")]
pub mod windows_search;

pub use database::{FileIndexDb, IndexStats};
pub use file_history::*;
pub use scanner::*;
pub use search_engine::{SearchEngine, SearchOptions, SearchResult};
pub use types::*;
