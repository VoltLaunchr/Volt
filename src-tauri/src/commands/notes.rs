//! Notes management commands.
//!
//! SQLite-backed CRUD + FTS5 full-text search for user notes. Notes live in
//! `<app_data_dir>/notes.db`. The schema is auto-created on first open and
//! versioned via a `schema_version` table so future migrations can branch off.
//!
//! Soft delete: `deleted_at` is set on delete; rows can be restored or hard-
//! deleted via `empty_trash` (which removes ALL trashed notes). A separate
//! `purge_old_trashed(retention_days)` helper is exposed for an app-startup
//! retention sweep (default 30 days) and is intentionally NOT a Tauri command.
//!
//! The `note_chunks` table is created here but never written from this module —
//! it is reserved for the future embedding pipeline (Agent 4 will populate it).
//!
//! All command logic lives in inherent methods on `NoteState` so tests can call
//! them directly without spinning up a `tauri::test::mock_app()` (which would
//! require enabling the `tauri/test` Cargo feature globally).

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use tracing::{debug, info};
use uuid::Uuid;

use crate::core::error::{VoltError, VoltResult};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A user note. `content` is markdown. `tags` is serialized as a JSON array in
/// SQLite (string column) and exposed as a `Vec<String>` to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub accessed_at: i64,
    pub access_count: u32,
    /// `None` = active, `Some(ts)` = soft-deleted at `ts` (millis).
    pub deleted_at: Option<i64>,
}

/// A single search hit returned by `search_notes`. `score` is the negated FTS5
/// `bm25` rank (so higher = more relevant for the frontend); `snippet` is the
/// HTML-marked excerpt (`<mark>…</mark>`) returned by FTS5's `snippet()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHit {
    pub note: Note,
    pub score: f32,
    pub snippet: String,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Thread-safe wrapper around the notes SQLite connection.
pub struct NoteState {
    conn: Mutex<Connection>,
}

const CURRENT_SCHEMA_VERSION: i64 = 1;

impl NoteState {
    /// Open (or create) the notes database under `data_dir`. The directory is
    /// created if missing. The schema is migrated up to
    /// `CURRENT_SCHEMA_VERSION`.
    pub fn new(data_dir: PathBuf) -> VoltResult<Self> {
        if !data_dir.exists() {
            std::fs::create_dir_all(&data_dir).map_err(VoltError::from)?;
        }
        let db_path = data_dir.join("notes.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| VoltError::Unknown(format!("Failed to open notes DB: {}", e)))?;

        Self::configure(&conn)?;
        Self::migrate(&conn)?;

        info!("Notes database opened at {:?}", db_path);

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open an in-memory notes database. Used by tests to avoid touching disk.
    #[cfg(test)]
    pub fn in_memory() -> VoltResult<Self> {
        let conn = Connection::open_in_memory()
            .map_err(|e| VoltError::Unknown(format!("Failed to open in-memory DB: {}", e)))?;
        Self::configure(&conn)?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn configure(conn: &Connection) -> VoltResult<()> {
        // WAL mode is meaningless for `:memory:` but harmless — sqlite silently
        // ignores it in that case. `foreign_keys=ON` is required for the
        // `note_chunks` ON DELETE CASCADE to actually fire.
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
        )
        .map_err(|e| VoltError::Unknown(format!("Failed to set PRAGMAs: {}", e)))?;
        Ok(())
    }

    /// Apply schema migrations idempotently. The current schema version lives
    /// in a single-row `schema_version` table; future migrations should branch
    /// off it.
    fn migrate(conn: &Connection) -> VoltResult<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL PRIMARY KEY
            );",
        )
        .map_err(|e| VoltError::Unknown(format!("Failed to ensure schema_version: {}", e)))?;

        let current: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |r| r.get(0),
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to read schema_version: {}", e)))?;

        if current >= CURRENT_SCHEMA_VERSION {
            return Ok(());
        }

