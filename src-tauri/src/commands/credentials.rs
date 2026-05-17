/**
 * Credentials Management Commands
 *
 * Stores OAuth tokens (GitHub, Notion) securely in the OS credential store:
 * - Windows : Windows Credential Manager (DPAPI-protected)
 * - macOS   : macOS Keychain
 * - Linux   : D-Bus Secret Service (GNOME Keyring / KWallet)
 */
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, info, warn};
use zeroize::Zeroizing;

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

    let token = Zeroizing::new(token);

    if token.trim().is_empty() {
        return Err("Token cannot be empty".to_string());
    }

    keyring_store::migrate_from_json_if_needed();

    // store_signed attaches a domain-tagged HMAC so retrieve_signed can
    // detect cross-process tampering of the keyring entry. (M10)
    keyring_store::store_signed(&token_account(&service), &token)?;

    let meta = CredentialMeta {
        saved_at: chrono::Local::now().to_rfc3339(),
        enabled: true,
    };
    let meta_json = serde_json::to_string(&meta)
        .map_err(|e| format!("Failed to serialize credential metadata: {}", e))?;
    keyring_store::store_signed(&meta_account(&service), &meta_json)?;

    info!("Credential saved for service: {}", service);
    Ok(())
}

/// Load an API token from the OS keyring.
///
/// `retrieve_signed` validates the companion HMAC tag and silently drops
/// the entry on mismatch (returning `None`); the caller observes a missing
/// credential and triggers re-auth, which is the desired tamper response.
///
/// NOT exposed via IPC — bare tokens must never cross the renderer boundary
/// (audit M2). Renderer code uses `has_credential` to check existence and
/// `test_credential` to validate; the token is read directly from this
/// function only by Rust callers (e.g. internal HTTP request builders).
pub fn load_credential(service: String) -> Result<Option<String>, String> {
    debug!("Loading credential for service: {}", service);
    keyring_store::migrate_from_json_if_needed();
    let token = keyring_store::retrieve_signed(&token_account(&service))?;
    if token.is_some() {
        debug!("Credential loaded for service: {}", service);
    } else {
        debug!("No credential found for service: {}", service);
    }
    Ok(token)
}

/// Maps a service ID to the only API hostnames its extension may reach through
/// the authenticated fetch proxy. Requests to any other host are rejected.
fn service_api_hosts(service: &str) -> &'static [&'static str] {
    match service {
        "github" => &["api.github.com"],
        "notion" => &["api.notion.com"],
        _ => &[],
    }
}

/// Perform an authenticated HTTP request on behalf of a sandboxed extension.
///
/// Security properties
/// -------------------
/// - The raw credential token **never** leaves Rust (not passed to renderer/Worker).
/// - `extension_id` must match a valid service name (validated by `validate_service`).
/// - The destination host must be in `service_api_hosts(extension_id)`.
/// - Only HTTPS is permitted.
/// - Any `Authorization` header supplied by the extension is unconditionally
///   stripped and replaced with the keyring value.
/// - Response body is capped at 10 MB to prevent OOM.
#[tauri::command]
pub async fn extension_authenticated_fetch(
    extension_id: String,
    url: String,
    method: String,
    headers: serde_json::Value,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    validate_service(&extension_id)?;

    let parsed =
        url::Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Only HTTPS URLs are allowed".to_string());
    }
    let host = parsed.host_str().unwrap_or("");
    let allowed = service_api_hosts(&extension_id);
    if !allowed.contains(&host) {
        return Err(format!(
            "Host '{}' is not on the allowlist for service '{}'",
            host, extension_id
        ));
    }

    // Token read from keyring — never returned to caller.
    // GitHub: if no token is stored, make an unauthenticated request (60 req/hr
    // rate limit — public endpoints still work). Auth-required endpoints will
    // return 401, which the extension handles gracefully.
    // Notion: always requires auth; missing token is a hard error.
    let maybe_token: Option<Zeroizing<String>> = match extension_id.as_str() {
        "github" => load_credential(extension_id.clone())?.map(Zeroizing::new),
        _ => match load_credential(extension_id.clone())? {
            Some(t) => Some(Zeroizing::new(t)),
            None => {
                return Err(format!(
                    "No credential stored for service: {}",
                    extension_id
                ))
            }
        },
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let mut req = match method.to_uppercase().as_str() {
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        _ => client.get(&url),
    };

    // Forward extension headers, stripping Authorization (injected below).
    if let Some(map) = headers.as_object() {
        for (k, v) in map {
            if k.to_lowercase() == "authorization" {
                continue;
            }
            if let Some(vs) = v.as_str() {
                req = req.header(k.as_str(), vs);
            }
        }
    }

    // Inject Authorization + service-specific defaults.
    req = match extension_id.as_str() {
        "github" => {
            let mut r = req.header("User-Agent", "Volt-GitHub-Extension/1.2.0");
            if let Some(ref t) = maybe_token
                && !t.trim().is_empty()
            {
                r = r.header("Authorization", format!("Bearer {}", t.trim()));
            }
            r
        }
        "notion" => {
            let t = maybe_token
                .ok_or_else(|| format!("No credential stored for service: {}", extension_id))?;
            req.header("Authorization", format!("Bearer {}", t.trim()))
                .header("Notion-Version", "2022-06-28")
        }
        other => return Err(format!("Unsupported service: {}", other)),
    };

    if let Some(b) = body {
        req = req.body(b);
    }

    const MAX_BODY: usize = 10 * 1024 * 1024;
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let status_text = resp
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    if bytes.len() > MAX_BODY {
        return Err("Response body exceeds 10 MB limit".to_string());
    }
    let body_str = String::from_utf8_lossy(&bytes).to_string();

    Ok(serde_json::json!({
        "ok": ok,
        "status": status,
        "statusText": status_text,
        "body": body_str,
        "bodyEncoding": "utf-8",
    }))
}

