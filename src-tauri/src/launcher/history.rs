//! Launch history tracking
//!
//! Tracks application launches for usage statistics and quick access to recently used apps.

use log;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use ts_rs::TS;

/// Credit (in ms) added to an item's `frecency_date` on each launch.
///
/// One day per use: a single launch keeps an app boosted for roughly a day,
/// while heavy use accumulates credit that decays proportionally slower (the
/// "frecency" self-balancing of frequency and recency). Tunable.
const FRECENCY_LAUNCH_WEIGHT: i64 = 86_400_000; // 1 day

/// Cap on the launch count counted when backfilling a legacy record, so a
/// long-lived history doesn't translate into an unbounded future date.
const FRECENCY_BACKFILL_CAP: i64 = 30;

/// A single launch record
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "LaunchRecord.ts")]
pub struct LaunchRecord {
    /// Application path
    pub path: String,

    /// Application name (derived from path)
    pub name: String,

    /// Total number of launches
    pub launch_count: u32,

    /// Timestamp of first launch. `#[ts(type = "number")]`: serde_json
    /// serialises i64 as a JSON number and Tauri's invoke yields a JS `number`
    /// (ms timestamps stay well within Number.MAX_SAFE_INTEGER) — ts-rs would
    /// otherwise default i64/u64 to `bigint`, which the wire never produces.
    #[ts(type = "number")]
    pub first_launched: i64,

    /// Timestamp of most recent launch
    #[ts(type = "number")]
    pub last_launched: i64,

    /// Monotonic "frecency date" (ms), pushed further into the future on each
    /// launch (Mozilla-style frecency). Ranking the per-keystroke search hot
    /// path by this single value needs no recency math at query time — see
    /// [`crate::search`]. Kept alongside `launch_count`/`last_launched`, which
    /// still drive the distinct "most frequent" and "most recent" app lists.
    ///
    /// `#[serde(default)]` lets records written before this field existed load
    /// with `0`, a sentinel [`backfill_frecency_date`] replaces on load.
    #[serde(default)]
    #[ts(type = "number")]
    pub frecency_date: i64,