        // v0 -> v1: initial schema.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '[]',
                pinned INTEGER NOT NULL DEFAULT 0,
                color TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                accessed_at INTEGER NOT NULL,
                access_count INTEGER NOT NULL DEFAULT 0,
                deleted_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at);
            CREATE INDEX IF NOT EXISTS idx_notes_pinned_updated
                ON notes(pinned DESC, updated_at DESC);

            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                title, content, tags,
                content='notes',
                content_rowid='rowid',
                tokenize='unicode61 remove_diacritics 2'
            );

            -- FTS5 sync triggers. We mirror notes -> notes_fts, but skip rows
            -- whose `deleted_at` is set so search never returns trashed notes.
            CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes
                WHEN new.deleted_at IS NULL
            BEGIN
                INSERT INTO notes_fts(rowid, title, content, tags)
                    VALUES (new.rowid, new.title, new.content, new.tags);
            END;

            -- Only emit a FTS5 'delete' command for rows that were actually in
            -- the index (i.e. not trashed). Issuing 'delete' for a row that the
            -- FTS5 contentless index doesn't have corrupts the index with
            -- "database disk image is malformed" — see notes_au below for the
            -- same constraint on the UPDATE path.
            CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes
                WHEN old.deleted_at IS NULL
            BEGIN
                INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
                    VALUES('delete', old.rowid, old.title, old.content, old.tags);
            END;

            CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
                -- Only remove from FTS if the OLD row was actually indexed
                -- (i.e. wasn't trashed). Restoring a trashed note would
                -- otherwise try to delete an absent FTS row and corrupt it.
                INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
                    SELECT 'delete', old.rowid, old.title, old.content, old.tags
                    WHERE old.deleted_at IS NULL;
                INSERT INTO notes_fts(rowid, title, content, tags)
                    SELECT new.rowid, new.title, new.content, new.tags
                    WHERE new.deleted_at IS NULL;
            END;

            -- TODO(notes): Agent 4 will populate `embedding` (float32 * 384) for
            -- semantic search; until then this table is empty.
            CREATE TABLE IF NOT EXISTS note_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                chunk_idx INTEGER NOT NULL,
                text TEXT NOT NULL,
                embedding BLOB,
                embedded_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_note_chunks_note_id ON note_chunks(note_id);
            "#,
        )
        .map_err(|e| VoltError::Unknown(format!("Failed to apply schema v1: {}", e)))?;

        conn.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            params![CURRENT_SCHEMA_VERSION],
        )
        .map_err(|e| VoltError::Unknown(format!("Failed to record schema version: {}", e)))?;

        info!("Notes schema migrated to v{}", CURRENT_SCHEMA_VERSION);
        Ok(())
    }

    fn lock(&self) -> VoltResult<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|e| VoltError::Unknown(format!("Notes DB lock poisoned: {}", e)))
    }

    // -----------------------------------------------------------------------
    // Inherent CRUD — the Tauri commands below are thin wrappers over these.
    // Keeping the logic on `NoteState` lets unit tests call them directly,
    // bypassing the `tauri::State` machinery (which would require enabling the
    // `tauri/test` Cargo feature).
    // -----------------------------------------------------------------------

    /// List all active notes (not in trash), ordered by `pinned DESC` then by
    /// `accessed_at DESC` (frecency proxy).
    pub fn list_active(&self) -> VoltResult<Vec<Note>> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, content, tags, pinned, color, created_at, updated_at,
                        accessed_at, access_count, deleted_at
                 FROM notes
                 WHERE deleted_at IS NULL
                 ORDER BY pinned DESC, accessed_at DESC",
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to prepare list_active: {}", e)))?;

        let notes: Vec<Note> = stmt
            .query_map([], row_to_note)
            .map_err(|e| VoltError::Unknown(format!("Failed to query notes: {}", e)))?
            .filter_map(Result::ok)
            .collect();

        Ok(notes)
    }

    /// Fetch a single note by id and bump its access counters atomically.
    /// Returns `None` for trashed or missing notes — the UI should treat both
    /// as "gone".
    pub fn get_one(&self, id: &str) -> VoltResult<Option<Note>> {
        let mut conn = self.lock()?;
        let now = now_millis();
        let tx = conn
            .transaction()
            .map_err(|e| VoltError::Unknown(format!("Failed to begin tx: {}", e)))?;

        let updated = tx
            .execute(
                "UPDATE notes SET accessed_at = ?1, access_count = access_count + 1
                 WHERE id = ?2 AND deleted_at IS NULL",
                params![now, id],
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to bump access: {}", e)))?;

        if updated == 0 {
            tx.commit()
                .map_err(|e| VoltError::Unknown(format!("Failed to commit tx: {}", e)))?;
            return Ok(None);
        }

        let note = tx
            .query_row(
                "SELECT id, title, content, tags, pinned, color, created_at, updated_at,
                        accessed_at, access_count, deleted_at
                 FROM notes WHERE id = ?1",
                params![id],
                row_to_note,
            )
            .optional()
            .map_err(|e| VoltError::Unknown(format!("Failed to fetch note: {}", e)))?;

        tx.commit()
            .map_err(|e| VoltError::Unknown(format!("Failed to commit tx: {}", e)))?;

        Ok(note)
    }

    /// List trashed notes, most-recently-trashed first.
    pub fn list_trash(&self) -> VoltResult<Vec<Note>> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, content, tags, pinned, color, created_at, updated_at,
                        accessed_at, access_count, deleted_at
                 FROM notes
                 WHERE deleted_at IS NOT NULL
                 ORDER BY deleted_at DESC",
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to prepare list_trash: {}", e)))?;

        let notes: Vec<Note> = stmt
            .query_map([], row_to_note)
            .map_err(|e| VoltError::Unknown(format!("Failed to query trash: {}", e)))?
            .filter_map(Result::ok)
            .collect();

        Ok(notes)
    }

    /// Create a new note with optional initial content.
    pub fn insert(
        &self,
        title: Option<String>,
        content: Option<String>,
        tags: Option<Vec<String>>,
    ) -> VoltResult<Note> {
        let now = now_millis();
        let note = Note {
            id: Uuid::new_v4().to_string(),
            title: title.unwrap_or_default(),
            content: content.unwrap_or_default(),
            tags: tags.unwrap_or_default(),
            pinned: false,
            color: None,
            created_at: now,
            updated_at: now,
            accessed_at: now,
            access_count: 0,
            deleted_at: None,
        };

        let tags_json = tags_to_json(&note.tags)?;

        {
            let conn = self.lock()?;
            conn.execute(
                "INSERT INTO notes (id, title, content, tags, pinned, color,
                                    created_at, updated_at, accessed_at, access_count, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL)",
                params![
                    note.id,
                    note.title,
                    note.content,
                    tags_json,
                    note.pinned as i64,
                    note.color,
                    note.created_at,
                    note.updated_at,
                    note.accessed_at,
                    note.access_count as i64,
                ],
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to insert note: {}", e)))?;
        }

        debug!("Created note {}", note.id);
        Ok(note)
    }

    /// Partial patch — `None` means "leave unchanged". Bumps `updated_at`.
    /// Refuses to update a trashed note (returns `NotFound`).
    pub fn patch(
        &self,
        id: &str,
        title: Option<String>,
        content: Option<String>,
        tags: Option<Vec<String>>,
        pinned: Option<bool>,
        color: Option<String>,
    ) -> VoltResult<Note> {
        let mut conn = self.lock()?;
        let tx = conn
            .transaction()
            .map_err(|e| VoltError::Unknown(format!("Failed to begin tx: {}", e)))?;

        let mut existing: Note = tx
            .query_row(
                "SELECT id, title, content, tags, pinned, color, created_at, updated_at,
                        accessed_at, access_count, deleted_at
                 FROM notes WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                row_to_note,
            )
            .optional()
            .map_err(|e| VoltError::Unknown(format!("Failed to fetch note: {}", e)))?
            .ok_or_else(|| VoltError::NotFound(format!("Note not found: {}", id)))?;

        if let Some(t) = title {
            existing.title = t;
        }
        if let Some(c) = content {
            existing.content = c;
        }
        if let Some(t) = tags {
            existing.tags = t;
        }
        if let Some(p) = pinned {
            existing.pinned = p;
        }
        if let Some(c) = color {
            existing.color = Some(c);
        }
        existing.updated_at = now_millis();

        let tags_json = tags_to_json(&existing.tags)?;

        tx.execute(
            "UPDATE notes
             SET title = ?1, content = ?2, tags = ?3, pinned = ?4, color = ?5, updated_at = ?6
             WHERE id = ?7",
            params![
                existing.title,
                existing.content,
                tags_json,
                existing.pinned as i64,
                existing.color,
                existing.updated_at,
                existing.id,
            ],
        )
        .map_err(|e| VoltError::Unknown(format!("Failed to update note: {}", e)))?;

        tx.commit()
            .map_err(|e| VoltError::Unknown(format!("Failed to commit tx: {}", e)))?;

        Ok(existing)
    }

    /// Soft-delete a note. Returns `NotFound` if the note is already trashed
    /// or doesn't exist.
    pub fn soft_delete(&self, id: &str) -> VoltResult<()> {
        let conn = self.lock()?;
        let now = now_millis();
        let updated = conn
            .execute(
                "UPDATE notes SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
                params![now, id],
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to soft-delete note: {}", e)))?;

        if updated == 0 {
            return Err(VoltError::NotFound(format!("Note not found: {}", id)));
        }
        Ok(())
    }

    /// Restore a trashed note (clears `deleted_at`). Returns `NotFound` if no
    /// trashed note matches the id.
    pub fn restore(&self, id: &str) -> VoltResult<Note> {
        let conn = self.lock()?;
        let updated = conn
            .execute(
                "UPDATE notes SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
                params![id],
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to restore note: {}", e)))?;

        if updated == 0 {
            return Err(VoltError::NotFound(format!(
                "Trashed note not found: {}",
                id
            )));
        }

        let note: Note = conn
            .query_row(
                "SELECT id, title, content, tags, pinned, color, created_at, updated_at,
                        accessed_at, access_count, deleted_at
                 FROM notes WHERE id = ?1",
                params![id],
                row_to_note,
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to fetch restored note: {}", e)))?;

        Ok(note)
    }

    /// Hard-delete every note currently in the trash. Returns the count
    /// removed. (Use `purge_old_trashed` from app startup for the time-windowed
    /// cleanup.)
    pub fn empty_trash_all(&self) -> VoltResult<usize> {
        let conn = self.lock()?;
        let removed = conn
            .execute("DELETE FROM notes WHERE deleted_at IS NOT NULL", [])
            .map_err(|e| VoltError::Unknown(format!("Failed to empty trash: {}", e)))?;
        info!("Emptied {} note(s) from trash", removed);
        Ok(removed)
    }

    /// Hard-delete trashed notes older than `retention_days`. Intended for an
    /// app-startup retention sweep. NOT exposed as a Tauri command — keeps the
    /// "user empties trash" UX explicit.
    #[allow(dead_code)] // wired in by the app-startup task in a follow-up
    pub fn purge_old_trashed(&self, retention_days: i64) -> VoltResult<usize> {
        let conn = self.lock()?;
        let cutoff = now_millis() - retention_days * 24 * 60 * 60 * 1000;
        let removed = conn
            .execute(
                "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
                params![cutoff],
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to purge trash: {}", e)))?;
        if removed > 0 {
            info!("Purged {} note(s) older than {}d", removed, retention_days);
        }
        Ok(removed)
    }

    /// FTS5 search across active notes. Title/tags weighted above content via
    /// `bm25(notes_fts, 3.0, 1.0, 2.0)`.
    pub fn search(&self, query: &str, limit: usize) -> VoltResult<Vec<NoteHit>> {
        let sanitized = sanitize_fts_query(query);
        if sanitized.is_empty() {
            return Ok(Vec::new());
        }

        let cap = limit.clamp(1, 100);

        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT n.id, n.title, n.content, n.tags, n.pinned, n.color,
                        n.created_at, n.updated_at, n.accessed_at, n.access_count, n.deleted_at,
                        bm25(notes_fts, 3.0, 1.0, 2.0) AS rank,
                        snippet(notes_fts, 1, '<mark>', '</mark>', '...', 32) AS snip
                 FROM notes_fts
                 JOIN notes n ON n.rowid = notes_fts.rowid
                 WHERE notes_fts MATCH ?1 AND n.deleted_at IS NULL
                 ORDER BY rank ASC
                 LIMIT ?2",
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to prepare search: {}", e)))?;

        let hits: Vec<NoteHit> = stmt
            .query_map(params![sanitized, cap as i64], |row| {
                let note = row_to_note(row)?;
                let rank: f64 = row.get("rank")?;
                let snip: String = row.get("snip")?;
                Ok(NoteHit {
                    note,
                    score: -rank as f32,
                    snippet: snip,
                })
            })
            .map_err(|e| VoltError::Unknown(format!("Failed to execute search: {}", e)))?
            .filter_map(Result::ok)
            .collect();

        Ok(hits)
    }

    /// Pretty-printed JSON dump of all active notes (trashed excluded).
    pub fn export_all(&self) -> VoltResult<String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, content, tags, pinned, color, created_at, updated_at,
                        accessed_at, access_count, deleted_at
                 FROM notes
                 WHERE deleted_at IS NULL",
            )
            .map_err(|e| VoltError::Unknown(format!("Failed to prepare export: {}", e)))?;

        let notes: Vec<Note> = stmt
            .query_map([], row_to_note)
            .map_err(|e| VoltError::Unknown(format!("Failed to query notes: {}", e)))?
            .filter_map(Result::ok)
            .collect();

        serde_json::to_string_pretty(&notes)
            .map_err(|e| VoltError::Serialization(format!("Failed to serialize notes: {}", e)))
    }

    /// Import notes from a JSON string. Caps the input size (5 MB) and count
    /// (10_000) — mirrors `import_snippets`. Regenerates UUIDs to avoid PK
    /// collisions with existing notes.
    pub fn import_json(&self, json: &str) -> VoltResult<usize> {
        const MAX_NOTES_JSON_BYTES: usize = 5 * 1024 * 1024;
        const MAX_NOTE_COUNT: usize = 10_000;

        if json.len() > MAX_NOTES_JSON_BYTES {
            return Err(VoltError::InvalidConfig(format!(
                "notes JSON too large: {} bytes (max {})",
                json.len(),
                MAX_NOTES_JSON_BYTES
            )));
        }

        let imported: Vec<Note> = serde_json::from_str(json)
            .map_err(|e| VoltError::Serialization(format!("Invalid notes JSON: {}", e)))?;

        if imported.len() > MAX_NOTE_COUNT {
            return Err(VoltError::InvalidConfig(format!(
                "too many notes in import: {} (max {})",
                imported.len(),
                MAX_NOTE_COUNT
            )));
        }

        let count = imported.len();
        let now = now_millis();

        let mut conn = self.lock()?;
        let tx = conn
            .transaction()
            .map_err(|e| VoltError::Unknown(format!("Failed to begin import tx: {}", e)))?;

        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO notes (id, title, content, tags, pinned, color,
                                        created_at, updated_at, accessed_at, access_count, deleted_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                )
                .map_err(|e| VoltError::Unknown(format!("Failed to prepare import: {}", e)))?;

            for mut note in imported {
                // Regen UUID to avoid PK collisions on re-import / merge.
                note.id = Uuid::new_v4().to_string();
                note.updated_at = now;
                // Imported notes never come in pre-trashed.
                note.deleted_at = None;

                let tags_json = tags_to_json(&note.tags)?;
                stmt.execute(params![
                    note.id,
                    note.title,
                    note.content,
                    tags_json,
                    note.pinned as i64,
                    note.color,
                    note.created_at,
                    note.updated_at,
                    note.accessed_at,
                    note.access_count as i64,
                    Option::<i64>::None,
                ])
                .map_err(|e| {
                    VoltError::Unknown(format!("Failed to insert imported note: {}", e))
                })?;
            }
        }

        tx.commit()
            .map_err(|e| VoltError::Unknown(format!("Failed to commit import tx: {}", e)))?;

        info!("Imported {} notes", count);
        Ok(count)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn tags_to_json(tags: &[String]) -> VoltResult<String> {
    serde_json::to_string(tags)
        .map_err(|e| VoltError::Serialization(format!("Failed to serialize tags: {}", e)))
}

fn tags_from_json(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

/// Map a row from the `notes` table (full column list) into a `Note`.
fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    let tags_str: String = row.get("tags")?;
    let pinned_int: i64 = row.get("pinned")?;
    let access_count_int: i64 = row.get("access_count")?;
    Ok(Note {
        id: row.get("id")?,
        title: row.get("title")?,
        content: row.get("content")?,
        tags: tags_from_json(&tags_str),
        pinned: pinned_int != 0,
        color: row.get("color")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        accessed_at: row.get("accessed_at")?,
        access_count: access_count_int.clamp(0, u32::MAX as i64) as u32,
        deleted_at: row.get("deleted_at")?,
    })
}

/// FTS5 has a small grammar (AND/OR/NEAR/quoted phrases/column filters). User
/// text can easily contain characters that turn the query into a syntax error
/// (`"`, `*`, `(`, `:`, `-`, `^`...). We strip the dangerous ones and quote
/// each remaining token, then OR them together. This trades grammar power for
/// "never crashes on user input".
fn sanitize_fts_query(query: &str) -> String {
    let cleaned: String = query
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() || c == '-' || c == '_' {
                c
            } else {
                ' '
            }
        })
        .collect();

    let tokens: Vec<String> = cleaned
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect();

    tokens.join(" OR ")
}

