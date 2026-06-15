//! NTFS Master File Table (MFT) / USN journal fast-enumeration accelerator.
//!
//! **Track 2 of Pilier D — PHASE 2, DOCUMENTATION ONLY.**
//! See `REFONTE-PILIER-D-SEARCH.md` §3 for the full design.
//!
//! This module is intentionally a doc-only placeholder. It contains **no
//! `unsafe` code**, **no Windows API calls**, and **no third-party NTFS
//! dependency** yet. It exists so the design and the integration contract are
//! captured in-tree; the real implementation lands in a later, separately
//! reviewed change behind its own `mft-search` Cargo feature.
//!
//! # What this will do (phase 2)
//!
//! Reading the on-disk NTFS Master File Table in a single sequential pass
//! enumerates every file and directory on a volume far faster than a recursive
//! `readdir` walk (which issues one syscall per directory entry). The USN change
//! journal then provides a low-overhead delta feed to keep the index current.
//! This is the industry-standard best-practice approach for "instant" local file
//! enumeration.
//!
//! - **Cold enumeration:** read `$MFT` once → stream [`crate::indexer::types::FileInfo`]
//!   into the *same* SQLite + Tantivy + in-memory pipeline the recursive scanner
//!   already feeds. The MFT path is a drop-in *source*, not a rewrite.
//! - **Incremental:** subscribe to the USN journal → emit the same upsert/remove
//!   batches the `notify` watcher emits today.
//!
//! # Crates (verified June 2026, not yet added to `Cargo.toml`)
//!
//! - `ntfs-reader` (≈0.4.2) — in-memory `$MFT` scan + USN journal reader; the
//!   highest-level option and the recommended first cut.
//! - `usn-journal-rs` — alternative safe abstraction over USN + MFT.
//! - `ntfs` (ColinFinck) — lower-level no-std NTFS implementation.
//!
//! # Privilege & fallback contract (non-negotiable)
//!
//! Reading the raw MFT requires opening a **volume handle** (`\\.\C:`), which on
//! Windows needs **Administrator / elevated** privileges. Volt runs unelevated by
//! design — a launcher must never demand UAC just to search. Therefore the MFT
//! path is attempted **only** when ALL of the following hold:
//!
//! 1. the `mft-search` feature is enabled,
//! 2. the process is already elevated (no UAC prompt is ever requested),
//! 3. the target volume's filesystem is NTFS.
//!
//! In every other case (not elevated, non-NTFS, network/removable volume, macOS,
//! Linux) the code **transparently falls back** to the existing recursive
//! [`crate::indexer::scanner::scan_files`] walk. The user gets faster indexing
//! *iff* they already run elevated, and byte-for-byte identical behaviour
//! otherwise.
//!
//! # Cross-platform
//!
//! MFT/USN is Windows + NTFS only. macOS and Linux always use the recursive walk.
//! The future implementation and its dependency will be `#[cfg(windows)]` and
//! feature-gated so non-Windows builds never compile it.
//!
//! # Planned surface (illustrative — intentionally not implemented here)
//!
//! ```ignore
//! /// Whether the MFT fast path can be used for `drive` right now.
//! /// Returns false (→ caller uses scan_files) unless elevated + NTFS.
//! #[cfg(all(windows, feature = "mft-search"))]
//! pub fn mft_available(drive: &str) -> bool { /* is_elevated() && is_ntfs(drive) */ }
//!
//! /// One-pass MFT enumeration → FileInfo stream (phase 2).
//! #[cfg(all(windows, feature = "mft-search"))]
//! pub fn enumerate_volume(drive: &str) -> Result<Vec<FileInfo>, String> { /* ntfs-reader */ }
//! ```
//!
//! Keeping this as documentation (rather than dead stubs) avoids shipping unused
//! `unsafe`/FFI surface before it is needed and keeps the default build clean.
