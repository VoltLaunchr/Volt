//! Encrypted-at-rest SQLite support (Pilier C).
//!
//! This module is the single integration point for encrypting Volt's SQLite
//! datastores with SQLCipher. It is built around two requirements:
//!
//! 1. **Default build unchanged.** With the `sqlcipher` Cargo feature *off*
//!    (the default), [`open_db`] is a thin alias over `Connection::open` — the
//!    exact behavior every call site has today. No new build dependency, no
//!    runtime change.
//! 2. **Opt-in encryption.** With `--features sqlcipher`, [`open_db`] reads (or
//!    provisions on first run) a per-database encryption key from the OS keyring,
//!    migrates an existing plaintext database atomically, and applies SQLCipher's
//!    `PRAGMA key` before any other statement.
//!
//! The high-level rationale, threat model, migration plan and rollout live in
//! `REFONTE-PILIER-C-SQLCIPHER.md` at the repo root.
//!
//! ## Key management
//!
//! The database key is a 32-byte CSPRNG value, hex-encoded, stored in the OS
//! keyring under a path-scoped account using the existing
//! [`crate::commands::keyring_store`] abstraction (DPAPI on Windows, Keychain
//! on macOS, Secret Service on Linux). The key never lives on disk in plaintext
//! and never crosses the IPC boundary into the renderer. Losing the keyring
//! entry means losing access to encrypted data — the standard, accepted
//! trade-off for at-rest encryption.
//!
use rusqlite::Connection;
#[cfg(feature = "sqlcipher")]
use std::fs::{File, OpenOptions};
use std::path::Path;
#[cfg(any(feature = "sqlcipher", test))]
use std::path::PathBuf;
#[cfg(feature = "sqlcipher")]
use std::sync::{Mutex, OnceLock};
#[cfg(feature = "sqlcipher")]
use tracing::warn;

#[cfg(feature = "sqlcipher")]
static DB_OPEN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Prefix for per-database SQLCipher keys in the OS keyring.
///
/// Each database receives an independent key derived from its absolute path.
/// This prevents loss or replacement of one store's key from orphaning every
/// other encrypted store.
#[cfg(feature = "sqlcipher")]
pub const DB_KEY_ACCOUNT_PREFIX: &str = "sqlcipher_db_key";

/// Global keyring account used by the first SQLCipher implementation.
/// Windows stored it in Credential Manager through `keyring` (DPAPI-backed).
#[cfg(feature = "sqlcipher")]
const LEGACY_DB_KEY_ACCOUNT: &str = "sqlcipher_db_key";

/// Suffix for the keyring marker recording that a path has completed its
/// plaintext-to-SQLCipher transition. Once present, plaintext at that path is
/// treated as a downgrade/replacement attempt and is never auto-migrated.
#[cfg(feature = "sqlcipher")]
const DB_ENCRYPTED_MARKER_SUFFIX: &str = ":encrypted";

/// Length, in bytes, of the database encryption key.
#[cfg(any(feature = "sqlcipher", test))]
pub const DB_KEY_LEN: usize = 32;

/// Open a SQLite database, applying encryption-at-rest when the `sqlcipher`
/// feature is enabled.
///
/// * **`sqlcipher` off (default):** plain `Connection::open(path)` — identical
///   to the current behavior at every existing call site.
/// * **`sqlcipher` on:** provisions/reads the keyring key and opens an
///   encrypted connection via [`open_encrypted`].
///
/// Callers should treat the returned [`Connection`] exactly as before — set
/// their own WAL / `foreign_keys` PRAGMAs and run migrations *after* this
/// returns. (Under SQLCipher, `PRAGMA key` has already been applied first,
/// which is the required ordering.)
pub fn open_db(path: impl AsRef<Path>) -> Result<Connection, String> {
    let path = path.as_ref();

    #[cfg(feature = "sqlcipher")]
    {
        let _open_guard = DB_OPEN_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|e| format!("Database open lock poisoned: {e}"))?;
        open_db_with_store(path, &OsDbKeyStore)
    }

    #[cfg(not(feature = "sqlcipher"))]
    {
        open_plain(path)
    }
}

#[cfg(feature = "sqlcipher")]
trait DbKeyStore {
    fn retrieve_current(&self, account: &str) -> Result<Option<String>, String>;
    fn retrieve_legacy(&self) -> Result<Option<String>, String>;
    fn store_current(&self, account: &str, key_hex: &str) -> Result<(), String>;
    fn is_marked_encrypted(&self, account: &str) -> Result<bool, String>;
    fn mark_encrypted(&self, account: &str) -> Result<(), String>;
}

#[cfg(feature = "sqlcipher")]
struct OsDbKeyStore;

#[cfg(feature = "sqlcipher")]
impl DbKeyStore for OsDbKeyStore {
    fn retrieve_current(&self, account: &str) -> Result<Option<String>, String> {
        // Database encryption keys must never be deleted or rejected because
        // the separate application HMAC key is unavailable, rotated or
        // corrupt. SQLCipher itself authenticates the candidate key when the
        // database is opened.
        crate::commands::keyring_store::retrieve(account)
    }

