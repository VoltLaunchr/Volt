//! SQLite-backed persistent file index.
//!
//! Schema (single table, auto-migrated with `IF NOT EXISTS`):
//!
//! ```sql
//! CREATE TABLE IF NOT EXISTS files (
//!   id          INTEGER PRIMARY KEY,
//!   path        TEXT UNIQUE NOT NULL,
//!   name        TEXT NOT NULL,
//!   extension   TEXT,
//!   size        INTEGER,
//!   modified_at INTEGER,
//!   indexed_at  INTEGER,
//!   category    TEXT
//! );
//! ```

use crate::indexer::types::{FileCategory, FileInfo};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::{debug, info, warn};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Statistics about the current SQLite index.
#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "IndexDbStats.ts", rename = "IndexDbStats")]
pub struct IndexStats {
    /// Number of files currently in the index.
    pub indexed_count: usize,
    /// Rough size of the DB file on disk, in bytes.
    #[ts(type = "number")]
    pub db_size_bytes: u64,
    /// Unix timestamp of the last full scan (0 = never).
    #[ts(type = "number")]
    pub last_full_scan: i64,
    /// Whether the file watcher is currently active.
    pub is_watching: bool,
    /// Number of offline catch-up reconciles that have actually re-walked the
    /// index (the no-admin stand-in for a USN-journal drain). This is the
    /// re-scan telemetry feeding the D3/USN reconsideration — see
    /// `REFONTE-PILIER-D-SEARCH.md`.
    #[ts(type = "number")]
    pub stale_catchup_count: i64,
    /// Unix timestamp of the most recent offline catch-up reconcile (0 = never).
    #[ts(type = "number")]
    pub last_stale_catchup: i64,
    /// Local, bounded diagnostics. These records deliberately contain no paths.
    pub scan_history: Vec<ScanDiagnostic>,
    #[ts(type = "number | null")]
    pub scan_duration_recent_ms: Option<u64>,
    #[ts(type = "number | null")]
    pub scan_duration_median_ms: Option<u64>,
    /// Watcher events per indexed root and UTC day (last
    /// [`WATCHER_CHURN_DAYS`] days). `root` is an opaque key in the database;
    /// the IPC command replaces it with a generic label (`Root 1`, ...).
    pub watcher_churn: Vec<WatcherChurnDay>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "ScanKind.ts")]
pub enum ScanKind {
    Initial,
    Rebuild,
    Catchup,
}

/// Only aggregate counts and timings cross the diagnostics boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "ScanDiagnostic.ts")]
pub struct ScanDiagnostic {
    pub kind: ScanKind,
    #[ts(type = "number")]
    pub completed_at: i64,
    #[ts(type = "number")]
    pub scan_ms: u64,
    #[ts(type = "number")]
    pub persist_ms: u64,
    #[ts(type = "number")]
    pub total_ms: u64,
    pub indexed_count: usize,
    pub root_count: usize,
    pub added: usize,
    pub removed: usize,
    pub modified: usize,
}

/// Watcher activity for one indexed root on one UTC day. No path is stored:
/// `root` is [`root_diagnostic_key`] on disk and a generic label over IPC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "WatcherChurnDay.ts")]
pub struct WatcherChurnDay {
    /// Days since the Unix epoch (UTC).
    #[ts(type = "number")]
    pub day: i64,
    pub root: String,
    #[ts(type = "number")]
    pub events: u64,
}

/// Days of watcher activity kept.
pub const WATCHER_CHURN_DAYS: i64 = 30;
/// Roots kept per day; quieter roots are folded into [`OTHER_ROOTS_KEY`].
pub const WATCHER_CHURN_ROOTS_PER_DAY: usize = 20;
/// Bucket for roots beyond the per-day bound.
pub const OTHER_ROOTS_KEY: &str = "other";

