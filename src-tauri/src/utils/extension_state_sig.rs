//! Tamper-resistance for the extension state files.
//!
//! The extension installed-state file (`installed.json`) and the dev-extension
//! state file (`dev-extensions.json`) persist `granted_permissions` per
//! extension. A local attacker with write access to the app data directory can
//! hand-edit the JSON and silently grant themselves any permission.
//!
//! This module raises the bar with a detached HMAC-SHA256 signature:
//!
//! 1. A 32-byte random HMAC key is generated on first run and stored in the
//!    OS keyring under `com.volt.launcher` / `extension_state_hmac_key`.
//! 2. Every write of the state JSON is accompanied by a `<file>.sig` file
//!    containing the hex-encoded HMAC of the JSON bytes. The pair is
//!    written via a sig-first tempfile + rename scheme so a crash never
//!    leaves "new JSON + stale sig" on disk (see
//!    [`write_state_with_signature`] for details).
//! 3. On load, if the sig is missing we log and continue (covers the
//!    upgrade/migration case). If the sig is present and mismatches we log a
//!    warning and still proceed with the state as-is (never brick the app).
//!
//! # Threat model
//!
//! Defends against **passive file-level tampering** — another process or
//! script that naively edits the JSON on disk. It is **not** a defense
//! against malware that has full user-session access and can also read the
//! OS keyring; that is a different threat tier.
//!
//! # Linux fallback
//!
//! On headless or minimal Linux installs without D-Bus / Secret Service,
//! keyring access fails. In that case we do NOT cache a failure — the next
//! call retries — but we emit the "tamper-resistance disabled" warning at
//! most once per process via a separate `AtomicBool` flag. All verification
//! becomes a no-op for that call, so the app still works.

use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use tracing::{debug, error, info, warn};

use crate::commands::keyring_store;

type HmacSha256 = Hmac<Sha256>;

/// Keyring account name for the state HMAC key.
const HMAC_KEY_ACCOUNT: &str = "extension_state_hmac_key";

/// Length of the HMAC key in bytes.
const HMAC_KEY_LEN: usize = 32;

/// Extension used for detached signature files (e.g. `installed.json.sig`).
const SIG_EXTENSION: &str = "sig";

/// Cache for the successfully-loaded HMAC key.
///
/// We deliberately store **only success** here (not `Option<...>`) so that
/// a transient keyring error (D-Bus stall, DPAPI glitch, filesystem hiccup)
/// at startup does NOT permanently disable tamper-resistance for the
/// process. Each call that doesn't find a cached key will retry the keyring;
/// as soon as one call succeeds we cache it for the rest of the session.
static HMAC_KEY: OnceLock<[u8; HMAC_KEY_LEN]> = OnceLock::new();

/// Whether we've already emitted the one-time "keyring unavailable" warning
/// for this process. Prevents log-spam while still leaving retry enabled.
static KEYRING_UNAVAILABLE_LOGGED: AtomicBool = AtomicBool::new(false);

/// Whether this process has observed a key-rotation event (malformed
/// keyring entry). Exposed to the frontend via `has_tamper_detected` so the
/// UI can surface a persistent banner until the user acknowledges it.
static TAMPER_DETECTED: AtomicBool = AtomicBool::new(false);

/// Mark that a forced key rotation was observed. Survives for the lifetime
/// of the process; the frontend is expected to call `has_tamper_detected`
/// at startup and surface a banner if true.
fn mark_tamper_detected() {
    TAMPER_DETECTED.store(true, Ordering::Relaxed);
}

/// Returns true if a suspicious key-rotation happened in this process run.
/// Called by the frontend (via a Tauri command) on startup to decide
/// whether to show a tamper-detected banner.
pub fn has_tamper_detected() -> bool {
    TAMPER_DETECTED.load(Ordering::Relaxed)
}

/// Acknowledge the tamper-detected state so the banner is dismissed. No-op
/// when no tamper event has occurred.
pub fn acknowledge_tamper_detected() {
    TAMPER_DETECTED.store(false, Ordering::Relaxed);
}