/// Return `true` if a token is stored for this service.
#[tauri::command]
pub fn has_credential(service: String) -> Result<bool, String> {
    keyring_store::migrate_from_json_if_needed();
    let result = keyring_store::retrieve_signed(&token_account(&service))?;
    Ok(result.is_some())
}

/// Delete the stored token and its metadata from the OS keyring.
#[tauri::command]
pub fn delete_credential(service: String) -> Result<(), String> {
    debug!("Deleting credential for service: {}", service);
    keyring_store::migrate_from_json_if_needed();
    // remove_signed clears both the value and its HMAC tag entry.
    keyring_store::remove_signed(&token_account(&service))?;
    keyring_store::remove_signed(&meta_account(&service))?;
    info!("Credential deleted for service: {}", service);
    Ok(())
}

/// Test that a stored API token is valid by making a single read-only request
/// to the upstream service.
///
/// The token is read directly from the OS keyring — it is never accepted from
/// the renderer. This prevents Volt from being used as a proxy for testing
/// arbitrary tokens supplied by untrusted IPC callers.
#[tauri::command]
pub async fn test_credential(service: String) -> Result<bool, String> {
    debug!("Testing credential for service: {}", service);
    validate_service(&service)?;

    let token = match load_credential(service.clone())? {
        Some(t) => Zeroizing::new(t),
        None => return Err(format!("No credential stored for service: {}", service)),
    };

    if token.trim().is_empty() {
        return Err("Stored token is empty".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let request = match service.as_str() {
        "github" => client
            .get("https://api.github.com/user")
            .header("Authorization", format!("Bearer {}", token.trim()))
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "Volt"),
        "notion" => client
            .get("https://api.notion.com/v1/users/me")
            .header("Authorization", format!("Bearer {}", token.trim()))
            .header("Notion-Version", "2022-06-28"),
        // validate_service already rejects everything else, but keep this
        // arm to make the match exhaustive without an `_` that could
        // silently accept new services.
        other => return Err(format!("Unsupported service for test: {}", other)),
    };

    match request.send().await {
        Ok(resp) => {
            let ok = resp.status().is_success();
            if !ok {
                warn!(
                    "Credential test for {} failed with status {}",
                    service,
                    resp.status()
                );
            }
            Ok(ok)
        }
        Err(e) => {
            warn!("Credential test for {} errored: {}", service, e);
            Ok(false)
        }
    }
}

/// Return credential metadata (saved_at, enabled) without exposing the token.
#[tauri::command]
pub fn get_credential_info(service: String) -> Result<Option<StoredCredential>, String> {
    debug!("Getting credential info for service: {}", service);
    keyring_store::migrate_from_json_if_needed();

    if keyring_store::retrieve_signed(&token_account(&service))?.is_none() {
        return Ok(None);
    }

    match keyring_store::retrieve_signed(&meta_account(&service))? {
        Some(meta_json) => {
            let meta: CredentialMeta = serde_json::from_str(&meta_json).unwrap_or_else(|e| {
                warn!(
                    "Failed to deserialize credential meta for '{}': {} — using defaults",
                    service, e
                );
                CredentialMeta {
                    saved_at: "Unknown".to_string(),
                    enabled: true,
                }
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
