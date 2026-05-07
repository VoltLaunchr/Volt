/**
 * Supabase Authentication Commands
 *
 * Handles browser-based OAuth + PKCE flow for desktop app authentication:
 * 1. `auth_start_login` mints a CSRF state nonce AND a PKCE
 *    code_verifier, kept in process memory; only the SHA-256
 *    code_challenge ever leaves the desktop.
 * 2. Browser hits voltlaunchr.com/auth/desktop-login?state=&code_challenge=
 * 3. After the user logs in there, the site mints a single-use AUTH_CODE
 *    bound to the challenge and redirects to volt://auth/callback?
 *    state=&code=.
 * 4. `handle_auth_deep_link` verifies state, posts {code, code_verifier}
 *    to /api/auth/exchange-code over HTTPS, receives tokens, validates
 *    the JWT signature against the project JWKS, and stores them in the
 *    OS keyring (HMAC-tagged) under "supabase_auth".
 *
 * Tokens never travel through URL params, browser history, or extensions.
 */
use base64::Engine as _;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::keyring_store;

/// Per-flow state held in memory between `auth_start_login` and the
/// matching `volt://auth/callback`. The `code_verifier` MUST never be
/// sent to the website until we have a valid AUTH_CODE bound to it.
struct PendingAuthFlow {
    initiated: Instant,
    code_verifier: String,
}

impl Drop for PendingAuthFlow {
    fn drop(&mut self) {
        self.code_verifier.zeroize();
    }
}

/// Pending login flows keyed by CSRF state nonce. `Mutex` rather than
/// `RwLock` because every access mutates (insert / remove / prune).
static AUTH_STATE: Lazy<Mutex<HashMap<String, PendingAuthFlow>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Lifetime of a pending login flow (5 minutes — same as the website's
/// auth-code TTL so the desktop never keeps state past what the server
/// will accept).
const AUTH_STATE_TTL: Duration = Duration::from_secs(5 * 60);

/// Hard cap on concurrent pending auth flows. A single user can only have
/// a handful in flight; anything beyond this is either a bug or a memory
/// DoS via repeated `auth_start_login` calls. When the cap is reached we
/// drop the oldest entries first.
const AUTH_STATE_MAX_ENTRIES: usize = 64;

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
/// is small (~200 bytes) so anything over a few seconds usually means a
/// connectivity blip; we retry once before failing the login flow. 15s
/// is comfortably above typical TLS handshake + cold-cache fetch on a
/// flaky network without being so long it noticeably stalls the UI.
const JWKS_FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// Number of retry attempts on transient JWKS fetch errors (TCP/TLS/timeout).
/// We do not retry on HTTP 4xx/5xx — those are deliberate responses, not
/// blips, and retrying would just hammer the upstream.
const JWKS_FETCH_MAX_ATTEMPTS: u32 = 2;

/// Backoff between JWKS retry attempts. Short on purpose — the user is
/// blocked on the auth flow completing.
const JWKS_RETRY_BACKOFF: Duration = Duration::from_millis(500);

fn auth_state_lock() -> std::sync::MutexGuard<'static, HashMap<String, PendingAuthFlow>> {
    AUTH_STATE.lock().unwrap_or_else(|e| {
        warn!("AUTH_STATE mutex was poisoned; recovering");
        e.into_inner()
    })
}

/// Drop pending flows older than `AUTH_STATE_TTL`.
fn prune_expired_auth_states(map: &mut HashMap<String, PendingAuthFlow>) {
    let now = Instant::now();
    map.retain(|_, flow| now.duration_since(flow.initiated) <= AUTH_STATE_TTL);
}

/// Enforce `AUTH_STATE_MAX_ENTRIES` by evicting the oldest entries first.
/// Should be called after `prune_expired_auth_states` so we only need to
/// trim if recent (non-expired) flows exceed the cap.
fn cap_auth_states(map: &mut HashMap<String, PendingAuthFlow>) {
    if map.len() <= AUTH_STATE_MAX_ENTRIES {
        return;
    }
    let mut by_age: Vec<(String, Instant)> =
        map.iter().map(|(k, v)| (k.clone(), v.initiated)).collect();
    by_age.sort_by_key(|(_, t)| *t);
    let to_remove = map.len() - AUTH_STATE_MAX_ENTRIES;
    for (k, _) in by_age.into_iter().take(to_remove) {
        map.remove(&k);
    }
}

