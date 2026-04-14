/**
 * OAuth Integration Commands
 *
 * Manages OAuth flows for integrations (GitHub, Notion)
 * Handles deep link callbacks from volta:// protocol
 */

use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};
use std::sync::Mutex;
use once_cell::sync::Lazy;

static OAUTH_STATE: Lazy<Mutex<OAuthState>> = Lazy::new(|| Mutex::new(OAuthState::new()));

/// Helper to lock OAUTH_STATE, recovering from poison if needed
fn lock_state() -> Result<std::sync::MutexGuard<'static, OAuthState>, String> {
    Ok(OAUTH_STATE.lock().unwrap_or_else(|e| e.into_inner()))
}

#[derive(Debug, Clone)]
pub struct OAuthState {
    pending_requests: std::collections::HashMap<String, OAuthRequest>,
}

#[derive(Debug, Clone)]
struct OAuthRequest {
    service: String,
    initiated_at: String,
}

impl OAuthState {
    fn new() -> Self {
        Self {
            pending_requests: std::collections::HashMap::new(),
        }
    }

    /// Remove entries older than 15 minutes
    fn prune_stale(&mut self) {
        let now = chrono::Local::now();
        let cutoff = now - chrono::Duration::minutes(15);
        self.pending_requests.retain(|_id, req| {
            if let Ok(initiated) = chrono::DateTime::parse_from_rfc3339(&req.initiated_at) {
                let initiated = initiated.with_timezone(&chrono::Local);
                initiated > cutoff
            } else {
                // Can't parse timestamp — treat as stale
                false
            }
        });
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthResult {
    pub service: String,
    pub success: bool,
    pub saved_at: String,
    pub workspace: Option<String>, // For Notion
}

/// Start OAuth flow for GitHub
///
/// Returns the OAuth URL - frontend is responsible for opening it
/// State is tracked server-side for verification
#[tauri::command]
pub fn get_github_oauth_url() -> Result<String, String> {
    debug!("Getting GitHub OAuth URL");

    // Generate request ID for tracking
    let request_id = uuid::Uuid::new_v4().to_string();

    let mut state = lock_state()?;

    // Prune stale entries (older than 15 minutes) before inserting
    state.prune_stale();

    state.pending_requests.insert(
        request_id.clone(),
        OAuthRequest {
            service: "github".to_string(),
            initiated_at: chrono::Local::now().to_rfc3339(),
        },
    );

    // Return OAuth endpoint URL with state parameter - frontend will open it
    info!("GitHub OAuth URL requested, request_id: {}", request_id);
    Ok(format!("https://voltlaunchr.com/api/oauth/github?state={}", request_id))
}

/// Start OAuth flow for Notion
///
/// Returns the OAuth URL - frontend is responsible for opening it
/// State is tracked server-side for verification
#[tauri::command]
pub fn get_notion_oauth_url() -> Result<String, String> {
    debug!("Getting Notion OAuth URL");

    // Generate request ID for tracking
    let request_id = uuid::Uuid::new_v4().to_string();

    let mut state = lock_state()?;

    // Prune stale entries (older than 15 minutes) before inserting
    state.prune_stale();

    state.pending_requests.insert(
        request_id.clone(),
        OAuthRequest {
            service: "notion".to_string(),
            initiated_at: chrono::Local::now().to_rfc3339(),
        },
    );

    // Return OAuth endpoint URL with state parameter - frontend will open it
    info!("Notion OAuth URL requested, request_id: {}", request_id);
    Ok(format!("https://voltlaunchr.com/api/oauth/notion?state={}", request_id))
}

/// Handle OAuth callback from deep link
///
/// Called when volta://oauth-callback?token=XXX&service=XXX&state=XXX is intercepted
/// Verifies state parameter against pending requests, then saves token to secure storage
#[tauri::command]
pub fn handle_oauth_callback(
    service: String,
    token: String,
    state: String,
    workspace: Option<String>,
) -> Result<OAuthResult, String> {
    debug!("Handling OAuth callback for service: {}", service);

    // Validate service
    let valid_services = vec!["github", "notion"];
    if !valid_services.contains(&service.as_str()) {
        return Err(format!("Invalid service: {}", service));
    }

    // Validate token
    if token.trim().is_empty() {
        return Err("Token cannot be empty".to_string());
    }

    // Verify state parameter against pending requests
    {
        let mut oauth_state = lock_state()?;

        let pending_request = oauth_state.pending_requests.remove(&state)
            .ok_or_else(|| {
                warn!("OAuth callback with unknown state: {}", state);
                "Invalid or expired OAuth state parameter".to_string()
            })?;

        // Verify that the callback service matches the request service
        if pending_request.service != service {
            warn!(
                "OAuth service mismatch: expected {}, got {}",
                pending_request.service, service
            );
            return Err(format!(
                "Service mismatch: OAuth flow was initiated for '{}' but callback is for '{}'",
                pending_request.service, service
            ));
        }
    }

    // Save token via credentials command
    super::credentials::save_credential(service.clone(), token)?;

    let saved_at = chrono::Local::now().to_rfc3339();
    info!("OAuth callback handled for service: {}", service);

    Ok(OAuthResult {
        service,
        success: true,
        saved_at,
        workspace,
    })
}

/// Check if OAuth is pending (waiting for callback)
#[tauri::command]
pub fn is_oauth_pending() -> Result<bool, String> {
    let state = lock_state()?;

    // Consider pending if any request is less than 15 minutes old
    let now = chrono::Local::now();
    let cutoff = now - chrono::Duration::minutes(15);

    let has_pending = state.pending_requests.values().any(|req| {
        if let Ok(initiated) = chrono::DateTime::parse_from_rfc3339(&req.initiated_at) {
            let initiated = initiated.with_timezone(&chrono::Local);
            initiated > cutoff
        } else {
            false
        }
    });

    Ok(has_pending)
}

/// Clear pending OAuth requests for a specific service
#[tauri::command]
pub fn clear_oauth_pending(service: String) -> Result<(), String> {
    debug!("Clearing pending OAuth requests for service: {}", service);

    let mut state = lock_state()?;

    state.pending_requests.retain(|_id, req| req.service != service);
    Ok(())
}

// ---------------------------------------------------------------------------
// Deep link callback handler (called from lib.rs setup)
// ---------------------------------------------------------------------------

/// Parse a `volt://oauth-callback?token=XXX&service=XXX&state=XXX` URL,
/// verify the state parameter, and persist the token via keyring.
/// Returns the OAuthResult on success.
pub fn handle_oauth_deep_link(url_str: &str) -> Result<OAuthResult, String> {
    let parsed =
        url::Url::parse(url_str).map_err(|e| format!("Failed to parse OAuth deep link: {}", e))?;

    // Extract query parameters
    let params: std::collections::HashMap<String, String> =
        parsed.query_pairs().into_owned().collect();

    let service = params
        .get("service")
        .ok_or("Missing 'service' in OAuth callback URL")?
        .clone();
    let token = params
        .get("token")
        .ok_or("Missing 'token' in OAuth callback URL")?
        .clone();
    let state = params
        .get("state")
        .ok_or("Missing 'state' in OAuth callback URL")?
        .clone();
    let workspace = params.get("workspace").cloned();

    // Delegate to the existing callback handler (validates service, token,
    // verifies state against pending requests, saves to keyring)
    handle_oauth_callback(service, token, state, workspace)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_service() {
        let result = handle_oauth_callback(
            "invalid_service".to_string(),
            "token123".to_string(),
            "some_state".to_string(),
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_token() {
        let result = handle_oauth_callback(
            "github".to_string(),
            "".to_string(),
            "some_state".to_string(),
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_state() {
        let result = handle_oauth_callback(
            "github".to_string(),
            "valid_token".to_string(),
            "nonexistent_state".to_string(),
            None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid or expired"));
    }

    #[test]
    fn test_state_included_in_github_url() {
        let url = get_github_oauth_url().unwrap();
        assert!(url.starts_with("https://voltlaunchr.com/api/oauth/github?state="));
    }

    #[test]
    fn test_state_included_in_notion_url() {
        let url = get_notion_oauth_url().unwrap();
        assert!(url.starts_with("https://voltlaunchr.com/api/oauth/notion?state="));
    }
}
