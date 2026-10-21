//! NTFS fast-enumeration accelerators — privilege map & design notes.
//!
//! **Track 2 of Pilier D — DOCUMENTATION ONLY.**
//! See `REFONTE-PILIER-D-SEARCH.md` §3 for the full design.
//!
//! This module is intentionally a doc-only placeholder. It contains **no
//! `unsafe` code**, **no Windows API calls**, and **no third-party NTFS
//! dependency**. It captures the design and the privilege boundary in-tree.
//! The *no-admin* incremental path actually lands in the sibling
//! [`crate::indexer::usn`] module (behind the `usn-incremental` feature); the
//! *admin-only* raw-MFT bulk path remains unimplemented and optional.
//!
//! # The key correction: two mechanisms, two privilege levels
//!
//! The original plan conflated "read the MFT" with "needs Administrator". They
//! are **not** the same thing. There are two distinct NTFS fast-paths:
//!
//! | Mechanism | Win32 surface | Privilege | Role in Volt |
//! |---|---|---|---|
//! | **Raw `$MFT` bulk read** | `CreateFile(\\.\C:, GENERIC_READ)` | **Administrator** (raw block-device access) | Optional accelerator, *only if already elevated*. Never default, never prompts UAC. |
//! | **USN change journal read** | `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL` on a handle opened with `FILE_TRAVERSE` | **None** (standard user) | The default no-admin live-delta feed → [`crate::indexer::usn`]. |
//!
//! Spotlight-/Everything-style "instant" search does **not** require every user
//! to run as admin: the OS maintains an index, and apps query it. Volt mirrors
//! that model on Windows — **a launcher must never demand UAC just to search.**
//!
//! # The no-admin architecture (what we actually ship)
//!
//! ```text
//! Baseline enumeration (no admin):
//!   Windows Search Index  → crate::indexer::windows_search (already wired)
//!   + scan_files walk      → crate::indexer::scanner (folders outside the index scope)
//!
//! Live deltas (no admin):
//!   USN journal, unprivileged → crate::indexer::usn (FSCTL_READ_UNPRIVILEGED_USN_JOURNAL)
//!   emits the SAME upsert/remove batches the `notify` watcher emits today.
//!
//! Optional bulk accelerator (admin ONLY, opportunistic):
//!   Raw $MFT one-pass read → this module, future, gated on is_elevated() && NTFS.
//!   Skipped silently when unelevated; baseline path covers that case identically.
//! ```
//!
//! The USN journal only reports **changes** since the journal was created — it is
//! a delta feed, never a substitute for the baseline enumeration above. That is
//! why the no-admin design pairs it with the Windows Search Index (and the
//! recursive walk as a universal fallback).
//!
//! # Crates (verified June 2026)
//!
//! - `ntfs-reader` (≈0.4.2) and `usn-journal-rs` both open the volume in **read**
//!   mode (`Volume::new("\\\\.\\C:")`) — i.e. the **admin** path — and neither
//!   clearly exposes `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL`. The no-admin USN
//!   reader therefore uses a thin in-tree FFI layer (see [`crate::indexer::usn`])
//!   rather than these crates as-is.
//! - `ntfs` (ColinFinck) — lower-level no-std NTFS implementation, for the future
//!   admin-only raw-MFT bulk path only.
//!
//! # Privilege & fallback contract (non-negotiable)
//!
//! 1. **Never request elevation for search.** No code path here prompts UAC.
//! 2. **No-admin first.** The default fast path (Windows Search + unprivileged
//!    USN) requires no special privileges and is the only path wired into the
//!    lifecycle.
//! 3. **Raw MFT is opportunistic.** It is attempted *only* when the process is
//!    already elevated AND the volume is NTFS AND its feature flag is on; in every
//!    other case (unelevated, non-NTFS, network/removable, macOS, Linux) the code
//!    transparently falls back to the baseline path with identical behaviour.
//!
//! # Cross-platform
//!
//! MFT/USN is Windows + NTFS only. macOS and Linux always use the recursive walk
//! (and could later adopt FSEvents / fanotify as their own no-privilege delta
//! feeds). Both the future raw-MFT code and the USN reader are `#[cfg(windows)]`
//! and feature-gated so non-Windows builds never compile them.