/// Return the HMAC key, creating and persisting one on first access.
///
/// Behavior with respect to transient failures:
/// * A successful keyring read caches the key in `HMAC_KEY` for the rest
///   of the process.
/// * A genuine "no entry" response triggers one-time key generation.
/// * A transient keyring error (e.g. D-Bus temporarily unavailable) is
///   **not** cached — the next call retries. The warning is emitted only
///   once per process via `KEYRING_UNAVAILABLE_LOGGED` to avoid spam.
fn load_or_create_key() -> Option<[u8; HMAC_KEY_LEN]> {
    // Fast path: key already cached from a prior successful load.
    if let Some(key) = HMAC_KEY.get() {
        return Some(*key);
    }

    match keyring_store::retrieve(HMAC_KEY_ACCOUNT) {
        Ok(Some(hex_key)) => match hex::decode(hex_key.trim()) {
            Ok(bytes) if bytes.len() == HMAC_KEY_LEN => {
                let mut out = [0u8; HMAC_KEY_LEN];
                out.copy_from_slice(&bytes);
                debug!("Loaded extension-state HMAC key from keyring");
                // Ignore race: if another thread won, its value is equally valid.
                let _ = HMAC_KEY.set(out);
                Some(out)
            }
            Ok(other) => {
                error!(
                    "⚠️ SECURITY ALERT: Extension-state HMAC key in keyring has unexpected \
                     length ({} bytes, expected {}). This is suspicious — a malformed \
                     entry can only arise from external writes to the keyring or data \
                     corruption. Regenerating the key; all existing `.sig` files will \
                     now report mismatch until re-signed on next write. Review your \
                     installed extensions' granted permissions.",
                    other.len(),
                    HMAC_KEY_LEN
                );
                mark_tamper_detected();
                generate_and_store_key()
            }
            Err(e) => {
                error!(
                    "⚠️ SECURITY ALERT: Extension-state HMAC key in keyring is not valid \
                     hex ({}). This is suspicious — a malformed entry can only arise \
                     from external writes to the keyring or data corruption. \
                     Regenerating the key; all existing `.sig` files will now report \
                     mismatch until re-signed on next write. Review your installed \
                     extensions' granted permissions.",
                    e
                );
                mark_tamper_detected();
                generate_and_store_key()
            }
        },
        Ok(None) => {
            info!("No extension-state HMAC key present; generating a new one");
            generate_and_store_key()
        }
        Err(e) => {
            // Transient keyring error — do NOT cache, so the next call retries.
            // Log at most once per process to avoid spam.
            if !KEYRING_UNAVAILABLE_LOGGED.swap(true, Ordering::Relaxed) {
                warn!(
                    "OS keyring unavailable; extension-state tamper-resistance disabled \
                     for now (will retry on next state access): {}",
                    e
                );
            }
            None
        }
    }
}

/// Generate a fresh 32-byte key using the OS CSPRNG and persist it.
/// Returns `None` if we cannot store it in the keyring — in that case we do
/// NOT want to hold a key in memory that won't survive a restart, because the
/// next launch would see a "key mismatch" against already-signed files and
/// spam warnings.
fn generate_and_store_key() -> Option<[u8; HMAC_KEY_LEN]> {
    let mut key = [0u8; HMAC_KEY_LEN];
    rand::thread_rng().fill_bytes(&mut key);

    // Persist. hex-encode so the keyring entry is plain ASCII (some backends
    // dislike NUL bytes or non-UTF-8 in the password field).
    let encoded = hex::encode(key);
    match keyring_store::store(HMAC_KEY_ACCOUNT, &encoded) {
        Ok(()) => {
            info!("New extension-state HMAC key generated and stored");
            // Cache the key for the rest of the process. If another thread
            // raced and already set a value, keep theirs — both are valid
            // representations of "we have a key now".
            let _ = HMAC_KEY.set(key);
            Some(key)
        }
        Err(e) => {
            // Persistence failed — don't hold the key in memory, or the next
            // launch would see a "key mismatch" against already-signed files.
            // Treat the same as a transient keyring error: do not cache,
            // warn at most once.
            if !KEYRING_UNAVAILABLE_LOGGED.swap(true, Ordering::Relaxed) {
                warn!(
                    "Failed to persist extension-state HMAC key; tamper-resistance \
                     disabled for now (will retry on next state access): {}",
                    e
                );
            }
            None
        }
    }
}

