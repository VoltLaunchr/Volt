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
use base64::Engine as _;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};

use super::keyring_store;

/// Pending login state nonces. Maps state UUID -> instant initiated.
/// Used to enforce CSRF protection on `volt://auth/callback`: the website
/// MUST echo the state back so an attacker can't seed a session by tricking
/// the browser into hitting the deep link.
static AUTH_STATE: Lazy<Mutex<HashMap<String, Instant>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Lifetime of a pending login state nonce (5 minutes).
const AUTH_STATE_TTL: Duration = Duration::from_secs(5 * 60);

/// Maximum allowed `expires_in` from a refresh response (24h). Prevents the
/// upstream from claiming an absurdly long-lived access token.
const MAX_EXPIRES_IN_SECS: i64 = 86_400;

fn auth_state_lock() -> Result<std::sync::MutexGuard<'static, HashMap<String, Instant>>, String> {
    Ok(AUTH_STATE.lock().unwrap_or_else(|e| e.into_inner()))
}

/// Drop pending state nonces older than `AUTH_STATE_TTL`.
fn prune_expired_auth_states(map: &mut HashMap<String, Instant>) {
    let now = Instant::now();
    map.retain(|_, initiated| now.duration_since(*initiated) <= AUTH_STATE_TTL);
}

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
    // store_signed attaches a domain-tagged HMAC so a peer-process attacker
    // (DPAPI on Windows is per-user, not per-app) can't silently swap the
    // session for an attacker-controlled JWT without recomputing the tag. (M10)
    keyring_store::store_signed(AUTH_ACCOUNT, &json)
}