    fn retrieve_legacy(&self) -> Result<Option<String>, String> {
        // Historical SQLCipher keys predate companion HMAC tags.
        crate::commands::keyring_store::retrieve(LEGACY_DB_KEY_ACCOUNT)
    }

    fn store_current(&self, account: &str, key_hex: &str) -> Result<(), String> {
        crate::commands::keyring_store::store(account, key_hex)
    }

    fn is_marked_encrypted(&self, account: &str) -> Result<bool, String> {
        Ok(
            crate::commands::keyring_store::retrieve(&encrypted_marker_account(account))?
                .is_some_and(|value| value == "1"),
        )
    }

    fn mark_encrypted(&self, account: &str) -> Result<(), String> {
        crate::commands::keyring_store::store(&encrypted_marker_account(account), "1")
    }
}

#[cfg(feature = "sqlcipher")]
fn open_db_with_store(path: &Path, store: &impl DbKeyStore) -> Result<Connection, String> {
    let account = db_key_account(path)?;
    let key = retrieve_db_key(store, &account)?;
    let marked_encrypted = store.is_marked_encrypted(&account)?;
    restore_interrupted_migration(path, key.as_deref(), marked_encrypted)?;

    match key {
        Some(key) => open_existing_or_migrate(path, &key, store, &account, marked_encrypted),
        None => open_without_current_key(path, store, &account, marked_encrypted),
    }
}

#[cfg(feature = "sqlcipher")]
fn open_without_current_key(
    path: &Path,
    store: &impl DbKeyStore,
    account: &str,
    marked_encrypted: bool,
) -> Result<Connection, String> {
    if path.exists() && !is_plaintext_database(path) {
        let Some(legacy_key) = retrieve_legacy_db_key(store)? else {
            return Err(missing_existing_database_key_error(path));
        };

        // An opaque existing DB authenticates the legacy key before migration.
        // Never store an unverified key or generate a replacement here.
        let conn = open_encrypted(path, &legacy_key)
            .map_err(|_| missing_existing_database_key_error(path))?;
        store.store_current(account, &legacy_key)?;
        store.mark_encrypted(account)?;
        return Ok(conn);
    }

    if path.exists() && marked_encrypted {
        return Err(plaintext_downgrade_error(path));
    }

    // A global legacy key is only accepted after authenticating an already
    // encrypted database. Plaintext stores always receive fresh independent
    // per-database keys.
    let key = generate_and_store_db_key(store, account)?;
    if path.exists() {
        migrate_plaintext_database(path, &key)?;
    }
    let conn = open_encrypted(path, &key)?;
    store.mark_encrypted(account)?;
    Ok(conn)
}

#[cfg(feature = "sqlcipher")]
fn missing_existing_database_key_error(path: &Path) -> String {
    format!(
        "Database key is missing for existing encrypted or unreadable database '{}'. Refusing to generate a replacement key.",
        path.display()
    )
}

#[cfg(feature = "sqlcipher")]
fn plaintext_downgrade_error(path: &Path) -> String {
    format!(
        "Database '{}' was previously marked encrypted but is now readable as plaintext. Refusing automatic downgrade or replacement migration.",
        path.display()
    )
}

/// Plain (unencrypted) open used by the default build and unit tests.
#[cfg(any(not(feature = "sqlcipher"), test))]
pub fn open_plain(path: impl AsRef<Path>) -> Result<Connection, String> {
    Connection::open(path.as_ref()).map_err(|e| {
        format!(
            "Failed to open database '{}': {}",
            path.as_ref().display(),
            e
        )
    })
}

#[cfg(feature = "sqlcipher")]
fn db_key_account(path: &Path) -> Result<String, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Failed to resolve database path: {}", e))?
            .join(path)
    };
    let normalized = absolute.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    let normalized = normalized.to_lowercase();
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(normalized.as_bytes());
    Ok(format!("{}:{}", DB_KEY_ACCOUNT_PREFIX, hex::encode(digest)))
}

#[cfg(feature = "sqlcipher")]
fn encrypted_marker_account(account: &str) -> String {
    format!("{account}{DB_ENCRYPTED_MARKER_SUFFIX}")
}

#[cfg(feature = "sqlcipher")]
fn retrieve_db_key(store: &impl DbKeyStore, account: &str) -> Result<Option<String>, String> {
    let Some(existing) = store.retrieve_current(account)? else {
        return Ok(None);
    };

    let trimmed = existing.trim().to_string();
    validate_hex_key(&trimmed)?;
    Ok(Some(trimmed))
}

#[cfg(feature = "sqlcipher")]
fn retrieve_legacy_db_key(store: &impl DbKeyStore) -> Result<Option<String>, String> {
    let Some(existing) = store.retrieve_legacy()? else {
        return Ok(None);
    };

    let trimmed = existing.trim().to_string();
    validate_hex_key(&trimmed)?;
    Ok(Some(trimmed))
}

#[cfg(feature = "sqlcipher")]
fn generate_and_store_db_key(store: &impl DbKeyStore, account: &str) -> Result<String, String> {
    let key_hex = generate_key_hex();
    store.store_current(account, &key_hex)?;
    Ok(key_hex)
}

