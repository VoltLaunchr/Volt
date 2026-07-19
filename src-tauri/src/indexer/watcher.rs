//! File-system watcher that keeps the SQLite index up-to-date incrementally.
//!
//! Uses the `notify` crate under the hood.  Events are debounced by
//! `DEBOUNCE_MS` milliseconds so that bulk renames / editor saves don't flood
//! the DB with individual updates.

use crate::indexer::database::FileIndexDb;
#[cfg(feature = "tantivy-search")]
use crate::indexer::fulltext::FulltextIndex;
use crate::indexer::scanner::{create_directory_info_pub, create_file_info_pub};
use crate::indexer::types::{FileInfo, IndexConfig};
use notify::{
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};

/// How long to wait (ms) before flushing a debounced batch.
const DEBOUNCE_MS: u64 = 100;
#[cfg(feature = "tantivy-search")]
const FULLTEXT_DIRTY_META_KEY: &str = "tantivy_dirty";

type SharedFileCache = Arc<Mutex<Arc<Vec<FileInfo>>>>;
type SharedFileLookup = Arc<Mutex<Arc<HashMap<String, usize>>>>;

// ---------------------------------------------------------------------------
// WatcherState
// ---------------------------------------------------------------------------

/// Owned handle returned to the caller.  Drop to stop watching.
pub struct WatcherHandle {
    /// The underlying notify watcher. Wrapped in `Option<Mutex<_>>` so that
    /// `stop()` can *explicitly* drop it, which closes the notify channel and
    /// wakes the background thread immediately instead of waiting up to
    /// `DEBOUNCE_MS` for the next poll.
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Worker thread draining notify events. Joining it during `stop()` makes
    /// shutdown a synchronization barrier before an index rebuild clears data.
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
    /// Shared atomic flag; set to `false` to signal the worker thread to exit.
    /// Uses `AtomicBool` so the thread can observe the shutdown without
    /// locking a Mutex on every iteration.
    active: Arc<AtomicBool>,
}

impl WatcherHandle {
    /// Stop the watcher. The background thread exits immediately because the
    /// notify sender is dropped (closing the event channel) and the `active`
    /// flag is flipped to `false`. Safe to call multiple times.
    pub fn stop(&self) {
        // Mark inactive first so the thread skips any further flushes even if
        // it was mid-iteration when we drop the channel sender.
        self.active.store(false, Ordering::Release);
        // Drop the notify watcher (closes the event channel).
        if let Ok(mut guard) = self.watcher.lock() {
            guard.take();
        }
        if let Ok(mut worker) = self.worker.lock()
            && let Some(handle) = worker.take()
            && handle.join().is_err()
        {
            error!("File watcher worker panicked during shutdown");
        }
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::DataChange;
    use std::fs;

    fn flush_test_events(
        db: &FileIndexDb,
        cache: &SharedFileCache,
        lookup: &SharedFileLookup,
        filter: &WatchFilter,
        events: &HashMap<PathBuf, EventKind>,
    ) {
        #[cfg(feature = "tantivy-search")]
        flush_events(db, Some(cache), Some(lookup), None, filter, events);
        #[cfg(not(feature = "tantivy-search"))]
        flush_events(db, Some(cache), Some(lookup), filter, events);
    }

    #[test]
    fn watch_filter_matches_scan_file_constraints() {
        let root = tempfile::tempdir().expect("watch root");
        let allowed = root.path().join("allowed.txt");
        let wrong_ext = root.path().join("video.mp4");
        let too_large = root.path().join("large.txt");
        let excluded_dir = root.path().join("node_modules");
        let excluded_file = excluded_dir.join("dep.txt");
        let deep_dir = root.path().join("a").join("b");
        let too_deep = deep_dir.join("deep.txt");

        fs::create_dir(&excluded_dir).expect("excluded dir");
        fs::create_dir_all(&deep_dir).expect("deep dir");
        fs::write(&allowed, b"ok").expect("allowed file");
        fs::write(&wrong_ext, b"ok").expect("wrong ext file");
        fs::write(&too_large, b"too-large").expect("large file");
        fs::write(&excluded_file, b"ok").expect("excluded file");
        fs::write(&too_deep, b"ok").expect("deep file");

        let config = IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: vec!["node_modules".to_string()],
            file_extensions: vec!["txt".to_string()],
            max_depth: 2,
            max_file_size: 4,
        };
        let filter = WatchFilter::new(&config);

        assert!(
            filter.should_index_file(&allowed, &fs::metadata(&allowed).expect("allowed metadata"))
        );
        assert!(!filter.should_index_file(
            &wrong_ext,
            &fs::metadata(&wrong_ext).expect("wrong ext metadata")
        ));
        assert!(!filter.should_index_file(
            &too_large,
            &fs::metadata(&too_large).expect("large metadata")
        ));
        assert!(!filter.should_index_file(
            &excluded_file,
            &fs::metadata(&excluded_file).expect("excluded metadata")
        ));
        assert!(
            !filter.should_index_file(&too_deep, &fs::metadata(&too_deep).expect("deep metadata"))
        );
    }