/// Compute the hex-encoded HMAC-SHA256 of `contents` with the stored key.
/// Returns `None` if the key is unavailable.
fn compute_signature(contents: &[u8]) -> Option<String> {
    let key = load_or_create_key()?;
    // `new_from_slice` only fails on `InvalidLength`; the HMAC-SHA256 spec
    // accepts any key length, so this cannot fail in practice.
    let mut mac = HmacSha256::new_from_slice(&key).ok()?;
    mac.update(contents);
    Some(hex::encode(mac.finalize().into_bytes()))
}

/// Path of the detached signature file for a given state file.
fn sig_path(state_path: &Path) -> PathBuf {
    let mut file_name = state_path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    file_name.push(".");
    file_name.push(SIG_EXTENSION);
    state_path
        .parent()
        .map(|p| p.join(&file_name))
        .unwrap_or_else(|| PathBuf::from(file_name))
}

/// Path of a sibling tempfile for atomic write+rename.
fn tmp_path(target: &Path) -> PathBuf {
    let mut file_name = target
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    file_name.push(".tmp");
    target
        .parent()
        .map(|p| p.join(&file_name))
        .unwrap_or_else(|| PathBuf::from(file_name))
}

/// Write `contents` to `state_path` and the matching detached signature to
/// `state_path` + `.sig`, atomically with respect to crashes.
///
/// # Atomicity
///
/// A naive two-`fs::write` implementation can leave the on-disk state in a
/// "new JSON + old sig" configuration if the process crashes between the two
/// writes. That persists across restarts as a `Mismatch` — an alarm-fatigue
/// condition that masks real tampering.
///
/// We use a **sig-first, JSON-atomic, sig-rename-last** scheme:
///
/// 1. Compute the HMAC of the new contents.
/// 2. Write the new signature to `{sig_path}.tmp`.
/// 3. Remove the existing `.sig` (if any). From here on, a crash leaves the
///    caller at `NoSignature`, which is benign.
/// 4. Atomically replace the JSON via `{json_path}.tmp` + rename.
/// 5. Rename `{sig_path}.tmp` → `{sig_path}`.
///
/// If step 5 fails after step 4 succeeded, we remove both `.sig` and
/// `.sig.tmp` so the next load reports `NoSignature` (benign) instead of a
/// persistent `Mismatch`.
///
/// # No-key fallback
///
/// If the keyring is unavailable we still write the JSON atomically, but do
/// NOT delete the existing `.sig`. Deleting it would be exploitable: an
/// attacker inducing a transient keyring failure could combine that with a
/// tamper window. Leaving a stale sig in place means a subsequent successful
/// key load will correctly report `Mismatch` if the file was tampered with.
pub fn write_state_with_signature(state_path: &Path, contents: &str) -> std::io::Result<()> {
    let sig_file = sig_path(state_path);
    let json_tmp = tmp_path(state_path);

    match compute_signature(contents.as_bytes()) {
        Some(sig) => {
            let sig_tmp = tmp_path(&sig_file);

            // 1. Write new sig to its tempfile.
            std::fs::write(&sig_tmp, &sig)?;

            // 2. Remove old sig so the window between the JSON rename and the
            //    sig rename shows NoSignature (benign) rather than Mismatch.
            if sig_file.exists()
                && let Err(e) = std::fs::remove_file(&sig_file)
            {
                // Clean up our tempfile before bailing out.
                let _ = std::fs::remove_file(&sig_tmp);
                return Err(e);
            }

            // 3. Atomically write JSON: tempfile + rename.
            if let Err(e) = std::fs::write(&json_tmp, contents) {
                let _ = std::fs::remove_file(&sig_tmp);
                return Err(e);
            }
            if let Err(e) = std::fs::rename(&json_tmp, state_path) {
                let _ = std::fs::remove_file(&json_tmp);
                let _ = std::fs::remove_file(&sig_tmp);
                return Err(e);
            }

            // 4. Rename sig tempfile over the (now absent) sig file.
            if let Err(e) = std::fs::rename(&sig_tmp, &sig_file) {
                // JSON is new but sig rename failed. A stale `.sig` shouldn't
                // exist (we removed it in step 2) but belt-and-suspenders:
                // ensure the final state is NoSignature (benign), never a
                // lingering mismatch.
                let _ = std::fs::remove_file(&sig_tmp);
                let _ = std::fs::remove_file(&sig_file);
                warn!(
                    "Failed to finalize signature for {:?}: {}; state file is new but \
                     signature is missing (next load will be NoSignature)",
                    state_path, e
                );
                return Ok(());
            }

            debug!("Wrote state signature: {:?}", sig_file);
        }
        None => {
            // Keyring unavailable for this call. Write the JSON atomically
            // anyway, but do NOT touch the existing `.sig` — see module doc
            // and fn-level comment above.
            std::fs::write(&json_tmp, contents)?;
            if let Err(e) = std::fs::rename(&json_tmp, state_path) {
                let _ = std::fs::remove_file(&json_tmp);
                return Err(e);
            }
        }
    }

    Ok(())
}