#[cfg(feature = "sqlcipher")]
fn open_existing_or_migrate(
    path: &Path,
    key_hex: &str,
    store: &impl DbKeyStore,
    account: &str,
    marked_encrypted: bool,
) -> Result<Connection, String> {
    if !path.exists() {
        let conn = open_encrypted(path, key_hex)?;
        store.mark_encrypted(account)?;
        return Ok(conn);
    }

    match open_encrypted(path, key_hex) {
        Ok(conn) => {
            remove_plaintext_backup(path)?;
            remove_temporary_migration_artifacts_best_effort(path);
            store.mark_encrypted(account)?;
            Ok(conn)
        }
        Err(_encrypted_error) if is_plaintext_database(path) && !marked_encrypted => {
            migrate_plaintext_database(path, key_hex)?;
            let conn = open_encrypted(path, key_hex)?;
            store.mark_encrypted(account)?;
            Ok(conn)
        }
        Err(_) if is_plaintext_database(path) => Err(plaintext_downgrade_error(path)),
        Err(encrypted_error) => Err(format!(
            "{}; the database is not readable as plaintext, so automatic migration was refused",
            encrypted_error
        )),
    }
}

/// Open an encrypted SQLite connection and apply the SQLCipher `PRAGMA key`.
///
/// `key_hex` must be a 64-char hex string (32 bytes). The raw-key form
/// `x'<hex>'` is used so SQLCipher consumes the bytes directly and skips
/// PBKDF2 — appropriate because the key is already full-entropy random, not a
/// human passphrase.
///
/// `PRAGMA key` is issued **before** any other statement, as SQLCipher
/// requires. Callers apply WAL/`foreign_keys`/schema *after* this returns.
#[cfg(feature = "sqlcipher")]
pub fn open_encrypted(path: impl AsRef<Path>, key_hex: &str) -> Result<Connection, String> {
    let path = path.as_ref();
    validate_hex_key(key_hex)?;

    let conn = Connection::open(path).map_err(|e| {
        format!(
            "Failed to open encrypted database '{}': {}",
            path.display(),
            e
        )
    })?;

    // Raw-key form: bypasses PBKDF2 since we supply full-entropy bytes.
    conn.execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))
        .map_err(|e| format!("Failed to apply SQLCipher key: {}", e))?;

    // Probe: confirms the key is correct / the file is a SQLCipher DB. A wrong
    // key (or a plaintext file opened as encrypted) fails here with
    // "file is not a database", which is the signal the migration path
    // (see REFONTE-PILIER-C-SQLCIPHER.md §5) keys off of.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .map_err(|e| {
            format!(
                "SQLCipher key verification failed for '{}': {}",
                path.display(),
                e
            )
        })?;

    Ok(conn)
}

#[cfg(feature = "sqlcipher")]
fn is_plaintext_database(path: &Path) -> bool {
    let Ok(conn) = Connection::open(path) else {
        return false;
    };
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .is_ok()
}