    #[test]
    fn watch_filter_keeps_scanner_directory_depth_rules() {
        let root = tempfile::tempdir().expect("watch root");
        let first_level = root.path().join("games");
        let second_level = first_level.join("Steam");
        let third_level = second_level.join("common");
        fs::create_dir_all(&third_level).expect("directory tree");

        let filtered_config = IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: Vec::new(),
            file_extensions: vec!["txt".to_string()],
            max_depth: 10,
            max_file_size: 0,
        };
        let filtered = WatchFilter::new(&filtered_config);
        assert!(filtered.should_index_directory(&first_level));
        assert!(filtered.should_index_directory(&second_level));
        assert!(!filtered.should_index_directory(&third_level));

        let unfiltered_config = IndexConfig {
            file_extensions: Vec::new(),
            ..filtered_config
        };
        let unfiltered = WatchFilter::new(&unfiltered_config);
        assert!(unfiltered.should_index_directory(&third_level));
    }

    #[test]
    fn watcher_removes_file_that_becomes_ineligible() {
        let root = tempfile::tempdir().expect("watch root");
        let file = root.path().join("notes.txt");
        fs::write(&file, b"ok").expect("initial file");
        let initial = create_file_info_pub(&file, &fs::metadata(&file).unwrap()).unwrap();
        let db = FileIndexDb::open(root.path().join("index.db")).unwrap();
        db.upsert_file(&initial).unwrap();

        let cache = Arc::new(Mutex::new(Arc::new(vec![initial.clone()])));
        let lookup = Arc::new(Mutex::new(Arc::new(HashMap::from([(
            initial.path.clone(),
            0,
        )]))));
        let filter = WatchFilter::new(&IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: Vec::new(),
            file_extensions: vec!["txt".to_string()],
            max_depth: 10,
            max_file_size: 4,
        });

        fs::write(&file, b"now-too-large").expect("oversized file");
        let events = HashMap::from([(
            file,
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        )]);
        flush_test_events(&db, &cache, &lookup, &filter, &events);

        assert_eq!(db.count().unwrap(), 0);
        assert!(cache.lock().unwrap().is_empty());
        assert!(lookup.lock().unwrap().is_empty());
    }

    #[test]
    fn watcher_folder_removal_purges_descendants_but_not_prefix_siblings() {
        let root = tempfile::tempdir().expect("watch root");
        let removed_dir = root.path().join("game");
        let removed_child = removed_dir.join("saves").join("slot.txt");
        let sibling_dir = root.path().join("game-old");
        let sibling = sibling_dir.join("keep.txt");
        fs::create_dir_all(removed_child.parent().unwrap()).unwrap();
        fs::create_dir_all(&sibling_dir).unwrap();
        fs::write(&removed_child, b"save").unwrap();
        fs::write(&sibling, b"keep").unwrap();

        let dir_info =
            create_directory_info_pub(&removed_dir, &fs::metadata(&removed_dir).unwrap()).unwrap();
        let child_info =
            create_file_info_pub(&removed_child, &fs::metadata(&removed_child).unwrap()).unwrap();
        let sibling_info =
            create_file_info_pub(&sibling, &fs::metadata(&sibling).unwrap()).unwrap();
        let indexed = vec![dir_info, child_info, sibling_info.clone()];
        let db = FileIndexDb::open(root.path().join("index.db")).unwrap();
        db.upsert_files(&indexed).unwrap();

        let cache = Arc::new(Mutex::new(Arc::new(indexed)));
        let lookup = Arc::new(Mutex::new(Arc::new(
            cache
                .lock()
                .unwrap()
                .iter()
                .enumerate()
                .map(|(index, file)| (file.path.clone(), index))
                .collect(),
        )));
        let filter = WatchFilter::new(&IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: Vec::new(),
            file_extensions: vec!["txt".to_string()],
            max_depth: 10,
            max_file_size: 1024,
        });

        fs::remove_dir_all(&removed_dir).unwrap();
        let events = HashMap::from([(removed_dir, EventKind::Remove(RemoveKind::Folder))]);
        flush_test_events(&db, &cache, &lookup, &filter, &events);

        let db_files = db.get_all_files().unwrap();
        assert_eq!(db_files.len(), 1);
        assert_eq!(db_files[0].path, sibling_info.path);
        let cached = cache.lock().unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].path, sibling_info.path);
        assert_eq!(
            lookup.lock().unwrap().get(&sibling_info.path).copied(),
            Some(0)
        );
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Start watching `directories` and incrementally update `db`.
///
/// When `in_memory_files` is `Some`, the watcher also keeps the in-memory
/// `Vec<FileInfo>` in sync so new/changed/deleted files are visible to search
/// without restarting the app.
///
/// Returns a `WatcherHandle` whose lifetime controls the watch.  Dropping the
/// handle stops watching.
pub fn start_watcher(
    config: IndexConfig,
    db: Arc<FileIndexDb>,
    #[cfg(feature = "tantivy-search")] fulltext_index: Option<Arc<FulltextIndex>>,
    in_memory_files: Option<SharedFileCache>,
    in_memory_lookup: Option<SharedFileLookup>,
) -> Result<WatcherHandle, String> {
    let directories = config.folders.clone();
    if directories.is_empty() {
        return Err("No directories to watch".to_string());
    }

    let filter = WatchFilter::new(&config);

    let active = Arc::new(AtomicBool::new(true));
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
    #[cfg(feature = "tantivy-search")]
    let fulltext_thread = fulltext_index;
    let files_thread = in_memory_files;
    let lookup_thread = in_memory_lookup;
    let filter_thread = filter;
    let worker = std::thread::spawn(move || {
        // pending_events: path → last-seen EventKind
        let mut pending: HashMap<PathBuf, EventKind> = HashMap::new();
        let mut last_flush = Instant::now();

        loop {
            // Fast check before blocking on recv.
            if !active_clone.load(Ordering::Acquire) {
                info!("File watcher thread exiting (active flag cleared)");
                break;
            }

            // Drain available events; timeout lets us re-check the flag.
            let deadline = Duration::from_millis(DEBOUNCE_MS);
            match rx.recv_timeout(deadline) {
                Ok(Ok(event)) => {
                    for path in event.paths {
                        pending.insert(path, event.kind);
                    }
                }
                Ok(Err(e)) => warn!("Watcher error: {}", e),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Fall through to flush.
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    // stop() dropped the notify watcher → channel closed.
                    info!("Watcher channel closed, exiting");
                    break;
                }
            }

            // Re-check the shutdown flag before flushing. Closes the race
            // window where flush_events could otherwise run against a DB
            // that invalidate_index has just cleared.
            if !active_clone.load(Ordering::Acquire) {
                info!("File watcher thread exiting (shutdown during poll)");
                break;
            }

            // Flush if debounce window elapsed.
            if last_flush.elapsed() >= Duration::from_millis(DEBOUNCE_MS) && !pending.is_empty() {
                #[cfg(feature = "tantivy-search")]
                flush_events(
                    &db_thread,
                    files_thread.as_ref(),
                    lookup_thread.as_ref(),
                    fulltext_thread.as_ref(),
                    &filter_thread,
                    &pending,
                );
                #[cfg(not(feature = "tantivy-search"))]
                flush_events(
                    &db_thread,
                    files_thread.as_ref(),
                    lookup_thread.as_ref(),
                    &filter_thread,
                    &pending,
                );
                pending.clear();
                last_flush = Instant::now();
            }
        }

        // No final flush on shutdown: if we're exiting because invalidate_index
        // cleared the DB, flushing stale pending events would resurrect rows.
        debug!(
            "Watcher exiting with {} pending events (intentionally dropped)",
            pending.len()
        );
    });

    Ok(WatcherHandle {
        watcher: Mutex::new(Some(watcher)),
        worker: Mutex::new(Some(worker)),
        active,
    })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct WatchFilter {
    roots: Vec<PathBuf>,
    excluded_canonical: Vec<(String, PathBuf)>,
    extensions_lower: HashSet<String>,
    max_depth: usize,
    max_file_size: u64,
}