    /// Total time spent in app (if tracked)
    #[ts(optional, type = "number")]
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
            frecency_date: now + FRECENCY_LAUNCH_WEIGHT,
            total_time_ms: None,
            tags: Vec::new(),
            pinned: false,
        }
    }

    /// Record a new launch of this application
    pub fn record_launch(&mut self) {
        let now = chrono::Utc::now().timestamp_millis();
        self.launch_count += 1;
        self.last_launched = now;
        // Anchor on `max(now, frecency_date)` so a long idle gap pulls the date
        // back toward `now` (recency), then add the per-use credit (frequency
        // accumulates). The value only ever moves forward.
        self.frecency_date = self.frecency_date.max(now) + FRECENCY_LAUNCH_WEIGHT;
    }

    /// Backfill `frecency_date` for a record loaded from a pre-`frecency_date`
    /// history file (serde fills the missing field with `0`). Derives a stable
    /// monotonic value from the legacy recency + (capped) frequency so search
    /// ranking stays sensible across the upgrade. No-op once migrated.
    fn backfill_frecency_date(&mut self) {
        if self.frecency_date == 0 {
            let credit =
                (self.launch_count as i64).min(FRECENCY_BACKFILL_CAP) * FRECENCY_LAUNCH_WEIGHT;
            self.frecency_date = self.last_launched + credit;
        }
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
    fn load_from_file(path: &Path) -> Option<HashMap<String, LaunchRecord>> {
        if !path.exists() {
            return None;
        }

        let content = fs::read_to_string(path).ok()?;
        let mut records: HashMap<String, LaunchRecord> = serde_json::from_str(&content).ok()?;
        // Backfill frecency_date for records written before the field existed.
        for record in records.values_mut() {
            record.backfill_frecency_date();
        }
        Some(records)
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

    /// Record an application launch.
    ///
    /// The in-memory update is fast; the persist-to-disk step is offloaded to
    /// a blocking task when called from a Tokio runtime so the IPC thread is
    /// never blocked on `fs::write`. Outside a runtime (tests, init) we fall
    /// back to a synchronous save.
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
            if tokio::runtime::Handle::try_current().is_ok() {
                self.save_async();
            } else {
                self.save()?;
            }
        }

        Ok(())
    }

    /// Fire-and-forget async persist used by hot mutators (record_launch).
    /// Errors are logged but not returned — the in-memory state is already
    /// updated, and a transient disk write failure must not block a launch.
    fn save_async(&self) {
        if self.history_file.as_os_str().is_empty() {
            return;
        }
        // Snapshot under the mutex; release before spawning so the blocking
        // thread doesn't contend with the next launch.
        let json = match self.records.lock() {
            Ok(records) => match serde_json::to_string_pretty(&*records) {
                Ok(j) => j,
                Err(e) => {
                    log::warn!("launch history: serialize failed: {}", e);
                    return;
                }
            },
            Err(e) => {
                log::warn!("launch history: mutex poisoned: {:?}", e);
                return;
            }
        };
        let history_file = self.history_file.clone();
        tokio::task::spawn_blocking(move || {
            if let Some(parent) = history_file.parent()
                && let Err(e) = fs::create_dir_all(parent)
            {
                log::warn!("launch history: create_dir_all failed: {}", e);
                return;
            }
            if let Err(e) = fs::write(&history_file, json) {
                log::warn!("launch history: fs::write failed: {}", e);
            }
        });
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

    /// Run `f` against the raw record map while holding the lock.
    ///
    /// This lets hot paths (per-keystroke search scoring) derive a cheap
    /// projection — e.g. a `path → frecency` score map — without cloning the
    /// entire `HashMap<String, LaunchRecord>` first (each `LaunchRecord` owns
    /// two `String`s and a `Vec<String>`). The closure must not hold onto the
    /// borrow past its return.
    pub fn with_records<R>(&self, f: impl FnOnce(&HashMap<String, LaunchRecord>) -> R) -> R {
        let records = self.records.lock().unwrap_or_else(|poisoned| {
            log::error!(
                "Launch history mutex poisoned in with_records(): {:?}",
                poisoned
            );
            poisoned.into_inner()
        });
        f(&records)
    }

    /// Get most recently launched apps.
    ///
    /// Uses [`select_nth_unstable_by_key`] to partition top-K in O(n) average
    /// time without sorting the entire history. The previous implementation
    /// cloned the full `Vec` then full-sorted it (O(n log n)) only to discard
    /// everything past index `limit`. For a 1000-launch history that's a 1000-
    /// string clone + ~10 k comparisons per keystroke when the predictive
    /// suggestion query is empty.
    pub fn get_recent(&self, limit: usize) -> Vec<LaunchRecord> {
        if limit == 0 {
            return Vec::new();
        }
        let mut records = self.get_all();
        if records.len() > limit {
            records.select_nth_unstable_by_key(limit, |r| std::cmp::Reverse(r.last_launched));
            records.truncate(limit);
        }
        records.sort_by_key(|r| std::cmp::Reverse(r.last_launched));
        records
    }

    /// Get most frequently launched apps. See [`get_recent`] for the
    /// partial-sort rationale.
    pub fn get_frequent(&self, limit: usize) -> Vec<LaunchRecord> {
        if limit == 0 {
            return Vec::new();
        }
        let mut records = self.get_all();
        if records.len() > limit {
            records.select_nth_unstable_by_key(limit, |r| std::cmp::Reverse(r.launch_count));
            records.truncate(limit);
        }
        records.sort_by_key(|r| std::cmp::Reverse(r.launch_count));
        records
    }

    /// Get pinned apps. Filters under the lock to avoid materialising the
    /// full record set just to throw most of it away.
    pub fn get_pinned(&self) -> Vec<LaunchRecord> {
        let records = self.records.lock().unwrap_or_else(|poisoned| {
            log::error!(
                "Launch history mutex poisoned in get_pinned(): {:?}",
                poisoned
            );
            poisoned.into_inner()
        });
        records.values().filter(|r| r.pinned).cloned().collect()
    }

    /// Get apps by tag. Filters under the lock so non-matching records never
    /// allocate a clone.
    pub fn get_by_tag(&self, tag: &str) -> Vec<LaunchRecord> {
        let records = self.records.lock().unwrap_or_else(|poisoned| {
            log::error!(
                "Launch history mutex poisoned in get_by_tag(): {:?}",
                poisoned
            );
            poisoned.into_inner()
        });
        records
            .values()
            .filter(|r| r.tags.iter().any(|t| t == tag))
            .cloned()
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
            Ok(())
        } else {
            Err(format!("App '{}' not found in launch history", path))
        }
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
            Ok(())
        } else {
            Err(format!("App '{}' not found in launch history", path))
        }
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
            Ok(())
        } else {
            Err(format!("App '{}' not found in launch history", path))
        }
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
            Ok(())
        } else {
            Err(format!("App '{}' not found in launch history", path))
        }
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
        let mut tags: Vec<String> = records
            .iter()
            .flat_map(|r| r.tags.iter().cloned())
            .collect();
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
    fn test_new_record_frecency_date_in_future() {
        let now = chrono::Utc::now().timestamp_millis();
        let record = LaunchRecord::new("C:\\app.exe", "App");
        // A fresh record is credited one launch weight ahead of now.
        assert!(record.frecency_date >= now + FRECENCY_LAUNCH_WEIGHT);
    }

    #[test]
    fn test_record_launch_pushes_frecency_date_forward() {
        let mut record = LaunchRecord::new("C:\\app.exe", "App");
        let after_first = record.frecency_date;
        record.record_launch();
        // Each launch moves the date strictly further into the future, so a
        // frequently used app accumulates credit (and outranks a rarely used one).
        assert!(record.frecency_date > after_first);
        assert_eq!(record.frecency_date, after_first + FRECENCY_LAUNCH_WEIGHT);
    }

    #[test]
    fn test_backfill_frecency_date_for_legacy_record() {
        // Simulate a record loaded from a pre-frecency_date history file: serde
        // would fill the field with 0.
        let mut legacy = LaunchRecord {
            path: "C:\\old.exe".into(),
            name: "Old".into(),
            launch_count: 5,
            first_launched: 1_000,
            last_launched: 2_000,
            frecency_date: 0,
            total_time_ms: None,
            tags: Vec::new(),
            pinned: false,
        };
        legacy.backfill_frecency_date();
        assert_eq!(legacy.frecency_date, 2_000 + 5 * FRECENCY_LAUNCH_WEIGHT);

        // Backfill is idempotent — a second pass must not move an already
        // migrated value.
        let migrated = legacy.frecency_date;
        legacy.backfill_frecency_date();
        assert_eq!(legacy.frecency_date, migrated);
    }

    #[test]
    fn test_backfill_caps_launch_count() {
        let mut legacy = LaunchRecord {
            path: "C:\\heavy.exe".into(),
            name: "Heavy".into(),
            launch_count: 10_000,
            first_launched: 0,
            last_launched: 0,
            frecency_date: 0,
            total_time_ms: None,
            tags: Vec::new(),
            pinned: false,
        };
        legacy.backfill_frecency_date();
        // Capped so a long history doesn't produce an unbounded future date.
        assert_eq!(
            legacy.frecency_date,
            FRECENCY_BACKFILL_CAP * FRECENCY_LAUNCH_WEIGHT
        );
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
