//! File-system watcher that keeps the SQLite index up-to-date incrementally.
//!
//! Uses the `notify` crate under the hood.  Events are debounced by
//! `DEBOUNCE_MS` milliseconds so that bulk renames / editor saves don't flood
//! the DB with individual updates.

use crate::indexer::database::FileIndexDb;
use crate::indexer::scanner::{create_directory_info_pub, create_file_info_pub};
use notify::{
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};

/// How long to wait (ms) before flushing a debounced batch.
const DEBOUNCE_MS: u64 = 100;

// ---------------------------------------------------------------------------
// WatcherState
// ---------------------------------------------------------------------------

/// Owned handle returned to the caller.  Drop to stop watching.
pub struct WatcherHandle {
    /// The underlying notify watcher – keeping it alive keeps the watch active.
    _watcher: RecommendedWatcher,
    /// Shared flag; set to `false` to signal the worker thread to exit.
    active: Arc<Mutex<bool>>,
}

impl WatcherHandle {
    /// Stop the watcher.  The background thread will exit on the next poll.
    pub fn stop(&self) {
        if let Ok(mut flag) = self.active.lock() {
            *flag = false;
        }
    }

    pub fn is_active(&self) -> bool {
        self.active.lock().map(|f| *f).unwrap_or(false)
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Start watching `directories` and incrementally update `db`.
///
/// Returns a `WatcherHandle` whose lifetime controls the watch.  Dropping the
/// handle stops watching.
pub fn start_watcher(
    directories: Vec<String>,
    db: Arc<FileIndexDb>,
) -> Result<WatcherHandle, String> {
    if directories.is_empty() {
        return Err("No directories to watch".to_string());
    }

    let active = Arc::new(Mutex::new(true));
    let active_clone = active.clone();

    // Channel for raw notify events.
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();

    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

    // Register every directory.
    for dir in &directories {
        let path = PathBuf::from(dir);
        if path.exists() {
            match watcher.watch(&path, RecursiveMode::Recursive) {
                Ok(_) => info!("Watching directory: {}", dir),
                Err(e) => warn!("Could not watch '{}': {}", dir, e),
            }
        } else {
            warn!("Watch target does not exist (skipped): {}", dir);
        }
    }

    // Spawn a background thread that drains events with a simple debounce.
    let db_thread = db.clone();
    std::thread::spawn(move || {
        // pending_events: path → last-seen EventKind
        let mut pending: HashMap<PathBuf, EventKind> = HashMap::new();
        let mut last_flush = Instant::now();

        loop {
            // Check if we should exit.
            if !active_clone.lock().map(|f| *f).unwrap_or(false) {
                info!("File watcher thread exiting");
                break;
            }

            // Drain available events (non-blocking after the first).
            let deadline = Duration::from_millis(DEBOUNCE_MS);
            match rx.recv_timeout(deadline) {
                Ok(Ok(event)) => {
                    for path in event.paths {
                        pending.insert(path, event.kind);
                    }
                }
                Ok(Err(e)) => warn!("Watcher error: {}", e),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Time to flush pending events.
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    info!("Watcher channel closed, exiting");
                    break;
                }
            }

            // Flush if debounce window elapsed.
            if last_flush.elapsed() >= Duration::from_millis(DEBOUNCE_MS) && !pending.is_empty() {
                flush_events(&db_thread, &pending);
                pending.clear();
                last_flush = Instant::now();
            }
        }

        // Final flush.
        if !pending.is_empty() {
            flush_events(&db_thread, &pending);
        }
    });

    Ok(WatcherHandle {
        _watcher: watcher,
        active,
    })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

#[allow(clippy::collapsible_if)]
fn flush_events(db: &FileIndexDb, events: &HashMap<PathBuf, EventKind>) {
    for (path, kind) in events {
        match kind {
            // File created or modified – upsert.
            EventKind::Create(CreateKind::File)
            | EventKind::Create(CreateKind::Any)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Any) => {
                if path.is_file() {
                    match std::fs::metadata(path) {
                        Ok(meta) => {
                            if let Some(file_info) = create_file_info_pub(path, &meta) {
                                if let Err(e) = db.upsert_file(&file_info) {
                                    error!("Watcher upsert failed for {:?}: {}", path, e);
                                } else {
                                    debug!("Watcher: upserted {:?}", path);
                                }
                            }
                        }
                        Err(e) => warn!("Watcher: metadata error for {:?}: {}", path, e),
                    }
                } else if path.is_dir() {
                    if let Ok(meta) = std::fs::metadata(path) {
                        if let Some(dir_info) = create_directory_info_pub(path, &meta) {
                            if let Err(e) = db.upsert_file(&dir_info) {
                                error!("Watcher upsert (dir) failed for {:?}: {}", path, e);
                            }
                        }
                    }
                }
            }

            // File removed.
            EventKind::Remove(RemoveKind::File)
            | EventKind::Remove(RemoveKind::Any)
            | EventKind::Remove(RemoveKind::Folder) => {
                let path_str = path.to_string_lossy().to_string();
                if let Err(e) = db.remove_file(&path_str) {
                    error!("Watcher remove failed for {:?}: {}", path, e);
                } else {
                    debug!("Watcher: removed {:?}", path);
                }
            }

            // Rename: treat old name as removed, new name as created.
            EventKind::Modify(ModifyKind::Name(rename_mode)) => {
                match rename_mode {
                    RenameMode::From => {
                        let path_str = path.to_string_lossy().to_string();
                        let _ = db.remove_file(&path_str);
                    }
                    RenameMode::To => {
                        if path.is_file() {
                            if let Ok(meta) = std::fs::metadata(path) {
                                if let Some(fi) = create_file_info_pub(path, &meta) {
                                    let _ = db.upsert_file(&fi);
                                }
                            }
                        }
                    }
                    RenameMode::Both => {
                        // notify provides both old + new in the same event paths vec.
                        // We already handle it above (one path → remove, other → upsert).
                    }
                    _ => {}
                }
            }

            _ => {
                debug!("Watcher: unhandled event kind {:?} for {:?}", kind, path);
            }
        }
    }
}
