/**
 * Supabase Authentication Commands
 *
 * Handles browser-based OAuth flow for desktop app authentication:
 * 1. Opens system browser to voltlaunchr.com login page
 * 2. Website redirects to volt://auth/callback with tokens
 * 3. Deep link handler stores tokens and emits event
 * 4. Commands provide session/profile access and token refresh
 *
 * Auth session is stored in the OS keyring under "supabase_auth".
 */
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};

use super::keyring_store;

// Injected at compile time from .env or CI secrets via build.rs.
const SUPABASE_URL: &str = env!("SUPABASE_URL");
const SUPABASE_ANON_KEY: &str = env!("SUPABASE_ANON_KEY");
const AUTH_REDIRECT_URL: &str = "https://voltlaunchr.com/auth/desktop-login";

const AUTH_ACCOUNT: &str = "supabase_auth";

fn ensure_configured() -> Result<(), String> {
    if SUPABASE_URL.is_empty() || SUPABASE_ANON_KEY.is_empty() {
        return Err(
            "Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env".into(),
        );
    }
    Ok(())
}

/// Stored auth session with tokens and expiry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub user_id: String,
}

/// User profile fetched from Supabase
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: String,
    pub email: String,
    pub tier: String,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
}

/// Supabase token refresh response
#[derive(Debug, Deserialize)]
struct TokenRefreshResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: TokenUser,
}

#[derive(Debug, Deserialize)]
struct TokenUser {
    id: String,
}

// ---------------------------------------------------------------------------
// Internal session helpers — OS keyring backed
// ---------------------------------------------------------------------------

pub fn save_auth_session(session: &AuthSession) -> Result<(), String> {
    keyring_store::migrate_from_json_if_needed();
    let json = serde_json::to_string(session)
        .map_err(|e| format!("Failed to serialize auth session: {}", e))?;
    keyring_store::store(AUTH_ACCOUNT, &json)
}

fn load_auth_session() -> Result<Option<AuthSession>, String> {
    keyring_store::migrate_from_json_if_needed();
    match keyring_store::retrieve(AUTH_ACCOUNT)? {
        None => Ok(None),
        Some(json) => {
            let session: AuthSession = serde_json::from_str(&json)
                .map_err(|e| format!("Failed to deserialize auth session: {}", e))?;
            Ok(Some(session))
        }
    }
}

