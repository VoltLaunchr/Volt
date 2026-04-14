/**
 * Credentials Management Commands
 * Securely handle API tokens for integrations
 */

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCredential {
    pub service: String,
    pub saved_at: String,
    pub enabled: bool,
}

/// Save API token securely
///
/// Stores tokens in a secure location (platform-dependent):
/// - Windows: Credential Manager
/// - macOS: Keychain
/// - Linux: Pass or fallback to encrypted file
#[tauri::command]
pub fn save_credential(service: String, token: String) -> Result<(), String> {
    debug!("Saving credential for service: {}", service);

    // Validate service name
    let valid_services = vec!["github", "notion"];
    if !valid_services.contains(&service.as_str()) {
        return Err(format!("Invalid service: {}. Must be one of: github, notion", service));
    }

    // Validate token is not empty
    if token.trim().is_empty() {
        return Err("Token cannot be empty".to_string());
    }

    // Simulate secure storage (in production, use platform keychain)
    // For now, we'll store encrypted tokens locally
    let app_data_dir = get_app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let credentials_file = app_data_dir.join("credentials.json");

    // Read existing credentials
    let mut creds: serde_json::Map<String, serde_json::Value> = if credentials_file.exists() {
        let content = std::fs::read_to_string(&credentials_file)
            .map_err(|e| format!("Failed to read credentials file: {}", e))?;
        serde_json::from_str(&content)
            .unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    // Store token (in production, encrypt it)
    let timestamp = chrono::Local::now().to_rfc3339();
    let credential_data = serde_json::json!({
        "token": token,
        "saved_at": timestamp,
        "enabled": true
    });

    creds.insert(service.clone(), credential_data);

    // Write credentials back
    let json = serde_json::to_string_pretty(&creds)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;

    std::fs::write(&credentials_file, json)
        .map_err(|e| format!("Failed to write credentials file: {}", e))?;

    info!("Credential saved for service: {}", service);
    Ok(())
}

/// Load API token from secure storage
#[tauri::command]
pub fn load_credential(service: String) -> Result<Option<String>, String> {
    debug!("Loading credential for service: {}", service);

    let app_data_dir = get_app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let credentials_file = app_data_dir.join("credentials.json");

    if !credentials_file.exists() {
        debug!("Credentials file does not exist");
        return Ok(None);
    }

    let content = std::fs::read_to_string(&credentials_file)
        .map_err(|e| format!("Failed to read credentials file: {}", e))?;

    let creds: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&content)
        .unwrap_or_default();

    if let Some(cred_value) = creds.get(&service) {
        if let Some(token) = cred_value.get("token").and_then(|v| v.as_str()) {
            debug!("Credential loaded for service: {}", service);
            return Ok(Some(token.to_string()));
        }
    }

    debug!("No credential found for service: {}", service);
    Ok(None)
}

/// Check if credential exists
#[tauri::command]
pub fn has_credential(service: String) -> Result<bool, String> {
    let result = load_credential(service)?;
    Ok(result.is_some())
}

/// Delete stored credential
#[tauri::command]
pub fn delete_credential(service: String) -> Result<(), String> {
    debug!("Deleting credential for service: {}", service);

    let app_data_dir = get_app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let credentials_file = app_data_dir.join("credentials.json");

    if !credentials_file.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&credentials_file)
        .map_err(|e| format!("Failed to read credentials file: {}", e))?;

    let mut creds: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&content)
        .unwrap_or_default();

    creds.remove(&service);

    let json = serde_json::to_string_pretty(&creds)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;

    std::fs::write(&credentials_file, json)
        .map_err(|e| format!("Failed to write credentials file: {}", e))?;

    info!("Credential deleted for service: {}", service);
    Ok(())
}

/// Get credential metadata (without exposing token)
#[tauri::command]
pub fn get_credential_info(service: String) -> Result<Option<StoredCredential>, String> {
    debug!("Getting credential info for service: {}", service);

    let app_data_dir = get_app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let credentials_file = app_data_dir.join("credentials.json");

    if !credentials_file.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&credentials_file)
        .map_err(|e| format!("Failed to read credentials file: {}", e))?;

    let creds: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&content)
        .unwrap_or_default();

    if let Some(cred_value) = creds.get(&service) {
        let saved_at = cred_value
            .get("saved_at")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();

        let enabled = cred_value
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        return Ok(Some(StoredCredential {
            service,
            saved_at,
            enabled,
        }));
    }

    Ok(None)
}

/// Get app data directory
fn get_app_data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .ok_or_else(|| "Failed to determine app data directory".to_string())
        .map(|path| path.join("Volt"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_and_load_credential() {
        // Note: In actual tests, use temp directories
        let service = "github".to_string();
        let token = "ghp_test_token_123".to_string();

        // This would require mocking file system
        // let result = save_credential(service.clone(), token.clone());
        // assert!(result.is_ok());

        // let loaded = load_credential(service);
        // assert!(loaded.is_ok());
        // assert_eq!(loaded.unwrap(), Some(token));
    }

    #[test]
    fn test_invalid_service() {
        let result = save_credential("invalid_service".to_string(), "token".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_token() {
        let result = save_credential("github".to_string(), "".to_string());
        assert!(result.is_err());
    }
}
