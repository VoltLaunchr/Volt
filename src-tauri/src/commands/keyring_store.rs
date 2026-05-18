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
use zeroize::{Zeroize, Zeroizing};

use crate::utils::extension_state_sig;

/// The service name used for every keyring entry Volt creates.
pub const KEYRING_SERVICE: &str = "com.volt.launcher";

/// Suffix appended to an account name to store its companion HMAC tag.
/// `github` -> token at `github`, integrity tag at `github__sig`.
const SIG_ACCOUNT_SUFFIX: &str = "__sig";

/// Domain string mixed into the credential HMAC. Distinct from any other
/// HMAC domain in the codebase so a signature produced for an extension
/// state file (or anything else) cannot be replayed as a valid credential
/// signature.
const CREDENTIAL_HMAC_DOMAIN: &str = "volt-credential-v1";

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
// Integrity-tagged store / retrieve (M10)
// ---------------------------------------------------------------------------
//
// On Windows, DPAPI is per-user with no per-app ACL: any process running as
// the same user can read/write our keyring entries. macOS Keychain gates by
// signed bundle identifier; D-Bus Secret Service has similar gaps to Windows.
//
// We can't make the secret unreachable to a peer-process attacker — they
// have the same permissions we do — but we can attach a domain-tagged
// HMAC-SHA256 tag so casual swaps (e.g. a malicious cleanup tool, a
// poorly-isolated extension running outside the sandbox, or an accidental
// cross-app collision on the legacy `com.volt.launcher` service name) are
// detected. The HMAC key lives in the keyring under a different account so
// a sufficiently determined attacker can also read it and recompute, but in
// practice the attacker has to think to do so. Mismatch means we drop the
// stored value (force re-auth) and emit an audible warn-level log.

/// Store `secret` under `account` along with a separate HMAC tag entry at
/// `account__sig`. Use `retrieve_signed` to verify on read.
///
/// If the keyring is unavailable for the HMAC key (e.g. brand-new install,
/// transient D-Bus failure on Linux), the secret is still stored but no
/// signature is produced — a subsequent `retrieve_signed` will report
/// `MissingSignature` and the caller can decide whether to trust it. We
/// never refuse to store on a missing key, because that would brick
/// credential save on first launch before the key has been generated.
pub fn store_signed(account: &str, secret: &str) -> Result<(), String> {
    // Persist the secret first. Order matters: if the signature write fails,
    // we'd rather have the secret + no sig (subsequent retrieve_signed will
    // fail-open with a warning) than no secret + a stale sig pointing at
    // the previous value.
    store(account, secret)?;

    let payload = build_payload(account, secret);
    match extension_state_sig::hmac_sign_domain(CREDENTIAL_HMAC_DOMAIN, &payload) {
        Some(sig_hex) => {
            let sig_account = format!("{}{}", account, SIG_ACCOUNT_SUFFIX);
            store(&sig_account, &sig_hex)?;
            debug!("Keyring: stored '{}' with integrity tag", account);
            Ok(())
        }
        None => {
            // HMAC key unavailable — log once-per-call (the underlying
            // load_or_create_key already throttles its own warning so this
            // doesn't spam either). The secret is still stored unsigned.
            warn!(
                "Keyring: stored '{}' WITHOUT integrity tag (HMAC key \
                 unavailable). Tampering will not be detected on next read.",
                account
            );
            Ok(())
        }
    }
}

/// Retrieve `account` and verify its companion HMAC tag.
///
/// Returns:
/// * `Ok(Some(secret))` — secret present and signature verified, OR secret
///   present and no signature exists (legacy entries pre-M10 carry no tag;
///   we treat them as trusted-but-unverified and log at debug level).
/// * `Ok(None)` — no entry at all.
/// * `Ok(None)` AFTER ALSO REMOVING the entry — signature mismatch
///   detected. We force re-auth rather than silently trusting the swapped
///   value. A warn-level log records what happened.
/// * `Err(_)` — keyring transport error.
pub fn retrieve_signed(account: &str) -> Result<Option<String>, String> {
    let Some(secret) = retrieve(account)? else {
        return Ok(None);
    };

    let sig_account = format!("{}{}", account, SIG_ACCOUNT_SUFFIX);
    let sig = retrieve(&sig_account)?;

    let Some(stored_sig) = sig else {
        // Legacy entry written before M10: no companion tag exists. Trust
        // it once and silently upgrade by writing a fresh tag on next save.
        debug!(
            "Keyring: no integrity tag for '{}' (legacy entry); accepting",
            account
        );
        return Ok(Some(secret));
    };

    let payload = build_payload(account, &secret);
    if extension_state_sig::hmac_verify_domain(CREDENTIAL_HMAC_DOMAIN, &payload, &stored_sig) {
        debug!("Keyring: '{}' integrity verified", account);
        Ok(Some(secret))
    } else {
        // Tamper detected. Wipe the suspect secret from memory before discarding,
        // then drop the entry so the caller is forced to re-authenticate.
        let mut suspect = secret;
        suspect.zeroize();

        warn!(
            "⚠️ SECURITY ALERT: Keyring integrity check FAILED for '{}'. \
             Stored value differs from its HMAC tag — likely modified by \
             another process. Removing the entry; user must re-authenticate.",
            account
        );
        // Best-effort cleanup; do not fail the read on a delete error.
        if let Err(e) = remove(account) {
            warn!(
                "Keyring: failed to remove tampered entry '{}': {}",
                account, e
            );
        }
        if let Err(e) = remove(&sig_account) {
            warn!(
                "Keyring: failed to remove companion sig for '{}': {}",
                account, e
            );
        }
        Ok(None)
    }
}

/// Remove `account` and its companion HMAC tag entry.
pub fn remove_signed(account: &str) -> Result<(), String> {
    remove(account)?;
    let sig_account = format!("{}{}", account, SIG_ACCOUNT_SUFFIX);
    remove(&sig_account)
}

/// Build the HMAC input. Including the account name binds the signature to
/// the account so a value swap from one entry to another (e.g. moving a
/// leaked test token into the github slot) is also detected.
///
/// Returns a `Zeroizing` wrapper so the byte buffer is wiped from memory
/// once the HMAC operation completes.
fn build_payload(account: &str, secret: &str) -> Zeroizing<Vec<u8>> {
    let mut buf = Vec::with_capacity(account.len() + 1 + secret.len());
    buf.extend_from_slice(account.as_bytes());
    buf.push(0); // null separator avoids account+secret collision
    buf.extend_from_slice(secret.as_bytes());
    Zeroizing::new(buf)
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

        let map: serde_json::Map<String, serde_json::Value> = match serde_json::from_str(&content) {
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
                if let Ok(meta_json) = serde_json::to_string(cred_val)
                    && let Err(e) = store(&meta_key, &meta_json)
                {
                    warn!("Migration: failed to store meta for {}: {}", service, e);
                }
            }
        }

        // Supabase auth session
        if let Some(auth_val) = map.get("supabase_auth")
            && let Ok(auth_json) = serde_json::to_string(auth_val)
        {
            if let Err(e) = store("supabase_auth", &auth_json) {
                warn!("Migration: failed to store supabase_auth: {}", e);
            } else {
                migrated += 1;
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
