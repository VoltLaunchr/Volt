/**
 * Credentials Management Commands
 *
 * Stores OAuth tokens (GitHub, Notion) securely in the OS credential store:
 * - Windows : Windows Credential Manager (DPAPI-protected)
 * - macOS   : macOS Keychain
 * - Linux   : D-Bus Secret Service (GNOME Keyring / KWallet)
 */
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use super::keyring_store;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCredential {
    pub service: String,
    pub saved_at: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct CredentialMeta {
    saved_at: String,
    enabled: bool,
}

fn validate_service(service: &str) -> Result<(), String> {
    const VALID: &[&str] = &["github", "notion"];
    if VALID.contains(&service) {
        Ok(())
    } else {
        Err(format!(
            "Invalid service: '{}'. Must be one of: {}",
            service,
            VALID.join(", ")
        ))
    }
}

#[inline]
fn token_account(service: &str) -> String {
    service.to_string()
}

#[inline]
fn meta_account(service: &str) -> String {
    format!("{}_meta", service)
}

/// Save an API token to the OS keyring.
#[tauri::command]
pub fn save_credential(service: String, token: String) -> Result<(), String> {
    debug!("Saving credential for service: {}", service);
    validate_service(&service)?;

    if token.trim().is_empty() {
        return Err("Token cannot be empty".to_string());
    }

    keyring_store::migrate_from_json_if_needed();

    keyring_store::store(&token_account(&service), &token)?;

    let meta = CredentialMeta {
        saved_at: chrono::Local::now().to_rfc3339(),
        enabled: true,
    };
    let meta_json = serde_json::to_string(&meta)
        .map_err(|e| format!("Failed to serialize credential metadata: {}", e))?;
    keyring_store::store(&meta_account(&service), &meta_json)?;

    info!("Credential saved for service: {}", service);
    Ok(())
}

/// Load an API token from the OS keyring.
#[tauri::command]
pub fn load_credential(service: String) -> Result<Option<String>, String> {
    debug!("Loading credential for service: {}", service);
    keyring_store::migrate_from_json_if_needed();
    let token = keyring_store::retrieve(&token_account(&service))?;
    if token.is_some() {
        debug!("Credential loaded for service: {}", service);
    } else {
        debug!("No credential found for service: {}", service);
    }
    Ok(token)
}

/// Return `true` if a token is stored for this service.
#[tauri::command]
pub fn has_credential(service: String) -> Result<bool, String> {
    keyring_store::migrate_from_json_if_needed();
    let result = keyring_store::retrieve(&token_account(&service))?;
    Ok(result.is_some())
}

/// Delete the stored token and its metadata from the OS keyring.
#[tauri::command]
pub fn delete_credential(service: String) -> Result<(), String> {
    debug!("Deleting credential for service: {}", service);
    keyring_store::migrate_from_json_if_needed();
    keyring_store::remove(&token_account(&service))?;
    keyring_store::remove(&meta_account(&service))?;
    info!("Credential deleted for service: {}", service);
    Ok(())
}

/// Return credential metadata (saved_at, enabled) without exposing the token.
#[tauri::command]
pub fn get_credential_info(service: String) -> Result<Option<StoredCredential>, String> {
    debug!("Getting credential info for service: {}", service);
    keyring_store::migrate_from_json_if_needed();

    if keyring_store::retrieve(&token_account(&service))?.is_none() {
        return Ok(None);
    }

    match keyring_store::retrieve(&meta_account(&service))? {
        Some(meta_json) => {
            let meta: CredentialMeta = serde_json::from_str(&meta_json).unwrap_or(CredentialMeta {
                saved_at: "Unknown".to_string(),
                enabled: true,
            });
            Ok(Some(StoredCredential {
                service,
                saved_at: meta.saved_at,
                enabled: meta.enabled,
            }))
        }
        None => Ok(Some(StoredCredential {
            service,
            saved_at: "Unknown".to_string(),
            enabled: true,
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_service() {
        let result = save_credential("invalid_service".to_string(), "token".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid service"));
    }

    #[test]
    fn test_empty_token() {
        let result = save_credential("github".to_string(), "".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn test_whitespace_only_token() {
        let result = save_credential("github".to_string(), "   ".to_string());
        assert!(result.is_err());
    }
}
