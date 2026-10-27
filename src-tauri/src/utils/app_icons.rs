//! Shared, bounded icon hydration for every webview. Native shell calls never run on the UI
//! thread. A cell per path deduplicates concurrent requests, including negative results.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, OnceCell, Semaphore};

const CACHE_CAPACITY: usize = 128;
const MAX_ICON_BYTES: usize = 128 * 1024;
const CACHE_TTL: Duration = Duration::from_secs(300);
const FAILURE_TTL: Duration = Duration::from_secs(30);

struct Entry {
    created: Instant,
    value: OnceCell<Option<String>>,
}

struct IconCache {
    entries: Mutex<HashMap<String, Arc<Entry>>>,
    workers: Arc<Semaphore>,
}

impl IconCache {
    fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            workers: Arc::new(Semaphore::new(2)),
        }
    }

    async fn load<F, Fut>(&self, path: String, extract: F) -> Option<String>
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Option<String>>,
    {
        let entry = {
            let mut entries = self.entries.lock().await;
            entries.retain(|_, entry| match entry.value.get() {
                None => true, // Never evict an extraction in flight.
                Some(value) => {
                    entry.created.elapsed()
                        < if value.is_some() {
                            CACHE_TTL
                        } else {
                            FAILURE_TTL
                        }
                }
            });
            if !entries.contains_key(&path) && entries.len() >= CACHE_CAPACITY {
                let oldest = entries
                    .iter()
                    .filter(|(_, entry)| entry.value.initialized())
                    .min_by_key(|(_, entry)| entry.created)
                    .map(|(path, _)| path.clone());
                // Bound pending work too; callers keep their placeholder if every cell is busy.
                entries.remove(&oldest?);
            }
            Arc::clone(entries.entry(path.clone()).or_insert_with(|| {
                Arc::new(Entry {
                    created: Instant::now(),
                    value: OnceCell::new(),
                })
            }))
        };
        entry
            .value
            .get_or_init(|| async {
                extract(path)
                    .await
                    .filter(|icon| icon.len() <= MAX_ICON_BYTES)
            })
            .await
            .clone()
    }
}

static ICONS: LazyLock<IconCache> = LazyLock::new(IconCache::new);

pub async fn load(path: String) -> Option<String> {
    ICONS
        .load(path, |path| async move {
            #[cfg(target_os = "windows")]
            let (path, store_logo) = if crate::utils::icon::is_uwp_aumid(&path) {
                (
                    crate::utils::store_icons::icon_path(&path)
                        .await?
                        .to_string_lossy()
                        .into_owned(),
                    true,
                )
            } else {
                (path, false)
            };
            let permit = Arc::clone(&ICONS.workers).acquire_owned().await.ok()?;
            tokio::task::spawn_blocking(move || {
                // The permit belongs to the physical worker: cancellation of its waiter cannot
                // allow more shell calls to start while this one is still running.
                let _permit = permit;
                #[cfg(target_os = "windows")]
                if store_logo {
                    return crate::utils::icon::file_to_data_url(std::path::Path::new(&path));
                }
                crate::utils::icon::extract_icon(&path)
            })
            .await
            .ok()
            .flatten()
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn deduplicates_requests_and_negative_results() {
        let cache = IconCache::new();
        let calls = AtomicUsize::new(0);
        let extract = |_| async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            None
        };
        let (first, second) = tokio::join!(
            cache.load("missing".into(), extract),
            cache.load("missing".into(), extract),
        );
        assert_eq!((first, second), (None, None));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(cache.load("missing".into(), extract).await, None);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn bounds_retained_icons_and_rejects_oversized_results() {
        let cache = IconCache::new();
        for i in 0..CACHE_CAPACITY + 10 {
            cache
                .load(i.to_string(), |_| async { Some("icon".into()) })
                .await;
        }
        assert_eq!(cache.entries.lock().await.len(), CACHE_CAPACITY);
        assert_eq!(
            cache
                .load("large".into(), |_| async {
                    Some("x".repeat(MAX_ICON_BYTES + 1))
                })
                .await,
            None
        );
    }
}
