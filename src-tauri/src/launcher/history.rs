//! Launch history tracking
//!
//! Tracks application launches for usage statistics and quick access to recently used apps.

use log;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// A single launch record
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRecord {
    /// Application path
    pub path: String,

    /// Application name (derived from path)
    pub name: String,

    /// Total number of launches
    pub launch_count: u32,

    /// Timestamp of first launch
    pub first_launched: i64,

    /// Timestamp of most recent launch
    pub last_launched: i64,

    /// Total time spent in app (if tracked)
    pub total_time_ms: Option<u64>,

    /// Tags/categories assigned by user
    pub tags: Vec<String>,

    /// Whether this app is pinned/favorited
    pub pinned: bool,
}

impl LaunchRecord {
    /// Create a new launch record
    pub fn new(path: impl Into<String>, name: impl Into<String>) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            path: path.into(),
            name: name.into(),
            launch_count: 1,
            first_launched: now,
            last_launched: now,
            total_time_ms: None,
            tags: Vec::new(),
            pinned: false,
        }
    }

    /// Record a new launch of this application
    pub fn record_launch(&mut self) {
        self.launch_count += 1;
        self.last_launched = chrono::Utc::now().timestamp_millis();
    }

    /// Add time spent in the app
    pub fn add_time(&mut self, ms: u64) {
        self.total_time_ms = Some(self.total_time_ms.unwrap_or(0) + ms);
    }

    /// Pin/unpin this app
    pub fn set_pinned(&mut self, pinned: bool) {
        self.pinned = pinned;
    }

    /// Add a tag to this app
    pub fn add_tag(&mut self, tag: impl Into<String>) {
        let tag = tag.into();
        if !self.tags.contains(&tag) {
            self.tags.push(tag);
        }
    }

    /// Remove a tag from this app
    pub fn remove_tag(&mut self, tag: &str) {
        self.tags.retain(|t| t != tag);
    }
}

/// Launch history manager
#[derive(Debug)]
pub struct LaunchHistory {
    /// All launch records indexed by path
    records: Mutex<HashMap<String, LaunchRecord>>,

    /// Path to the history file
    history_file: PathBuf,

    /// Whether auto-save is enabled
    auto_save: bool,
}

impl LaunchHistory {
    /// Create a new launch history manager
    ///
    /// # Arguments
    /// * `data_dir` - Directory to store the history file
    pub fn new(data_dir: PathBuf) -> Self {
        let history_file = data_dir.join("launch_history.json");
        let records = Self::load_from_file(&history_file).unwrap_or_default();

        Self {
            records: Mutex::new(records),
            history_file,
            auto_save: true,
        }
    }