/// Opaque, stable key for an indexed root (FNV-1a of its canonical path).
/// Lets per-root counters survive restarts without persisting the path.
pub fn root_diagnostic_key(root: &Path) -> String {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in canonical.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Current UTC day number, the unit of [`WatcherChurnDay::day`].
pub fn current_churn_day() -> i64 {
    chrono::Utc::now().timestamp().div_euclid(86_400)
}

/// Merge `counts` into `history` for `day`, then enforce both bounds.
fn merge_watcher_churn(history: &mut Vec<WatcherChurnDay>, day: i64, counts: &[(String, u64)]) {
    for (root, events) in counts {
        match history
            .iter_mut()
            .find(|entry| entry.day == day && &entry.root == root)
        {
            Some(entry) => entry.events = entry.events.saturating_add(*events),
            None => history.push(WatcherChurnDay {
                day,
                root: root.clone(),
                events: *events,
            }),
        }
    }
    history.retain(|entry| entry.day > day - WATCHER_CHURN_DAYS && entry.day <= day);
    let mut days: Vec<i64> = history.iter().map(|entry| entry.day).collect();
    days.sort_unstable();
    days.dedup();
    let mut bounded = Vec::with_capacity(history.len());
    for current in days {
        let mut entries: Vec<WatcherChurnDay> = history
            .iter()
            .filter(|entry| entry.day == current)
            .cloned()
            .collect();
        entries.sort_by(|a, b| {
            (a.root == OTHER_ROOTS_KEY)
                .cmp(&(b.root == OTHER_ROOTS_KEY))
                .then(b.events.cmp(&a.events))
                .then(a.root.cmp(&b.root))
        });
        if entries.len() > WATCHER_CHURN_ROOTS_PER_DAY {
            let folded: u64 = entries
                .drain(WATCHER_CHURN_ROOTS_PER_DAY - 1..)
                .map(|entry| entry.events)
                .fold(0, u64::saturating_add);
            entries.push(WatcherChurnDay {
                day: current,
                root: OTHER_ROOTS_KEY.to_string(),
                events: folded,
            });
        }
        bounded.extend(entries);
    }
    *history = bounded;
}

/// Compare stable snapshot metadata; access times and presentation icons do
/// not imply a file changed. Paths are used transiently and never returned.
pub fn snapshot_delta(before: &[FileInfo], after: &[FileInfo]) -> (usize, usize, usize) {
    let mut previous: HashMap<&str, &FileInfo> = before
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let mut added = 0;
    let mut modified = 0;
    for file in after {
        match previous.remove(file.path.as_str()) {
            None => added += 1,
            Some(old)
                if old.size != file.size
                    || old.modified != file.modified
                    || old.name != file.name
                    || old.extension != file.extension
                    || old.category != file.category =>
            {
                modified += 1;
            }
            Some(_) => {}
        }
    }
    (added, previous.len(), modified)
}

fn duration_median(history: &[ScanDiagnostic]) -> Option<u64> {
    let mut values: Vec<u64> = history.iter().map(|scan| scan.total_ms).collect();
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    let middle = values.len() / 2;
    Some(if values.len().is_multiple_of(2) {
        values[middle - 1] + (values[middle] - values[middle - 1]) / 2
    } else {
        values[middle]
    })
}

// ---------------------------------------------------------------------------
// FileIndexDb
// ---------------------------------------------------------------------------

/// Thread-safe wrapper around a SQLite connection for file indexing.
///
/// Cloning shares the SAME underlying connection (the `Arc<Mutex<_>>` is
/// cloned, not the connection): all clones serialize on one mutex, so two
/// writers in the same process can never hit `SQLITE_BUSY` against each
/// other. This is what lets the file watcher share the index state's
/// connection instead of opening a second one to the same file.
pub struct FileIndexDb {
    conn: Arc<Mutex<Connection>>,
    db_path: std::path::PathBuf,
}

impl Clone for FileIndexDb {
    fn clone(&self) -> Self {
        Self {
            conn: Arc::clone(&self.conn),
            db_path: self.db_path.clone(),
        }
    }
}

impl FileIndexDb {
    /// Open (or create) the SQLite database at `db_path` and run the
    /// `CREATE TABLE IF NOT EXISTS` migration.
    pub fn open(db_path: impl AsRef<Path>) -> Result<Self, String> {
        let db_path = db_path.as_ref().to_path_buf();
        let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;

        // Enable WAL mode for better concurrent read performance.
        // `busy_timeout` makes the second connection (watcher) wait instead of
        // immediately failing with SQLITE_BUSY when the scanner holds a write
        // transaction — without it watcher upserts are dropped and DB/memory
        // diverge under scan+churn contention.
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;",
        )
        .map_err(|e| format!("Failed to set PRAGMA: {}", e))?;

        // Create table.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS files (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                path        TEXT UNIQUE NOT NULL,
                name        TEXT NOT NULL,
                extension   TEXT,
                size        INTEGER,
                modified_at INTEGER,
                indexed_at  INTEGER,
                category    TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
            CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);",
        )
        .map_err(|e| format!("Failed to create table: {}", e))?;

        // Metadata table to store key-value pairs (e.g. last_full_scan timestamp).
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS metadata (
                key   TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Failed to create metadata table: {}", e))?;

        info!("File index database opened at {:?}", db_path);

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path,
        })
    }

    /// Return the path to the DB file.
    pub fn db_path(&self) -> &std::path::Path {
        &self.db_path
    }

    // -----------------------------------------------------------------------
    // Write operations
    // -----------------------------------------------------------------------

    /// Insert or replace a single file record.
    pub fn upsert_file(&self, file: &FileInfo) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        let category = serde_json::to_string(&file.category)
            .unwrap_or_else(|e| {
                warn!(
                    "Failed to serialize category for '{}': {} — using 'other'",
                    file.path, e
                );
                "\"other\"".to_string()
            })
            .trim_matches('"')
            .to_string();

        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "INSERT INTO files (path, name, extension, size, modified_at, indexed_at, category)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(path) DO UPDATE SET
               name        = excluded.name,
               extension   = excluded.extension,
               size        = excluded.size,
               modified_at = excluded.modified_at,
               indexed_at  = excluded.indexed_at,
               category    = excluded.category",
            params![
                file.path,
                file.name,
                file.extension,
                file.size as i64,
                file.modified,
                now,
                category
            ],
        )
        .map_err(|e| format!("Failed to upsert file '{}': {}", file.path, e))?;

        debug!("Upserted file: {}", file.path);
        Ok(())
    }

    /// Bulk-insert a batch of files in a single transaction.
    pub fn upsert_files(&self, files: &[FileInfo]) -> Result<(), String> {
        if files.is_empty() {
            return Ok(());
        }

        let mut conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        let now = chrono::Utc::now().timestamp();

        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO files (path, name, extension, size, modified_at, indexed_at, category)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(path) DO UPDATE SET
                       name        = excluded.name,
                       extension   = excluded.extension,
                       size        = excluded.size,
                       modified_at = excluded.modified_at,
                       indexed_at  = excluded.indexed_at,
                       category    = excluded.category",
                )
                .map_err(|e| format!("Failed to prepare statement: {}", e))?;

            for file in files {
                let category = serde_json::to_string(&file.category)
                    .unwrap_or_else(|e| {
                        warn!(
                            "Failed to serialize category for '{}': {} — using 'other'",
                            file.path, e
                        );
                        "\"other\"".to_string()
                    })
                    .trim_matches('"')
                    .to_string();

                stmt.execute(params![
                    file.path,
                    file.name,
                    file.extension,
                    file.size as i64,
                    file.modified,
                    now,
                    category
                ])
                .map_err(|e| format!("Failed to upsert '{}': {}", file.path, e))?;
            }
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;

        info!("Bulk-upserted {} files", files.len());
        Ok(())
    }

    /// Atomically replace the complete file snapshot.
    ///
    /// Full scans use this instead of `clear_all` followed by `upsert_files`,
    /// so readers never observe an empty/partial persistent index and stale
    /// rows cannot survive a rescan.
    pub fn replace_files(&self, files: &[FileInfo]) -> Result<(), String> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to begin replacement transaction: {}", e))?;
        tx.execute("DELETE FROM files", [])
            .map_err(|e| format!("Failed to clear files for replacement: {}", e))?;

        let now = chrono::Utc::now().timestamp();
        {
            // ON CONFLICT DO UPDATE (matching `upsert_files`) rather than a
            // plain INSERT: `files` can contain the same path twice when the
            // configured index folders overlap (e.g. both `Program Files` and
            // `Program Files\Epic Games` are indexed, so a directory under the
            // latter gets walked once per matching root in `scan_files`). A
            // plain INSERT would hit the `files.path` UNIQUE constraint on the
            // second occurrence and roll back the whole transaction, silently
            // dropping every full-scan persist.
            let mut stmt = tx
                .prepare(
                    "INSERT INTO files (path, name, extension, size, modified_at, indexed_at, category)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(path) DO UPDATE SET
                       name        = excluded.name,
                       extension   = excluded.extension,
                       size        = excluded.size,
                       modified_at = excluded.modified_at,
                       indexed_at  = excluded.indexed_at,
                       category    = excluded.category",
                )
                .map_err(|e| format!("Failed to prepare replacement insert: {}", e))?;
            for file in files {
                let category = serde_json::to_string(&file.category)
                    .unwrap_or_else(|_| "\"other\"".to_string())
                    .trim_matches('"')
                    .to_string();
                stmt.execute(params![
                    file.path,
                    file.name,
                    file.extension,
                    file.size as i64,
                    file.modified,
                    now,
                    category
                ])
                .map_err(|e| format!("Failed to replace file '{}': {}", file.path, e))?;
            }
        }
        tx.commit()
            .map_err(|e| format!("Failed to commit file replacement: {}", e))?;
        info!("Replaced file index with {} files", files.len());
        Ok(())
    }

    /// Remove a file from the index by its path.
    pub fn remove_file(&self, path: &str) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        conn.execute("DELETE FROM files WHERE path = ?1", params![path])
            .map_err(|e| format!("Failed to remove file '{}': {}", path, e))?;

        debug!("Removed file from index: {}", path);
        Ok(())
    }

    /// Remove an indexed path and every indexed descendant below it.
    ///
    /// Descendant matching is path-component based rather than a string
    /// prefix, so removing `/data/game` cannot remove `/data/game-old`.
    /// Returns the exact stored paths that were deleted so derived indexes and
    /// in-memory caches can apply the same mutation.
    pub fn remove_path_tree(&self, root: &Path) -> Result<Vec<String>, String> {
        let root_text = root.to_string_lossy().into_owned();
        let mut descendant_prefix = root_text.clone();
        if !descendant_prefix.ends_with(std::path::MAIN_SEPARATOR) {
            descendant_prefix.push(std::path::MAIN_SEPARATOR);
        }
        // Both supported separators are ASCII. Replacing the final separator
        // with its immediate successor creates an exclusive upper bound for
        // every string beginning with `descendant_prefix`. This stays
        // index-friendly without SQL LIKE wildcard/case-folding semantics.
        let mut descendant_upper_bound = descendant_prefix.clone();
        descendant_upper_bound.pop();
        descendant_upper_bound.push(
            char::from_u32(std::path::MAIN_SEPARATOR as u32 + 1)
                .expect("path separator has a Unicode successor"),
        );

        let mut conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start path-tree removal: {}", e))?;

        let removed = {
            let mut stmt = tx
                .prepare(
                    "SELECT path FROM files
                     WHERE path = ?1 OR (path >= ?2 AND path < ?3)",
                )
                .map_err(|e| format!("Failed to prepare path-tree lookup: {}", e))?;
            let paths = stmt
                .query_map(
                    params![root_text, descendant_prefix, descendant_upper_bound],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|e| format!("Failed to query path-tree entries: {}", e))?;

            let mut removed = Vec::new();
            for path in paths {
                let path = path.map_err(|e| format!("Failed to read path-tree entry: {}", e))?;
                removed.push(path);
            }
            removed
        };

        tx.execute(
            "DELETE FROM files
             WHERE path = ?1 OR (path >= ?2 AND path < ?3)",
            params![root_text, descendant_prefix, descendant_upper_bound],
        )
        .map_err(|e| format!("Failed to remove indexed path tree '{}': {}", root_text, e))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit path-tree removal: {}", e))?;
        debug!(
            "Removed {} indexed path(s) under {}",
            removed.len(),
            root.display()
        );
        Ok(removed)
    }

    /// Delete all rows from the files table.
    pub fn clear_all(&self) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        conn.execute("DELETE FROM files", [])
            .map_err(|e| format!("Failed to clear index: {}", e))?;

        info!("File index cleared");
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Read operations
    // -----------------------------------------------------------------------

    /// Return all `FileInfo` rows from the database.
    pub fn get_all_files(&self) -> Result<Vec<FileInfo>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT path, name, extension, size, modified_at, category FROM files")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let files = stmt
            .query_map([], |row| {
                let path: String = row.get(0)?;
                let name: String = row.get(1)?;
                let extension: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
                let size: i64 = row.get::<_, Option<i64>>(3)?.unwrap_or(0);
                let modified: i64 = row.get::<_, Option<i64>>(4)?.unwrap_or(0);
                let category_str: String = row.get::<_, Option<String>>(5)?.unwrap_or_default();

                Ok((path, name, extension, size, modified, category_str))
            })
            .map_err(|e| format!("Failed to query files: {}", e))?
            .filter_map(|r| match r {
                Ok(v) => Some(v),
                Err(e) => {
                    warn!("Skipping corrupted DB row: {}", e);
                    None
                }
            })
            .map(|(path, name, extension, size, modified, category_str)| {
                let category = parse_category(&category_str);
                let id = crate::utils::hash_id(&path);
                FileInfo {
                    id,
                    name,
                    path,
                    extension,
                    size: size as u64,
                    modified,
                    created: None,
                    accessed: None,
                    icon: None,
                    category,
                }
            })
            .collect();

        Ok(files)
    }

    /// How many files are in the index.
    pub fn count(&self) -> Result<usize, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0))
            .map_err(|e| format!("Failed to count: {}", e))?;

        Ok(count as usize)
    }

    // -----------------------------------------------------------------------
    // Metadata helpers
    // -----------------------------------------------------------------------

    /// Persist an arbitrary metadata key.
    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        conn.execute(
            "INSERT INTO metadata(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| format!("Failed to set meta '{}': {}", key, e))?;

        Ok(())
    }

    /// Retrieve a metadata value.
    pub fn get_meta(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        let result = conn.query_row(
            "SELECT value FROM metadata WHERE key = ?1",
            params![key],
            |r| r.get::<_, String>(0),
        );

        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Failed to get meta '{}': {}", key, e)),
        }
    }

    // -----------------------------------------------------------------------
    // Stats
    // -----------------------------------------------------------------------

    /// Collect index statistics.
    pub fn get_stats(&self, is_watching: bool) -> Result<IndexStats, String> {
        let indexed_count = self.count()?;

        let db_size_bytes = std::fs::metadata(&self.db_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let last_full_scan = self
            .get_meta("last_full_scan")?
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);

        let stale_catchup_count = self
            .get_meta(STALE_CATCHUP_COUNT_KEY)?
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);

        let last_stale_catchup = self
            .get_meta(LAST_STALE_CATCHUP_KEY)?
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);

        let scan_history = self
            .get_meta(SCAN_HISTORY_KEY)?
            .map(|value| serde_json::from_str::<Vec<ScanDiagnostic>>(&value))
            .transpose()
            .map_err(|e| format!("Failed to read scan diagnostics: {}", e))?
            .unwrap_or_default();
        let scan_duration_recent_ms = scan_history.last().map(|scan| scan.total_ms);
        let scan_duration_median_ms = duration_median(&scan_history);
        let watcher_churn = self
            .get_meta(WATCHER_CHURN_KEY)?
            .map(|value| serde_json::from_str::<Vec<WatcherChurnDay>>(&value))
            .transpose()
            .map_err(|e| format!("Failed to read watcher diagnostics: {}", e))?
            .unwrap_or_default();

        Ok(IndexStats {
            indexed_count,
            db_size_bytes,
            last_full_scan,
            is_watching,
            stale_catchup_count,
            last_stale_catchup,
            scan_history,
            scan_duration_recent_ms,
            scan_duration_median_ms,
            watcher_churn,
        })
    }

    /// Add watcher event counts (`(root key, events)`) for `day`. One lock
    /// covers read/merge/write so concurrent callers cannot lose counts.
    pub fn record_watcher_events(&self, day: i64, counts: &[(String, u64)]) -> Result<(), String> {
        if counts.is_empty() {
            return Ok(());
        }
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM metadata WHERE key = ?1",
                params![WATCHER_CHURN_KEY],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to read watcher diagnostics: {}", e))?;
        // A corrupt blob is diagnostics only: restart the series.
        let mut history: Vec<WatcherChurnDay> = value
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default();
        merge_watcher_churn(&mut history, day, counts);
        let value = serde_json::to_string(&history)
            .map_err(|e| format!("Failed to serialize watcher diagnostics: {}", e))?;
        conn.execute("INSERT INTO metadata(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![WATCHER_CHURN_KEY, value])
            .map_err(|e| format!("Failed to persist watcher diagnostics: {}", e))?;
        Ok(())
    }

    /// Append after a successful SQLite replacement only. One connection lock
    /// covers the read/append/write so concurrent callers cannot lose samples.
    pub fn record_scan(&self, scan: ScanDiagnostic) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM metadata WHERE key = ?1",
                params![SCAN_HISTORY_KEY],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to read scan diagnostics: {}", e))?;
        let mut history: Vec<ScanDiagnostic> = value
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|e| format!("Failed to parse scan diagnostics: {}", e))?
            .unwrap_or_default();
        history.push(scan);
        if history.len() > SCAN_HISTORY_LIMIT {
            history.drain(..history.len() - SCAN_HISTORY_LIMIT);
        }
        let value = serde_json::to_string(&history)
            .map_err(|e| format!("Failed to serialize scan diagnostics: {}", e))?;
        conn.execute("INSERT INTO metadata(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![SCAN_HISTORY_KEY, value])
            .map_err(|e| format!("Failed to persist scan diagnostics: {}", e))?;
        Ok(())
    }

    /// Record a successful full scan timestamp.
    pub fn mark_full_scan(&self) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp().to_string();
        self.set_meta("last_full_scan", &now)
    }

    /// Record that an offline catch-up reconcile actually re-walked the index:
    /// bumps the persisted counter and stamps the timestamp, atomically under a
    /// single connection lock. This is the re-scan frequency telemetry that
    /// gate (2) of the D3/USN NO-GO needs — see `REFONTE-PILIER-D-SEARCH.md`.
    pub fn record_stale_catchup(&self) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        conn.execute(
            "INSERT INTO metadata(key, value) VALUES(?1, '1')
             ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)",
            params![STALE_CATCHUP_COUNT_KEY],
        )
        .map_err(|e| format!("Failed to bump stale-catchup counter: {}", e))?;

        let now = chrono::Utc::now().timestamp().to_string();
        conn.execute(
            "INSERT INTO metadata(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![LAST_STALE_CATCHUP_KEY, now],
        )
        .map_err(|e| format!("Failed to stamp stale-catchup timestamp: {}", e))?;

        Ok(())
    }
}

