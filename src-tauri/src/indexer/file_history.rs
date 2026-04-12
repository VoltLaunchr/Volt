//! File access history tracking
//!
//! Tracks file opens for quick access to recently used files.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tracing::warn;

/// A single file access record
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAccessRecord {
    /// File path
    pub path: String,

    /// File name
    pub name: String,

    /// Total number of accesses
    pub access_count: u32,

    /// Timestamp of first access
    pub first_accessed: i64,

    /// Timestamp of most recent access
    pub last_accessed: i64,
}

impl FileAccessRecord {
    /// Create a new file access record
    pub fn new(path: impl Into<String>, name: impl Into<String>) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            path: path.into(),
            name: name.into(),
            access_count: 1,
            first_accessed: now,
            last_accessed: now,
        }
    }

    /// Record a new access of this file
    pub fn record_access(&mut self) {
        self.access_count += 1;
        self.last_accessed = chrono::Utc::now().timestamp_millis();
    }
}

/// File access history manager
#[derive(Debug)]
pub struct FileHistory {
    /// All access records indexed by path
    records: Mutex<HashMap<String, FileAccessRecord>>,

    /// Path to the history file
    history_file: PathBuf,

    /// Whether auto-save is enabled
    auto_save: bool,
}

impl FileHistory {
    /// Create a new file history manager
    pub fn new(history_file: PathBuf, auto_save: bool) -> Self {
        let mut history = Self {
            records: Mutex::new(HashMap::new()),
            history_file,
            auto_save,
        };

        // Try to load existing history
        if let Err(e) = history.load() {
            warn!("Failed to load file history: {}", e);
        }

        history
    }

    /// Record a file access
    pub fn record_access(
        &self,
        path: impl Into<String>,
        name: impl Into<String>,
    ) -> Result<(), String> {
        let path = path.into();
        let name = name.into();

        let mut records = self.records.lock().map_err(|e| e.to_string())?;

        if let Some(record) = records.get_mut(&path) {
            record.record_access();
        } else {
            records.insert(path.clone(), FileAccessRecord::new(path, name));
        }

        drop(records);

        if self.auto_save {
            self.save()?;
        }

        Ok(())
    }

    /// Get recently accessed files
    pub fn get_recent(&self, limit: usize) -> Result<Vec<FileAccessRecord>, String> {
        let records = self.records.lock().map_err(|e| e.to_string())?;

        let mut recent: Vec<FileAccessRecord> = records.values().cloned().collect();
        recent.sort_by(|a, b| b.last_accessed.cmp(&a.last_accessed));
        recent.truncate(limit);

        Ok(recent)
    }

    /// Clear all history
    pub fn clear(&self) -> Result<(), String> {
        let mut records = self.records.lock().map_err(|e| e.to_string())?;
        records.clear();
        drop(records);

        if self.auto_save {
            self.save()?;
        }

        Ok(())
    }

    /// Save history to disk
    pub fn save(&self) -> Result<(), String> {
        let records = self.records.lock().map_err(|e| e.to_string())?;

        // Ensure parent directory exists
        if let Some(parent) = self.history_file.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // Serialize and write
        let json = serde_json::to_string_pretty(&*records).map_err(|e| e.to_string())?;
        fs::write(&self.history_file, json).map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Load history from disk
    pub fn load(&mut self) -> Result<(), String> {
        if !self.history_file.exists() {
            return Ok(()); // No history file yet
        }

        let json = fs::read_to_string(&self.history_file).map_err(|e| e.to_string())?;
        let loaded: HashMap<String, FileAccessRecord> =
            serde_json::from_str(&json).map_err(|e| e.to_string())?;

        let mut records = self.records.lock().map_err(|e| e.to_string())?;
        *records = loaded;

        Ok(())
    }
}
