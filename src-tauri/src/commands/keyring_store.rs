//! Shared OS keyring abstraction for Volt credential storage.
//!
//! All tokens are stored under the service name "com.volt.launcher".
//! Each credential is identified by its `account` string (e.g. "github",
//! "notion", "supabase_auth").
//!
//! OS backends:
//! - Windows  : Windows Credential Manager (DPAPI-protected)
//! - macOS    : macOS Keychain
//! - Linux    : D-Bus Secret Service (GNOME Keyring / KWallet)

use std::path::PathBuf;
use std::sync::OnceLock;
use tracing::{debug, info, warn};

/// The service name used for every keyring entry Volt creates.
pub const KEYRING_SERVICE: &str = "com.volt.launcher";

/// Ensures migration from the legacy credentials.json runs at most once.
static MIGRATION_DONE: OnceLock<()> = OnceLock::new();

// ---------------------------------------------------------------------------
// Core store / retrieve / remove helpers
// ---------------------------------------------------------------------------

/// Persist `secret` for the given `account` in the OS keyring.
pub fn store(account: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|e| format!("Keyring entry creation failed for '{}': {}", account, e))?;
    entry
        .set_password(secret)
        .map_err(|e| format!("Keyring set_password failed for '{}': {}", account, e))?;
    debug!("Keyring: stored '{}'", account);
    Ok(())
}

/// Retrieve the secret for `account` from the OS keyring.
/// Returns `None` if no entry exists (not an error).
pub fn retrieve(account: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|e| format!("Keyring entry creation failed for '{}': {}", account, e))?;
    match entry.get_password() {
        Ok(secret) => {
            debug!("Keyring: retrieved '{}'", account);
            Ok(Some(secret))
        }
        Err(keyring::Error::NoEntry) => {
            debug!("Keyring: no entry for '{}'", account);
            Ok(None)
        }
        Err(e) => Err(format!(
            "Keyring get_password failed for '{}': {}",
            account, e
        )),
    }
}

/// Remove the entry for `account` from the OS keyring.
/// Deleting a non-existent entry is treated as a no-op.
pub fn remove(account: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|e| format!("Keyring entry creation failed for '{}': {}", account, e))?;
    match entry.delete_credential() {
        Ok(_) => {
            debug!("Keyring: removed '{}'", account);
            Ok(())
        }
        Err(keyring::Error::NoEntry) => {
            debug!(
                "Keyring: delete_credential — no entry for '{}', skipping",
                account
            );
            Ok(())
        }
        Err(e) => Err(format!(
            "Keyring delete_credential failed for '{}': {}",
            account, e
        )),
    }
}

// ---------------------------------------------------------------------------
// One-time migration from legacy credentials.json
// ---------------------------------------------------------------------------

/// Path to the legacy plaintext credentials file.
fn legacy_credentials_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("Volt").join("credentials.json"))
}

/// Migrate all entries from `credentials.json` into the OS keyring, then
/// delete the file. Safe to call repeatedly — runs at most once per process.
pub fn migrate_from_json_if_needed() {
    MIGRATION_DONE.get_or_init(|| {
        let path = match legacy_credentials_path() {
            Some(p) => p,
            None => return,
        };

        if !path.exists() {
            return;
        }

        info!("Migrating credentials from {:?} to OS keyring", path);

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                warn!("Migration: failed to read credentials.json: {}", e);
                return;
            }
        };

        let map: serde_json::Map<String, serde_json::Value> = match serde_json::from_str(&content)
        {
            Ok(m) => m,
            Err(e) => {
                warn!("Migration: failed to parse credentials.json: {}", e);
                return;
            }
        };

        let mut migrated = 0usize;

        // OAuth tokens: { "github": { "token": "...", ... }, "notion": { ... } }
        for service in &["github", "notion"] {
            if let Some(cred_val) = map.get(*service) {
                if let Some(token) = cred_val.get("token").and_then(|v| v.as_str()) {
                    if let Err(e) = store(service, token) {
                        warn!("Migration: failed to store token for {}: {}", service, e);
                    } else {
                        migrated += 1;
                    }
                }
                // Store metadata (saved_at, enabled)
                let meta_key = format!("{}_meta", service);
                if let Ok(meta_json) = serde_json::to_string(cred_val) {
                    if let Err(e) = store(&meta_key, &meta_json) {
                        warn!("Migration: failed to store meta for {}: {}", service, e);
                    }
                }
            }
        }

        // Supabase auth session
        if let Some(auth_val) = map.get("supabase_auth") {
            if let Ok(auth_json) = serde_json::to_string(auth_val) {
                if let Err(e) = store("supabase_auth", &auth_json) {
                    warn!("Migration: failed to store supabase_auth: {}", e);
                } else {
                    migrated += 1;
                }
            }
        }

        info!("Migration: {} credential(s) moved to OS keyring", migrated);

        if let Err(e) = std::fs::remove_file(&path) {
            warn!("Migration: failed to delete legacy credentials.json: {}", e);
        } else {
            info!("Migration: deleted legacy credentials.json");
        }
    });
}
