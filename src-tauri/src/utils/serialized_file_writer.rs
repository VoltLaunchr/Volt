use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Serializes snapshots destined for one file and discards stale generations.
///
/// Call `reserve` while holding the mutex that protects the source data. This
/// couples snapshot order to mutation order. Writers may then run on arbitrary
/// blocking threads: the newest reserved generation is the only one allowed to
/// reach disk, and the write mutex prevents overlapping truncation/writes.
#[derive(Clone, Debug)]
pub struct SerializedFileWriter {
    inner: Arc<WriterInner>,
}

#[derive(Debug)]
struct WriterInner {
    path: PathBuf,
    latest_generation: AtomicU64,
    write_lock: Mutex<()>,
}

impl SerializedFileWriter {
    pub fn new(path: PathBuf) -> Self {
        Self {
            inner: Arc::new(WriterInner {
                path,
                latest_generation: AtomicU64::new(0),
                write_lock: Mutex::new(()),
            }),
        }
    }

    /// Reserve a monotonically increasing generation for a snapshot.
    pub fn reserve(&self) -> u64 {
        self.inner.latest_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn write_blocking(&self, generation: u64, contents: String) -> Result<(), String> {
        let _guard = self
            .inner
            .write_lock
            .lock()
            .map_err(|error| error.to_string())?;

        if generation != self.inner.latest_generation.load(Ordering::SeqCst) {
            return Ok(());
        }

        write_file(&self.inner.path, contents.as_bytes()).map_err(|error| error.to_string())
    }

    pub async fn write_async(&self, generation: u64, contents: String) -> Result<(), String> {
        let writer = self.clone();
        tokio::task::spawn_blocking(move || writer.write_blocking(generation, contents))
            .await
            .map_err(|error| format!("serialized file writer task failed: {error}"))?
    }

    /// Fire-and-forget variant for hot paths whose in-memory mutation already
    /// succeeded. Ordering is still guaranteed by the reserved generation.
    pub fn spawn_write(&self, generation: u64, contents: String) {
        let writer = self.clone();
        if tokio::runtime::Handle::try_current().is_ok() {
            tokio::task::spawn_blocking(move || {
                if let Err(error) = writer.write_blocking(generation, contents) {
                    tracing::warn!("serialized file write failed: {error}");
                }
            });
        } else if let Err(error) = writer.write_blocking(generation, contents) {
            tracing::warn!("serialized file write failed: {error}");
        }
    }
}

fn write_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temporary_path = temporary_path(path);
    let write_result = (|| {
        let mut file = File::create(&temporary_path)?;
        file.write_all(contents)?;
        file.sync_all()?;
        replace_file(&temporary_path, path)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut file_name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    file_name.push(".tmp");
    path.parent()
        .map(|parent| parent.join(&file_name))
        .unwrap_or_else(|| PathBuf::from(file_name))
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::winbase::{MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW};

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();

    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_snapshot_cannot_overwrite_latest_generation() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("state.json");
        let writer = SerializedFileWriter::new(path.clone());

        let stale = writer.reserve();
        let latest = writer.reserve();
        writer
            .write_blocking(latest, "latest".to_string())
            .expect("write latest");
        writer
            .write_blocking(stale, "stale".to_string())
            .expect("skip stale");

        assert_eq!(fs::read_to_string(path).expect("read"), "latest");
    }

    #[test]
    fn replacement_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("state.json");
        let writer = SerializedFileWriter::new(path.clone());

        let first = writer.reserve();
        writer
            .write_blocking(first, "first".to_string())
            .expect("write first");
        let second = writer.reserve();
        writer
            .write_blocking(second, "second".to_string())
            .expect("replace");

        assert_eq!(fs::read_to_string(&path).expect("read"), "second");
        assert!(!temporary_path(&path).exists());
    }
}