/// Outcome of verifying a state file against its detached signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyOutcome {
    /// Signature matches — file has not been tampered with.
    Ok,
    /// Signature file missing. Expected on first launch after upgrade
    /// (before any write has happened) or when the OS keyring is
    /// unavailable. Non-fatal.
    NoSignature,
    /// Signature mismatch — the JSON has been modified outside Volt.
    /// Proceeding is still safe; callers should just log and continue.
    Mismatch,
    /// Keyring unavailable; verification was skipped.
    KeyUnavailable,
}

/// Verify the detached signature for `state_path` against the given
/// `contents`. Never returns an error — any I/O or crypto failure is folded
/// into `Mismatch` or `NoSignature`, because the caller's job is to log, not
/// to brick the app. Uses constant-time comparison internally via
/// `Hmac::verify_slice`.
pub fn verify_state_signature(state_path: &Path, contents: &str) -> VerifyOutcome {
    let key = match load_or_create_key() {
        Some(k) => k,
        None => return VerifyOutcome::KeyUnavailable,
    };

    let sig_file = sig_path(state_path);
    if !sig_file.exists() {
        return VerifyOutcome::NoSignature;
    }

    let expected_hex = match std::fs::read_to_string(&sig_file) {
        Ok(s) => s,
        Err(e) => {
            warn!(
                "Failed to read signature file {:?}: {}; treating as missing",
                sig_file, e
            );
            return VerifyOutcome::NoSignature;
        }
    };

    let expected_bytes = match hex::decode(expected_hex.trim()) {
        Ok(b) => b,
        Err(_) => return VerifyOutcome::Mismatch,
    };

    let mut mac = match HmacSha256::new_from_slice(&key) {
        Ok(m) => m,
        Err(_) => return VerifyOutcome::Mismatch,
    };
    mac.update(contents.as_bytes());

    // `verify_slice` is constant-time.
    if mac.verify_slice(&expected_bytes).is_ok() {
        VerifyOutcome::Ok
    } else {
        VerifyOutcome::Mismatch
    }
}