#[cfg(feature = "sqlcipher")]
fn migrate_plaintext_database(path: &Path, key_hex: &str) -> Result<(), String> {
    validate_hex_key(key_hex)?;
    let _migration_lock = MigrationFileLock::acquire(path)?;

    let encrypted_path = migration_path(path, ".encrypted.tmp");
    let backup_path = migration_path(path, ".plaintext.bak");

    if backup_path.exists() {
        return Err(format!(
            "Refusing to migrate '{}' because recovery backup '{}' already exists",
            path.display(),
            backup_path.display()
        ));
    }
    if encrypted_path.exists() {
        std::fs::remove_file(&encrypted_path).map_err(|e| {
            format!(
                "Failed to remove stale encrypted migration file '{}': {}",
                encrypted_path.display(),
                e
            )
        })?;
    }

    let conn = Connection::open(path)
        .map_err(|e| format!("Failed to open plaintext database for migration: {}", e))?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .map_err(|e| format!("Database is not readable as plaintext: {}", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to configure migration busy timeout: {}", e))?;
    prepare_plaintext_database_for_migration(&conn)?;

    let encrypted_path_text = encrypted_path.to_string_lossy().into_owned();
    conn.execute(
        &format!("ATTACH DATABASE ?1 AS encrypted KEY \"x'{key_hex}'\""),
        rusqlite::params![encrypted_path_text],
    )
    .map_err(|e| format!("Failed to attach encrypted migration database: {}", e))?;

    let export_result = conn
        .query_row("SELECT sqlcipher_export('encrypted')", [], |_| Ok(()))
        .map_err(|e| format!("Failed to export plaintext database to SQLCipher: {}", e));
    let detach_result = conn
        .execute_batch("DETACH DATABASE encrypted")
        .map_err(|e| format!("Failed to detach encrypted migration database: {}", e));

    export_result?;
    detach_result?;
    drop(conn);
    remove_plaintext_sidecars(path)?;

    std::fs::rename(path, &backup_path).map_err(|e| {
        format!(
            "Failed to move plaintext database '{}' to recovery backup: {}",
            path.display(),
            e
        )
    })?;

    if let Err(e) = std::fs::rename(&encrypted_path, path) {
        return rollback_install_failure(
            path,
            &backup_path,
            &encrypted_path,
            format!(
                "Failed to install encrypted database '{}': {}",
                path.display(),
                e
            ),
        );
    }

    if let Err(e) = open_encrypted(path, key_hex) {
        return rollback_install_failure(
            path,
            &backup_path,
            &encrypted_path,
            format!(
                "Encrypted database verification failed after migration: {}",
                e
            ),
        );
    }

    remove_plaintext_backup(path)?;
    remove_temporary_migration_artifacts_best_effort(path);
    Ok(())
}

#[cfg(feature = "sqlcipher")]
fn prepare_plaintext_database_for_migration(conn: &Connection) -> Result<(), String> {
    let (busy, log_frames, checkpointed_frames): (i64, i64, i64) = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| format!("Failed to checkpoint plaintext database WAL: {e}"))?;
    if busy != 0 || checkpointed_frames != log_frames {
        return Err(format!(
            "Plaintext database WAL checkpoint did not complete (busy={busy}, log_frames={log_frames}, checkpointed_frames={checkpointed_frames}); refusing migration"
        ));
    }

    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode=DELETE", [], |row| row.get(0))
        .map_err(|e| format!("Failed to switch plaintext database out of WAL mode: {e}"))?;
    if !journal_mode.eq_ignore_ascii_case("delete") {
        return Err(format!(
            "Plaintext database remained in journal mode '{journal_mode}' after checkpoint; refusing migration"
        ));
    }

    conn.execute_batch(
        "PRAGMA locking_mode=EXCLUSIVE;
         BEGIN EXCLUSIVE;
         COMMIT;",
    )
    .map_err(|e| {
        format!(
            "Failed to obtain exclusive access and checkpoint plaintext database: {}",
            e
        )
    })
}

#[cfg(feature = "sqlcipher")]
struct MigrationFileLock {
    file: File,
}

#[cfg(feature = "sqlcipher")]
impl MigrationFileLock {
    fn acquire(path: &Path) -> Result<Self, String> {
        use fs4::fs_std::FileExt;

        let lock_path = migration_path(path, ".migration.lock");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .map_err(|e| {
                format!(
                    "Failed to open database migration lock '{}': {e}",
                    lock_path.display()
                )
            })?;
        if !file.try_lock_exclusive().map_err(|e| {
            format!(
                "Failed to acquire database migration lock '{}': {e}",
                lock_path.display()
            )
        })? {
            return Err(format!(
                "Another process is already migrating database '{}'",
                path.display()
            ));
        }
        Ok(Self { file })
    }
}

#[cfg(feature = "sqlcipher")]
impl Drop for MigrationFileLock {
    fn drop(&mut self) {
        let _ = fs4::fs_std::FileExt::unlock(&self.file);
    }
}

#[cfg(feature = "sqlcipher")]
fn remove_plaintext_sidecars(path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm"] {
        let sidecar = migration_path(path, suffix);
        if sidecar.exists() {
            std::fs::remove_file(&sidecar).map_err(|e| {
                format!(
                    "Failed to remove plaintext SQLite sidecar '{}': {}",
                    sidecar.display(),
                    e
                )
            })?;
        }
    }
    Ok(())
}

#[cfg(feature = "sqlcipher")]
fn rollback_install_failure(
    path: &Path,
    backup_path: &Path,
    encrypted_path: &Path,
    cause: String,
) -> Result<(), String> {
    let mut rollback_errors = Vec::new();

    if path.exists()
        && let Err(e) = std::fs::rename(path, encrypted_path)
    {
        rollback_errors.push(format!(
            "failed to quarantine encrypted candidate '{}': {}",
            path.display(),
            e
        ));
    }
    if !path.exists()
        && let Err(e) = std::fs::rename(backup_path, path)
    {
        rollback_errors.push(format!(
            "failed to restore plaintext backup '{}': {}",
            backup_path.display(),
            e
        ));
    }
    if !is_plaintext_database(path) {
        rollback_errors.push(format!(
            "restored database '{}' is not readable as plaintext",
            path.display()
        ));
    }

    if rollback_errors.is_empty() {
        Err(cause)
    } else {
        Err(format!(
            "{}; rollback errors: {}",
            cause,
            rollback_errors.join("; ")
        ))
    }
}

