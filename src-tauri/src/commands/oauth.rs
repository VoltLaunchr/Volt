/**
 * OAuth Integration Commands
 *
 * Manages OAuth flows for integrations (GitHub, Notion)
 * Handles deep link callbacks from volta:// protocol
 */
use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex};
use tracing::{debug, info, trace, warn};

/// Hard cap on concurrent pending OAuth requests. Mirrors auth.rs's
/// `AUTH_STATE_MAX_ENTRIES` — anything beyond a small handful in-flight is
/// either a bug or a memory-DoS via repeated `get_*_oauth_url` calls.
const MAX_PENDING_OAUTH_REQUESTS: usize = 32;

static OAUTH_STATE: LazyLock<Mutex<OAuthState>> = LazyLock::new(|| Mutex::new(OAuthState::new()));

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

    /// Enforce `MAX_PENDING_OAUTH_REQUESTS` by evicting the oldest entry
    /// first. Should be called after `prune_stale` so we only trim if recent
    /// (non-expired) flows exceed the cap. Mirrors the same pattern used in
    /// auth.rs for pending PKCE flows.
    fn cap_entries(&mut self) {
        if self.pending_requests.len() < MAX_PENDING_OAUTH_REQUESTS {
            return;
        }
        // Find the oldest by parsed initiated_at and remove it.
        let oldest_key = self
            .pending_requests
            .iter()
            .filter_map(|(k, v)| {
                chrono::DateTime::parse_from_rfc3339(&v.initiated_at)
                    .ok()
                    .map(|t| (k.clone(), t))
            })
            .min_by_key(|(_, t)| *t)
            .map(|(k, _)| k);
        if let Some(k) = oldest_key {
            warn!("OAuth pending map at cap; evicting oldest entry");
            self.pending_requests.remove(&k);
        }
    }
}

/// Validate a freshly-received OAuth access token before it's persisted.
/// Catches obviously-bogus payloads (truncated, oversized, wrong scheme)
/// before they hit the keyring. Format prefixes mirror what the upstream
/// providers actually issue today — unknown but shape-compatible variants
/// are accepted.
fn validate_token_format(service: &str, token: &str) -> Result<(), String> {
    let len = token.len();
    if len < 20 {
        return Err(format!("token too short: {}", len));
    }
    if len > 512 {
        return Err(format!("token too long: {}", len));
    }
    match service {
        "github"
            if !token.starts_with("ghp_")
                && !token.starts_with("gho_")
                && !token.starts_with("ghu_")
                && !token.starts_with("ghs_")
                && !token.starts_with("github_pat_") =>
        {
            return Err("github token has unexpected prefix".into());
        }
        "notion" if !token.starts_with("secret_") && !token.starts_with("ntn_") => {
            return Err("notion token has unexpected prefix".into());
        }
        _ => {}
    }
    Ok(())
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

    // Prune stale entries (older than 15 minutes) before inserting, then
    // enforce the in-flight cap so a malicious caller can't exhaust memory
    // by repeatedly invoking this command without ever completing the flow.
    state.prune_stale();
    state.cap_entries();

    state.pending_requests.insert(
        request_id.clone(),
        OAuthRequest {
            service: "github".to_string(),
            initiated_at: chrono::Local::now().to_rfc3339(),
        },
    );

    // Open the website's `/start` route in the user's browser. That route
    // mints its own CSRF nonce, sets an HttpOnly cookie pairing it with our
    // `desktop_state`, and 302-redirects to GitHub's authorize endpoint.
    // After GitHub redirects back, the site forwards the access token to
    // `volt://oauth-callback?token=...&state={request_id}`. We log only an
    // 8-char hint at info; the full request_id is demoted to trace so even
    // a verbose debug build doesn't leave a usable CSRF nonce in the log
    // file (M10).
    trace!("GitHub OAuth URL issued, request_id: {}", request_id);
    info!("GitHub OAuth URL requested, state_hint: {:.8}", request_id);
    Ok(format!(
        "https://voltlaunchr.com/api/oauth/github/start?desktop_state={}",
        request_id
    ))
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

    // Prune stale entries (older than 15 minutes) before inserting, then
    // enforce the in-flight cap so a malicious caller can't exhaust memory
    // by repeatedly invoking this command without ever completing the flow.
    state.prune_stale();
    state.cap_entries();

    state.pending_requests.insert(
        request_id.clone(),
        OAuthRequest {
            service: "notion".to_string(),
            initiated_at: chrono::Local::now().to_rfc3339(),
        },
    );

    // See `get_github_oauth_url` for why we open `/start` rather than the
    // bare callback URL. The full request_id is at trace so a verbose log
    // file never carries a usable CSRF nonce.
    trace!("Notion OAuth URL issued, request_id: {}", request_id);
    info!("Notion OAuth URL requested, state_hint: {:.8}", request_id);
    Ok(format!(
        "https://voltlaunchr.com/api/oauth/notion/start?desktop_state={}",
        request_id
    ))
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
    let valid_services = ["github", "notion"];
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

        let pending_request = oauth_state.pending_requests.remove(&state).ok_or_else(|| {
            // Avoid logging the raw state at warn — leaked log files
            // shouldn't carry a usable CSRF nonce. Keep only a hint.
            warn!("OAuth callback with unknown state (hint: {:.8})", state);
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

    // Token format sanity check before we hand it to the keyring. Catches
    // truncated / oversized / wrong-scheme payloads that survived the
    // upstream hop. Invalid tokens are surfaced to the renderer as an error
    // rather than silently saved (M10).
    validate_token_format(&service, &token).map_err(|e| {
        warn!("OAuth token rejected for service {}: {}", service, e);
        format!("Invalid OAuth token for {}: {}", service, e)
    })?;

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
    if !matches!(service.as_str(), "github" | "notion") {
        return Err(format!("unknown service: {}", service));
    }
    debug!("Clearing pending OAuth requests for service: {}", service);

    let mut state = lock_state()?;

    state
        .pending_requests
        .retain(|_id, req| req.service != service);
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

    // Reject any deep link that isn't actually targeted at our oauth callback
    // host. Without this check, a `volt://something-else?token=...&service=...`
    // URL would be silently accepted by the query-param parser below.
    if parsed.host_str() != Some("oauth-callback") {
        let redacted = url_str.split('?').next().unwrap_or(url_str);
        warn!("Rejecting deep link with unexpected host: {}", redacted);
        return Err("Unexpected deep-link host for OAuth callback".to_string());
    }

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
        assert!(
            url.starts_with("https://voltlaunchr.com/api/oauth/github/start?desktop_state="),
            "got: {}",
            url
        );
    }

    #[test]
    fn test_state_included_in_notion_url() {
        let url = get_notion_oauth_url().unwrap();
        assert!(
            url.starts_with("https://voltlaunchr.com/api/oauth/notion/start?desktop_state="),
            "got: {}",
            url
        );
    }
}