// ---------------------------------------------------------------------------
// Tauri commands — thin wrappers over `NoteState` methods.
// ---------------------------------------------------------------------------

/// List active notes (not in trash). Pinned first, then by `accessed_at DESC`.
#[tauri::command]
pub async fn get_notes(state: State<'_, NoteState>) -> VoltResult<Vec<Note>> {
    state.list_active()
}

/// Fetch a single note and bump its access counters. Returns `None` for
/// trashed/missing.
#[tauri::command]
pub async fn get_note(state: State<'_, NoteState>, id: String) -> VoltResult<Option<Note>> {
    state.get_one(&id)
}

/// List trashed notes, most-recently-trashed first.
#[tauri::command]
pub async fn get_trash(state: State<'_, NoteState>) -> VoltResult<Vec<Note>> {
    state.list_trash()
}

/// Create a new note. All inputs optional.
#[tauri::command]
pub async fn create_note(
    state: State<'_, NoteState>,
    title: Option<String>,
    content: Option<String>,
    tags: Option<Vec<String>>,
) -> VoltResult<Note> {
    state.insert(title, content, tags)
}

/// Partial update — `None` fields remain unchanged.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_note(
    state: State<'_, NoteState>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    tags: Option<Vec<String>>,
    pinned: Option<bool>,
    color: Option<String>,
) -> VoltResult<Note> {
    state.patch(&id, title, content, tags, pinned, color)
}