#[cfg(feature = "sqlcipher")]
fn restore_interrupted_migration(
    path: &Path,
    key_hex: Option<&str>,
    marked_encrypted: bool,
) -> Result<(), String> {
    let backup_path = migration_path(path, ".plaintext.bak");
    if !backup_path.exists() {
        return Ok(());
    }

    if !is_plaintext_database(&backup_path) {
        return Err(format!(
            "Interrupted migration backup '{}' is not readable as plaintext; refusing recovery",
            backup_path.display()
        ));
    }

    if !path.exists() {
        if marked_encrypted {
            return Err(format!(
                "Database '{}' was previously marked encrypted; refusing to restore plaintext migration backup '{}'",
                path.display(),
                backup_path.display()
            ));
        }
        restore_verified_plaintext_backup(path, &backup_path)?;
        return Ok(());
    }

    if key_hex.is_some_and(|key| open_encrypted(path, key).is_ok()) || is_plaintext_database(path) {
        return Ok(());
    }

    // Without the key, an unreadable file may still be a valid SQLCipher DB.
    // Keep it in place rather than replacing data we cannot authenticate.
    if key_hex.is_none() {
        return Ok(());
    }

    if marked_encrypted {
        return Err(format!(
            "Database '{}' was previously marked encrypted; refusing to replace the unreadable primary with plaintext backup '{}'",
            path.display(),
            backup_path.display()
        ));
    }

    let quarantine_path = available_quarantine_path(path)?;
    std::fs::rename(path, &quarantine_path).map_err(|e| {
        format!(
            "Failed to quarantine interrupted migration candidate '{}' as '{}': {}",
            path.display(),
            quarantine_path.display(),
            e
        )
    })?;

    if let Err(restore_error) = restore_verified_plaintext_backup(path, &backup_path) {
        let rollback_error = std::fs::rename(&quarantine_path, path).err();
        return Err(match rollback_error {
            Some(error) => format!(
                "{}; failed to restore quarantined candidate '{}': {}",
                restore_error,
                quarantine_path.display(),
                error
            ),
            None => restore_error,
        });
    }

    Ok(())
}

#[cfg(feature = "sqlcipher")]
fn restore_verified_plaintext_backup(path: &Path, backup_path: &Path) -> Result<(), String> {
    std::fs::rename(backup_path, path).map_err(|e| {
        format!(
            "Failed to restore interrupted database migration from '{}': {}",
            backup_path.display(),
            e
        )
    })?;

    if is_plaintext_database(path) {
        return Ok(());
    }

    let rollback_error = std::fs::rename(path, backup_path).err();
    Err(match rollback_error {
        Some(error) => format!(
            "Restored database '{}' is not readable as plaintext; failed to return it to backup '{}': {}",
            path.display(),
            backup_path.display(),
            error
        ),
        None => format!(
            "Restored database '{}' is not readable as plaintext",
            path.display()
        ),
    })
}