    /// Create an in-memory history (no persistence)
    pub fn in_memory() -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
            history_file: PathBuf::new(),
            auto_save: false,
        }
    }

    /// Load history from a file
    fn load_from_file(path: &PathBuf) -> Option<HashMap<String, LaunchRecord>> {
        if !path.exists() {
            return None;
        }

        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// Save history to file
    pub fn save(&self) -> Result<(), String> {
        if self.history_file.as_os_str().is_empty() {
            return Ok(()); // In-memory mode, nothing to save
        }

        let records = self.records.lock().map_err(|e| e.to_string())?;

        // Ensure parent directory exists
        if let Some(parent) = self.history_file.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let json = serde_json::to_string_pretty(&*records).map_err(|e| e.to_string())?;
        fs::write(&self.history_file, json).map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Record an application launch
    pub fn record_launch(&self, path: &str, name: &str) -> Result<(), String> {
        {
            let mut records = self.records.lock().map_err(|e| e.to_string())?;

            if let Some(record) = records.get_mut(path) {
                record.record_launch();
            } else {
                records.insert(path.to_string(), LaunchRecord::new(path, name));
            }
        }

        if self.auto_save {
            self.save()?;
        }

        Ok(())
    }
    /// Get a launch record by path
    pub fn get(&self, path: &str) -> Option<LaunchRecord> {
        let records = self.records.lock().unwrap_or_else(|poisoned| {
            log::error!("Launch history mutex poisoned in get(): {:?}", poisoned);
            poisoned.into_inner()
        });
        records.get(path).cloned()
    }

    /// Get all launch records
    pub fn get_all(&self) -> Vec<LaunchRecord> {
        let records = self.records.lock().unwrap_or_else(|poisoned| {
            log::error!("Launch history mutex poisoned in get_all(): {:?}", poisoned);
            poisoned.into_inner()
        });
        records.values().cloned().collect()
    }

    /// Get most recently launched apps
    pub fn get_recent(&self, limit: usize) -> Vec<LaunchRecord> {
        let mut records = self.get_all();
        records.sort_by(|a, b| b.last_launched.cmp(&a.last_launched));
        records.truncate(limit);
        records
    }

    /// Get most frequently launched apps
    pub fn get_frequent(&self, limit: usize) -> Vec<LaunchRecord> {
        let mut records = self.get_all();
        records.sort_by(|a, b| b.launch_count.cmp(&a.launch_count));
        records.truncate(limit);
        records
    }

    /// Get pinned apps
    pub fn get_pinned(&self) -> Vec<LaunchRecord> {
        self.get_all().into_iter().filter(|r| r.pinned).collect()
    }

    /// Get apps by tag
    pub fn get_by_tag(&self, tag: &str) -> Vec<LaunchRecord> {
        self.get_all()
            .into_iter()
            .filter(|r| r.tags.contains(&tag.to_string()))
            .collect()
    }

    /// Pin an application
    pub fn pin(&self, path: &str) -> Result<(), String> {
        let mut records = self.records.lock().map_err(|e| e.to_string())?;

        if let Some(record) = records.get_mut(path) {
            record.set_pinned(true);
            drop(records);
            if self.auto_save {
                self.save()?;
            }
        }

        Ok(())
    }

    /// Unpin an application
    pub fn unpin(&self, path: &str) -> Result<(), String> {
        let mut records = self.records.lock().map_err(|e| e.to_string())?;

        if let Some(record) = records.get_mut(path) {
            record.set_pinned(false);
            drop(records);
            if self.auto_save {
                self.save()?;
            }
        }

        Ok(())
    }

    /// Add a tag to an application
    pub fn add_tag(&self, path: &str, tag: &str) -> Result<(), String> {
        let mut records = self.records.lock().map_err(|e| e.to_string())?;

        if let Some(record) = records.get_mut(path) {
            record.add_tag(tag);
            drop(records);
            if self.auto_save {
                self.save()?;
            }
        }

        Ok(())
    }

    /// Remove a tag from an application
    pub fn remove_tag(&self, path: &str, tag: &str) -> Result<(), String> {
        let mut records = self.records.lock().map_err(|e| e.to_string())?;

        if let Some(record) = records.get_mut(path) {
            record.remove_tag(tag);
            drop(records);
            if self.auto_save {
                self.save()?;
            }
        }

        Ok(())
    }

    /// Remove a record from history
    pub fn remove(&self, path: &str) -> Result<(), String> {
        let mut records = self.records.lock().map_err(|e| e.to_string())?;
        records.remove(path);
        drop(records);

        if self.auto_save {
            self.save()?;
        }

        Ok(())
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

    /// Get total number of records
    pub fn count(&self) -> usize {
        self.records.lock().map(|r| r.len()).unwrap_or(0)
    }

    /// Get all unique tags used in history
    pub fn get_all_tags(&self) -> Vec<String> {
        let records = self.get_all();
        let mut tags: Vec<String> = records.iter().flat_map(|r| r.tags.clone()).collect();
        tags.sort();
        tags.dedup();
        tags
    }

    /// Clean up invalid/deleted application paths from history
    /// Returns the number of records removed
    pub fn cleanup_invalid_paths(&self) -> Result<usize, String> {
        use std::path::Path;

        let mut records = self.records.lock().map_err(|e| e.to_string())?;

        // Collect paths that don't exist anymore
        let invalid_paths: Vec<String> = records
            .iter()
            .filter(|(path, _)| !Path::new(path).exists())
            .map(|(path, _)| path.clone())
            .collect();

        // Remove invalid paths
        for path in &invalid_paths {
            records.remove(path);
        }

        let removed_count = invalid_paths.len();
        drop(records);

        // Save if anything was removed
        if removed_count > 0 && self.auto_save {
            self.save()?;
        }

        Ok(removed_count)
    }

    /// Validate if a specific path still exists
    pub fn validate_path(&self, path: &str) -> bool {
        use std::path::Path;
        Path::new(path).exists()
    }
}

impl Default for LaunchHistory {
    fn default() -> Self {
        Self::in_memory()
    }
}

// ============================================================================
// Query-Result Binding Store
// ============================================================================

/// A single query→result binding that tracks how often a user selects
/// a particular result for a given query prefix.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryBinding {
    /// The query prefix (e.g. "ch", "chr")
    pub query_prefix: String,
    /// The result identifier (app path or plugin result id)
    pub result_id: String,
    /// Number of times this result was selected for this prefix
    pub count: u32,
    /// Timestamp (ms) of the last selection
    pub last_used: i64,
}

/// Persisted store of query→result bindings.
/// Enables "Alfred-style" learning: typing "ch" and picking Chrome
/// causes Chrome to be boosted for future "ch" queries.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryBindingStore {
    bindings: HashMap<String, Vec<QueryBinding>>,
}

/// Maximum number of unique prefixes to keep (prevents unbounded growth)
const MAX_BINDING_PREFIXES: usize = 1000;
/// Maximum prefix length to record
const MAX_PREFIX_LEN: usize = 8;

