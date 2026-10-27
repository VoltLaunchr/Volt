//! Launch history tracking — the universal frecency store.
//!
//! Tracks application launches (usage statistics, recents, pins) and, since
//! the unified search ranking, the usage of every other launchable result
//! with a stable identity (plugin commands: system commands, quicklinks,
//! snippets, window actions, games, extension commands…). One record per
//! identity, one frecency model ([`LaunchRecord::frecency_date`]), one file
//! (`launch_history.json`). Records carry a [`UsageKind`] so the app-facing
//! APIs (recents, frequent, pins, suggestions) keep returning applications only.

use log;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use ts_rs::TS;

use crate::search::{LearnedMatch, SearchTier};
use crate::utils::serialized_file_writer::SerializedFileWriter;

/// Credit (in ms) added to an item's `frecency_date` on each launch.
///
/// One day per use: a single launch keeps an app boosted for roughly a day,
/// while heavy use accumulates credit that decays proportionally slower (the
/// "frecency" self-balancing of frequency and recency). Tunable.
const FRECENCY_LAUNCH_WEIGHT: i64 = 86_400_000; // 1 day

/// Cap on the launch count counted when backfilling a legacy record, so a
/// long-lived history doesn't translate into an unbounded future date.
const FRECENCY_BACKFILL_CAP: i64 = 30;

/// Maximum number of [`UsageKind::Command`] records kept. Applications are
/// bounded by the installed catalog; command identities are not (a quicklink
/// or snippet can be created and deleted at will), so the least-frecent
/// commands are evicted beyond this cap.
pub const MAX_COMMAND_RECORDS: usize = 500;

/// Maximum byte length of a command identity accepted by
/// [`LaunchHistory::record_command_usage`].
pub const MAX_COMMAND_IDENTITY_LEN: usize = 512;

/// What a [`LaunchRecord`] tracks.
///
/// `#[serde(default)]` on the field makes every record written before this
/// enum existed load as [`UsageKind::App`] — the only kind that used to exist —
/// so `launch_history.json` needs no migration step.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "UsageKind.ts")]
pub enum UsageKind {
    /// An application, keyed by its path. Recorded by the launch commands.
    #[default]
    App,
    /// Any other launchable result, keyed by its stable identity
    /// (`pluginId:resultId`, see `src/app/searchResultIdentity.ts`).
    Command,
}

/// A single launch record
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "LaunchRecord.ts")]
pub struct LaunchRecord {
    /// Application path, or the stable result identity of a command record.
    pub path: String,

    /// Application name (derived from path), or the command title.
    pub name: String,

    /// What this record tracks. Absent in pre-unified-ranking files → `App`.
    #[serde(default)]
    pub kind: UsageKind,

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
            kind: UsageKind::App,
            total_time_ms: None,
            tags: Vec::new(),
            pinned: false,
        }
    }

    /// Create the first usage record of a command identity.
    pub fn new_command(identity: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            kind: UsageKind::Command,
            ..Self::new(identity, title)
        }
    }

    /// Whether this record tracks an application.
    pub fn is_app(&self) -> bool {
        self.kind == UsageKind::App
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

    /// Orders disk snapshots so an older blocking task can never overwrite a
    /// newer mutation.
    writer: SerializedFileWriter,
}

impl LaunchHistory {
    /// Create a new launch history manager
    ///
    /// # Arguments
    /// * `data_dir` - Directory to store the history file
    pub fn new(data_dir: PathBuf) -> Self {
        let history_file = data_dir.join("launch_history.json");
        let records = Self::load_from_file(&history_file).unwrap_or_default();
        let writer = SerializedFileWriter::new(history_file.clone());

        Self {
            records: Mutex::new(records),
            history_file,
            auto_save: true,
            writer,
        }
    }

    /// Create an in-memory history (no persistence)
    pub fn in_memory() -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
            history_file: PathBuf::new(),
            auto_save: false,
            writer: SerializedFileWriter::new(PathBuf::new()),
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

        let (generation, json) = {
            let records = self.records.lock().map_err(|e| e.to_string())?;
            let generation = self.writer.reserve();
            let json = serde_json::to_string_pretty(&*records).map_err(|e| e.to_string())?;
            (generation, json)
        };