impl WatchFilter {
    fn new(config: &IndexConfig) -> Self {
        let roots = config
            .folders
            .iter()
            .map(|folder| {
                let path = PathBuf::from(folder);
                path.canonicalize().unwrap_or(path)
            })
            .collect();

        let excluded_canonical = config
            .excluded_paths
            .iter()
            .map(|excluded| {
                let path = PathBuf::from(excluded);
                let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
                (excluded.clone(), canonical)
            })
            .collect();

        let extensions_lower = config
            .file_extensions
            .iter()
            .map(|ext| ext.to_lowercase())
            .collect();

        Self {
            roots,
            excluded_canonical,
            extensions_lower,
            max_depth: config.max_depth,
            max_file_size: config.max_file_size,
        }
    }

    fn should_index_file(&self, path: &Path, metadata: &std::fs::Metadata) -> bool {
        !self.is_excluded(path)
            && self.within_file_depth(path)
            && self.extension_allowed(path)
            && (self.max_file_size == 0 || metadata.len() <= self.max_file_size)
    }

    fn should_index_directory(&self, path: &Path) -> bool {
        if self.is_excluded(path) {
            return false;
        }

        let Some(parent_depth) = path
            .parent()
            .and_then(|parent| self.depth_from_roots(parent))
        else {
            return false;
        };

        parent_depth < self.max_depth && (parent_depth <= 1 || self.extensions_lower.is_empty())
    }