#[cfg(feature = "sqlcipher")]
fn available_quarantine_path(path: &Path) -> Result<PathBuf, String> {
    let first = migration_path(path, ".encrypted.failed");
    if !first.exists() {
        return Ok(first);
    }

    for attempt in 1..=u16::MAX {
        let candidate = migration_path(path, &format!(".encrypted.failed.{attempt}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "No available quarantine path for interrupted migration candidate '{}'",
        path.display()
    ))
}

#[cfg(feature = "sqlcipher")]
fn remove_plaintext_backup(path: &Path) -> Result<(), String> {
    let backup = migration_path(path, ".plaintext.bak");
    if !backup.exists() {
        return Ok(());
    }
    std::fs::remove_file(&backup).map_err(|e| {
        format!(
            "Encrypted database is valid but plaintext backup '{}' could not be removed: {}",
            backup.display(),
            e
        )
    })
}

#[cfg(feature = "sqlcipher")]
fn remove_temporary_migration_artifacts_best_effort(path: &Path) {
    for suffix in [".encrypted.tmp", ".encrypted.failed"] {
        let artifact = migration_path(path, suffix);
        if artifact.exists()
            && let Err(e) = std::fs::remove_file(&artifact)
        {
            warn!(
                path = %artifact.display(),
                error = %e,
                "Failed to remove SQLCipher migration artifact"
            );
        }
    }
}

#[cfg(any(feature = "sqlcipher", test))]
fn migration_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

/// Generate a fresh 32-byte key from the OS CSPRNG, hex-encoded.
///
/// Always compiled (not feature-gated) so the key-generation logic is unit
/// tested even in the default build. Matches the `rand 0.9` pattern used in
/// `utils::extension_state_sig`.
#[cfg(any(feature = "sqlcipher", test))]
fn generate_key_hex() -> String {
    use rand::RngCore;
    let mut key = [0u8; DB_KEY_LEN];
    rand::rng().fill_bytes(&mut key);
    hex::encode(key)
}

/// Validate that `key_hex` decodes to exactly [`DB_KEY_LEN`] bytes of valid
/// hex. Always compiled so it can be unit tested without the `sqlcipher`
/// feature; also used by the feature-gated open/provision paths.
#[cfg(any(feature = "sqlcipher", test))]
fn validate_hex_key(key_hex: &str) -> Result<(), String> {
    let bytes =
        hex::decode(key_hex).map_err(|e| format!("Database key is not valid hex: {}", e))?;
    if bytes.len() != DB_KEY_LEN {
        return Err(format!(
            "Database key has unexpected length ({} bytes, expected {})",
            bytes.len(),
            DB_KEY_LEN
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "sqlcipher")]
    use std::{
        cell::RefCell,
        collections::{HashMap, HashSet},
    };

    #[cfg(feature = "sqlcipher")]
    #[derive(Default)]
    struct FakeDbKeyStore {
        current: RefCell<HashMap<String, String>>,
        legacy: RefCell<Option<String>>,
        stores: RefCell<Vec<(String, String)>>,
        encrypted_markers: RefCell<HashSet<String>>,
    }

    #[cfg(feature = "sqlcipher")]
    impl DbKeyStore for FakeDbKeyStore {
        fn retrieve_current(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self.current.borrow().get(account).cloned())
        }

        fn retrieve_legacy(&self) -> Result<Option<String>, String> {
            Ok(self.legacy.borrow().clone())
        }

        fn store_current(&self, account: &str, key_hex: &str) -> Result<(), String> {
            self.current
                .borrow_mut()
                .insert(account.to_string(), key_hex.to_string());
            self.stores
                .borrow_mut()
                .push((account.to_string(), key_hex.to_string()));
            Ok(())
        }

        fn is_marked_encrypted(&self, account: &str) -> Result<bool, String> {
            Ok(self.encrypted_markers.borrow().contains(account))
        }

        fn mark_encrypted(&self, account: &str) -> Result<(), String> {
            self.encrypted_markers
                .borrow_mut()
                .insert(account.to_string());
            Ok(())
        }
    }

    #[test]
    fn generated_key_is_valid_64_char_hex() {
        let key = generate_key_hex();
        assert_eq!(key.len(), DB_KEY_LEN * 2, "32 bytes -> 64 hex chars");
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
        // A freshly generated key must satisfy our own validator.
        validate_hex_key(&key).expect("generated key should validate");
    }

    #[test]
    fn generated_keys_are_distinct() {
        // Two CSPRNG draws colliding would be astronomically unlikely; this
        // guards against an accidental constant/zeroed buffer regression.
        let a = generate_key_hex();
        let b = generate_key_hex();
        assert_ne!(a, b);
        // And neither is all-zero.
        assert_ne!(a, "0".repeat(DB_KEY_LEN * 2));
    }

    #[test]
    fn validate_hex_key_rejects_bad_input() {
        // Not hex.
        assert!(validate_hex_key("not-hex-zz").is_err());
        // Right charset, wrong length (too short — 16 bytes).
        assert!(validate_hex_key(&"ab".repeat(16)).is_err());
        // Right charset, wrong length (too long — 48 bytes).
        assert!(validate_hex_key(&"cd".repeat(48)).is_err());
        // Empty.
        assert!(validate_hex_key("").is_err());
    }

    #[test]
    fn validate_hex_key_accepts_exact_length() {
        // Exactly 32 bytes of hex.
        assert!(validate_hex_key(&"ff".repeat(DB_KEY_LEN)).is_ok());
    }

    #[test]
    fn open_plain_creates_usable_db() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("scaffold_test.db");
        let conn = open_plain(&path).expect("open_plain should succeed");
        conn.execute_batch("CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);")
            .expect("schema + insert");
        let n: i64 = conn
            .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
            .expect("query");
        assert_eq!(n, 1);
    }

    #[test]
    fn migration_paths_preserve_original_filename() {
        let path = Path::new("notes.db");
        assert_eq!(
            migration_path(path, ".encrypted.tmp"),
            PathBuf::from("notes.db.encrypted.tmp")
        );
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn migrates_plaintext_database_without_losing_data() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("migration.db");
        let plain = Connection::open(&path).expect("open plaintext");
        plain
            .execute_batch("CREATE TABLE t (value TEXT); INSERT INTO t VALUES ('kept');")
            .expect("seed plaintext");
        drop(plain);

        let key = generate_key_hex();
        migrate_plaintext_database(&path, &key).expect("migration should succeed");

        let encrypted = open_encrypted(&path, &key).expect("encrypted DB should reopen");
        let value: String = encrypted
            .query_row("SELECT value FROM t", [], |row| row.get(0))
            .expect("migrated row");
        assert_eq!(value, "kept");
        assert!(!migration_path(&path, ".plaintext.bak").exists());
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn bundled_sqlcipher_contains_wal_reset_fix() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("versions.db");
        let key = generate_key_hex();
        let conn = open_encrypted(&path, &key).expect("open encrypted DB");

        let sqlite_version: String = conn
            .query_row("SELECT sqlite_version()", [], |row| row.get(0))
            .expect("SQLite version");
        let cipher_version: String = conn
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))
            .expect("SQLCipher version");

        let sqlite = semver::Version::parse(sqlite_version.split_whitespace().next().unwrap())
            .expect("parse SQLite version");
        let cipher = semver::Version::parse(cipher_version.split_whitespace().next().unwrap())
            .expect("parse SQLCipher version");
        assert!(sqlite >= semver::Version::new(3, 51, 3), "{sqlite_version}");
        assert!(cipher >= semver::Version::new(4, 14, 0), "{cipher_version}");
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn incomplete_wal_checkpoint_refuses_migration() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("busy-wal.db");
        let writer = Connection::open(&path).expect("open writer");
        writer
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 CREATE TABLE t (value INTEGER);
                 INSERT INTO t VALUES (1);",
            )
            .expect("seed WAL database");

        let reader = Connection::open(&path).expect("open reader");
        reader
            .execute_batch("BEGIN; SELECT value FROM t;")
            .expect("hold read snapshot");
        writer
            .execute("INSERT INTO t VALUES (2)", [])
            .expect("append WAL frame after reader snapshot");

        let migration = Connection::open(&path).expect("open migration connection");
        migration
            .busy_timeout(std::time::Duration::from_millis(50))
            .expect("short timeout");
        let error = prepare_plaintext_database_for_migration(&migration)
            .expect_err("busy WAL must refuse migration");

        assert!(
            error.contains("checkpoint did not complete")
                || error.contains("switch plaintext database out of WAL mode"),
            "unexpected error: {error}"
        );
        reader.execute_batch("ROLLBACK").expect("release reader");
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn database_key_accounts_are_isolated_by_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let notes = db_key_account(&dir.path().join("notes.db")).expect("notes account");
        let clipboard =
            db_key_account(&dir.path().join("clipboard.db")).expect("clipboard account");

        assert_ne!(notes, clipboard);
        assert!(notes.starts_with(DB_KEY_ACCOUNT_PREFIX));
        assert!(clipboard.starts_with(DB_KEY_ACCOUNT_PREFIX));
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn missing_key_for_existing_encrypted_database_never_generates_replacement() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("lost-key.db");
        let original_key = generate_key_hex();
        let conn = open_encrypted(&path, &original_key).expect("create encrypted DB");
        conn.execute_batch("CREATE TABLE t (id INTEGER);")
            .expect("seed encrypted DB");
        drop(conn);
        let store = FakeDbKeyStore::default();

        let error = open_db_with_store(&path, &store).expect_err("missing key must fail");

        assert!(error.contains("Refusing to generate a replacement key"));
        assert!(store.stores.borrow().is_empty());
        assert!(open_encrypted(&path, &original_key).is_ok());
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn migrates_verified_legacy_global_key_to_path_scoped_account() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("legacy-key.db");
        let legacy_key = generate_key_hex();
        let conn = open_encrypted(&path, &legacy_key).expect("create legacy encrypted DB");
        conn.execute_batch("CREATE TABLE t (value TEXT); INSERT INTO t VALUES ('kept');")
            .expect("seed encrypted DB");
        drop(conn);
        let store = FakeDbKeyStore::default();
        *store.legacy.borrow_mut() = Some(legacy_key.clone());

        let migrated = open_db_with_store(&path, &store).expect("migrate legacy key");
        let value: String = migrated
            .query_row("SELECT value FROM t", [], |row| row.get(0))
            .expect("read migrated DB");

        let account = db_key_account(&path).expect("path-scoped account");
        assert_eq!(value, "kept");
        assert_eq!(store.current.borrow().get(&account), Some(&legacy_key));
        assert_eq!(store.stores.borrow().len(), 1);
        assert!(store.encrypted_markers.borrow().contains(&account));
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn legacy_global_key_is_not_reused_for_plaintext_stores() {
        let dir = tempfile::tempdir().expect("tempdir");
        let first_path = dir.path().join("first.db");
        let second_path = dir.path().join("second.db");
        for path in [&first_path, &second_path] {
            let conn = Connection::open(path).expect("create plaintext DB");
            conn.execute_batch("CREATE TABLE t (id INTEGER);")
                .expect("seed plaintext DB");
        }

        let legacy_key = generate_key_hex();
        let store = FakeDbKeyStore::default();
        *store.legacy.borrow_mut() = Some(legacy_key.clone());

        drop(open_db_with_store(&first_path, &store).expect("migrate first"));
        drop(open_db_with_store(&second_path, &store).expect("migrate second"));

        let first_key = store.current.borrow()[&db_key_account(&first_path).unwrap()].clone();
        let second_key = store.current.borrow()[&db_key_account(&second_path).unwrap()].clone();
        assert_ne!(first_key, legacy_key);
        assert_ne!(second_key, legacy_key);
        assert_ne!(first_key, second_key);
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn encrypted_marker_refuses_plaintext_replacement() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("downgrade.db");
        let store = FakeDbKeyStore::default();
        drop(open_db_with_store(&path, &store).expect("create encrypted DB"));

        std::fs::remove_file(&path).expect("remove encrypted DB");
        let plain = Connection::open(&path).expect("create replacement plaintext DB");
        plain
            .execute_batch("CREATE TABLE forged (id INTEGER);")
            .expect("seed replacement");
        drop(plain);

        let error = open_db_with_store(&path, &store).expect_err("downgrade must fail");
        assert!(error.contains("previously marked encrypted"), "{error}");
        assert!(is_plaintext_database(&path));
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn interrupted_plaintext_migration_recovers_with_fresh_path_key() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("interrupted-legacy.db");
        let backup = migration_path(&path, ".plaintext.bak");
        let plain = Connection::open(&backup).expect("create plaintext backup");
        plain
            .execute_batch("CREATE TABLE t (value TEXT); INSERT INTO t VALUES ('recovered');")
            .expect("seed backup");
        drop(plain);
        let legacy_key = generate_key_hex();
        let store = FakeDbKeyStore::default();
        *store.legacy.borrow_mut() = Some(legacy_key.clone());

        let recovered = open_db_with_store(&path, &store).expect("recover and migrate");
        let value: String = recovered
            .query_row("SELECT value FROM t", [], |row| row.get(0))
            .expect("read recovered DB");

        assert_eq!(value, "recovered");
        assert!(!backup.exists());
        let account = db_key_account(&path).expect("account");
        let path_key = store
            .current
            .borrow()
            .get(&account)
            .cloned()
            .expect("fresh path key");
        assert_ne!(path_key, legacy_key);
        assert!(store.encrypted_markers.borrow().contains(&account));
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn sensitive_store_schemas_migrate_without_data_loss() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fixtures = [
            (
                "clipboard.db",
                "CREATE TABLE clipboard_history (id TEXT PRIMARY KEY, content TEXT NOT NULL); \
                 INSERT INTO clipboard_history VALUES ('clip-1', 'secret clipboard');",
                "SELECT content FROM clipboard_history WHERE id = 'clip-1'",
                "secret clipboard",
            ),
            (
                "notes.db",
                "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL); \
                 INSERT INTO notes VALUES ('note-1', 'private note');",
                "SELECT title FROM notes WHERE id = 'note-1'",
                "private note",
            ),
            (
                "extension-storage.db",
                "CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); \
                 INSERT INTO kv VALUES ('token-cache', 'extension value');",
                "SELECT value FROM kv WHERE key = 'token-cache'",
                "extension value",
            ),
        ];

        for (filename, schema, query, expected) in fixtures {
            let path = dir.path().join(filename);
            let plain = Connection::open(&path).expect("create plaintext store");
            plain.execute_batch(schema).expect("seed plaintext store");
            drop(plain);

            let store = FakeDbKeyStore::default();
            let encrypted = open_db_with_store(&path, &store).expect("migrate sensitive store");
            let value: String = encrypted
                .query_row(query, [], |row| row.get(0))
                .expect("read migrated store row");
            assert_eq!(value, expected);
            drop(encrypted);

            let account = db_key_account(&path).expect("path account");
            let key = store
                .current
                .borrow()
                .get(&account)
                .cloned()
                .expect("stored path-scoped key");
            assert!(open_encrypted(&path, &key).is_ok());
        }
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn restores_backup_when_primary_is_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("interrupted.db");
        let backup = migration_path(&path, ".plaintext.bak");
        let conn = Connection::open(&backup).expect("open backup");
        conn.execute_batch("CREATE TABLE t (id INTEGER);")
            .expect("seed backup");
        drop(conn);

        restore_interrupted_migration(&path, None, false).expect("restore backup");

        assert!(path.exists());
        assert!(!backup.exists());
        assert!(is_plaintext_database(&path));
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn encrypted_marker_refuses_plaintext_backup_restore() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("marked-interrupted.db");
        let backup = migration_path(&path, ".plaintext.bak");
        let conn = Connection::open(&backup).expect("open backup");
        conn.execute_batch("CREATE TABLE t (id INTEGER);")
            .expect("seed backup");
        drop(conn);

        let error = restore_interrupted_migration(&path, None, true)
            .expect_err("marked database must not restore plaintext");
        assert!(error.contains("previously marked encrypted"), "{error}");
        assert!(!path.exists());
        assert!(backup.exists());
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn restores_valid_backup_after_invalid_candidate_was_installed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("invalid-candidate.db");
        let backup = migration_path(&path, ".plaintext.bak");
        let quarantine = migration_path(&path, ".encrypted.failed");
        let backup_conn = Connection::open(&backup).expect("open backup");
        backup_conn
            .execute_batch("CREATE TABLE t (value TEXT); INSERT INTO t VALUES ('backup');")
            .expect("seed backup");
        drop(backup_conn);
        std::fs::write(&path, b"invalid encrypted candidate").expect("write candidate");

        let key = generate_key_hex();
        restore_interrupted_migration(&path, Some(&key), false).expect("recover valid backup");

        assert!(!backup.exists());
        assert_eq!(
            std::fs::read(&quarantine).expect("read quarantined candidate"),
            b"invalid encrypted candidate"
        );
        let restored = Connection::open(&path).expect("open restored backup");
        let value: String = restored
            .query_row("SELECT value FROM t", [], |row| row.get(0))
            .expect("read restored row");
        assert_eq!(value, "backup");
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn does_not_restore_backup_over_valid_encrypted_primary() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("valid-primary.db");
        let backup = migration_path(&path, ".plaintext.bak");
        let key = generate_key_hex();

        let primary = open_encrypted(&path, &key).expect("create encrypted primary");
        primary
            .execute_batch("CREATE TABLE t (value TEXT); INSERT INTO t VALUES ('primary');")
            .expect("seed primary");
        drop(primary);
        let backup_conn = Connection::open(&backup).expect("open backup");
        backup_conn
            .execute_batch("CREATE TABLE t (value TEXT); INSERT INTO t VALUES ('backup');")
            .expect("seed backup");
        drop(backup_conn);

        restore_interrupted_migration(&path, Some(&key), true).expect("keep valid primary");

        assert!(backup.exists());
        let primary = open_encrypted(&path, &key).expect("reopen encrypted primary");
        let value: String = primary
            .query_row("SELECT value FROM t", [], |row| row.get(0))
            .expect("read primary row");
        assert_eq!(value, "primary");
    }
}