/// Generate a fresh PKCE pair: a 32-byte random verifier and its
/// base64url-encoded SHA-256 challenge.
///
/// Per RFC 7636 the verifier must be 43-128 chars from the URL-safe
/// alphabet; 32 raw bytes encoded base64url-no-pad is exactly 43 chars.
fn generate_pkce_pair() -> (String, String) {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize());

    (verifier, challenge)
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

/// Full auth session stored in the OS keyring. Tokens never leave the backend.
#[derive(Debug, Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub user_id: String,
}

/// Session info returned to the renderer via IPC.
/// Deliberately omits tokens — the renderer only needs to know whether a
/// valid session exists and when it expires (to schedule a proactive refresh).
/// All token-bearing operations are performed entirely in the backend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub user_id: String,
    pub expires_at: i64,
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

/// Load the full `AuthSession` (with tokens) from the OS keyring.
/// For backend-only use — tokens must not be forwarded to the renderer.
pub fn load_auth_session() -> Result<Option<AuthSession>, String> {
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

/// Generate a fresh login URL bound to a CSRF state nonce + a PKCE
/// code challenge.
///
/// The verifier stays in process memory; only the challenge ships with
/// the URL. The website later mints a single-use AUTH_CODE bound to that
/// challenge, redirects to `volt://auth/callback?state=&code=`, and the
/// desktop submits {code, code_verifier} to /api/auth/exchange-code to
/// obtain tokens. Tokens never travel through the browser.
#[tauri::command]
pub async fn auth_start_login() -> Result<String, String> {
    ensure_configured()?;

    let state = uuid::Uuid::new_v4().to_string();
    let (verifier, challenge) = generate_pkce_pair();

    {
        let mut map = auth_state_lock();
        prune_expired_auth_states(&mut map);
        cap_auth_states(&mut map);
        map.insert(
            state.clone(),
            PendingAuthFlow {
                initiated: Instant::now(),
                code_verifier: verifier,
            },
        );
    }

    info!("Generated new auth login state (PKCE)");
    Ok(format!(
        "{}?state={}&code_challenge={}&code_challenge_method=S256",
        AUTH_REDIRECT_URL, state, challenge
    ))
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

/// Get current session status (checks expiry, returns user_id + expires_at).
/// Tokens are never returned to the renderer.
#[tauri::command]
pub async fn auth_get_session() -> Result<Option<SessionStatus>, String> {
    debug!("Getting auth session");
    let session = match load_auth_session()? {
        Some(s) => s,
        None => return Ok(None),
    };

    let now = chrono::Utc::now().timestamp();
    if now >= session.expires_at {
        debug!("Auth session expired");
        return Ok(None);
    }

    Ok(Some(SessionStatus {
        user_id: session.user_id.clone(),
        expires_at: session.expires_at,
    }))
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
        error!("Supabase profile request failed: {}", status);
        // Body is gated to debug — Supabase error JSON shouldn't contain
        // tokens today, but logging an upstream response body verbatim is
        // a leak vector if the shape ever changes (e.g. a future endpoint
        // echoes the bearer back in `details`). Operators who want the
        // body re-run with RUST_LOG=debug.
        if let Ok(body) = resp.text().await {
            debug!("Profile error response body: {}", body);
        }
        return Err(format!("Profile request failed with status {}", status));
    }

    let profiles: Vec<UserProfile> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse profile response: {}", e))?;

    Ok(profiles.into_iter().next())
}

/// Refresh the access token using the stored refresh_token.
/// Returns only session status (no tokens) to the renderer.
#[tauri::command]
pub async fn auth_refresh_token() -> Result<SessionStatus, String> {
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
        error!("Token refresh failed: {}", status);
        // Body is gated to debug — Supabase has historically embedded
        // request fragments in `error_description` strings, and we don't
        // want a future upstream change to start echoing the refresh
        // token (or anything resembling it) into prod log files.
        if let Ok(body) = resp.text().await {
            debug!("Token refresh error response body: {}", body);
        }
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

    Ok(SessionStatus {
        user_id: new_session.user_id.clone(),
        expires_at: new_session.expires_at,
    })
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

/// Endpoint that exchanges the PKCE auth code for tokens.
const AUTH_EXCHANGE_URL: &str = "https://voltlaunchr.com/api/auth/exchange-code";

/// Network timeout for the code exchange HTTP call. The website looks up
/// a single row by primary key and returns ~1KB of JSON, so anything past
/// a few seconds means trouble.
const EXCHANGE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct ExchangeResponse {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    user_id: String,
}

/// Parse a `volt://auth/callback?...` URL and persist the session.
///
/// Accepts two callback shapes for forward/backward compatibility during
/// the PKCE rollout:
///
/// * **PKCE** — `?state=&code=`. The desktop submits {code, verifier} to
///   `/api/auth/exchange-code` and gets tokens back over HTTPS; tokens
///   never travel through the URL / browser history.
/// * **Implicit (legacy)** — `?state=&access_token=&refresh_token=`. The
///   tokens come through the deep link directly. We still verify the JWT
///   signature against the project JWKS before persisting, so a forged
///   URL can't seed a session even on this path.
///
/// Validation layers (both shapes):
/// 1. URL host/path must match the expected callback shape.
/// 2. `state` MUST match a pending flow stored by `auth_start_login`
///    (CSRF binding); the entry is removed on use so the nonce can't be
///    replayed.
/// 3. The access token's signature is verified against the project JWKS
///    (ES256), and `iss` / `aud` / `exp` are validated. `user_id` /
///    `expires_at` come from the verified claims, never from the URL or
///    the website body.
pub async fn handle_auth_deep_link(url_str: &str) -> Result<AuthSession, String> {
    let parsed =
        url::Url::parse(url_str).map_err(|e| format!("Failed to parse deep link URL: {}", e))?;

    if parsed.host_str() != Some("auth") || parsed.path() != "/callback" {
        let redacted = url_str.split('?').next().unwrap_or(url_str);
        return Err(format!("Not an auth callback URL: {}", redacted));
    }

    let params: std::collections::HashMap<String, String> =
        parsed.query_pairs().into_owned().collect();

    // 1. Verify the state nonce + claim the matching PKCE verifier.
    let state = params
        .get("state")
        .ok_or("Missing state in callback URL")?
        .clone();

    let verifier = {
        let mut map = auth_state_lock();
        prune_expired_auth_states(&mut map);
        let flow = map.remove(&state).ok_or_else(|| {
            warn!("Auth callback rejected: unknown or expired state nonce");
            "Invalid or expired auth state".to_string()
        })?;
        if Instant::now().duration_since(flow.initiated) > AUTH_STATE_TTL {
            warn!("Auth callback rejected: state nonce expired during processing");
            return Err("Auth state expired".into());
        }
        flow.code_verifier.clone()
    };

    // 2. Pick the path: PKCE (preferred) or legacy implicit (fallback).
    if let Some(code) = params.get("code") {
        info!("Auth callback: PKCE path (exchanging code)");
        return exchange_code_for_session(code.clone(), verifier).await;
    }

    Err("Auth callback URL missing required `code` parameter".into())
}

/// PKCE path — exchange the auth code for tokens via the website, then
/// verify the JWT signature before persisting.
async fn exchange_code_for_session(code: String, verifier: String) -> Result<AuthSession, String> {
    let client = reqwest::Client::builder()
        .timeout(EXCHANGE_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build exchange HTTP client: {}", e))?;

    let resp = client
        .post(AUTH_EXCHANGE_URL)
        .json(&serde_json::json!({
            "code": code,
            "code_verifier": verifier,
        }))
        .send()
        .await
        .map_err(|e| format!("Auth code exchange failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        warn!("Auth code exchange returned {}", status);
        // Body is gated to debug — the success path of /api/auth/exchange-code
        // returns access_token + refresh_token, so even though the error
        // path shouldn't echo those, a misconfigured deploy returning an
        // unexpected 4xx with the request fields included would be a
        // disaster if logged at warn level. Keep it opt-in.
        if let Ok(body) = resp.text().await {
            debug!("Auth code exchange error response body: {}", body);
        }
        return Err(format!("Auth code exchange failed with status {}", status));
    }

    let exchange: ExchangeResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse exchange response: {}", e))?;

    let claims = validate_access_token(&exchange.access_token).await?;
    if claims.sub != exchange.user_id {
        warn!(
            "Exchange body user_id ({}) does not match JWT sub ({})",
            exchange.user_id, claims.sub
        );
        return Err("Exchange response user_id mismatch".into());
    }

    let expires_at = std::cmp::min(claims.exp, exchange.expires_at);

    let session = AuthSession {
        access_token: exchange.access_token,
        refresh_token: exchange.refresh_token,
        expires_at,
        user_id: claims.sub,
    };

    save_auth_session(&session)?;
    info!("Auth session saved via PKCE code exchange");

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
    /// Optional `tier` claim published by a Supabase auth hook (defense in
    /// depth for premium gating). Renderers can't issue the underlying JWT,
    /// so a `tier` claim that survives signature verification is
    /// authoritative — preferred over the `profiles.tier` REST lookup which
    /// is exposed to a `profiles.tier` UPDATE-via-REST escalation if the
    /// upstream RLS policy ever drifts.
    ///
    /// Migration path: configure a Supabase auth hook to publish this claim,
    /// then the REST fallback in `sync::require_premium` can be retired.
    #[serde(default)]
    pub tier: Option<String>,
}

/// Fetch the Supabase project JWKS document. Performed once per cache miss.
///
/// Retries on transient network errors (TCP/TLS/timeout) up to
/// `JWKS_FETCH_MAX_ATTEMPTS` total attempts. HTTP 4xx/5xx responses are
/// not retried — those signal a misconfigured project / upstream outage,
/// and hammering with retries doesn't help.
async fn fetch_jwks() -> Result<JwkSet, String> {
    let base = SUPABASE_URL.trim_end_matches('/');
    let url = format!("{}/auth/v1/.well-known/jwks.json", base);
    let client = reqwest::Client::builder()
        .timeout(JWKS_FETCH_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build JWKS HTTP client: {}", e))?;

    let mut last_err: Option<String> = None;
    for attempt in 1..=JWKS_FETCH_MAX_ATTEMPTS {
        match client.get(&url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    // Non-2xx is deterministic — bubble up immediately.
                    return Err(format!("JWKS endpoint returned {}", resp.status()));
                }
                return resp
                    .json::<JwkSet>()
                    .await
                    .map_err(|e| format!("Failed to parse JWKS response: {}", e));
            }
            Err(e) => {
                let msg = format!("JWKS fetch attempt {} failed: {}", attempt, e);
                if attempt < JWKS_FETCH_MAX_ATTEMPTS {
                    warn!("{} — retrying", msg);
                    tokio::time::sleep(JWKS_RETRY_BACKOFF).await;
                }
                last_err = Some(msg);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| "JWKS fetch failed".into()))
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
    let header =
        decode_header(access_token).map_err(|e| format!("JWT header parse failed: {}", e))?;

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

    #[test]
    fn test_pkce_pair_shape() {
        // RFC 7636: 32 raw bytes -> 43-char URL-safe base64 (no padding).
        // SHA-256 -> 32 bytes -> 43-char URL-safe base64 challenge.
        let (verifier, challenge) = generate_pkce_pair();
        assert_eq!(verifier.len(), 43, "verifier must be 43 chars");
        assert_eq!(challenge.len(), 43, "challenge must be 43 chars");
        // URL-safe alphabet only — no '+' '/' '=' so the values can ride
        // through query strings without further encoding.
        let safe = |s: &str| {
            s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        };
        assert!(safe(&verifier), "verifier has unsafe chars: {}", verifier);
        assert!(
            safe(&challenge),
            "challenge has unsafe chars: {}",
            challenge
        );
        // Two consecutive calls must yield different verifiers (entropy
        // sanity check — not a cryptographic test, just a regression
        // guard for `generate_pkce_pair` accidentally becoming constant).
        let (v2, _) = generate_pkce_pair();
        assert_ne!(verifier, v2, "PKCE generator is not random");
    }

    #[tokio::test]
    async fn test_handle_deep_link_rejects_missing_payload() {
        // State accepted (we plant one), but neither `code` nor
        // `access_token` present → must be rejected before any HTTP call.
        let state = "test-missing-payload";
        {
            let mut map = auth_state_lock();
            map.insert(
                state.to_string(),
                PendingAuthFlow {
                    initiated: Instant::now(),
                    code_verifier: "x".repeat(43),
                },
            );
        }
        let url = format!("volt://auth/callback?state={}", state);
        let err = handle_auth_deep_link(&url)
            .await
            .expect_err("missing payload should be rejected");
        let lower = err.to_lowercase();
        assert!(
            lower.contains("code") || lower.contains("access_token"),
            "expected payload error, got: {}",
            err
        );
    }
}
