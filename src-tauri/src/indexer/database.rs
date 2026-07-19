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
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::{debug, info, warn};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Statistics about the current SQLite index.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    /// Number of files currently in the index.
    pub indexed_count: usize,
    /// Rough size of the DB file on disk, in bytes.
    pub db_size_bytes: u64,
    /// Unix timestamp of the last full scan (0 = never).
    pub last_full_scan: i64,
    /// Whether the file watcher is currently active.
    pub is_watching: bool,
    /// Number of offline catch-up reconciles that have actually re-walked the
    /// index (the no-admin stand-in for a USN-journal drain). This is the
    /// re-scan telemetry feeding the D3/USN reconsideration — see
    /// `REFONTE-PILIER-D-SEARCH.md`.
    pub stale_catchup_count: i64,
    /// Unix timestamp of the most recent offline catch-up reconcile (0 = never).
    pub last_stale_catchup: i64,
}

// ---------------------------------------------------------------------------
// FileIndexDb
// ---------------------------------------------------------------------------

/// Thread-safe wrapper around a SQLite connection for file indexing.
pub struct FileIndexDb {
    conn: Arc<Mutex<Connection>>,
    db_path: std::path::PathBuf,
}

impl FileIndexDb {
    /// Open (or create) the SQLite database at `db_path` and run the
    /// `CREATE TABLE IF NOT EXISTS` migration.
    pub fn open(db_path: impl AsRef<Path>) -> Result<Self, String> {
        let db_path = db_path.as_ref().to_path_buf();
        let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;

        // Enable WAL mode for better concurrent read performance.
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
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

    /// Fuzzy-ish search directly in SQLite using a `LIKE` filter.
    /// Not on the hot path (we use in-memory nucleo ranking); kept as a utility.
    #[allow(dead_code)]
    pub fn search_files(&self, query: &str, limit: usize) -> Result<Vec<FileInfo>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {}", e))?;

        let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));

        let mut stmt = conn
            .prepare(
                "SELECT path, name, extension, size, modified_at, category
                 FROM files
                 WHERE name LIKE ?1 ESCAPE '\\'
                 ORDER BY name
                 LIMIT ?2",
            )
            .map_err(|e| format!("Failed to prepare search: {}", e))?;

        let files = stmt
            .query_map(params![pattern, limit as i64], |row| {
                let path: String = row.get(0)?;
                let name: String = row.get(1)?;
                let extension: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
                let size: i64 = row.get::<_, Option<i64>>(3)?.unwrap_or(0);
                let modified: i64 = row.get::<_, Option<i64>>(4)?.unwrap_or(0);
                let category_str: String = row.get::<_, Option<String>>(5)?.unwrap_or_default();

                Ok((path, name, extension, size, modified, category_str))
            })
            .map_err(|e| format!("Failed to execute search: {}", e))?
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

        Ok(IndexStats {
            indexed_count,
            db_size_bytes,
            last_full_scan,
            is_watching,
            stale_catchup_count,
            last_stale_catchup,
        })
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
    fn test_search_files_like() {
        let dir = tempdir().unwrap();
        let db = FileIndexDb::open(dir.path().join("t.db")).unwrap();

        db.upsert_files(&[
            make_file("report.pdf", "/docs/report.pdf"),
            make_file("invoice.pdf", "/docs/invoice.pdf"),
            make_file("photo.jpg", "/pics/photo.jpg"),
        ])
        .unwrap();

        let results = db.search_files("report", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "report.pdf");
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
}
