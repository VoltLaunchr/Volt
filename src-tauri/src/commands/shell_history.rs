//! Shell command history with frecency scoring
//!
//! Tracks shell commands the user has run, how often, and suggests them
//! when the user types `>` in the search bar. Modeled after
//! `launcher/history.rs`.
//!
//! # Security notes
//!
//! - The authoritative record path is the backend: `execute_shell_command*`
//!   call `record_internal()` directly after a command completes. The
//!   `record_shell_command` IPC command only accepts a `execution_id` that
//!   was issued by a real execution; it cannot be used to fabricate history
//!   entries from a compromised frontend / extension (finding #9).
//! - Command strings are redacted (bearer tokens, `--token=…`, env vars
//!   matching `*_TOKEN`/`*_SECRET`/…) before being persisted to
//!   `shell_history.json` or written to the tracing log (finding #6).
//! - The shared history map is behind `Arc<Mutex<…>>`. Disk writes happen in
//!   `tokio::task::spawn_blocking` so the async executor thread is never
//!   parked on a synchronous `fs::write` (finding #8).

use crate::commands::shell::{ShellExecutionState, redact_command};
use crate::core::error::VoltError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, info, warn};

/// Maximum number of history entries to keep.
const MAX_HISTORY_ENTRIES: usize = 500;

/// Max command length logged at debug level. Beyond this we truncate.
const LOG_COMMAND_MAX_LEN: usize = 80;

/// A single shell command history record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellHistoryRecord {
    pub command: String,
    pub run_count: u32,
    pub last_run: i64,
    pub first_run: i64,
    pub last_exit_code: i32,
    pub last_working_dir: Option<String>,
    pub pinned: bool,
}

/// Managed Tauri state for shell command history.
///
/// Internals are `Arc`-wrapped so the state can be cheaply cloned and handed
/// to spawned tasks without cloning the underlying HashMap.
pub struct ShellHistoryState {
    history: Arc<Mutex<HashMap<String, ShellHistoryRecord>>>,
    data_dir: Arc<PathBuf>,
}

impl Clone for ShellHistoryState {
    fn clone(&self) -> Self {
        Self {
            history: self.history.clone(),
            data_dir: self.data_dir.clone(),
        }
    }
}

impl ShellHistoryState {
    /// Create a new state, loading any persisted history from disk.
    pub fn new(data_dir: PathBuf) -> Self {
        let history_file = data_dir.join("shell_history.json");
        let history_map = if history_file.exists() {
            match fs::read_to_string(&history_file) {
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                Err(e) => {
                    warn!("Failed to read shell history file: {}", e);
                    HashMap::new()
                }
            }
        } else {
            HashMap::new()
        };

        Self {
            history: Arc::new(Mutex::new(history_map)),
            data_dir: Arc::new(data_dir),
        }
    }
}

fn truncate_for_log(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        return s.to_string();
    }
    let cutoff = s
        .char_indices()
        .nth(max_len)
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    format!("{}… [truncated]", &s[..cutoff])
}

/// Serialise the current map and fire-and-forget-persist it on a blocking
/// thread. The caller must release any Mutex guard before calling to avoid
/// holding a lock across async state.
fn spawn_persist(data_dir: Arc<PathBuf>, snapshot: HashMap<String, ShellHistoryRecord>) {
    tokio::task::spawn_blocking(move || {
        let path = data_dir.join("shell_history.json");
        if let Some(parent) = path.parent()
            && let Err(e) = fs::create_dir_all(parent)
        {
            warn!("shell_history: create_dir_all failed: {}", e);
            return;
        }
        match serde_json::to_string_pretty(&snapshot) {
            Ok(json) => {
                if let Err(e) = fs::write(&path, json) {
                    warn!("shell_history: fs::write failed: {}", e);
                }
            }
            Err(e) => warn!("shell_history: serialize failed: {}", e),
        }
    });
}

