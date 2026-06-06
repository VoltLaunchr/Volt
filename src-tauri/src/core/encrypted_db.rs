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
//!    provisions on first run) a per-install encryption key from the OS keyring
//!    and applies SQLCipher's `PRAGMA key` before any other statement.
//!
//! The high-level rationale, threat model, migration plan and rollout live in
//! `REFONTE-PILIER-C-SQLCIPHER.md` at the repo root.
//!
//! ## Key management
//!
//! The database key is a 32-byte CSPRNG value, hex-encoded, stored in the OS
//! keyring under [`DB_KEY_ACCOUNT`] using the existing
//! [`crate::commands::keyring_store`] abstraction (DPAPI on Windows, Keychain
//! on macOS, Secret Service on Linux). The key never lives on disk in plaintext
//! and never crosses the IPC boundary into the renderer. Losing the keyring
//! entry means losing access to encrypted data — the standard, accepted
//! trade-off for at-rest encryption.
//!
//! ## Integration (later step — intentionally NOT done yet)
//!
//! Call sites such as `clipboard_manager`, `notes`, and the extension KV store
//! currently call `Connection::open(path)` directly. To encrypt one of them,
//! swap that single line for `crate::core::encrypted_db::open_db(path)`. With
//! the feature off this is byte-for-byte identical to today; with the feature
//! on it transparently encrypts. No call sites are rewired in this scaffold.

// Pilier C scaffold. These items are the documented integration surface for
// encrypting Volt's SQLite stores, but no call site is rewired yet (that is a
// deliberate later step — see the module docs and REFONTE-PILIER-C-SQLCIPHER.md
// §8). Until then, in a default (non-`sqlcipher`, non-test) build they have no
// caller. We scope `dead_code` to this module only so the rest of the crate
// keeps full dead-code enforcement.
#![allow(dead_code)]

use rusqlite::Connection;
use std::path::Path;

/// Keyring account under which the SQLCipher database key is stored.
///
/// Lives alongside the other Volt keyring entries on the
/// [`crate::commands::keyring_store::KEYRING_SERVICE`] service.
pub const DB_KEY_ACCOUNT: &str = "sqlcipher_db_key";

/// Length, in bytes, of the database encryption key.
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
        let key = provision_db_key()?;
        open_encrypted(path, &key)
    }

    #[cfg(not(feature = "sqlcipher"))]
    {
        open_plain(path)
    }
}

/// Plain (unencrypted) open. Always available regardless of feature flags so
/// call sites and tests compile in every configuration. This is the fallback
/// path and the default-build path.
pub fn open_plain(path: impl AsRef<Path>) -> Result<Connection, String> {
    Connection::open(path.as_ref()).map_err(|e| {
        format!(
            "Failed to open database '{}': {}",
            path.as_ref().display(),
            e
        )
    })
}

/// Provision the database encryption key: return the existing keyring entry, or
/// generate + store a fresh 32-byte CSPRNG key on first run.
///
/// Returns the hex-encoded key (64 ASCII hex chars). Hex encoding keeps the
/// keyring entry plain ASCII, which some backends require (no NUL / non-UTF-8
/// in the password field), and matches the form `PRAGMA key = "x'<hex>'"`
/// consumes directly.
///
/// Available behind the `sqlcipher` feature only — there is no reason to create
/// a DB key in a build that cannot use it. The pure key-derivation/validation
/// logic is exercised by the always-compiled unit tests below via the
/// `_logic` helpers.
#[cfg(feature = "sqlcipher")]
pub fn provision_db_key() -> Result<String, String> {
    use crate::commands::keyring_store;

    match keyring_store::retrieve(DB_KEY_ACCOUNT)? {
        Some(existing) => {
            let trimmed = existing.trim().to_string();
            validate_hex_key(&trimmed)?;
            Ok(trimmed)
        }
        None => {
            let key_hex = generate_key_hex();
            keyring_store::store(DB_KEY_ACCOUNT, &key_hex)?;
            Ok(key_hex)
        }
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
    conn.pragma_update(None, "key", format!("x'{}'", key_hex))
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

/// Generate a fresh 32-byte key from the OS CSPRNG, hex-encoded.
///
/// Always compiled (not feature-gated) so the key-generation logic is unit
/// tested even in the default build. Matches the `rand 0.9` pattern used in
/// `utils::extension_state_sig`.
fn generate_key_hex() -> String {
    use rand::RngCore;
    let mut key = [0u8; DB_KEY_LEN];
    rand::rng().fill_bytes(&mut key);
    hex::encode(key)
}

/// Validate that `key_hex` decodes to exactly [`DB_KEY_LEN`] bytes of valid
/// hex. Always compiled so it can be unit tested without the `sqlcipher`
/// feature; also used by the feature-gated open/provision paths.
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
}