        self.writer.write_blocking(generation, json)
    }

    /// Snapshot `records` for the background writer while the lock is held,
    /// so disk order always matches in-memory mutation order.
    fn snapshot_for_write(
        &self,
        records: &HashMap<String, LaunchRecord>,
    ) -> Result<Option<(u64, String)>, String> {
        if !self.auto_save {
            return Ok(None);
        }
        let generation = self.writer.reserve();
        let json = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
        Ok(Some((generation, json)))
    }

    /// Record an application launch.
    ///
    /// The in-memory update is fast; the persist-to-disk step is offloaded to
    /// a blocking task when called from a Tokio runtime so the IPC thread is
    /// never blocked on `fs::write`. Outside a runtime (tests, init) we fall
    /// back to a synchronous save.
    pub fn record_launch(&self, path: &str, name: &str) -> Result<(), String> {
        let pending_write = {
            let mut records = self.records.lock().map_err(|e| e.to_string())?;

            if let Some(record) = records.get_mut(path) {
                record.record_launch();
            } else {
                records.insert(path.to_string(), LaunchRecord::new(path, name));
            }

            self.snapshot_for_write(&records)?
        };

        if let Some((generation, json)) = pending_write {
            self.writer.spawn_write(generation, json);
        }

        Ok(())
    }

    /// Record one execution of a non-application result (plugin command,
    /// quicklink, snippet, window action, game, extension command…) under its
    /// stable identity, with the same frecency model as app launches.
    ///
    /// Returns the record's new `frecency_date` so the caller can update its
    /// cached copy without another round trip. Refuses identities that are
    /// already tracked as applications: app launches are recorded by the
    /// launch commands, and accepting them here would count them twice.
    pub fn record_command_usage(&self, identity: &str, title: &str) -> Result<i64, String> {
        let identity = identity.trim();
        if identity.is_empty()
            || identity.len() > MAX_COMMAND_IDENTITY_LEN
            || identity.contains('\0')
        {
            return Err("Invalid command identity".to_string());
        }
        let title = title.trim();
        if title.len() > 1024 || title.contains('\0') {
            return Err("Invalid command title".to_string());
        }

        let (frecency_date, pending_write) = {
            let mut records = self.records.lock().map_err(|e| e.to_string())?;

            let frecency_date = match records.get_mut(identity) {
                Some(record) if record.is_app() => {
                    return Err(format!(
                        "'{}' is an application; app launches are recorded by launch_app",
                        identity
                    ));
                }
                Some(record) => {
                    record.record_launch();
                    if !title.is_empty() {
                        record.name = title.to_string();
                    }
                    record.frecency_date
                }
                None => {
                    let record = LaunchRecord::new_command(identity, title);
                    let date = record.frecency_date;
                    records.insert(identity.to_string(), record);
                    date
                }
            };

            prune_command_records(&mut records, MAX_COMMAND_RECORDS);
            (frecency_date, self.snapshot_for_write(&records)?)
        };

        if let Some((generation, json)) = pending_write {
            self.writer.spawn_write(generation, json);
        }

        Ok(frecency_date)
    }

    /// `identity → frecency_date` for every [`UsageKind::Command`] record.
    /// Bounded by [`MAX_COMMAND_RECORDS`]; the frontend caches it so plugin
    /// results are ranked without an IPC round trip per keystroke.
    pub fn command_frecency(&self) -> HashMap<String, i64> {
        self.frecency_map(UsageKind::Command)
    }

    /// `path → frecency_date` for every application record — the projection
    /// the per-keystroke app ranker needs, built without cloning records.
    pub fn app_frecency(&self) -> HashMap<String, i64> {
        self.frecency_map(UsageKind::App)
    }

    fn frecency_map(&self, kind: UsageKind) -> HashMap<String, i64> {
        self.with_records(|records| {
            records
                .iter()
                .filter(|(_, record)| record.kind == kind)
                .map(|(key, record)| (key.clone(), record.frecency_date))
                .collect()
        })
    }

    /// Get a launch record by path
    pub fn get(&self, path: &str) -> Option<LaunchRecord> {
        let records = self.records.lock().unwrap_or_else(|poisoned| {
            log::error!("Launch history mutex poisoned in get(): {:?}", poisoned);
            poisoned.into_inner()
        });
        records.get(path).cloned()
    }

    /// Get every application record (command usage records are excluded:
    /// they back search ranking only, never the app lists).
    pub fn get_all(&self) -> Vec<LaunchRecord> {
        let records = self.records.lock().unwrap_or_else(|poisoned| {
            log::error!("Launch history mutex poisoned in get_all(): {:?}", poisoned);
            poisoned.into_inner()
        });
        records.values().filter(|r| r.is_app()).cloned().collect()
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
        records
            .values()
            .filter(|r| r.is_app() && r.pinned)
            .cloned()
            .collect()
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

    /// Get the number of application records
    pub fn count(&self) -> usize {
        self.records
            .lock()
            .map(|r| r.values().filter(|record| record.is_app()).count())
            .unwrap_or(0)
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

        // Collect app paths that don't exist anymore (command identities are
        // not filesystem paths and are bounded by MAX_COMMAND_RECORDS instead).
        let invalid_paths: Vec<String> = records
            .iter()
            .filter(|(path, record)| record.is_app() && !Path::new(path).exists())
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

/// Evict the least-frecent command records beyond `cap`. Application records
/// are never touched.
fn prune_command_records(records: &mut HashMap<String, LaunchRecord>, cap: usize) {
    let mut commands: Vec<(i64, String)> = records
        .iter()
        .filter(|(_, record)| !record.is_app())
        .map(|(key, record)| (record.frecency_date, key.clone()))
        .collect();
    if commands.len() <= cap {
        return;
    }
    commands.sort_unstable();
    let excess = commands.len() - cap;
    for (_, key) in commands.into_iter().take(excess) {
        records.remove(&key);
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
    /// Selections where the typed query was exactly `query_prefix` (not a
    /// longer query starting with it). `#[serde(default)]`: bindings written
    /// before learned tiers existed load with `0` and only ever surface as
    /// learned *prefixes* until the user types the exact query again.
    #[serde(default)]
    pub exact_count: u32,
    /// Timestamp (ms) of the last exact selection (`0` = never).
    #[serde(default)]
    pub last_exact: i64,
}

impl QueryBinding {
    fn learned_tier(&self, now_ms: i64) -> Option<SearchTier> {
        let fresh = |at: i64| at > 0 && now_ms.saturating_sub(at) <= LEARNED_TIER_TTL_MS;
        if self.exact_count > 0 && fresh(self.last_exact) {
            Some(SearchTier::LearnedExact)
        } else if fresh(self.last_used) {
            Some(SearchTier::AliasPrefix)
        } else {
            None
        }
    }
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
/// How long a learned query stays a ranking tier (Raycast keeps typed search
/// terms for 17 days). Older bindings stay in the store but no longer rank.
pub const LEARNED_TIER_TTL_MS: i64 = 17 * 86_400_000;

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
        self.record_binding_at(query_lower, result_id, now);
    }

    /// [`Self::record_binding`] with an explicit clock (tests).
    fn record_binding_at(&mut self, query_lower: &str, result_id: &str, now: i64) {
        let max_len = MAX_PREFIX_LEN.min(query_lower.len());

        for end in 1..=max_len {
            // Ensure we split on a char boundary
            let prefix = match query_lower.get(..end) {
                Some(p) => p,
                None => continue,
            };

            let is_exact = end == query_lower.len();
            let entries = self.bindings.entry(prefix.to_string()).or_default();

            if let Some(existing) = entries.iter_mut().find(|b| b.result_id == result_id) {
                existing.count += 1;
                existing.last_used = now;
                if is_exact {
                    existing.exact_count += 1;
                    existing.last_exact = now;
                }
            } else {
                entries.push(QueryBinding {
                    query_prefix: prefix.to_string(),
                    result_id: result_id.to_string(),
                    count: 1,
                    last_used: now,
                    exact_count: u32::from(is_exact),
                    last_exact: if is_exact { now } else { 0 },
                });
            }
        }

        // Prune if we exceed the max number of unique prefixes
        self.prune_if_needed();
    }

    /// Learned tier of `result_id` for `query`, if any:
    ///
    /// - [`SearchTier::LearnedExact`]: the user typed exactly this query and
    ///   opened this result within [`LEARNED_TIER_TTL_MS`];
    /// - [`SearchTier::AliasPrefix`] (the "alias or learned prefix" tier): the
    ///   user typed a query starting with this one and opened this result
    ///   within the TTL.
    ///
    /// The tier only applies to results that already matched the query; it
    /// never makes an unrelated result appear.
    pub fn learned_tier(&self, query: &str, result_id: &str, now_ms: i64) -> Option<SearchTier> {
        let query_lower = query.trim().to_lowercase();
        self.bindings
            .get(&query_lower)?
            .iter()
            .find(|b| b.result_id == result_id)
            .and_then(|b| b.learned_tier(now_ms))
    }

    /// Every learned tier for `query` (see [`Self::learned_tier`]). Streamed
    /// to the frontend so plugin commands share the applications' learned
    /// tiers without an extra IPC round trip.
    pub fn learned_matches(&self, query: &str, now_ms: i64) -> Vec<LearnedMatch> {
        let query_lower = query.trim().to_lowercase();
        self.bindings
            .get(&query_lower)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|b| {
                        b.learned_tier(now_ms).map(|tier| LearnedMatch {
                            result_id: b.result_id.clone(),
                            tier,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
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
            kind: UsageKind::App,
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
            kind: UsageKind::App,
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

    // ---- Universal frecency (command identities) ----

    #[test]
    fn legacy_records_without_kind_load_as_apps() {
        let json = r#"{"C:\\app.exe":{"path":"C:\\app.exe","name":"App","launchCount":2,
            "firstLaunched":1,"lastLaunched":2,"frecencyDate":5,"tags":[],"pinned":true}}"#;
        let records: HashMap<String, LaunchRecord> = serde_json::from_str(json).unwrap();
        let record = &records["C:\\app.exe"];
        assert_eq!(record.kind, UsageKind::App);
        assert!(record.is_app());

        // New records serialise their kind so a round trip keeps it.
        let command = LaunchRecord::new_command("systemcommands:syscmd-settings", "Settings");
        let back: LaunchRecord =
            serde_json::from_str(&serde_json::to_string(&command).unwrap()).unwrap();
        assert_eq!(back.kind, UsageKind::Command);
    }

    #[test]
    fn command_usage_accrues_frecency_like_app_launches() {
        let history = LaunchHistory::in_memory();
        let first = history
            .record_command_usage("quicklinks:ql-github", "GitHub")
            .unwrap();
        let second = history
            .record_command_usage("quicklinks:ql-github", "GitHub")
            .unwrap();
        assert_eq!(second, first + FRECENCY_LAUNCH_WEIGHT);

        let record = history.get("quicklinks:ql-github").unwrap();
        assert_eq!(record.kind, UsageKind::Command);
        assert_eq!(record.launch_count, 2);
        assert_eq!(
            history.command_frecency().get("quicklinks:ql-github"),
            Some(&second)
        );
    }

    #[test]
    fn command_records_stay_out_of_app_lists() {
        let history = LaunchHistory::in_memory();
        history.record_launch("C:\\app.exe", "App").unwrap();
        history
            .record_command_usage("systemcommands:syscmd-quit", "Quit Volt")
            .unwrap();
        history.pin("systemcommands:syscmd-quit").unwrap();

        assert_eq!(history.count(), 1);
        assert_eq!(history.get_all().len(), 1);
        assert_eq!(history.get_recent(10).len(), 1);
        assert_eq!(history.get_frequent(10).len(), 1);
        assert!(history.get_pinned().is_empty());
        assert!(history.app_frecency().contains_key("C:\\app.exe"));
        assert!(
            !history
                .app_frecency()
                .contains_key("systemcommands:syscmd-quit")
        );
        assert!(!history.command_frecency().contains_key("C:\\app.exe"));
    }

    #[test]
    fn command_usage_rejects_app_identities_and_invalid_input() {
        let history = LaunchHistory::in_memory();
        history.record_launch("C:\\app.exe", "App").unwrap();
        assert!(history.record_command_usage("C:\\app.exe", "App").is_err());
        assert_eq!(history.get("C:\\app.exe").unwrap().launch_count, 1);

        assert!(history.record_command_usage("   ", "Blank").is_err());
        assert!(history.record_command_usage("a\0b", "Nul").is_err());
        let too_long = "x".repeat(MAX_COMMAND_IDENTITY_LEN + 1);
        assert!(history.record_command_usage(&too_long, "Long").is_err());
        assert!(
            history
                .record_command_usage("plugin:large", &"x".repeat(1025))
                .is_err()
        );
        assert!(history.record_command_usage("plugin:nul", "a\0b").is_err());
        assert!(history.command_frecency().is_empty());
    }

    #[test]
    fn command_records_are_pruned_by_frecency_and_apps_are_kept() {
        let mut records = HashMap::new();
        let mut app = LaunchRecord::new("C:\\old.exe", "Old");
        app.frecency_date = 1;
        records.insert(app.path.clone(), app);
        for i in 0..5 {
            let mut command = LaunchRecord::new_command(format!("p:{i}"), "Cmd");
            command.frecency_date = 100 + i;
            records.insert(command.path.clone(), command);
        }

        prune_command_records(&mut records, 3);

        assert!(records.contains_key("C:\\old.exe"));
        let mut kept: Vec<&str> = records
            .values()
            .filter(|r| !r.is_app())
            .map(|r| r.path.as_str())
            .collect();
        kept.sort_unstable();
        assert_eq!(kept, vec!["p:2", "p:3", "p:4"]);
    }

    #[test]
    fn cleanup_invalid_paths_keeps_command_records() {
        let history = LaunchHistory::in_memory();
        history
            .record_command_usage("window-management:left_half", "Left Half")
            .unwrap();
        history
            .record_launch("Z:\\definitely\\missing.exe", "Missing")
            .unwrap();

        assert_eq!(history.cleanup_invalid_paths().unwrap(), 1);
        assert!(history.get("window-management:left_half").is_some());
    }

    // ---- Learned query tiers ----

    #[test]
    fn exact_query_is_learned_exact_and_its_prefixes_learned_prefix() {
        let mut store = QueryBindingStore::default();
        let now = 1_000_000_000_000;
        store.record_binding_at("chr", "C:\\chrome.exe", now);

        assert_eq!(
            store.learned_tier("CHR", "C:\\chrome.exe", now),
            Some(SearchTier::LearnedExact)
        );
        assert_eq!(
            store.learned_tier("ch", "C:\\chrome.exe", now),
            Some(SearchTier::AliasPrefix)
        );
        assert_eq!(store.learned_tier("chro", "C:\\chrome.exe", now), None);
        assert_eq!(store.learned_tier("ch", "C:\\other.exe", now), None);
        assert_eq!(
            store.learned_matches("ch", now),
            vec![LearnedMatch {
                result_id: "C:\\chrome.exe".to_string(),
                tier: SearchTier::AliasPrefix,
            }]
        );
    }

    #[test]
    fn learned_tiers_expire_after_the_ttl() {
        let mut store = QueryBindingStore::default();
        let then = 1_000_000_000_000;
        store.record_binding_at("ql", "quicklinks:ql-1", then);

        let within = then + LEARNED_TIER_TTL_MS;
        assert_eq!(
            store.learned_tier("ql", "quicklinks:ql-1", within),
            Some(SearchTier::LearnedExact)
        );
        let expired = within + 1;
        assert_eq!(store.learned_tier("ql", "quicklinks:ql-1", expired), None);
        assert!(store.learned_matches("ql", expired).is_empty());
    }

    #[test]
    fn exact_learning_expires_back_to_prefix_when_only_longer_queries_are_recent() {
        let mut store = QueryBindingStore::default();
        let then = 1_000_000_000_000;
        store.record_binding_at("co", "C:\\code.exe", then);
        let later = then + LEARNED_TIER_TTL_MS + 1;
        store.record_binding_at("code", "C:\\code.exe", later);

        assert_eq!(
            store.learned_tier("co", "C:\\code.exe", later),
            Some(SearchTier::AliasPrefix)
        );
        assert_eq!(
            store.learned_tier("code", "C:\\code.exe", later),
            Some(SearchTier::LearnedExact)
        );
    }

    #[test]
    fn legacy_bindings_without_exact_counts_are_prefix_only() {
        let now = chrono::Utc::now().timestamp_millis();
        let json = format!(
            r#"{{"bindings":{{"ch":[{{"queryPrefix":"ch","resultId":"C:\\chrome.exe","count":4,"lastUsed":{now}}}]}}}}"#
        );
        let store: QueryBindingStore = serde_json::from_str(&json).unwrap();
        assert_eq!(
            store.learned_tier("ch", "C:\\chrome.exe", now),
            Some(SearchTier::AliasPrefix)
        );
    }
}