/// Soft-delete a note (moves to trash).
#[tauri::command]
pub async fn delete_note(state: State<'_, NoteState>, id: String) -> VoltResult<()> {
    state.soft_delete(&id)
}

/// Restore a trashed note.
#[tauri::command]
pub async fn restore_note(state: State<'_, NoteState>, id: String) -> VoltResult<Note> {
    state.restore(&id)
}

/// Hard-delete every note in the trash. Returns the count removed.
#[tauri::command]
pub async fn empty_trash(state: State<'_, NoteState>) -> VoltResult<usize> {
    state.empty_trash_all()
}

/// Full-text search via FTS5. `limit` defaults to 20, capped at 100.
#[tauri::command]
pub async fn search_notes(
    state: State<'_, NoteState>,
    query: String,
    limit: Option<usize>,
) -> VoltResult<Vec<NoteHit>> {
    state.search(&query, limit.unwrap_or(20))
}

/// Pretty-printed JSON dump of all active notes.
#[tauri::command]
pub async fn export_notes(state: State<'_, NoteState>) -> VoltResult<String> {
    state.export_all()
}

/// Import notes from JSON. Caps: 5 MB / 10_000 notes. Regenerates UUIDs.
#[tauri::command]
pub async fn import_notes(state: State<'_, NoteState>, json: String) -> VoltResult<usize> {
    state.import_json(&json)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Open an in-memory `NoteState`. All tests use this — no disk, no Tauri
    /// `mock_app` (which would require `tauri/test` feature globally).
    fn test_state() -> NoteState {
        NoteState::in_memory().expect("in-memory NoteState must succeed")
    }

    /// Direct SQL insert bypassing the command layer — used to seed time-
    /// sensitive fixtures (custom `accessed_at`, pre-trashed rows).
    #[allow(clippy::too_many_arguments)] // 1-to-1 mirror of the notes table columns we care about
    fn raw_insert(
        state: &NoteState,
        id: &str,
        title: &str,
        content: &str,
        access_count: u32,
        accessed_at: i64,
        deleted_at: Option<i64>,
        pinned: bool,
    ) {
        let conn = state.conn.lock().expect("lock");
        let now = now_millis();
        conn.execute(
            "INSERT INTO notes (id, title, content, tags, pinned, color,
                                created_at, updated_at, accessed_at, access_count, deleted_at)
             VALUES (?1, ?2, ?3, '[]', ?4, NULL, ?5, ?5, ?6, ?7, ?8)",
            params![
                id,
                title,
                content,
                pinned as i64,
                now,
                accessed_at,
                access_count as i64,
                deleted_at,
            ],
        )
        .expect("raw_insert");
    }

    // -----------------------------------------------------------------------

    #[test]
    fn test_schema_creates_tables() {
        let state = test_state();
        let conn = state.conn.lock().unwrap();

        let names: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type IN ('table','trigger','index')
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        for required in [
            "notes",
            "notes_fts",
            "note_chunks",
            "schema_version",
            "idx_notes_deleted_at",
            "idx_notes_pinned_updated",
            "idx_note_chunks_note_id",
            "notes_ai",
            "notes_au",
            "notes_ad",
        ] {
            assert!(
                names.iter().any(|n| n == required),
                "missing schema object: {required} (have: {names:?})"
            );
        }

        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_schema_migration_idempotent() {
        // Re-running migrate() must not error and must keep data.
        let state = test_state();
        raw_insert(&state, "n1", "hello", "world", 0, now_millis(), None, false);
        // Run migrate a second time — should bail early.
        {
            let conn = state.conn.lock().unwrap();
            NoteState::migrate(&conn).expect("re-migrate idempotent");
        }
        let count: i64 = state
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_create_get_note() {
        let state = test_state();
        let created = state
            .insert(
                Some("title".into()),
                Some("body".into()),
                Some(vec!["a".into(), "b".into()]),
            )
            .unwrap();
        assert_eq!(created.title, "title");
        assert_eq!(created.content, "body");
        assert_eq!(created.tags, vec!["a", "b"]);
        assert!(created.deleted_at.is_none());
        assert_eq!(created.access_count, 0);

        // get bumps access count
        let fetched = state.get_one(&created.id).unwrap().expect("present");
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.access_count, 1);

        // second get bumps again
        let fetched2 = state.get_one(&created.id).unwrap().expect("present");
        assert_eq!(fetched2.access_count, 2);

        // missing id returns None
        assert!(state.get_one("nonexistent").unwrap().is_none());
    }

    #[test]
    fn test_update_partial_patch() {
        let state = test_state();
        let created = state
            .insert(
                Some("orig title".into()),
                Some("orig body".into()),
                Some(vec!["t1".into()]),
            )
            .unwrap();

        // Patch only the title; everything else must remain.
        let updated = state
            .patch(
                &created.id,
                Some("new title".into()),
                None,
                None,
                None,
                None,
            )
            .unwrap();

        assert_eq!(updated.title, "new title");
        assert_eq!(updated.content, "orig body");
        assert_eq!(updated.tags, vec!["t1"]);
        assert!(!updated.pinned);
        assert!(updated.color.is_none());
        assert!(
            updated.updated_at >= created.updated_at,
            "updated_at must bump"
        );
    }

    #[test]
    fn test_soft_delete_filters_get_notes() {
        let state = test_state();
        let a = state.insert(Some("keep".into()), None, None).unwrap();
        let b = state.insert(Some("trash me".into()), None, None).unwrap();

        state.soft_delete(&b.id).unwrap();

        // get_notes excludes soft-deleted
        let active = state.list_active().unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, a.id);

        // get_trash includes only soft-deleted
        let trash = state.list_trash().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].id, b.id);
        assert!(trash[0].deleted_at.is_some());

        // double-deleting returns NotFound
        let err = state.soft_delete(&b.id).unwrap_err();
        assert!(matches!(err, VoltError::NotFound(_)));
    }

    #[test]
    fn test_restore_note() {
        let state = test_state();
        let n = state.insert(Some("alive".into()), None, None).unwrap();
        state.soft_delete(&n.id).unwrap();
        assert_eq!(state.list_active().unwrap().len(), 0);

        let restored = state.restore(&n.id).unwrap();
        assert!(restored.deleted_at.is_none());
        assert_eq!(restored.id, n.id);

        // Now it's back in the active list
        assert_eq!(state.list_active().unwrap().len(), 1);
        assert_eq!(state.list_trash().unwrap().len(), 0);

        // Restoring a non-trashed note fails
        let err = state.restore(&n.id).unwrap_err();
        assert!(matches!(err, VoltError::NotFound(_)));
    }

    #[test]
    fn test_empty_trash() {
        let state = test_state();
        let now = now_millis();
        // Three notes in trash with varying deleted_at timestamps.
        raw_insert(
            &state,
            "old",
            "old",
            "",
            0,
            now,
            Some(now - 60 * 86400 * 1000),
            false,
        );
        raw_insert(
            &state,
            "mid",
            "mid",
            "",
            0,
            now,
            Some(now - 5 * 86400 * 1000),
            false,
        );
        raw_insert(&state, "new", "new", "", 0, now, Some(now - 60_000), false);
        // One active note, must NOT be touched.
        raw_insert(&state, "active", "active", "", 0, now, None, false);

        let removed = state.empty_trash_all().unwrap();
        assert_eq!(removed, 3, "every trashed note removed regardless of age");

        // Active note still present.
        let active = state.list_active().unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "active");
        assert!(state.list_trash().unwrap().is_empty());
    }

    #[test]
    fn test_purge_old_trashed_30_days() {
        // Verify the startup-cleanup helper respects the retention window.
        let state = test_state();
        let now = now_millis();
        let one_day_ms = 86_400_000;
        raw_insert(
            &state,
            "old",
            "old",
            "",
            0,
            now,
            Some(now - 31 * one_day_ms),
            false,
        );
        raw_insert(
            &state,
            "fresh",
            "fresh",
            "",
            0,
            now,
            Some(now - 5 * one_day_ms),
            false,
        );
        raw_insert(&state, "active", "active", "", 0, now, None, false);

        let removed = state.purge_old_trashed(30).unwrap();
        assert_eq!(removed, 1);

        let trash = state.list_trash().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].id, "fresh");
    }

    #[test]
    fn test_search_notes_title_boost() {
        // Title weight is 3.0, content weight 1.0 — so a note with the query
        // term in its title MUST outrank a note where the same term only
        // appears in the body.
        let state = test_state();
        state
            .insert(
                Some("alpha".into()),
                Some("nothing relevant here".into()),
                None,
            )
            .unwrap();
        state
            .insert(
                Some("beta".into()),
                Some("the word alpha appears in the content".into()),
                None,
            )
            .unwrap();

        let hits = state.search("alpha", 20).unwrap();
        assert_eq!(hits.len(), 2, "both notes must match");
        assert_eq!(
            hits[0].note.title, "alpha",
            "title-match must rank first via bm25 weighting"
        );
    }

    #[test]
    fn test_search_fts5_diacritics() {
        let state = test_state();
        state
            .insert(
                Some("Réunion d'équipe".into()),
                Some("Préparer l'ordre du jour".into()),
                None,
            )
            .unwrap();

        // unicode61 + remove_diacritics 2 => "reunion" matches "Réunion"
        let hits = state.search("reunion", 20).unwrap();
        assert_eq!(hits.len(), 1, "diacritic-stripped query must match");

        let hits = state.search("equipe", 20).unwrap();
        assert_eq!(hits.len(), 1, "diacritic-stripped query must match");
    }

    #[test]
    fn test_search_returns_snippet_with_mark() {
        let state = test_state();
        state
            .insert(
                Some("doc".into()),
                Some("hello world this is a test".into()),
                None,
            )
            .unwrap();

        let hits = state.search("hello", 20).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(
            hits[0].snippet.contains("<mark>"),
            "snippet must wrap matches in <mark>: got {}",
            hits[0].snippet
        );
    }

    #[test]
    fn test_search_default_limit_and_cap() {
        // Limit clamps to 100 and 0 inputs round up to 1.
        let state = test_state();
        for i in 0..5 {
            state
                .insert(Some(format!("n{i}")), Some("alpha".into()), None)
                .unwrap();
        }
        // Cap of 2 must return exactly 2.
        let hits = state.search("alpha", 2).unwrap();
        assert_eq!(hits.len(), 2);

        // Empty / whitespace queries return empty list, no crash.
        assert!(state.search("", 20).unwrap().is_empty());
        assert!(state.search("    ", 20).unwrap().is_empty());
    }

    #[test]
    fn test_search_no_crash_on_special_chars() {
        let state = test_state();
        state
            .insert(Some("hello world".into()), None, None)
            .unwrap();

        for evil in &[
            "hello \"world\"",
            "hello*",
            "(hello)",
            "hello:world",
            "hello AND world",
            "\"unterminated",
            "!@#$%^&*",
            "^^^",
        ] {
            let r = state.search(evil, 20);
            assert!(r.is_ok(), "evil query crashed: {evil:?} -> {r:?}");
        }
    }

    #[test]
    fn test_import_caps_size() {
        let state = test_state();
        let huge = "a".repeat(6 * 1024 * 1024);
        let err = state.import_json(&huge).unwrap_err();
        assert!(matches!(err, VoltError::InvalidConfig(_)));
    }

    #[test]
    fn test_import_caps_count() {
        let state = test_state();
        let tiny_note = |i: usize| {
            format!(
                r#"{{"id":"{i}","title":"","content":"","tags":[],"pinned":false,"color":null,"createdAt":0,"updatedAt":0,"accessedAt":0,"accessCount":0,"deletedAt":null}}"#
            )
        };
        let payload = format!(
            "[{}]",
            (0..10_001).map(tiny_note).collect::<Vec<_>>().join(",")
        );
        let err = state.import_json(&payload).unwrap_err();
        assert!(matches!(err, VoltError::InvalidConfig(_)));
    }

    #[test]
    fn test_import_regenerates_uuid() {
        let state = test_state();
        let created = state
            .insert(Some("orig".into()), Some("body".into()), None)
            .unwrap();
        let json = state.export_all().unwrap();
        let count = state.import_json(&json).unwrap();
        assert_eq!(count, 1);

        let all = state.list_active().unwrap();
        assert_eq!(all.len(), 2, "import must not collide with existing PK");
        let ids: std::collections::HashSet<_> = all.iter().map(|n| n.id.clone()).collect();
        assert_eq!(ids.len(), 2);
        assert!(all.iter().any(|n| n.id == created.id));
    }

    #[test]
    fn test_export_excludes_trashed() {
        let state = test_state();
        let kept = state.insert(Some("kept".into()), None, None).unwrap();
        let trashed = state.insert(Some("trashed".into()), None, None).unwrap();
        state.soft_delete(&trashed.id).unwrap();

        let json = state.export_all().unwrap();
        let parsed: Vec<Note> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, kept.id);
    }

    #[test]
    fn test_frecency_pinned_first() {
        // Pinned must always win regardless of accessed_at recency.
        let state = test_state();
        let now = now_millis();
        // Recent + many accesses but unpinned.
        raw_insert(&state, "hot", "hot", "", 1000, now, None, false);
        // Old + few accesses but PINNED.
        raw_insert(
            &state,
            "pinned",
            "pinned",
            "",
            1,
            now - 30 * 86_400_000,
            None,
            true,
        );

        let notes = state.list_active().unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].id, "pinned", "pinned note must come first");
        assert_eq!(notes[1].id, "hot");
    }

    #[test]
    fn test_sanitize_fts_query_unit() {
        assert_eq!(sanitize_fts_query(""), "");
        assert_eq!(sanitize_fts_query("   "), "");
        assert_eq!(sanitize_fts_query("hello"), r#""hello""#);
        assert_eq!(sanitize_fts_query("hello world"), r#""hello" OR "world""#);
        // Special chars become whitespace.
        assert_eq!(sanitize_fts_query("a*b"), r#""a" OR "b""#);
        assert_eq!(
            sanitize_fts_query("(foo) AND \"bar\""),
            r#""foo" OR "AND" OR "bar""#
        );
    }

    /// FTS5 must be available in our bundled rusqlite. Guards against an
    /// accidental Cargo feature regression.
    #[test]
    fn test_fts5_compiled_in() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE t USING fts5(x);
             INSERT INTO t(x) VALUES('hello world');",
        )
        .expect("FTS5 must be compiled into bundled rusqlite");
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM t WHERE t MATCH 'hello'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(n, 1);
    }
}
