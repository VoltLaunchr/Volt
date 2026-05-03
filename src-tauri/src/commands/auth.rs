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
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, RwLock};
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

/// JWKS cache: stores the parsed Supabase Auth JSON Web Key Set together
/// with the time it was fetched. Refreshed every `JWKS_CACHE_TTL` or on
/// demand when an unknown `kid` is encountered (which signals a key
/// rotation upstream).
static JWKS_CACHE: Lazy<RwLock<Option<(JwkSet, Instant)>>> = Lazy::new(|| RwLock::new(None));

/// JWKS cache TTL — matches Supabase's edge cache window so we don't keep
/// stale public keys after a rotation, while avoiding a fetch per token.
const JWKS_CACHE_TTL: Duration = Duration::from_secs(600);

/// Network timeout for `/auth/v1/.well-known/jwks.json` fetches. The endpoint
/// is small (~200 bytes) so anything over a few seconds means trouble.
const JWKS_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

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

    // Verify the freshly-issued access token's signature + claims against
    // JWKS. Body-level user_id check above is belt-and-braces — this is
    // the cryptographic binding.
    let claims = validate_access_token(&refresh_resp.access_token).await?;
    if claims.sub != session.user_id {
        warn!(
            "Refresh JWT sub mismatch: stored {}, JWT {}",
            session.user_id, claims.sub
        );
        return Err("Refreshed JWT sub does not match stored session".into());
    }

    // Cap expires_in to MAX_EXPIRES_IN_SECS (24h) as a defense against an
    // upstream handing us an absurd lifetime in the refresh body. The JWT's
    // `exp` is preferred as the authoritative bound, but we still cap relative
    // to `now` so that even a forged `exp` (impossible past signature check,
    // but we layer regardless) cannot extend a session indefinitely.
    let capped_expires_in = refresh_resp.expires_in.clamp(0, MAX_EXPIRES_IN_SECS);
    if capped_expires_in != refresh_resp.expires_in {
        warn!(
            "Refresh response expires_in ({}) exceeded cap; using {}",
            refresh_resp.expires_in, capped_expires_in
        );
    }
    let now = chrono::Utc::now().timestamp();
    let body_expires_at = now + capped_expires_in;
    let expires_at = std::cmp::min(claims.exp, body_expires_at);

    let new_session = AuthSession {
        access_token: refresh_resp.access_token,
        refresh_token: refresh_resp.refresh_token,
        expires_at,
        user_id: claims.sub,
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
/// 3. The JWT signature is verified against the project JWKS (ES256 by
///    default since Supabase's 2025-10 asymmetric migration), and the
///    `iss` / `aud` / `exp` claims are validated. `user_id` and
///    `expires_at` are taken from the verified claims, NEVER from the URL
///    query params.
pub async fn handle_auth_deep_link(url_str: &str) -> Result<AuthSession, String> {
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

    // 2. Verify JWT signature against the project JWKS and validate
    //    `iss`/`aud`/`exp`. Pull authoritative user_id / expires_at from
    //    the cryptographically verified claims rather than the URL.
    let claims = validate_access_token(&access_token).await?;

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
// JWT signature + claim validation (ES256/RS256/EdDSA via JWKS)
// ---------------------------------------------------------------------------

/// Subset of Supabase JWT claims we validate.
///
/// `iss` / `aud` / `exp` are checked by `jsonwebtoken::Validation` directly
/// against the JSON, so they don't all need to live in this struct — only
/// the fields we want to *use* once the token is verified.
#[derive(Debug, Deserialize)]
pub struct AccessTokenClaims {
    /// Subject (user id) — pulled from the verified token after signature check.
    pub sub: String,
    /// Expiration unix timestamp.
    pub exp: i64,
    /// Issuer — kept for diagnostics; the value is also independently asserted
    /// by `Validation::set_issuer` during decode.
    #[allow(dead_code)]
    pub iss: String,
}

/// Fetch the Supabase project JWKS document. Performed once per cache miss.
async fn fetch_jwks() -> Result<JwkSet, String> {
    let base = SUPABASE_URL.trim_end_matches('/');
    let url = format!("{}/auth/v1/.well-known/jwks.json", base);
    let resp = reqwest::Client::builder()
        .timeout(JWKS_FETCH_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build JWKS HTTP client: {}", e))?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("JWKS fetch failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("JWKS endpoint returned {}", resp.status()));
    }

    resp.json::<JwkSet>()
        .await
        .map_err(|e| format!("Failed to parse JWKS response: {}", e))
}

/// Read the JWKS through the cache. With `force_refresh = true` the cached
/// entry is bypassed — used when an unknown `kid` is encountered, which
/// indicates the upstream rotated keys.
async fn get_jwks(force_refresh: bool) -> Result<JwkSet, String> {
    if !force_refresh
        && let Ok(guard) = JWKS_CACHE.read()
        && let Some((jwks, fetched_at)) = guard.as_ref()
        && fetched_at.elapsed() < JWKS_CACHE_TTL
    {
        return Ok(jwks.clone());
    }

    let jwks = fetch_jwks().await?;
    if let Ok(mut guard) = JWKS_CACHE.write() {
        *guard = Some((jwks.clone(), Instant::now()));
    }
    Ok(jwks)
}

/// Map a JWK's `alg` advertisement to a `jsonwebtoken::Algorithm`.
/// We only accept algorithms Supabase actually uses for asymmetric signing
/// (ES256 since the 2025-10 default migration; RS256 / EdDSA for projects
/// that opted into other curves).
fn jwk_to_algorithm(jwk: &jsonwebtoken::jwk::Jwk) -> Result<Algorithm, String> {
    use jsonwebtoken::jwk::KeyAlgorithm;
    match jwk.common.key_algorithm {
        Some(KeyAlgorithm::ES256) => Ok(Algorithm::ES256),
        Some(KeyAlgorithm::RS256) => Ok(Algorithm::RS256),
        Some(KeyAlgorithm::EdDSA) => Ok(Algorithm::EdDSA),
        Some(other) => Err(format!("Unsupported JWT algorithm in JWKS: {:?}", other)),
        None => Err("JWK is missing the `alg` field".into()),
    }
}

/// Verify a Supabase access token end-to-end:
/// signature against the project JWKS, plus `iss` / `aud` / `exp` claim
/// checks. Returns the verified claims so the caller can use `sub` and
/// `exp` as authoritative values.
///
/// Algorithm-confusion defense: the JWT header's `alg` MUST match the
/// algorithm advertised by the JWK matched via `kid`. This rejects tokens
/// that try to swap an HS256 header onto a key that was issued for ES256.
pub async fn validate_access_token(access_token: &str) -> Result<AccessTokenClaims, String> {
    let header = decode_header(access_token)
        .map_err(|e| format!("JWT header parse failed: {}", e))?;

    let kid = header
        .kid
        .clone()
        .ok_or_else(|| "JWT is missing the `kid` header".to_string())?;

    // Try cache, then refresh once on unknown kid (key rotation case).
    let mut jwks = get_jwks(false).await?;
    if jwks.find(&kid).is_none() {
        warn!("JWT kid '{}' not in cached JWKS; forcing refresh", kid);
        jwks = get_jwks(true).await?;
    }
    let jwk = jwks
        .find(&kid)
        .ok_or_else(|| format!("Unknown JWT kid '{}' even after JWKS refresh", kid))?;

    let alg = jwk_to_algorithm(jwk)?;
    if header.alg != alg {
        warn!(
            "JWT alg mismatch rejected: header={:?} JWK={:?}",
            header.alg, alg
        );
        return Err(format!(
            "JWT alg mismatch: header advertises {:?} but JWK is {:?}",
            header.alg, alg
        ));
    }

    let key = DecodingKey::from_jwk(jwk)
        .map_err(|e| format!("Failed to load decoding key from JWK: {}", e))?;

    let mut validation = Validation::new(alg);
    let expected_iss = format!("{}/auth/v1", SUPABASE_URL.trim_end_matches('/'));
    validation.set_issuer(&[&expected_iss]);
    validation.set_audience(&["authenticated"]);
    validation.validate_exp = true;

    let data = decode::<AccessTokenClaims>(access_token, &key, &validation)
        .map_err(|e| format!("JWT signature/claims verification failed: {}", e))?;

    if data.claims.sub.trim().is_empty() {
        return Err("Access token has empty `sub`".into());
    }

    Ok(data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_parse_auth_deep_link_missing_state_rejected() {
        // Without `state`, the callback must be rejected even if other
        // tokens look valid — this is the CSRF protection check.
        let url = "volt://auth/callback?access_token=abc&refresh_token=def&expires_at=1700000000&user_id=uid123";
        let result = handle_auth_deep_link(url).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_lowercase().contains("state"));
    }

    #[tokio::test]
    async fn test_parse_auth_deep_link_unknown_state_rejected() {
        // A state that was never issued by `auth_start_login` must be rejected.
        let url = "volt://auth/callback?state=not-a-real-state&access_token=abc&refresh_token=def";
        let result = handle_auth_deep_link(url).await;
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_lowercase()
                .contains("invalid or expired")
        );
    }

    #[tokio::test]
    async fn test_parse_wrong_path() {
        let url = "volt://other/path?access_token=abc";
        let result = handle_auth_deep_link(url).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_validate_access_token_rejects_non_jwt() {
        // A bare string is not a JWT — header parse fails before any
        // network round-trip, so this test stays offline-safe.
        let result = validate_access_token("not-a-jwt").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_validate_access_token_rejects_jwt_without_kid() {
        // Header `{"alg":"ES256","typ":"JWT"}` (no kid) → must be rejected
        // before any JWKS fetch. Verifies the kid check is evaluated first.
        use base64::Engine as _;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"alg":"ES256","typ":"JWT"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"sub":"u","exp":99999999999,"iss":"x","aud":"authenticated"}"#);
        let token = format!("{}.{}.sig", header, payload);
        let err = validate_access_token(&token)
            .await
            .expect_err("token without kid should be rejected");
        assert!(err.to_lowercase().contains("kid"), "got: {}", err);
    }
}
