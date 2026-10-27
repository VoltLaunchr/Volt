//! File-system watcher that keeps the SQLite index up-to-date incrementally.
//!
//! Uses the `notify` crate under the hood.  Events are debounced by
//! `DEBOUNCE_MS` milliseconds so that bulk renames / editor saves don't flood
//! the DB with individual updates.

use crate::indexer::database::FileIndexDb;
#[cfg(feature = "tantivy-search")]
use crate::indexer::fulltext::FulltextIndex;
use crate::indexer::ignore_policy::{IGNORE_FILES, IgnorePolicy};
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
const RAW_EVENT_CAPACITY: usize = 2048;
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
    ///
    /// Lock failures are recovered via `into_inner` instead of silently
    /// skipping: a poisoned mutex here would otherwise leak the worker thread,
    /// which would keep flushing stale events into the DB during a rebuild
    /// (audit passe 2, sujet 6 — STATE CORRUPTION RISK downgraded to
    /// DEGRADED: the data behind a poisoned mutex may itself be suspect, but
    /// stopping the thread is strictly safer than leaking it).
    pub fn stop(&self) {
        // Mark inactive first so the thread skips any further flushes even if
        // it was mid-iteration when we drop the channel sender.
        self.active.store(false, Ordering::Release);
        // Drop the notify watcher (closes the event channel).
        {
            let mut guard = self.watcher.lock().unwrap_or_else(|poisoned| {
                warn!("WatcherHandle.watcher mutex poisoned during stop; recovering");
                poisoned.into_inner()
            });
            guard.take();
        }
        {
            let mut worker = self.worker.lock().unwrap_or_else(|poisoned| {
                warn!("WatcherHandle.worker mutex poisoned during stop; recovering");
                poisoned.into_inner()
            });
            if let Some(handle) = worker.take()
                && handle.join().is_err()
            {
                error!("File watcher worker panicked during shutdown");
            }
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

    #[test]
    fn ignore_rule_edits_and_removal_reconcile_sqlite_cache_and_lookup() {
        let root = crate::indexer::test_tempdir();
        let file = root.path().join("secret.txt");
        fs::write(&file, b"note").unwrap();
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
            file_extensions: vec!["txt".into()],
            ..IndexConfig::default()
        });
        assert!(filter.should_index_file(&file, &fs::metadata(&file).unwrap()));
        let rules = root.path().join(".voltignore");
        fs::write(&rules, "secret.txt\n").unwrap();
        let events = HashMap::from([(rules.clone(), EventKind::Create(CreateKind::File))]);
        flush_test_events(&db, &cache, &lookup, &filter, &events);
        assert!(db.get_all_files().unwrap().is_empty());
        assert!(cache.lock().unwrap().is_empty());
        assert!(lookup.lock().unwrap().is_empty());
        fs::remove_file(&rules).unwrap();
        let events = HashMap::from([(rules, EventKind::Remove(RemoveKind::File))]);
        flush_test_events(&db, &cache, &lookup, &filter, &events);
        assert_eq!(db.get_all_files().unwrap()[0].path, initial.path);
        assert_eq!(cache.lock().unwrap()[0].path, initial.path);
        assert_eq!(lookup.lock().unwrap().get(&initial.path), Some(&0));
    }

    #[test]
    fn created_deep_directory_traverses_without_indexing_the_directory_itself() {
        let root = crate::indexer::test_tempdir();
        let moved = root.path().join("a/b/moved");
        fs::create_dir_all(&moved).unwrap();
        let child = moved.join("notes.txt");
        fs::write(&child, b"note").unwrap();
        fs::create_dir(moved.join("node_modules")).unwrap();
        fs::write(moved.join("node_modules/dep.txt"), b"excluded").unwrap();
        let db = FileIndexDb::open(root.path().join("index.db")).unwrap();
        let cache = Arc::new(Mutex::new(Arc::new(Vec::new())));
        let lookup = Arc::new(Mutex::new(Arc::new(HashMap::new())));
        let filter = WatchFilter::new(&IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            file_extensions: vec!["txt".into()],
            ..IndexConfig::default()
        });
        let events = HashMap::from([(moved, EventKind::Create(CreateKind::Folder))]);
        flush_test_events(&db, &cache, &lookup, &filter, &events);
        let files = db.get_all_files().unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, child.to_string_lossy());
    }

    #[test]
    fn parent_ignore_rule_changes_reconcile_selected_nested_root() {
        let parent = crate::indexer::test_tempdir();
        let root = parent.path().join("selected");
        fs::create_dir(&root).unwrap();
        let file = root.join("notes.txt");
        fs::write(&file, b"note").unwrap();
        let initial = create_file_info_pub(&file, &fs::metadata(&file).unwrap()).unwrap();
        let db = FileIndexDb::open(parent.path().join("index.db")).unwrap();
        db.upsert_file(&initial).unwrap();
        let cache = Arc::new(Mutex::new(Arc::new(vec![initial])));
        let lookup = Arc::new(Mutex::new(Arc::new(HashMap::new())));
        let filter = WatchFilter::new(&IndexConfig {
            folders: vec![root.to_string_lossy().into_owned()],
            file_extensions: vec!["txt".into()],
            ..IndexConfig::default()
        });
        let rules = parent.path().join(".voltignore");
        fs::write(&rules, "*.txt\n").unwrap();
        flush_test_events(
            &db,
            &cache,
            &lookup,
            &filter,
            &HashMap::from([(rules.clone(), EventKind::Create(CreateKind::File))]),
        );
        assert!(db.get_all_files().unwrap().is_empty());
        fs::remove_file(&rules).unwrap();
        flush_test_events(
            &db,
            &cache,
            &lookup,
            &filter,
            &HashMap::from([(rules, EventKind::Remove(RemoveKind::File))]),
        );
        assert_eq!(db.get_all_files().unwrap()[0].name, "notes.txt");
        assert_eq!(cache.lock().unwrap()[0].name, "notes.txt");
        assert_eq!(
            lookup.lock().unwrap().values().copied().collect::<Vec<_>>(),
            vec![0]
        );
    }

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
        let root = crate::indexer::test_tempdir();
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
            ..IndexConfig::default()
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
        let root = crate::indexer::test_tempdir();
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
            ..IndexConfig::default()
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
    fn watcher_indexes_created_and_renamed_directories() {
        for kind in [
            EventKind::Create(CreateKind::Folder),
            EventKind::Modify(ModifyKind::Name(RenameMode::To)),
        ] {
            let root = crate::indexer::test_tempdir();
            let folder = root.path().join("games");
            fs::create_dir(&folder).unwrap();
            let db = FileIndexDb::open(root.path().join("index.db")).unwrap();
            let cache = Arc::new(Mutex::new(Arc::new(Vec::new())));
            let lookup = Arc::new(Mutex::new(Arc::new(HashMap::new())));
            let filter = WatchFilter::new(&IndexConfig {
                folders: vec![root.path().to_string_lossy().into_owned()],
                excluded_paths: Vec::new(),
                file_extensions: vec!["txt".to_string()],
                max_depth: 10,
                max_file_size: 0,
                ..IndexConfig::default()
            });
            let events = HashMap::from([(folder.clone(), kind)]);
            flush_test_events(&db, &cache, &lookup, &filter, &events);
            let expected =
                create_directory_info_pub(&folder, &fs::metadata(&folder).unwrap()).unwrap();
            assert_eq!(db.get_all_files().unwrap()[0].path, expected.path);
            assert_eq!(cache.lock().unwrap()[0].path, expected.path);
            assert_eq!(lookup.lock().unwrap().get(&expected.path), Some(&0));
        }
    }

    #[test]
    fn watcher_removes_file_that_becomes_ineligible() {
        let root = crate::indexer::test_tempdir();
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
            ..IndexConfig::default()
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
        let root = crate::indexer::test_tempdir();
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
            ..IndexConfig::default()
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

    #[test]
    fn watcher_new_directory_indexes_subtree() {
        // Regression: a moved/copied directory used to index only the folder
        // entry — children stayed invisible until the next full scan.
        let root = crate::indexer::test_tempdir();
        let moved_dir = root.path().join("moved");
        let nested = moved_dir.join("sub");
        fs::create_dir_all(&nested).expect("nested dir");
        let child_a = moved_dir.join("a.txt");
        let child_b = nested.join("b.txt");
        fs::write(&child_a, b"a").expect("child a");
        fs::write(&child_b, b"b").expect("child b");

        let db = FileIndexDb::open(root.path().join("index.db")).unwrap();
        let cache = Arc::new(Mutex::new(Arc::new(Vec::new())));
        let lookup = Arc::new(Mutex::new(Arc::new(HashMap::new())));
        let filter = WatchFilter::new(&IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: Vec::new(),
            file_extensions: vec!["txt".to_string()],
            max_depth: 10,
            max_file_size: 1024,
            ..IndexConfig::default()
        });

        let events = HashMap::from([(moved_dir.clone(), EventKind::Create(CreateKind::Folder))]);
        flush_test_events(&db, &cache, &lookup, &filter, &events);

        let mut paths: Vec<String> = db
            .get_all_files()
            .unwrap()
            .into_iter()
            .map(|f| f.path)
            .collect();
        paths.sort();
        assert!(
            paths.iter().any(|p| p.ends_with("a.txt")),
            "moved tree child a.txt indexed, got {paths:?}"
        );
        assert!(
            paths.iter().any(|p| p.ends_with("b.txt")),
            "moved tree nested b.txt indexed, got {paths:?}"
        );
        let cached = cache.lock().unwrap();
        assert!(cached.iter().any(|f| f.path.ends_with("a.txt")));
        assert!(cached.iter().any(|f| f.path.ends_with("b.txt")));
    }

    /// Sujet 2: `take_flush_batch` ne perd ni ne duplique aucun chemin.
    /// Pur et déterministe (aucun sleep, aucune I/O).
    #[test]
    fn churn_counter_attributes_events_to_deepest_root_and_persists_keys_only() {
        let dir = crate::indexer::test_tempdir();
        let outer = dir.path().join("outer");
        let inner = outer.join("inner");
        fs::create_dir_all(&inner).unwrap();
        let db = FileIndexDb::open(dir.path().join("churn.db")).unwrap();
        let mut churn = ChurnCounter::new(&[outer.clone(), inner.clone()]);
        churn.count(&outer.join("a.txt"));
        churn.count(&inner.join("b.txt"));
        churn.count(&inner.join("c.txt"));
        churn.count(&dir.path().join("elsewhere.txt"));
        // Not due yet: nothing written.
        churn.persist_if_due(&db, false);
        assert!(db.get_stats(false).unwrap().watcher_churn.is_empty());
        churn.persist_if_due(&db, true);
        let stored = db.get_stats(false).unwrap().watcher_churn;
        let key = |p: &Path| crate::indexer::database::root_diagnostic_key(p);
        let events = |k: String| stored.iter().find(|e| e.root == k).map(|e| e.events);
        assert_eq!(events(key(&outer)), Some(1));
        assert_eq!(events(key(&inner)), Some(2));
        assert_eq!(stored.len(), 2);
        let raw = serde_json::to_string(&stored).unwrap();
        assert!(!raw.contains("outer") && !raw.contains("inner"));
    }

    #[test]
    fn flush_batch_split_is_lossless() {
        let mut pending: HashMap<PathBuf, EventKind> = (0..5_000)
            .map(|i| {
                (
                    PathBuf::from(format!("/w/f{i}.txt")),
                    EventKind::Create(CreateKind::File),
                )
            })
            .collect();
        let batch = take_flush_batch(&mut pending, 2_000);
        assert_eq!(batch.len(), 2_000);
        assert_eq!(pending.len(), 3_000);
        // Union sans perte ni doublon.
        let mut all: Vec<PathBuf> = batch.into_keys().chain(pending.into_keys()).collect();
        all.sort();
        let expected: Vec<PathBuf> = (0..5_000)
            .map(|i| PathBuf::from(format!("/w/f{i}.txt")))
            .collect::<Vec<_>>()
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        assert_eq!(all, expected);

        // Sous le cap: tout est drainé d'un coup.
        let mut small: HashMap<PathBuf, EventKind> = (0..10)
            .map(|i| {
                (
                    PathBuf::from(format!("/w/s{i}.txt")),
                    EventKind::Remove(RemoveKind::File),
                )
            })
            .collect();
        let batch = take_flush_batch(&mut small, 2_000);
        assert_eq!(batch.len(), 10);
        assert!(small.is_empty());
    }

    /// Sujet 2 (stress): 30 000 événements synthétiques à travers un vrai
    /// `flush_events` — 2 000 fichiers réels + 28 000 chemins inexistants
    /// (coalescing + stat-at-flush). Prouve que le flush à grande échelle
    /// termine et indexe exactement les fichiers présents, sans perte.
    #[test]
    fn flush_events_handles_tens_of_thousands_of_paths() {
        let root = crate::indexer::test_tempdir();
        let live_dir = root.path().join("live");
        fs::create_dir(&live_dir).expect("live dir");
        let mut events: HashMap<PathBuf, EventKind> = HashMap::new();
        for i in 0..2_000 {
            let p = live_dir.join(format!("f{i}.txt"));
            fs::write(&p, b"x").expect("live file");
            events.insert(p, EventKind::Create(CreateKind::File));
        }
        for i in 0..28_000 {
            events.insert(
                root.path().join(format!("ghost{i}.txt")),
                EventKind::Create(CreateKind::File),
            );
        }
        assert_eq!(events.len(), 30_000);

        let db = FileIndexDb::open(root.path().join("index.db")).unwrap();
        let cache = Arc::new(Mutex::new(Arc::new(Vec::new())));
        let lookup = Arc::new(Mutex::new(Arc::new(HashMap::new())));
        let filter = WatchFilter::new(&IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: Vec::new(),
            file_extensions: vec!["txt".to_string()],
            max_depth: 10,
            max_file_size: 0,
            ..IndexConfig::default()
        });

        flush_test_events(&db, &cache, &lookup, &filter, &events);

        assert_eq!(db.count().unwrap(), 2_000);
        assert_eq!(cache.lock().unwrap().len(), 2_000);
        assert_eq!(lookup.lock().unwrap().len(), 2_000);
    }

    /// Sujet 1-D: une mutation dont l'écriture SQLite échoue ne doit atteindre
    /// NI le cache NI le lookup (tout-ou-rien par mutation). Ici la table est
    /// supprimée sous les pieds du handle via une SECONDE connexion (publique
    /// uniquement): chaque upsert échoue, donc le cache doit rester vide —
    /// jamais diverger seul.
    #[test]
    fn failed_db_mutation_leaves_cache_untouched() {
        let root = crate::indexer::test_tempdir();
        let file = root.path().join("doomed.txt");
        fs::write(&file, b"x").expect("file");
        let db_path = root.path().join("index.db");
        let db = FileIndexDb::open(&db_path).unwrap();
        rusqlite::Connection::open(&db_path)
            .unwrap()
            .execute_batch("DROP TABLE files;")
            .unwrap();

        let cache = Arc::new(Mutex::new(Arc::new(Vec::new())));
        let lookup = Arc::new(Mutex::new(Arc::new(HashMap::new())));
        let filter = WatchFilter::new(&IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: Vec::new(),
            file_extensions: vec!["txt".to_string()],
            max_depth: 10,
            max_file_size: 0,
            ..IndexConfig::default()
        });
        let events = HashMap::from([(file, EventKind::Create(CreateKind::File))]);
        flush_test_events(&db, &cache, &lookup, &filter, &events);

        assert!(cache.lock().unwrap().is_empty());
        assert!(lookup.lock().unwrap().is_empty());
    }

    /// Sujet 6: `flush_events` récupère d'un mutex empoisonné au lieu de
    /// sauter silencieusement le swap (qui désynchroniserait DB/cache).
    /// Le poison est provoqué déterministiquement par un thread qui panique
    /// en tenant le verrou.
    #[test]
    fn flush_recovers_from_poisoned_cache_mutex() {
        fn poison<T: Send + 'static>(m: &Arc<Mutex<T>>) {
            let clone = Arc::clone(m);
            std::thread::spawn(move || {
                let _guard = clone.lock().unwrap();
                panic!("intentional poison for test");
            })
            .join()
            .unwrap_err();
        }

        let root = crate::indexer::test_tempdir();
        let file = root.path().join("healed.txt");
        fs::write(&file, b"x").expect("file");
        let db = FileIndexDb::open(root.path().join("index.db")).unwrap();
        let cache = Arc::new(Mutex::new(Arc::new(Vec::new())));
        let lookup = Arc::new(Mutex::new(Arc::new(HashMap::new())));
        poison(&cache);
        poison(&lookup);
        assert!(cache.lock().is_err());
        assert!(lookup.lock().is_err());

        let filter = WatchFilter::new(&IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: Vec::new(),
            file_extensions: vec!["txt".to_string()],
            max_depth: 10,
            max_file_size: 0,
            ..IndexConfig::default()
        });
        let events = HashMap::from([(file, EventKind::Create(CreateKind::File))]);
        flush_test_events(&db, &cache, &lookup, &filter, &events);

        // Le swap a eu lieu malgré le poison: DB et cache concordent.
        // (Le bit de poison persiste après `into_inner`, donc on relit via
        // la même récupération — c'est le comportement documenté du Mutex.)
        assert_eq!(db.count().unwrap(), 1);
        assert_eq!(cache.lock().unwrap_or_else(|e| e.into_inner()).len(), 1);
        assert_eq!(lookup.lock().unwrap_or_else(|e| e.into_inner()).len(), 1);
    }

    /// Sujet 6: `WatcherHandle::stop` avec mutex internes empoisonnés ne doit
    /// ni paniquer ni fuir le thread worker.
    #[test]
    fn watcher_stop_recovers_from_poisoned_handle_mutexes() {
        let handle = WatcherHandle {
            watcher: Mutex::new(None),
            worker: Mutex::new(Some(std::thread::spawn(|| {}))),
            active: Arc::new(AtomicBool::new(true)),
        };
        // Poison déterministe sans thread: la panique se propage à travers le
        // garde (qui empoisonne le mutex en se détruisant) jusqu'au
        // `catch_unwind`, qui la contient. Motif standard, 100 % synchrone.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = handle.watcher.lock().unwrap();
            panic!("intentional poison for test");
        }));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = handle.worker.lock().unwrap();
            panic!("intentional poison for test");
        }));
        assert!(handle.watcher.lock().is_err());
        assert!(handle.worker.lock().is_err());

        handle.stop();
        assert!(!handle.is_active());
        assert!(
            handle
                .worker
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_none()
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
    mutation_gate: Arc<tokio::sync::Mutex<()>>,
) -> Result<WatcherHandle, String> {
    let directories = config.folders.clone();
    if directories.is_empty() {
        return Err("No directories to watch".to_string());
    }

    let filter = WatchFilter::new(&config);

    let active = Arc::new(AtomicBool::new(true));
    let active_clone = active.clone();

    // Apply backpressure on notify's worker instead of allowing an unbounded heap backlog.
    // The callback observes shutdown so dropping the watcher cannot deadlock on a full queue.
    let (tx, rx) = std::sync::mpsc::sync_channel::<notify::Result<Event>>(RAW_EVENT_CAPACITY);
    let callback_active = Arc::clone(&active);
    let mut watcher = notify::recommended_watcher(move |event| {
        send_watcher_event(&tx, &callback_active, event);
    })
    .map_err(|e| format!("Failed to create file watcher: {}", e))?;

    // Register every directory.
    for path in minimal_watch_roots(&directories, &filter.policy) {
        if filter.has_symlink_ancestor(&path) {
            warn!("Watch target uses a symlink (skipped): {:?}", path);
            continue;
        }
        if path.exists() {
            match watcher.watch(&path, RecursiveMode::Recursive) {
                Ok(_) => info!("Watching directory: {:?}", path),
                Err(e) => warn!("Could not watch '{:?}': {}", path, e),
            }
        } else {
            warn!("Watch target does not exist (skipped): {:?}", path);
        }
    }

    if config.respect_ignore_files {
        // Parent ignore files apply even when a nested directory is the only
        // selected root. Nonrecursive watches also observe newly-created rules.
        let parents: HashSet<PathBuf> = filter
            .roots
            .iter()
            .flat_map(|root| root.parent().into_iter().flat_map(Path::ancestors))
            .filter(|parent| !filter.roots.iter().any(|root| parent.starts_with(root)))
            .map(Path::to_path_buf)
            .collect();
        for parent in parents {
            if let Err(e) = watcher.watch(&parent, RecursiveMode::NonRecursive) {
                warn!("Could not watch parent ignore rules in {:?}: {}", parent, e);
            }
        }
    }

    // Spawn a background thread that drains events with a simple debounce.
    let db_thread = db.clone();
    #[cfg(feature = "tantivy-search")]
    let fulltext_thread = fulltext_index;
    let files_thread = in_memory_files;
    let lookup_thread = in_memory_lookup;
    let filter_thread = filter;
    let mutation_gate_thread = mutation_gate;
    let mut churn = config
        .diagnostics_enabled
        .then(|| ChurnCounter::new(&filter_thread.roots));
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
            // Flush before accepting more paths when the pending batch is full. Together
            // with the bounded raw queue this also bounds memory while SQLite is busy.
            let batch_full = pending.len() >= FLUSH_BATCH_CAP;
            let received = if batch_full {
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            } else {
                rx.recv_timeout(deadline)
            };
            match received {
                Ok(Ok(event)) => {
                    for path in event.paths {
                        if matches!(event.kind, EventKind::Access(_)) {
                            continue;
                        }
                        let normalized = filter_thread.policy.normalize_path(&path);
                        let inside_root = filter_thread
                            .roots
                            .iter()
                            .any(|root| normalized.starts_with(root));
                        let parent_rule = filter_thread.policy.respects_ignore_files()
                            && path
                                .file_name()
                                .and_then(|name| name.to_str())
                                .is_some_and(|name| IGNORE_FILES.contains(&name));
                        if inside_root && let Some(churn) = churn.as_mut() {
                            churn.count(&normalized);
                        }
                        if inside_root || parent_rule {
                            pending.insert(path, event.kind);
                        }
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
            if (batch_full || last_flush.elapsed() >= Duration::from_millis(DEBOUNCE_MS))
                && !pending.is_empty()
            {
                // A full reconcile holds this gate from scan start through
                // snapshot commit. Raw notify events remain queued meanwhile
                // and are applied on top of the new snapshot after release.
                let _mutation_guard = mutation_gate_thread.blocking_lock();
                // Chunk huge backlogs (sujet 2): one giant flush would hold
                // the gate for minutes. The remainder stays queued and
                // coalesces with newly arriving events — nothing is dropped.
                let batch = take_flush_batch(&mut pending, FLUSH_BATCH_CAP);
                if !pending.is_empty() {
                    debug!(
                        "Watcher flush chunked: {} paths this round, {} deferred",
                        batch.len(),
                        pending.len()
                    );
                }
                #[cfg(feature = "tantivy-search")]
                flush_events(
                    &db_thread,
                    files_thread.as_ref(),
                    lookup_thread.as_ref(),
                    fulltext_thread.as_ref(),
                    &filter_thread,
                    &batch,
                );
                #[cfg(not(feature = "tantivy-search"))]
                flush_events(
                    &db_thread,
                    files_thread.as_ref(),
                    lookup_thread.as_ref(),
                    &filter_thread,
                    &batch,
                );
                last_flush = Instant::now();
            }
            if let Some(churn) = churn.as_mut() {
                churn.persist_if_due(&db_thread, false);
            }
        }
        if let Some(churn) = churn.as_mut() {
            churn.persist_if_due(&db_thread, true);
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

fn send_watcher_event(
    sender: &std::sync::mpsc::SyncSender<notify::Result<Event>>,
    active: &AtomicBool,
    mut event: notify::Result<Event>,
) {
    while active.load(Ordering::Acquire) {
        match sender.try_send(event) {
            Ok(()) | Err(std::sync::mpsc::TrySendError::Disconnected(_)) => return,
            Err(std::sync::mpsc::TrySendError::Full(returned)) => {
                event = returned;
                std::thread::sleep(Duration::from_millis(2));
            }
        }
    }
}

/// Only native registrations are collapsed. Keep ALL configured roots in WatchFilter, since
/// a nested explicit root may have its own depth/ignore semantics.
fn minimal_watch_roots(directories: &[String], policy: &IgnorePolicy) -> Vec<PathBuf> {
    let mut candidates: Vec<_> = directories
        .iter()
        .map(|directory| {
            (
                policy.normalize_path(Path::new(directory)),
                PathBuf::from(directory),
            )
        })
        .collect();
    candidates.sort_by_key(|(normalized, _)| normalized.components().count());
    let mut kept: Vec<(PathBuf, PathBuf)> = Vec::new();
    for candidate in candidates {
        if !kept
            .iter()
            .any(|(parent, _)| candidate.0.starts_with(parent))
        {
            kept.push(candidate);
        }
    }
    kept.into_iter().map(|(_, original)| original).collect()
}

#[cfg(test)]
mod backpressure_tests {
    use super::*;

    #[test]
    fn collapses_nested_registrations_without_changing_filter_roots() {
        let base = std::env::temp_dir().join("volt-watch-roots");
        let outer = base.join("programs");
        let inner = outer.join("steam");
        let sibling = base.join("programs-other");
        let config = IndexConfig {
            folders: vec![
                inner.to_string_lossy().into_owned(),
                outer.to_string_lossy().into_owned(),
                sibling.to_string_lossy().into_owned(),
                outer.to_string_lossy().into_owned(),
            ],
            ..Default::default()
        };
        let filter = WatchFilter::new(&config);
        let roots = minimal_watch_roots(&config.folders, &filter.policy);
        assert_eq!(roots.len(), 2);
        assert!(roots.contains(&outer));
        assert!(roots.contains(&sibling));
        assert_eq!(filter.roots.len(), 4);
    }

    #[test]
    fn full_queue_preserves_event_then_allows_shutdown() {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let active = Arc::new(AtomicBool::new(true));
        tx.send(Ok(Event::new(EventKind::Any))).unwrap();
        let worker_active = Arc::clone(&active);
        let worker = std::thread::spawn(move || {
            send_watcher_event(&tx, &worker_active, Ok(Event::new(EventKind::Other)));
            send_watcher_event(&tx, &worker_active, Ok(Event::new(EventKind::Any)));
        });
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap()
                .kind,
            EventKind::Any
        );
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap()
                .kind,
            EventKind::Other
        );
        active.store(false, Ordering::Release);
        worker.join().unwrap();
    }

    #[test]
    fn shutdown_unblocks_a_producer_with_a_full_queue() {
        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        tx.send(Ok(Event::new(EventKind::Any))).unwrap();
        let active = Arc::new(AtomicBool::new(true));
        let worker_active = Arc::clone(&active);
        let worker = std::thread::spawn(move || {
            send_watcher_event(&tx, &worker_active, Ok(Event::new(EventKind::Any)));
        });
        active.store(false, Ordering::Release);
        worker.join().unwrap();
    }
}

/// Opt-in, local watcher churn measurement: raw event counts per indexed root
/// and UTC day, persisted in the index metadata at most every
/// [`CHURN_PERSIST_INTERVAL`]. Only opaque root keys are written.
struct ChurnCounter {
    roots: Vec<(PathBuf, String)>,
    counts: HashMap<usize, u64>,
    day: i64,
    last_persist: Instant,
}

const CHURN_PERSIST_INTERVAL: Duration = Duration::from_secs(60);

impl ChurnCounter {
    fn new(roots: &[PathBuf]) -> Self {
        Self {
            roots: roots
                .iter()
                .map(|root| {
                    (
                        root.clone(),
                        crate::indexer::database::root_diagnostic_key(root),
                    )
                })
                .collect(),
            counts: HashMap::new(),
            day: crate::indexer::database::current_churn_day(),
            last_persist: Instant::now(),
        }
    }

    /// Attribute one event to the deepest root containing `normalized`.
    fn count(&mut self, normalized: &Path) {
        if let Some((index, _)) = self
            .roots
            .iter()
            .enumerate()
            .filter(|(_, (root, _))| normalized.starts_with(root))
            .max_by_key(|(_, (root, _))| root.components().count())
        {
            *self.counts.entry(index).or_default() += 1;
        }
    }

    fn persist_if_due(&mut self, db: &FileIndexDb, force: bool) {
        let today = crate::indexer::database::current_churn_day();
        let due =
            force || today != self.day || self.last_persist.elapsed() >= CHURN_PERSIST_INTERVAL;
        if !due {
            return;
        }
        if !self.counts.is_empty() {
            let counts: Vec<(String, u64)> = self
                .counts
                .drain()
                .map(|(index, events)| (self.roots[index].1.clone(), events))
                .collect();
            if let Err(e) = db.record_watcher_events(self.day, &counts) {
                warn!("Watcher diagnostics not persisted: {}", e);
            }
        }
        self.day = today;
        self.last_persist = Instant::now();
    }
}

#[derive(Debug, Clone)]
struct WatchFilter {
    roots: Vec<PathBuf>,
    // Matching uses canonical roots; indexed paths retain the scanner's spelling
    // (Windows canonicalize adds \\?\, which must not become a new database key).
    scan_roots: Vec<PathBuf>,
    policy: IgnorePolicy,
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

        let extensions_lower = config
            .file_extensions
            .iter()
            .map(|ext| ext.to_lowercase())
            .collect();

        Self {
            roots,
            scan_roots: config.folders.iter().map(PathBuf::from).collect(),
            policy: IgnorePolicy::new(config),
            extensions_lower,
            max_depth: config.max_depth,
            max_file_size: config.max_file_size,
        }
    }

    fn should_index_file(&self, path: &Path, metadata: &std::fs::Metadata) -> bool {
        !metadata.file_type().is_symlink()
            && !self.has_symlink_ancestor(path)
            && self.policy.allows(path, false)
            && !path
                .parent()
                .is_some_and(crate::indexer::scanner::is_sensitive_directory)
            && self.within_file_depth(path)
            && self.extension_allowed(path)
            && (self.max_file_size == 0 || metadata.len() <= self.max_file_size)
    }

    fn should_index_directory(&self, path: &Path) -> bool {
        if !self.directory_allowed(path) {
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

    fn should_traverse_directory(&self, path: &Path) -> bool {
        self.directory_allowed(path)
            && self
                .depth_from_roots(path)
                .is_some_and(|depth| depth < self.max_depth)
    }

    fn directory_allowed(&self, path: &Path) -> bool {
        !self.has_symlink_ancestor(path)
            && self.policy.allows(path, true)
            && !crate::indexer::scanner::is_sensitive_directory(path)
    }

    fn has_symlink_ancestor(&self, path: &Path) -> bool {
        path.ancestors().any(|ancestor| {
            std::fs::symlink_metadata(ancestor).is_ok_and(|m| m.file_type().is_symlink())
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

    fn snapshot_path(&self, canonical_path: &Path) -> PathBuf {
        self.roots
            .iter()
            .zip(&self.scan_roots)
            .filter_map(|(canonical_root, scan_root)| {
                canonical_path
                    .strip_prefix(canonical_root)
                    .ok()
                    .map(|relative| (canonical_root, scan_root.join(relative)))
            })
            .max_by_key(|(root, _)| root.components().count())
            .map(|(_, path)| path)
            .unwrap_or_else(|| canonical_path.to_path_buf())
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

/// Upper bound for the recursive re-walk when a directory appears via
/// create/rename. Prevents a single `mv huge-tree` from exploding the watcher
/// flush (DB + in-memory + Tantivy) — beyond the cap we keep the dir entry
/// and let the next full scan pick up the rest.
const DIR_SUBTREE_WALK_LIMIT: usize = 5000;

/// Flush-wide cap on recursive directory-walk entries (audit passe 2, sujet
/// 2). Each created directory re-walks up to `DIR_SUBTREE_WALK_LIMIT` files;
/// 1 000 created dirs would otherwise mean 5M stats in ONE flush while
/// holding the mutation gate. When the shared budget runs out, remaining
/// walks are skipped (their dir entries are still indexed) and the next full
/// scan heals the contents. Never drops paths — only defers deep walks.
const FLUSH_WALK_BUDGET: usize = 20_000;

/// Max distinct paths processed in a single flush (audit passe 2, sujet 2).
/// The coalescing map is bounded by DISTINCT paths, and the raw notify
/// channel is unbounded, so a mass operation (untarg, git checkout, OS
/// update) during a gate hold can queue tens of thousands of paths. Flushing
/// all of them at once would hold the mutation gate for minutes and starve
/// scans/searches. Chunking keeps every path (no loss, no reorder — new
/// events coalesce into the retained remainder) while bounding per-flush
/// latency. The remainder is flushed on the next debounce window.
const FLUSH_BATCH_CAP: usize = 2_000;

/// Split at most `cap` entries off `pending` for one flush round.
///
/// Pure function (no I/O, no locks) so the batching discipline is unit
/// testable. Returns the batch; `pending` retains the remainder, into which
/// subsequently arriving events coalesce normally. No path is ever dropped.
fn take_flush_batch(
    pending: &mut HashMap<PathBuf, EventKind>,
    cap: usize,
) -> HashMap<PathBuf, EventKind> {
    if pending.len() <= cap {
        return std::mem::take(pending);
    }
    let keys: Vec<PathBuf> = pending.keys().take(cap).cloned().collect();
    keys.into_iter()
        .filter_map(|k| pending.remove(&k).map(|v| (k, v)))
        .collect()
}

/// Index the contents of a newly-appeared directory.
///
/// `notify` reports a moved/copied directory as a single `To` event for the
/// root only — without this walk only the folder entry would be searchable
/// until the next full scan. Files are filtered with the same rules as the
/// scanner (symlinks skipped, extension/size/depth/exclusion honoured).
fn index_dir_subtree(
    db: &FileIndexDb,
    dir: &Path,
    filter: &WatchFilter,
    upserts: &mut Vec<FileInfo>,
    walk_budget: &mut usize,
) {
    let mut stack = vec![dir.to_path_buf()];
    let mut visited = 0usize;
    while let Some(current) = stack.pop() {
        if !filter.should_traverse_directory(&current) {
            continue;
        }
        let entries = match std::fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(e) => {
                warn!("Watcher: cannot list new dir {:?}: {}", current, e);
                continue;
            }
        };
        for entry in entries.flatten() {
            if *walk_budget == 0 {
                warn!(
                    "Watcher: flush walk budget exhausted at {:?}; remaining subtree \
                     contents left for next full scan",
                    dir
                );
                return;
            }
            if visited >= DIR_SUBTREE_WALK_LIMIT {
                warn!(
                    "Watcher: new-dir walk of {:?} hit {}-entry cap; remainder left for next full scan",
                    dir, DIR_SUBTREE_WALK_LIMIT
                );
                return;
            }
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if let Ok(meta) = std::fs::metadata(&path)
                    && filter.should_index_directory(&path)
                    && let Some(dir_info) = create_directory_info_pub(&path, &meta)
                {
                    if let Err(e) = db.upsert_file(&dir_info) {
                        error!("Watcher upsert (new-subdir) failed for {:?}: {}", path, e);
                    } else {
                        upserts.push(dir_info);
                    }
                }
                if filter.should_traverse_directory(&path) {
                    stack.push(path);
                }
                visited += 1;
                *walk_budget = walk_budget.saturating_sub(1);
            } else if file_type.is_file() {
                visited += 1;
                *walk_budget = walk_budget.saturating_sub(1);
                match std::fs::metadata(&path) {
                    Ok(meta) => {
                        if filter.should_index_file(&path, &meta)
                            && let Some(file_info) = create_file_info_pub(&path, &meta)
                        {
                            if let Err(e) = db.upsert_file(&file_info) {
                                error!("Watcher upsert (new-tree) failed for {:?}: {}", path, e);
                            } else {
                                upserts.push(file_info);
                            }
                        }
                    }
                    Err(e) => warn!("Watcher: metadata error for {:?}: {}", path, e),
                }
            }
        }
    }
}

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
    // Shared across every subtree re-walk in this flush (see FLUSH_WALK_BUDGET).
    let mut walk_budget = FLUSH_WALK_BUDGET;
    // Rules can change between batches; never keep a stale matcher in a watcher.
    filter.policy.invalidate();

    #[cfg(feature = "tantivy-search")]
    let tracks_fulltext = fulltext.is_some();
    #[cfg(feature = "tantivy-search")]
    if tracks_fulltext && let Err(e) = db.set_meta(FULLTEXT_DIRTY_META_KEY, "1") {
        error!("Watcher could not mark fulltext index dirty: {}", e);
    }

    if filter.policy.respects_ignore_files() {
        let changed_dirs: HashSet<PathBuf> = events
            .iter()
            .filter_map(|(path, kind)| {
                let name = path.file_name()?.to_str()?;
                if IGNORE_FILES.contains(&name)
                    && matches!(
                        kind,
                        EventKind::Create(_)
                            | EventKind::Remove(_)
                            | EventKind::Modify(
                                ModifyKind::Data(_) | ModifyKind::Any | ModifyKind::Name(_)
                            )
                    )
                {
                    path.parent().map(|parent| {
                        parent
                            .canonicalize()
                            .unwrap_or_else(|_| parent.to_path_buf())
                    })
                } else {
                    None
                }
            })
            .collect();
        if !changed_dirs.is_empty() {
            // Remove only rejected records. Keeping accepted records preserves
            // the old snapshot when the bounded re-walk cannot finish this batch.
            match db.get_all_files() {
                Ok(indexed) => {
                    for file in indexed {
                        let path = Path::new(&file.path);
                        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
                        if changed_dirs.iter().any(|dir| canonical.starts_with(dir))
                            && !filter.policy.allows(path, file.extension == "folder")
                        {
                            match db.remove_file(&file.path) {
                                Ok(()) => {
                                    removals.insert(file.path);
                                }
                                Err(e) => error!("Watcher ignore-rule removal failed: {}", e),
                            }
                        }
                    }
                }
                Err(e) => error!("Watcher ignore-rule reconciliation failed: {}", e),
            }
            let walk_roots: HashSet<PathBuf> = changed_dirs
                .iter()
                .flat_map(|directory| {
                    filter.roots.iter().filter_map(move |root| {
                        if root.starts_with(directory) {
                            Some(root.clone())
                        } else if directory.starts_with(root) {
                            Some(directory.clone())
                        } else {
                            None
                        }
                    })
                })
                .collect();
            for directory in walk_roots {
                let directory = filter.snapshot_path(&directory);
                index_dir_subtree(db, &directory, filter, &mut upserts, &mut walk_budget);
            }
        }
    }

    for (path, kind) in events {
        if let Ok(metadata) = std::fs::symlink_metadata(path)
            && (metadata.file_type().is_symlink()
                || (metadata.is_dir() && !filter.directory_allowed(path)))
        {
            remove_indexed_path(db, path, &mut removals);
            continue;
        }
        match kind {
            // File created or modified – upsert.
            EventKind::Create(CreateKind::File)
            | EventKind::Create(CreateKind::Folder)
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
                    if filter.should_index_directory(path)
                        && let Ok(meta) = std::fs::symlink_metadata(path)
                        && let Some(dir_info) = create_directory_info_pub(path, &meta)
                    {
                        if let Err(e) = db.upsert_file(&dir_info) {
                            error!("Watcher upsert (dir) failed for {:?}: {}", path, e);
                        } else {
                            upserts.push(dir_info);
                        }
                    }
                    index_dir_subtree(db, path, filter, &mut upserts, &mut walk_budget);
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
                    RenameMode::To | RenameMode::Both => {
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
                            } else if path.is_dir() {
                                if filter.should_index_directory(path)
                                    && let Ok(meta) = std::fs::symlink_metadata(path)
                                    && let Some(dir_info) = create_directory_info_pub(path, &meta)
                                    && db.upsert_file(&dir_info).is_ok()
                                {
                                    upserts.push(dir_info);
                                }
                                index_dir_subtree(db, path, filter, &mut upserts, &mut walk_budget);
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
    // Poison is recovered (not skipped): a wholesale snapshot rebuild from
    // the just-committed DB mutations heals rather than propagates whatever
    // the panicking holder left behind. Skipping here while SQLite+Tantivy
    // advanced would desynchronize the three stores (sujet 6).
    if let Some(files_mutex) = in_memory
        && (!upserts.is_empty() || !removals.is_empty())
    {
        let mut guard = files_mutex.lock().unwrap_or_else(|poisoned| {
            warn!("Watcher file-cache mutex poisoned during flush; recovering");
            poisoned.into_inner()
        });
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
        if let Some(lookup_mutex) = in_memory_lookup {
            let mut lookup_guard = lookup_mutex.lock().unwrap_or_else(|poisoned| {
                warn!("Watcher lookup mutex poisoned during flush; recovering");
                poisoned.into_inner()
            });
            *guard = Arc::new(new_files);
            *lookup_guard = new_lookup;
        } else {
            *guard = Arc::new(new_files);
        }
    }
}