    fn within_file_depth(&self, path: &Path) -> bool {
        path.parent()
            .and_then(|parent| self.depth_from_roots(parent))
            .map(|depth| depth < self.max_depth)
            .unwrap_or(false)
    }

    fn extension_allowed(&self, path: &Path) -> bool {
        if self.extensions_lower.is_empty() {
            return true;
        }

        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| self.extensions_lower.contains(&ext.to_lowercase()))
            .unwrap_or(false)
    }

    fn is_excluded(&self, path: &Path) -> bool {
        if self.excluded_canonical.is_empty() {
            return false;
        }

        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        self.excluded_canonical.iter().any(|(raw, excluded)| {
            if excluded.is_absolute() {
                canonical.starts_with(excluded)
            } else {
                canonical.components().any(|component| {
                    component
                        .as_os_str()
                        .to_str()
                        .map(|segment| segment == raw)
                        .unwrap_or(false)
                })
            }
        })
    }

    fn depth_from_roots(&self, path: &Path) -> Option<usize> {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        self.roots
            .iter()
            .filter_map(|root| canonical.strip_prefix(root).ok())
            .map(|relative| relative.components().count())
            .min()
    }
}

fn remove_indexed_path(db: &FileIndexDb, path: &Path, removals: &mut HashSet<String>) {
    match db.remove_path_tree(path) {
        Ok(removed) => {
            removals.extend(removed);
        }
        Err(e) => error!("Watcher remove failed for {:?}: {}", path, e),
    }
}