fn load_auth_session() -> Result<Option<AuthSession>, String> {
    keyring_store::migrate_from_json_if_needed();
    // retrieve_signed verifies the HMAC tag and silently drops + returns
    // None on mismatch — the user observes a logged-out state and is forced
    // to re-authenticate, which is the desired tamper response.
    match keyring_store::retrieve_signed(AUTH_ACCOUNT)? {
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
    keyring_store::remove_signed(AUTH_ACCOUNT)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Generate a fresh login URL bound to a server-side state nonce.
///
/// The frontend should call this command, store the returned URL, then open it
/// (or call `auth_login` which opens the same URL). The website MUST echo the
/// state back in the `volt://auth/callback?state=...` deep link or the
/// callback is rejected — preventing a malicious page from injecting a
/// session into the user's keyring via a forged deep link.
#[tauri::command]
pub async fn auth_start_login() -> Result<String, String> {
    ensure_configured()?;

    let state = uuid::Uuid::new_v4().to_string();

    {
        let mut map = auth_state_lock()?;
        prune_expired_auth_states(&mut map);
        map.insert(state.clone(), Instant::now());
    }

    info!("Generated new auth login state");
    Ok(format!("{}?state={}", AUTH_REDIRECT_URL, state))
}

/// Start login flow — opens system browser to the website login page.
///
/// This generates a state nonce (CSRF binding) and opens the browser to the
/// state-bound URL so that `volt://auth/callback` payloads can be verified.
#[tauri::command]
pub async fn auth_login() -> Result<(), String> {
    ensure_configured()?;
    info!("Starting Supabase auth login flow");

    let url = auth_start_login().await?;

    tauri_plugin_opener::open_url(&url, None::<&str>)
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

    // Reject refreshes that swap the underlying user — a stolen refresh
    // token must not be allowed to silently re-bind the local session to
    // a different account.
    if refresh_resp.user.id != session.user_id {
        warn!(
            "Refresh response user mismatch: stored {}, response {}",
            session.user_id, refresh_resp.user.id
        );
        return Err("Refresh response user_id does not match stored session".into());
    }

    // Cap expires_in to MAX_EXPIRES_IN_SECS (24h) to avoid trusting an
    // upstream that hands us an absurd lifetime.
    let capped_expires_in = refresh_resp.expires_in.clamp(0, MAX_EXPIRES_IN_SECS);
    if capped_expires_in != refresh_resp.expires_in {
        warn!(
            "Refresh response expires_in ({}) exceeded cap; using {}",
            refresh_resp.expires_in, capped_expires_in
        );
    }

    let now = chrono::Utc::now().timestamp();
    let new_session = AuthSession {
        access_token: refresh_resp.access_token,
        refresh_token: refresh_resp.refresh_token,
        expires_at: now + capped_expires_in,
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
///
/// Performs three layers of validation before accepting tokens:
/// 1. The URL host/path must match the expected callback shape.
/// 2. The `state` query param MUST match a pending nonce stored by
///    `auth_start_login` (CSRF binding) — prevents drive-by deep links
///    from injecting a session into the victim's keyring.
/// 3. The JWT claims (`exp`, `iss`, `sub`) must validate against the
///    configured `SUPABASE_URL`. `user_id` and `expires_at` are taken from
///    the verified claims, NEVER from the URL query params.
pub fn handle_auth_deep_link(url_str: &str) -> Result<AuthSession, String> {
    let parsed =
        url::Url::parse(url_str).map_err(|e| format!("Failed to parse deep link URL: {}", e))?;

    if parsed.host_str() != Some("auth") || parsed.path() != "/callback" {
        let redacted = url_str.split('?').next().unwrap_or(url_str);
        return Err(format!("Not an auth callback URL: {}", redacted));
    }

    let params: std::collections::HashMap<String, String> =
        parsed.query_pairs().into_owned().collect();

    // 1. Verify the state nonce matches a pending login (CSRF protection).
    //    We consume (remove) the nonce so it can't be replayed.
    let state = params
        .get("state")
        .ok_or("Missing state in callback URL")?
        .clone();

    {
        let mut map = auth_state_lock()?;
        prune_expired_auth_states(&mut map);
        let initiated = map.remove(&state).ok_or_else(|| {
            warn!("Auth callback rejected: unknown or expired state nonce");
            "Invalid or expired auth state".to_string()
        })?;
        if Instant::now().duration_since(initiated) > AUTH_STATE_TTL {
            warn!("Auth callback rejected: state nonce expired during processing");
            return Err("Auth state expired".into());
        }
    }

    let access_token = params
        .get("access_token")
        .ok_or("Missing access_token in callback URL")?
        .clone();
    let refresh_token = params
        .get("refresh_token")
        .ok_or("Missing refresh_token in callback URL")?
        .clone();

    // 2. Validate JWT claims and pull authoritative user_id / expires_at
    //    from them rather than trusting the URL query params.
    let claims = validate_access_token_claims(&access_token)?;

    let session = AuthSession {
        access_token,
        refresh_token,
        expires_at: claims.exp,
        user_id: claims.sub,
    };

    save_auth_session(&session)?;
    info!("Auth session saved from deep link callback");

    Ok(session)
}

// ---------------------------------------------------------------------------
// JWT claim validation
// ---------------------------------------------------------------------------

/// Subset of Supabase JWT claims we validate.
///
/// NOTE: We intentionally do NOT verify the JWT signature client-side.
/// Supabase signs access tokens with HS256 using a project-level JWT secret
/// that is NOT exposed to clients (no JWKS endpoint for symmetric keys).
/// Without that secret, signature verification is impossible. We instead
/// rely on the deep-link state binding (CSRF) plus claim validation
/// (`exp`/`iss`/`sub`) to detect obvious tampering, and let the Supabase
/// REST API reject any forged tokens on the next authenticated call.
#[derive(Debug, Deserialize)]
struct AccessTokenClaims {
    /// Subject (user id).
    sub: String,
    /// Expiration unix timestamp.
    exp: i64,
    /// Issuer — must equal `{SUPABASE_URL}/auth/v1`.
    iss: String,
}

/// Decode the access token's claims (without signature verification — see
/// `AccessTokenClaims` doc comment for why) and validate `exp`, `iss`, `sub`.
fn validate_access_token_claims(access_token: &str) -> Result<AccessTokenClaims, String> {
    let parts: Vec<&str> = access_token.split('.').collect();
    if parts.len() != 3 {
        return Err("Access token is not a valid JWT (expected 3 segments)".into());
    }

    let payload_b64 = parts[1];
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|e| format!("Failed to base64-decode JWT payload: {}", e))?;

    let claims: AccessTokenClaims = serde_json::from_slice(&decoded)
        .map_err(|e| format!("Failed to parse JWT claims: {}", e))?;

    let now = chrono::Utc::now().timestamp();
    if claims.exp <= now {
        return Err("Access token is expired".into());
    }

    if claims.sub.trim().is_empty() {
        return Err("Access token has empty subject".into());
    }

    let expected_iss = format!("{}/auth/v1", SUPABASE_URL.trim_end_matches('/'));
    if claims.iss != expected_iss {
        warn!(
            "Auth token rejected: issuer mismatch (expected {}, got {})",
            expected_iss, claims.iss
        );
        return Err("Access token issuer does not match configured Supabase URL".into());
    }

    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_auth_deep_link_missing_state_rejected() {
        // Without `state`, the callback must be rejected even if other
        // tokens look valid — this is the CSRF protection check.
        let url = "volt://auth/callback?access_token=abc&refresh_token=def&expires_at=1700000000&user_id=uid123";
        let result = handle_auth_deep_link(url);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_lowercase().contains("state"));
    }

    #[test]
    fn test_parse_auth_deep_link_unknown_state_rejected() {
        // A state that was never issued by `auth_start_login` must be rejected.
        let url = "volt://auth/callback?state=not-a-real-state&access_token=abc&refresh_token=def";
        let result = handle_auth_deep_link(url);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_lowercase()
                .contains("invalid or expired")
        );
    }

    #[test]
    fn test_parse_wrong_path() {
        let url = "volt://other/path?access_token=abc";
        let result = handle_auth_deep_link(url);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_jwt_claims_rejects_non_jwt() {
        let result = validate_access_token_claims("not-a-jwt");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_jwt_claims_rejects_expired() {
        // Header.payload.signature with exp=1 (epoch second 1)
        // Payload: {"sub":"u","exp":1,"iss":"https://example.com/auth/v1"}
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            br#"{"sub":"u","exp":1,"iss":"https://example.com/auth/v1"}"#,
        );
        let token = format!("aaa.{}.bbb", payload);
        let result = validate_access_token_claims(&token);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_lowercase().contains("expired"));
    }
}
