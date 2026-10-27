pub mod database;
pub mod file_history;
mod ignore_policy;
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
// Track 2: NTFS MFT/USN fast-enumeration accelerators.
// `mft` is a documentation-only privilege map (admin-only raw-MFT accelerator).
pub mod mft;
// `usn` is the no-admin unprivileged USN change-journal delta reader, gated
// behind the `usn-incremental` feature (OFF by default). The FFI is Windows-only;
// the record parser is portable so its tests run on every OS.
#[cfg(feature = "usn-incremental")]
pub mod usn;

pub use database::{FileIndexDb, IndexStats};
pub use file_history::*;
pub(crate) use ignore_policy::set_external_policy;
pub use scanner::*;
pub use search_engine::{SearchEngine, SearchOptions, SearchResult};
pub use types::*;

/// Temp dir under a canonical base. macOS temp dirs live below the
/// `/var` -> `/private/var` symlink, which the scanner deliberately refuses to
/// traverse, so tests must root their fixtures at the resolved path.
#[cfg(test)]
pub(crate) fn test_tempdir() -> tempfile::TempDir {
    let base = std::env::temp_dir().canonicalize().unwrap();
    tempfile::Builder::new().tempdir_in(base).unwrap()
}