#[allow(clippy::collapsible_if)]
fn flush_events(
    db: &FileIndexDb,
    in_memory: Option<&SharedFileCache>,
    in_memory_lookup: Option<&SharedFileLookup>,
    #[cfg(feature = "tantivy-search")] fulltext: Option<&Arc<FulltextIndex>>,
    filter: &WatchFilter,
    events: &HashMap<PathBuf, EventKind>,
) {
    // Collect changes to apply to the in-memory vec in one batch.
    let mut upserts: Vec<FileInfo> = Vec::new();
    let mut removals: HashSet<String> = HashSet::new();

    #[cfg(feature = "tantivy-search")]
    let tracks_fulltext = fulltext.is_some();
    #[cfg(feature = "tantivy-search")]
    if tracks_fulltext && let Err(e) = db.set_meta(FULLTEXT_DIRTY_META_KEY, "1") {
        error!("Watcher could not mark fulltext index dirty: {}", e);
    }

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
                            if filter.should_index_file(path, &meta) {
                                if let Some(file_info) = create_file_info_pub(path, &meta) {
                                    if let Err(e) = db.upsert_file(&file_info) {
                                        error!("Watcher upsert failed for {:?}: {}", path, e);
                                    } else {
                                        debug!("Watcher: upserted {:?}", path);
                                        upserts.push(file_info);
                                    }
                                }
                            } else {
                                remove_indexed_path(db, path, &mut removals);
                            }
                        }
                        Err(e) => warn!("Watcher: metadata error for {:?}: {}", path, e),
                    }
                } else if path.is_dir() {
                    if let Ok(meta) = std::fs::metadata(path) {
                        if filter.should_index_directory(path)
                            && let Some(dir_info) = create_directory_info_pub(path, &meta)
                        {
                            if let Err(e) = db.upsert_file(&dir_info) {
                                error!("Watcher upsert (dir) failed for {:?}: {}", path, e);
                            } else {
                                upserts.push(dir_info);
                            }
                        }
                    }
                }
            }

            // File removed.
            EventKind::Remove(RemoveKind::File)
            | EventKind::Remove(RemoveKind::Any)
            | EventKind::Remove(RemoveKind::Folder) => {
                remove_indexed_path(db, path, &mut removals);
            }

            // Rename: treat old name as removed, new name as created.
            EventKind::Modify(ModifyKind::Name(rename_mode)) => {
                match rename_mode {
                    RenameMode::From => {
                        remove_indexed_path(db, path, &mut removals);
                    }
                    RenameMode::To if path.is_file() => {
                        if let Ok(meta) = std::fs::metadata(path) {
                            if filter.should_index_file(path, &meta) {
                                if let Some(fi) = create_file_info_pub(path, &meta)
                                    && db.upsert_file(&fi).is_ok()
                                {
                                    upserts.push(fi);
                                }
                            } else {
                                remove_indexed_path(db, path, &mut removals);
                            }
                        }
                    }
                    RenameMode::Both => {
                        // For Both, we get both paths in pending but don't know
                        // which is old/new from the key alone. Check disk existence.
                        if path.exists() {
                            // New name: upsert
                            if path.is_file() {
                                if let Ok(meta) = std::fs::metadata(path) {
                                    if filter.should_index_file(path, &meta) {
                                        if let Some(fi) = create_file_info_pub(path, &meta)
                                            && db.upsert_file(&fi).is_ok()
                                        {
                                            upserts.push(fi);
                                        }
                                    } else {
                                        remove_indexed_path(db, path, &mut removals);
                                    }
                                }
                            } else if path.is_dir()
                                && filter.should_index_directory(path)
                                && let Ok(meta) = std::fs::metadata(path)
                                && let Some(dir_info) = create_directory_info_pub(path, &meta)
                                && db.upsert_file(&dir_info).is_ok()
                            {
                                upserts.push(dir_info);
                            }
                        } else {
                            // Old name: remove
                            remove_indexed_path(db, path, &mut removals);
                        }
                    }
                    _ => {}
                }
            }

            _ => {
                debug!("Watcher: unhandled event kind {:?} for {:?}", kind, path);
            }
        }
    }

    let removals: Vec<String> = removals.into_iter().collect();

    #[cfg(feature = "tantivy-search")]
    if let Some(fulltext) = fulltext
        && (!upserts.is_empty() || !removals.is_empty())
    {
        match fulltext.apply_batch(&upserts, &removals) {
            Ok(()) => {
                if let Err(e) = db.set_meta(FULLTEXT_DIRTY_META_KEY, "0") {
                    error!("Watcher could not mark fulltext index clean: {}", e);
                }
            }
            Err(e) => error!("Watcher fulltext sync failed: {}", e),
        }
    } else if tracks_fulltext {
        // No successful SQLite mutation was collected, so there is no derived
        // index work to commit and the prior clean state remains valid.
        if let Err(e) = db.set_meta(FULLTEXT_DIRTY_META_KEY, "0") {
            error!("Watcher could not restore fulltext clean marker: {}", e);
        }
    }

    // Apply collected changes to the in-memory cache in one lock acquisition.
    if let Some(files_mutex) = in_memory {
        if !upserts.is_empty() || !removals.is_empty() {
            if let Ok(mut guard) = files_mutex.lock() {
                let mut new_files: Vec<FileInfo> = (**guard).clone();

                // Apply removals
                if !removals.is_empty() {
                    let removal_set: std::collections::HashSet<&str> =
                        removals.iter().map(|s| s.as_str()).collect();
                    new_files.retain(|f| !removal_set.contains(f.path.as_str()));
                }

                // Apply upserts (update existing or insert new)
                for upsert in upserts {
                    if let Some(existing) = new_files.iter_mut().find(|f| f.path == upsert.path) {
                        *existing = upsert;
                    } else {
                        new_files.push(upsert);
                    }
                }

                let new_lookup = Arc::new(
                    new_files
                        .iter()
                        .enumerate()
                        .map(|(index, file)| (file.path.clone(), index))
                        .collect(),
                );
                if let Some(lookup_mutex) = in_memory_lookup
                    && let Ok(mut lookup_guard) = lookup_mutex.lock()
                {
                    *guard = Arc::new(new_files);
                    *lookup_guard = new_lookup;
                } else if in_memory_lookup.is_none() {
                    *guard = Arc::new(new_files);
                }
            }
        }
    }
}