/// Metadata key: running count of offline catch-up reconciles.
const STALE_CATCHUP_COUNT_KEY: &str = "stale_catchup_count";
/// Metadata key: Unix timestamp of the last offline catch-up reconcile.
const LAST_STALE_CATCHUP_KEY: &str = "last_stale_catchup";
const SCAN_HISTORY_KEY: &str = "scan_history_v1";
const SCAN_HISTORY_LIMIT: usize = 50;
const WATCHER_CHURN_KEY: &str = "watcher_churn_v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_category(s: &str) -> FileCategory {
    // The stored value is the lowercase serde tag, e.g. "application", "game", …
    let json_str = format!("\"{}\"", s);
    serde_json::from_str::<FileCategory>(&json_str).unwrap_or_else(|_| {
        if !s.is_empty() {
            warn!("Unknown file category {:?} in DB; defaulting to Other", s);
        }
        FileCategory::default()
    })
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer::types::FileCategory;
    use tempfile::tempdir;

    fn make_file(name: &str, path: &str) -> FileInfo {
        FileInfo {
            id: crate::utils::hash_id(path),
            name: name.to_string(),
            path: path.to_string(),
            extension: name.rsplit('.').next().unwrap_or("").to_string(),
            size: 1024,
            modified: 1_700_000_000,
            created: None,
            accessed: None,
            icon: None,
            category: FileCategory::Document,
        }
    }

    fn make_scan(total_ms: u64) -> ScanDiagnostic {
        ScanDiagnostic {
            kind: ScanKind::Rebuild,
            completed_at: 1_700_000_000,
            scan_ms: total_ms / 2,
            persist_ms: total_ms / 2,
            total_ms,
            indexed_count: 4,
            root_count: 2,
            added: 1,
            removed: 1,
            modified: 1,
        }
    }

    #[test]
    fn scan_delta_ignores_access_times_and_counts_stable_metadata_changes() {
        let unchanged = make_file("unchanged.txt", "/private/unchanged.txt");
        let size_changed = make_file("size.txt", "/private/size.txt");
        let time_changed = make_file("time.txt", "/private/time.txt");
        let removed = make_file("removed.txt", "/private/removed.txt");
        let before = vec![
            unchanged.clone(),
            size_changed.clone(),
            time_changed.clone(),
            removed,
        ];
        let mut after = vec![
            unchanged,
            size_changed,
            time_changed,
            make_file("added.txt", "/private/added.txt"),
        ];
        after[0].accessed = Some(1234);
        after[0].icon = Some("transient-icon".to_string());
        after[1].size += 1;
        after[2].modified += 1;
        assert_eq!(snapshot_delta(&before, &after), (1, 1, 2));
        assert_eq!(snapshot_delta(&[], &after), (4, 0, 0));
        assert_eq!(snapshot_delta(&before, &[]), (0, 4, 0));
    }

    #[test]
    fn scan_history_is_bounded_persistent_and_contains_only_aggregate_data() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("diagnostics.db");
        let db = FileIndexDb::open(&db_path).unwrap();
        db.upsert_file(&make_file("secret.txt", "/private/customer/secret.txt"))
            .unwrap();
        for total_ms in 1..=55 {
            db.record_scan(make_scan(total_ms)).unwrap();
        }
        drop(db);
        let db = FileIndexDb::open(&db_path).unwrap();
        let stats = db.get_stats(false).unwrap();
        assert_eq!(stats.scan_history.len(), 50);
        assert_eq!(stats.scan_history.first().unwrap().total_ms, 6);
        assert_eq!(stats.scan_duration_recent_ms, Some(55));
        assert_eq!(stats.scan_duration_median_ms, Some(30));
        let stored = db.get_meta(SCAN_HISTORY_KEY).unwrap().unwrap();
        assert!(!stored.contains("private"));
        assert!(!stored.contains("secret.txt"));
        let wire = serde_json::to_value(stats).unwrap();
        let record = wire["scanHistory"][0].as_object().unwrap();
        let mut keys: Vec<_> = record.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "added",
                "completedAt",
                "indexedCount",
                "kind",
                "modified",
                "persistMs",
                "removed",
                "rootCount",
                "scanMs",
                "totalMs"
            ]
        );
    }

    #[test]
    fn watcher_churn_is_bounded_by_day_and_root_and_persists() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("churn.db");
        let db = FileIndexDb::open(&db_path).unwrap();
        let today = 20_000;
        // Older than the window: dropped at the next write.
        db.record_watcher_events(today - WATCHER_CHURN_DAYS, &[("a".into(), 5)])
            .unwrap();
        db.record_watcher_events(today - 1, &[("a".into(), 2)])
            .unwrap();
        db.record_watcher_events(today, &[("a".into(), 3), ("b".into(), 1)])
            .unwrap();
        db.record_watcher_events(today, &[("a".into(), 4)]).unwrap();
        let many: Vec<(String, u64)> = (0..30).map(|i| (format!("r{i:02}"), 1)).collect();
        db.record_watcher_events(today, &many).unwrap();
        drop(db);

        let stats = FileIndexDb::open(&db_path)
            .unwrap()
            .get_stats(false)
            .unwrap();
        let churn = stats.watcher_churn;
        assert!(churn.iter().all(|e| e.day > today - WATCHER_CHURN_DAYS));
        let todays: Vec<_> = churn.iter().filter(|e| e.day == today).collect();
        assert_eq!(todays.len(), WATCHER_CHURN_ROOTS_PER_DAY);
        assert_eq!(todays[0].root, "a");
        assert_eq!(todays[0].events, 7);
        let total: u64 = todays.iter().map(|e| e.events).sum();
        assert_eq!(total, 7 + 1 + 30, "folding keeps every event");
        assert_eq!(todays.last().unwrap().root, OTHER_ROOTS_KEY);
        assert_eq!(churn.iter().find(|e| e.day == today - 1).unwrap().events, 2);
    }

    #[test]
    fn root_diagnostic_key_is_stable_and_does_not_leak_the_path() {
        let dir = tempdir().unwrap();
        let key = root_diagnostic_key(dir.path());
        assert_eq!(key, root_diagnostic_key(dir.path()));
        assert_eq!(key.len(), 16);
        let name = dir
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(!key.contains(&name));
        assert_ne!(key, root_diagnostic_key(&dir.path().join("child")));
    }

    #[test]
    fn scan_median_handles_empty_even_odd_and_large_durations() {
        assert_eq!(duration_median(&[]), None);
        assert_eq!(
            duration_median(&[make_scan(50), make_scan(10), make_scan(30)]),
            Some(30)
        );
        assert_eq!(duration_median(&[make_scan(50), make_scan(10)]), Some(30));
        assert_eq!(
            duration_median(&[make_scan(u64::MAX), make_scan(u64::MAX)]),
            Some(u64::MAX)
        );
    }

    #[test]
    fn test_open_creates_db() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = FileIndexDb::open(&db_path).expect("should open");
        assert_eq!(db.count().unwrap(), 0);
    }

    #[test]
    fn test_upsert_and_count() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();

        let f = make_file("report.pdf", "/docs/report.pdf");
        db.upsert_file(&f).unwrap();
        assert_eq!(db.count().unwrap(), 1);

        // Upsert same path again – count should stay at 1
        db.upsert_file(&f).unwrap();
        assert_eq!(db.count().unwrap(), 1);
    }

    #[test]
    fn test_bulk_upsert() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();

        let files: Vec<FileInfo> = (0..100)
            .map(|i| make_file(&format!("file{}.txt", i), &format!("/data/file{}.txt", i)))
            .collect();

        db.upsert_files(&files).unwrap();
        assert_eq!(db.count().unwrap(), 100);
    }

    #[test]
    fn test_replace_files_removes_stale_rows() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();
        db.upsert_files(&[
            make_file("old.txt", "/tmp/old.txt"),
            make_file("keep.txt", "/tmp/keep.txt"),
        ])
        .unwrap();

        db.replace_files(&[make_file("keep.txt", "/tmp/keep.txt")])
            .unwrap();

        let files = db.get_all_files().unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "/tmp/keep.txt");
    }

    #[test]
    fn test_remove_file() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();

        let f = make_file("foo.txt", "/tmp/foo.txt");
        db.upsert_file(&f).unwrap();
        assert_eq!(db.count().unwrap(), 1);

        db.remove_file("/tmp/foo.txt").unwrap();
        assert_eq!(db.count().unwrap(), 0);
    }

    #[test]
    fn test_remove_path_tree_is_separator_safe() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();
        let tree = dir.path().join("game");
        let child = tree.join("saves").join("slot.txt");
        let sibling = dir.path().join("game-old").join("keep.txt");

        db.upsert_files(&[
            make_file("game", &tree.to_string_lossy()),
            make_file("slot.txt", &child.to_string_lossy()),
            make_file("keep.txt", &sibling.to_string_lossy()),
        ])
        .unwrap();

        let removed = db.remove_path_tree(&tree).unwrap();
        assert_eq!(removed.len(), 2);
        assert!(removed.contains(&tree.to_string_lossy().into_owned()));
        assert!(removed.contains(&child.to_string_lossy().into_owned()));

        let remaining = db.get_all_files().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].path, sibling.to_string_lossy().into_owned());
    }

    #[test]
    fn test_clear_all() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();

        let files = vec![
            make_file("a.txt", "/tmp/a.txt"),
            make_file("b.txt", "/tmp/b.txt"),
        ];
        db.upsert_files(&files).unwrap();
        assert_eq!(db.count().unwrap(), 2);

        db.clear_all().unwrap();
        assert_eq!(db.count().unwrap(), 0);
    }

    #[test]
    fn test_get_all_files_round_trip() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();

        let f = make_file("notes.txt", "/home/user/notes.txt");
        db.upsert_file(&f).unwrap();

        let all = db.get_all_files().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "notes.txt");
        assert_eq!(all[0].path, "/home/user/notes.txt");
    }

    #[test]
    fn test_meta_round_trip() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();

        assert!(db.get_meta("last_full_scan").unwrap().is_none());

        db.set_meta("last_full_scan", "1700000000").unwrap();
        assert_eq!(
            db.get_meta("last_full_scan").unwrap(),
            Some("1700000000".to_string())
        );
    }

    #[test]
    fn test_get_stats() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();

        db.upsert_file(&make_file("test.rs", "/src/test.rs"))
            .unwrap();
        db.mark_full_scan().unwrap();

        let stats = db.get_stats(false).unwrap();
        assert_eq!(stats.indexed_count, 1);
        assert!(stats.last_full_scan > 0);
        assert!(!stats.is_watching);
        // Never reconciled yet → telemetry starts at zero.
        assert_eq!(stats.stale_catchup_count, 0);
        assert_eq!(stats.last_stale_catchup, 0);
    }

    #[test]
    fn record_stale_catchup_increments_and_stamps() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();

        db.record_stale_catchup().unwrap();
        db.record_stale_catchup().unwrap();

        let stats = db.get_stats(false).unwrap();
        assert_eq!(stats.stale_catchup_count, 2);
        assert!(stats.last_stale_catchup > 0);
    }

    #[test]
    fn test_idempotent_open() {
        // Opening the same DB twice should not error
        let dir = tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let db = FileIndexDb::open(&path).unwrap();
            db.upsert_file(&make_file("x.txt", "/x.txt")).unwrap();
        }
        // Re-open – data should still be there
        let db2 = FileIndexDb::open(&path).unwrap();
        assert_eq!(db2.count().unwrap(), 1);
    }

    /// Regression (audit passe 2, sujet 1): the scanner's bulk `replace_files`
    /// transaction and the watcher's single-row `upsert_file` used to run on
    /// two SEPARATE SQLite connections to the same file, so under contention
    /// the watcher got `SQLITE_BUSY` ("database is locked") and DROPPED the
    /// mutation. Cloned `FileIndexDb` handles share one connection behind one
    /// mutex, so concurrent writers serialize instead of failing. This test
    /// hammers a shared handle from several threads behind a barrier and
    /// asserts zero lock errors and a coherent final count.
    #[test]
    fn shared_clone_serializes_concurrent_writers_without_busy() {
        use std::sync::{
            Barrier,
            atomic::{AtomicUsize, Ordering as AtomicOrdering},
        };

        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();
        // Seed so the replacer always has something to write.
        db.upsert_files(
            &(0..50)
                .map(|i| make_file(&format!("seed{i}.txt"), &format!("/s/seed{i}.txt")))
                .collect::<Vec<_>>(),
        )
        .unwrap();

        let busy_errors = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(5));
        let mut handles = Vec::new();

        // 4 single-row writers (watcher profile).
        for w in 0..4 {
            let db = db.clone();
            let barrier = Arc::clone(&barrier);
            let busy_errors = Arc::clone(&busy_errors);
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                for i in 0..50 {
                    let f = make_file(&format!("w{w}_{i}.txt"), &format!("/w{w}/{i}.txt"));
                    if let Err(e) = db.upsert_file(&f)
                        && (e.contains("locked") || e.contains("busy"))
                    {
                        busy_errors.fetch_add(1, AtomicOrdering::Relaxed);
                    }
                }
            }));
        }

        // 1 bulk replacer (scanner profile).
        {
            let db = db.clone();
            let barrier = Arc::clone(&barrier);
            let busy_errors = Arc::clone(&busy_errors);
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                for round in 0..5 {
                    let files: Vec<FileInfo> = (0..50)
                        .map(|i| {
                            make_file(&format!("r{round}_{i}.txt"), &format!("/r{round}/{i}.txt"))
                        })
                        .collect();
                    if let Err(e) = db.replace_files(&files)
                        && (e.contains("locked") || e.contains("busy"))
                    {
                        busy_errors.fetch_add(1, AtomicOrdering::Relaxed);
                    }
                }
            }));
        }

        for h in handles {
            h.join().expect("worker thread panicked");
        }

        assert_eq!(
            busy_errors.load(AtomicOrdering::Relaxed),
            0,
            "shared connection must never surface SQLITE_BUSY to same-process writers"
        );
        // The last replacer round wrote exactly 50 rows; single-row upserts
        // raced it, so the final count is >= 50 and every row is readable.
        let all = db.get_all_files().unwrap();
        assert!(
            all.len() >= 50,
            "final snapshot must be coherent, got {} rows",
            all.len()
        );
    }

    /// A failed DB mutation must never reach the in-memory layer alone. This
    /// pins the all-or-none ordering inside `flush_events` indirectly: here at
    /// the DB level, a write error is returned to the caller instead of being
    /// swallowed, so the caller can skip the cache/Tantivy half (see the
    /// watcher test `failed_db_mutation_leaves_cache_untouched`).
    #[test]
    fn write_error_is_surfaced_not_swallowed() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();
        // Drop the table out from under the handle: every write must now fail.
        db.conn
            .lock()
            .unwrap()
            .execute_batch("DROP TABLE files;")
            .unwrap();
        let err = db
            .upsert_file(&make_file("x.txt", "/x.txt"))
            .expect_err("write against a dropped table must fail");
        assert!(!err.is_empty());
    }
}