impl QueryBindingStore {
    /// Record a binding for every prefix of `query` (length 1..min(8, query.len())).
    /// Increments count and updates last_used for existing bindings, or inserts new ones.
    pub fn record_binding(&mut self, query: &str, result_id: &str) {
        let query_lower = query.to_lowercase();
        let query_lower = query_lower.trim();
        if query_lower.is_empty() {
            return;
        }

        let now = chrono::Utc::now().timestamp_millis();
        let max_len = MAX_PREFIX_LEN.min(query_lower.len());

        for end in 1..=max_len {
            // Ensure we split on a char boundary
            let prefix = match query_lower.get(..end) {
                Some(p) => p,
                None => continue,
            };

            let entries = self.bindings.entry(prefix.to_string()).or_default();

            if let Some(existing) = entries.iter_mut().find(|b| b.result_id == result_id) {
                existing.count += 1;
                existing.last_used = now;
            } else {
                entries.push(QueryBinding {
                    query_prefix: prefix.to_string(),
                    result_id: result_id.to_string(),
                    count: 1,
                    last_used: now,
                });
            }
        }

        // Prune if we exceed the max number of unique prefixes
        self.prune_if_needed();
    }

    /// Return a boost score for a given (query, result_id) pair.
    /// Formula: min(count, 10) * 3.0 with recency decay (half-life 1 week).
    /// Maximum boost: +30.
    pub fn get_boost(&self, query: &str, result_id: &str) -> f32 {
        let query_lower = query.to_lowercase();
        let query_lower = query_lower.trim();
        if query_lower.is_empty() {
            return 0.0;
        }

        let entries = match self.bindings.get(query_lower) {
            Some(e) => e,
            None => return 0.0,
        };

        let binding = match entries.iter().find(|b| b.result_id == result_id) {
            Some(b) => b,
            None => return 0.0,
        };

        let now_ms = chrono::Utc::now().timestamp_millis();
        let age_hours = ((now_ms - binding.last_used) as f64 / 3_600_000.0).max(0.0);
        // Half-life of 1 week (168 hours), floor at 0.2 so old bindings don't vanish
        let recency_weight = (-age_hours / 168.0).exp().max(0.2) as f32;

        let count_factor = (binding.count.min(10) as f32) * 3.0;
        count_factor * recency_weight
    }

    /// Save the store to a JSON file.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Load the store from a JSON file. Returns Default if the file doesn't exist.
    pub fn load(path: &Path) -> Self {
        if !path.exists() {
            return Self::default();
        }
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return Self::default(),
        };
        serde_json::from_str(&content).unwrap_or_default()
    }

    /// Prune oldest prefixes when exceeding the limit.
    fn prune_if_needed(&mut self) {
        if self.bindings.len() <= MAX_BINDING_PREFIXES {
            return;
        }

        // Find the oldest last_used per prefix, then drop the oldest prefixes
        let mut prefix_ages: Vec<(String, i64)> = self
            .bindings
            .iter()
            .map(|(prefix, entries)| {
                let max_last_used = entries.iter().map(|b| b.last_used).max().unwrap_or(0);
                (prefix.clone(), max_last_used)
            })
            .collect();

        // Sort oldest first
        prefix_ages.sort_by_key(|(_, age)| *age);

        // Remove oldest entries until we're under the limit
        let to_remove = self.bindings.len() - MAX_BINDING_PREFIXES;
        for (prefix, _) in prefix_ages.into_iter().take(to_remove) {
            self.bindings.remove(&prefix);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_launch() {
        let history = LaunchHistory::in_memory();

        history
            .record_launch("C:\\app.exe", "App")
            .expect("Failed to record launch");

        let record = history.get("C:\\app.exe").expect("Record not found");
        assert_eq!(record.launch_count, 1);
        assert_eq!(record.name, "App");
    }

    #[test]
    fn test_multiple_launches() {
        let history = LaunchHistory::in_memory();

        history.record_launch("C:\\app.exe", "App").unwrap();
        history.record_launch("C:\\app.exe", "App").unwrap();
        history.record_launch("C:\\app.exe", "App").unwrap();

        let record = history.get("C:\\app.exe").unwrap();
        assert_eq!(record.launch_count, 3);
    }

    #[test]
    fn test_pinned_apps() {
        let history = LaunchHistory::in_memory();

        history.record_launch("C:\\app1.exe", "App1").unwrap();
        history.record_launch("C:\\app2.exe", "App2").unwrap();
        history.pin("C:\\app1.exe").unwrap();

        let pinned = history.get_pinned();
        assert_eq!(pinned.len(), 1);
        assert_eq!(pinned[0].path, "C:\\app1.exe");
    }

    #[test]
    fn test_tags() {
        let history = LaunchHistory::in_memory();

        history.record_launch("C:\\app.exe", "App").unwrap();
        history.add_tag("C:\\app.exe", "work").unwrap();
        history.add_tag("C:\\app.exe", "productivity").unwrap();

        let by_tag = history.get_by_tag("work");
        assert_eq!(by_tag.len(), 1);

        let record = history.get("C:\\app.exe").unwrap();
        assert!(record.tags.contains(&"work".to_string()));
        assert!(record.tags.contains(&"productivity".to_string()));
    }
}
