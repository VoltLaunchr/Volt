pub mod database;
pub mod file_history;
pub mod scanner;
pub mod search_engine;
pub mod types;
pub mod watcher;
#[cfg(target_os = "windows")]
pub mod windows_search;

// --- Pilier D: next-gen file search (see REFONTE-PILIER-D-SEARCH.md) ---
// Track 1: Tantivy full-text index, gated behind the `tantivy-search` feature
// (OFF by default — the default build and search behaviour are unaffected).
#[cfg(feature = "tantivy-search")]
pub mod fulltext;
// Track 2: NTFS MFT/USN fast-enumeration accelerator. Documentation-only stub
// for phase 2 (no unsafe, no dependency yet).
pub mod mft;

pub use database::{FileIndexDb, IndexStats};
pub use file_history::*;
pub use scanner::*;
pub use search_engine::{SearchEngine, SearchOptions, SearchResult};
pub use types::*;