fn delete_auth_session() -> Result<(), String> {
    keyring_store::migrate_from_json_if_needed();
    keyring_store::remove(AUTH_ACCOUNT)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start login flow — opens system browser to the website login page.
#[tauri::command]
pub async fn auth_login() -> Result<(), String> {
    ensure_configured()?;
    info!("Starting Supabase auth login flow");
    tauri_plugin_opener::open_url(AUTH_REDIRECT_URL, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;
    Ok(())
}

/// Get current session (reads stored tokens, checks expiry).
#[tauri::command]
pub async fn auth_get_session() -> Result<Option<AuthSession>, String> {
    debug!("Getting auth session");
    let session = load_auth_session()?;

    if let Some(ref s) = session {
        let now = chrono::Utc::now().timestamp();
        if now >= s.expires_at {
            debug!("Auth session expired");
            return Ok(None);
        }
    }

    Ok(session)
}

/// Fetch user profile from Supabase REST API using stored access_token.
#[tauri::command]
pub async fn auth_get_profile() -> Result<Option<UserProfile>, String> {
    ensure_configured()?;
    debug!("Fetching user profile from Supabase");

    let session = match load_auth_session()? {
        Some(s) => s,
        None => return Ok(None),
    };

    let now = chrono::Utc::now().timestamp();
    if now >= session.expires_at {
        warn!("Access token expired, cannot fetch profile");
        return Ok(None);
    }

    let url = format!(
        "{}/rest/v1/profiles?id=eq.{}&select=*",
        SUPABASE_URL, session.user_id
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", session.access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch profile: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        error!("Supabase profile request failed: {} — {}", status, body);
        return Err(format!("Profile request failed with status {}", status));
    }

    let profiles: Vec<UserProfile> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse profile response: {}", e))?;

    Ok(profiles.into_iter().next())
}

/// Refresh the access token using the stored refresh_token.
#[tauri::command]
pub async fn auth_refresh_token() -> Result<AuthSession, String> {
    ensure_configured()?;
    info!("Refreshing Supabase auth token");

    let session =
        load_auth_session()?.ok_or_else(|| "No auth session found to refresh".to_string())?;

    let url = format!("{}/auth/v1/token?grant_type=refresh_token", SUPABASE_URL);

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "refresh_token": session.refresh_token
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to refresh token: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        error!("Token refresh failed: {} — {}", status, body);
        return Err(format!("Token refresh failed with status {}", status));
    }

    let refresh_resp: TokenRefreshResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    let now = chrono::Utc::now().timestamp();
    let new_session = AuthSession {
        access_token: refresh_resp.access_token,
        refresh_token: refresh_resp.refresh_token,
        expires_at: now + refresh_resp.expires_in,
        user_id: refresh_resp.user.id,
    };

    save_auth_session(&new_session)?;
    info!("Auth token refreshed successfully");

    Ok(new_session)
}

/// Logout — clear stored auth tokens.
#[tauri::command]
pub async fn auth_logout() -> Result<(), String> {
    info!("Logging out — clearing auth session");
    delete_auth_session()
}

// ---------------------------------------------------------------------------
// Deep link callback handler (called from lib.rs setup)
// ---------------------------------------------------------------------------

/// Parse a `volt://auth/callback?...` URL and persist the session.
pub fn handle_auth_deep_link(url_str: &str) -> Result<AuthSession, String> {
    let parsed =
        url::Url::parse(url_str).map_err(|e| format!("Failed to parse deep link URL: {}", e))?;

    if parsed.host_str() != Some("auth") || parsed.path() != "/callback" {
        let redacted = url_str.split('?').next().unwrap_or(url_str);
        return Err(format!("Not an auth callback URL: {}", redacted));
    }

    let params: std::collections::HashMap<String, String> =
        parsed.query_pairs().into_owned().collect();

    let access_token = params
        .get("access_token")
        .ok_or("Missing access_token in callback URL")?
        .clone();
    let refresh_token = params
        .get("refresh_token")
        .ok_or("Missing refresh_token in callback URL")?
        .clone();
    let expires_at: i64 = params
        .get("expires_at")
        .ok_or("Missing expires_at in callback URL")?
        .parse()
        .map_err(|_| "Invalid expires_at value")?;
    let user_id = params
        .get("user_id")
        .ok_or("Missing user_id in callback URL")?
        .clone();

    let session = AuthSession {
        access_token,
        refresh_token,
        expires_at,
        user_id,
    };

    save_auth_session(&session)?;
    info!("Auth session saved from deep link callback");

    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires OS keyring"]
    fn test_parse_auth_deep_link() {
        let url = "volt://auth/callback?access_token=abc&refresh_token=def&expires_at=1700000000&user_id=uid123";
        let session = handle_auth_deep_link(url).unwrap();
        assert_eq!(session.access_token, "abc");
        assert_eq!(session.refresh_token, "def");
        assert_eq!(session.expires_at, 1700000000);
        assert_eq!(session.user_id, "uid123");
    }

    #[test]
    fn test_parse_auth_deep_link_missing_token() {
        let url = "volt://auth/callback?refresh_token=def&expires_at=1700000000&user_id=uid123";
        let result = handle_auth_deep_link(url);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("access_token"));
    }

    #[test]
    fn test_parse_wrong_path() {
        let url = "volt://other/path?access_token=abc";
        let result = handle_auth_deep_link(url);
        assert!(result.is_err());
    }
}