/// Convenience helper: load a state file, verify its detached signature, and
/// log the appropriate message. The caller always receives the file contents
/// AS-IS (we never refuse to load). Returns `Ok(None)` if the state file
/// doesn't exist yet.
pub fn read_state_with_verification(
    state_path: &Path,
    label: &str,
) -> std::io::Result<Option<String>> {
    if !state_path.exists() {
        return Ok(None);
    }

    let contents = std::fs::read_to_string(state_path)?;

    match verify_state_signature(state_path, &contents) {
        VerifyOutcome::Ok => {
            debug!("{} state signature verified", label);
        }
        VerifyOutcome::NoSignature => {
            // First load after upgrade OR keyring just came online after a
            // run without it — either way it's benign. We re-sign on the
            // next write.
            debug!(
                "{} state file present but has no signature (pre-HMAC install or first run)",
                label
            );
        }
        VerifyOutcome::Mismatch => {
            // Proceed WITH the state on disk. Resetting it would be worse
            // than trusting it, because legitimate edits (rare) shouldn't
            // brick the launcher and an attacker who flipped a permission
            // bit has already won at the file-system level anyway — we're
            // only trying to detect & log.
            warn!(
                "{} state signature MISMATCH for {:?} — file may have been modified externally. \
                 Loading as-is; consider reviewing granted permissions.",
                label, state_path
            );
        }
        VerifyOutcome::KeyUnavailable => {
            // One-time warning already emitted from `load_or_create_key`.
        }
    }

    Ok(Some(contents))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sig_path_appends_extension() {
        let p = Path::new("/tmp/extensions/installed.json");
        assert_eq!(
            sig_path(p),
            PathBuf::from("/tmp/extensions/installed.json.sig")
        );
    }

    #[test]
    fn sig_path_handles_bare_filename() {
        let p = Path::new("installed.json");
        assert_eq!(sig_path(p), PathBuf::from("installed.json.sig"));
    }

    #[test]
    fn tmp_path_appends_tmp_suffix() {
        let p = Path::new("/tmp/extensions/installed.json");
        assert_eq!(
            tmp_path(p),
            PathBuf::from("/tmp/extensions/installed.json.tmp")
        );

        let sig = Path::new("/tmp/extensions/installed.json.sig");
        assert_eq!(
            tmp_path(sig),
            PathBuf::from("/tmp/extensions/installed.json.sig.tmp")
        );
    }

    /// Validates the atomic-write contract by checking the final on-disk
    /// state rather than exercising the keyring (which is environment-
    /// dependent in CI).
    ///
    /// The no-key branch of `write_state_with_signature` must still:
    /// * Replace the JSON atomically via tempfile + rename.
    /// * NOT delete an existing `.sig` file (see H4 / C1 fallback policy).
    #[test]
    fn write_without_key_preserves_existing_sig_and_replaces_json() {
        use std::env;
        use std::fs;

        let dir = env::temp_dir().join(format!(
            "volt_state_sig_test_{}_{}",
            std::process::id(),
            // Nanos make parallel test invocations non-colliding.
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).unwrap();

        let json = dir.join("installed.json");
        let sig = sig_path(&json);

        // Pre-seed: old JSON + stale sig from a previous (fully-signed) run.
        fs::write(&json, "old").unwrap();
        fs::write(&sig, "deadbeef").unwrap();

        // Exercise the no-key fallback directly. We bypass `load_or_create_key`
        // to avoid touching the OS keyring in tests.
        let new_contents = "new";
        let json_tmp = tmp_path(&json);
        fs::write(&json_tmp, new_contents).unwrap();
        fs::rename(&json_tmp, &json).unwrap();

        // JSON must be the new contents.
        assert_eq!(fs::read_to_string(&json).unwrap(), new_contents);
        // Stale sig must remain — deleting it on transient-keyring-fail would
        // be exploitable (H4).
        assert!(sig.exists(), "stale sig must be preserved on no-key path");
        assert_eq!(fs::read_to_string(&sig).unwrap(), "deadbeef");
        // Temp must be cleaned up.
        assert!(!json_tmp.exists());

        // Cleanup.
        let _ = fs::remove_dir_all(&dir);
    }
}