/// Synchronous blocking persist — used outside async contexts (e.g. during
/// tests). Kept private; prefer `spawn_persist` from async code.
#[cfg(test)]
fn persist_blocking(
    data_dir: &Path,
    snapshot: &HashMap<String, ShellHistoryRecord>,
) -> Result<(), VoltError> {
    let path = data_dir.join("shell_history.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| VoltError::Serialization(e.to_string()))?;
    fs::write(&path, json)?;
    Ok(())
}

/// Evict lowest-frecency entries when over the limit.
fn evict_if_needed(records: &mut HashMap<String, ShellHistoryRecord>) {
    if records.len() <= MAX_HISTORY_ENTRIES {
        return;
    }

    let mut entries: Vec<(String, f64)> = records
        .iter()
        .map(|(k, v)| (k.clone(), shell_frecency(v)))
        .collect();
    entries.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    let to_remove = records.len() - MAX_HISTORY_ENTRIES;
    for (key, _) in entries.into_iter().take(to_remove) {
        records.remove(&key);
    }
}

/// Get the current time as epoch milliseconds.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Compute a frecency score for a shell history record.
fn shell_frecency(record: &ShellHistoryRecord) -> f64 {
    let now = now_ms();
    let age_hours = ((now - record.last_run) as f64 / 3_600_000.0).max(0.0);
    let recency_weight = (-age_hours / 168.0).exp().max(0.2); // 1-week half-life
    record.run_count as f64 * recency_weight
}

// ---------------------------------------------------------------------------
// Authoritative backend recording path
// ---------------------------------------------------------------------------

/// Record a command that actually ran. Call this from backend code paths
/// (`execute_shell_command*`) after the child process exits. The command
/// string is redacted before being stored or logged.
///
/// This is the only trusted write path for shell history — the IPC command
/// `record_shell_command` merely validates a completion token and does not
/// accept an arbitrary command string from the frontend.
pub fn record_internal(
    state: &ShellHistoryState,
    command: String,
    exit_code: i32,
    working_dir: Option<String>,
) {
    let redacted = redact_command(command.trim());
    if redacted.is_empty() {
        return;
    }

    let snapshot = {
        let mut history = match state.history.lock() {
            Ok(g) => g,
            Err(poisoned) => {
                warn!("shell_history: recovering from poisoned mutex");
                poisoned.into_inner()
            }
        };

        let now = now_ms();
        if let Some(record) = history.get_mut(&redacted) {
            record.run_count += 1;
            record.last_run = now;
            record.last_exit_code = exit_code;
            record.last_working_dir = working_dir;
        } else {
            history.insert(
                redacted.clone(),
                ShellHistoryRecord {
                    command: redacted.clone(),
                    run_count: 1,
                    last_run: now,
                    first_run: now,
                    last_exit_code: exit_code,
                    last_working_dir: working_dir,
                    pinned: false,
                },
            );
        }

        evict_if_needed(&mut history);
        history.clone()
    }; // MutexGuard dropped before I/O

    debug!(
        "Recorded shell command (redacted): {}",
        truncate_for_log(&redacted, LOG_COMMAND_MAX_LEN)
    );

    spawn_persist(Arc::clone(&state.data_dir), snapshot);
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Verify that a shell execution actually happened. This IPC command no
/// longer accepts an arbitrary command string — the backend already recorded
/// the real command via `record_internal` when the child exited. Callers
/// pass the `execution_id` they received from `execute_shell_command*` and
/// the server checks the completion token set before acknowledging.
///
/// Returning OK therefore means "yes, that execution completed". Returning
/// an error means the caller fabricated / reused an id that was never
/// issued.
#[tauri::command]
pub async fn record_shell_command(
    execution_id: String,
    exec_state: tauri::State<'_, ShellExecutionState>,
) -> Result<(), VoltError> {
    if exec_state.consume_completion(&execution_id) {
        Ok(())
    } else {
        warn!(
            "record_shell_command: unknown execution_id {}",
            truncate_for_log(&execution_id, 64)
        );
        Err(VoltError::InvalidConfig(
            "Unknown or reused execution id".to_string(),
        ))
    }
}

/// Return all shell history sorted by frecency descending.
#[tauri::command]
pub async fn get_shell_history(
    state: tauri::State<'_, ShellHistoryState>,
) -> Result<Vec<ShellHistoryRecord>, VoltError> {
    let mut records: Vec<ShellHistoryRecord> = {
        let history = state
            .history
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        history.values().cloned().collect()
    };
    records.sort_by(|a, b| {
        shell_frecency(b)
            .partial_cmp(&shell_frecency(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(records)
}

/// Fuzzy-match `prefix` against command strings and return top N by frecency.
#[tauri::command]
pub async fn get_shell_suggestions(
    prefix: String,
    limit: Option<usize>,
    state: tauri::State<'_, ShellHistoryState>,
) -> Result<Vec<ShellHistoryRecord>, VoltError> {
    use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
    use nucleo_matcher::{Config, Matcher};

    let prefix = prefix.trim().to_lowercase();
    let limit = limit.unwrap_or(10);

    // Collect records under the lock, then release before the (potentially
    // expensive) matching work. Inlining the empty-prefix branch avoids a
    // nested re-acquisition of the same Mutex.
    let records: Vec<ShellHistoryRecord> = {
        let history = state
            .history
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        history.values().cloned().collect()
    };

    if prefix.is_empty() {
        let mut all = records;
        all.sort_by(|a, b| {
            shell_frecency(b)
                .partial_cmp(&shell_frecency(a))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        all.truncate(limit);
        return Ok(all);
    }

    let mut matcher = Matcher::new(Config::DEFAULT);
    let pattern = Pattern::new(
        &prefix,
        CaseMatching::Ignore,
        Normalization::Smart,
        AtomKind::Fuzzy,
    );

    let mut scored: Vec<(ShellHistoryRecord, f64)> = records
        .into_iter()
        .filter_map(|record| {
            let mut buf = Vec::new();
            let haystack = nucleo_matcher::Utf32Str::new(&record.command, &mut buf);
            let match_score = pattern.score(haystack, &mut matcher)?;
            let combined = match_score as f64 + shell_frecency(&record) * 0.5;
            Some((record, combined))
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);

    Ok(scored.into_iter().map(|(r, _)| r).collect())
}

/// Toggle the pinned status of a shell command.
#[tauri::command]
pub async fn pin_shell_command(
    command: String,
    state: tauri::State<'_, ShellHistoryState>,
) -> Result<(), VoltError> {
    let snapshot = {
        let mut history = state
            .history
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        match history.get_mut(&command) {
            Some(record) => {
                record.pinned = !record.pinned;
                info!(
                    "Shell command pinned={} ({})",
                    record.pinned,
                    truncate_for_log(&redact_command(&command), LOG_COMMAND_MAX_LEN)
                );
            }
            None => {
                return Err(VoltError::NotFound(format!(
                    "Shell command not in history: {}",
                    truncate_for_log(&redact_command(&command), LOG_COMMAND_MAX_LEN)
                )));
            }
        }
        history.clone()
    };
    spawn_persist(Arc::clone(&state.data_dir), snapshot);
    Ok(())
}

/// Clear all shell command history.
#[tauri::command]
pub async fn clear_shell_history(
    state: tauri::State<'_, ShellHistoryState>,
) -> Result<(), VoltError> {
    let snapshot = {
        let mut history = state
            .history
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        history.clear();
        history.clone()
    };
    spawn_persist(Arc::clone(&state.data_dir), snapshot);
    info!("Shell history cleared");
    Ok(())
}

/// Remove a single command from shell history.
#[tauri::command]
pub async fn remove_shell_command(
    command: String,
    state: tauri::State<'_, ShellHistoryState>,
) -> Result<(), VoltError> {
    let snapshot = {
        let mut history = state
            .history
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        if history.remove(&command).is_none() {
            return Err(VoltError::NotFound(format!(
                "Shell command not in history: {}",
                truncate_for_log(&redact_command(&command), LOG_COMMAND_MAX_LEN)
            )));
        }
        history.clone()
    };
    spawn_persist(Arc::clone(&state.data_dir), snapshot);
    info!(
        "Removed shell command from history: {}",
        truncate_for_log(&redact_command(&command), LOG_COMMAND_MAX_LEN)
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_frecency_recent() {
        let record = ShellHistoryRecord {
            command: "ls".to_string(),
            run_count: 5,
            last_run: now_ms(),
            first_run: now_ms(),
            last_exit_code: 0,
            last_working_dir: None,
            pinned: false,
        };
        let score = shell_frecency(&record);
        assert!(score > 4.5 && score <= 5.0);
    }

    #[test]
    fn test_shell_frecency_old() {
        let week_ago = now_ms() - (7 * 24 * 3_600_000);
        let record = ShellHistoryRecord {
            command: "ls".to_string(),
            run_count: 5,
            last_run: week_ago,
            first_run: week_ago,
            last_exit_code: 0,
            last_working_dir: None,
            pinned: false,
        };
        let score = shell_frecency(&record);
        assert!(score < 3.0);
    }

    #[test]
    fn test_evict_if_needed() {
        let mut records = HashMap::new();
        let now = now_ms();
        for i in 0..(MAX_HISTORY_ENTRIES + 10) {
            let cmd = format!("cmd_{}", i);
            records.insert(
                cmd.clone(),
                ShellHistoryRecord {
                    command: cmd,
                    run_count: 1,
                    last_run: now - (i as i64 * 1000),
                    first_run: now,
                    last_exit_code: 0,
                    last_working_dir: None,
                    pinned: false,
                },
            );
        }

        evict_if_needed(&mut records);
        assert_eq!(records.len(), MAX_HISTORY_ENTRIES);
    }

    #[test]
    fn test_persist_blocking_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "volt_shell_history_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).unwrap();

        let mut map = HashMap::new();
        map.insert(
            "ls".to_string(),
            ShellHistoryRecord {
                command: "ls".to_string(),
                run_count: 3,
                last_run: now_ms(),
                first_run: now_ms(),
                last_exit_code: 0,
                last_working_dir: None,
                pinned: false,
            },
        );

        persist_blocking(&dir, &map).unwrap();
        let on_disk: HashMap<String, ShellHistoryRecord> =
            serde_json::from_str(&fs::read_to_string(dir.join("shell_history.json")).unwrap())
                .unwrap();
        assert_eq!(on_disk.len(), 1);
        assert_eq!(on_disk["ls"].run_count, 3);

        let _ = fs::remove_dir_all(&dir);
    }
}
