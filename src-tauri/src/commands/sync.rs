//! Cloud sync commands (premium feature)
//!
//! Push/pull snippets and quicklinks to Supabase.
//! All commands gate on `profiles.tier = 'premium'`.

use crate::commands::auth;
use crate::commands::quicklinks::{
    Quicklink, QuicklinkState, validate_command_target, validate_folder_target, validate_url_target,
};
use crate::commands::snippets::{Snippet, SnippetState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use tracing::{info, warn};

// Sync-pull row sanity caps (applied to remote rows before insertion).
// A cross-device attacker with a leaked access token could write rows directly
// via Supabase REST; these limits + per-row validators prevent persisting them.
const MAX_SNIPPET_TRIGGER_LEN: usize = 64;
const MAX_SNIPPET_CONTENT_LEN: usize = 100_000;
const MAX_SNIPPET_ID_LEN: usize = 128;
const MAX_QUICKLINK_FIELD_LEN: usize = 4096;

const SUPABASE_URL: &str = env!("SUPABASE_URL");
const SUPABASE_ANON_KEY: &str = env!("SUPABASE_ANON_KEY");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub last_synced_at: Option<i64>,
    pub is_premium: bool,
    pub is_logged_in: bool,
}

pub struct SyncState {
    pub last_synced_at: Mutex<Option<i64>>,
    pub client: reqwest::Client,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            last_synced_at: Mutex::new(None),
            client: reqwest::Client::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct SyncRow {
    data: serde_json::Value,
}

/// Premium gate. Prefers `tier` JWT claim if upstream Supabase auth hook
/// publishes one (defense in depth — avoids the `profiles.tier` UPDATE-via-REST
/// privilege escalation). Falls back to REST `/profiles?id=eq.<uid>` for
/// backward compat. Migration path: configure a Supabase auth hook to add
/// `tier` to access-token claims, then this REST fallback can be removed.
async fn require_premium() -> Result<auth::AuthSession, String> {
    let session = auth::auth_get_session()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "not_logged_in".to_string())?;

    // Defense in depth: if the access token carries a verified `tier`
    // claim, trust it. The renderer cannot mint a signed JWT, so a claim
    // that survives JWKS signature verification is authoritative — and
    // unlike a REST `/profiles?id=eq.<uid>` lookup, it's not vulnerable to
    // a leaked anon key + `profiles.tier` UPDATE if upstream RLS ever
    // drifts.
    if let Ok(claims) = auth::validate_access_token(&session.access_token).await
        && let Some(ref tier) = claims.tier
    {
        let tier = tier.as_str();
        if matches!(tier, "premium" | "lifetime" | "developer" | "admin") {
            return Ok(session);
        }
        return Err("premium_required".to_string());
    }

    // Fallback (current behavior) — REST profile lookup.
    let profile = auth::auth_get_profile()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "profile_not_found".to_string())?;

    if profile.tier != "premium" && profile.tier != "developer" && profile.tier != "admin" {
        return Err("premium_required".to_string());
    }

    Ok(session)
}

async fn upsert(
    client: &reqwest::Client,
    session: &auth::AuthSession,
    data_type: &str,
    data: &serde_json::Value,
) -> Result<(), String> {
    let url = format!("{}/rest/v1/sync_data", SUPABASE_URL);

    let body = serde_json::json!({
        "user_id":    session.user_id,
        "data_type":  data_type,
        "data":       data,
        "updated_at": chrono::Utc::now().to_rfc3339(),
    });

    let resp = client
        .post(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", session.access_token))
        .header("Prefer", "resolution=merge-duplicates")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("sync push network error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("sync push failed {}: {}", status, body));
    }

    Ok(())
}

async fn fetch(
    client: &reqwest::Client,
    session: &auth::AuthSession,
    data_type: &str,
) -> Result<Option<serde_json::Value>, String> {
    let url = format!("{}/rest/v1/sync_data", SUPABASE_URL);

    let resp = client
        .get(&url)
        .query(&[
            ("user_id", format!("eq.{}", session.user_id)),
            ("data_type", format!("eq.{}", data_type)),
            ("select", "data".to_string()),
        ])
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", session.access_token))
        .send()
        .await
        .map_err(|e| format!("sync pull network error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("sync pull failed {}: {}", status, body));
    }

    let rows: Vec<SyncRow> = resp
        .json()
        .await
        .map_err(|e| format!("sync pull parse error: {}", e))?;

    Ok(rows.into_iter().next().map(|r| r.data))
}

/// Validate a single remote snippet row pulled from Supabase.
///
/// Defends against a leaked access token / cross-device attacker writing
/// pathological rows directly via Supabase REST.
fn validate_remote_snippet(s: &Snippet) -> Result<(), String> {
    if s.id.trim().is_empty() {
        return Err("empty id".into());
    }
    if s.id.len() > MAX_SNIPPET_ID_LEN {
        return Err(format!("id too long ({} chars)", s.id.len()));
    }
    if s.trigger.trim().is_empty() {
        return Err("empty trigger".into());
    }
    if s.trigger.len() > MAX_SNIPPET_TRIGGER_LEN {
        return Err(format!(
            "trigger too long ({} chars, max {})",
            s.trigger.len(),
            MAX_SNIPPET_TRIGGER_LEN
        ));
    }
    if s.content.len() > MAX_SNIPPET_CONTENT_LEN {
        return Err(format!(
            "content too long ({} bytes, max {})",
            s.content.len(),
            MAX_SNIPPET_CONTENT_LEN
        ));
    }
    Ok(())
}

/// Validate a single remote quicklink row pulled from Supabase. Reuses the
/// same validators applied at save time so that a maliciously injected row
/// (e.g. `link_type="command"` with a piped shell payload) is rejected
/// before it ever reaches local state.
fn validate_remote_quicklink(q: &Quicklink) -> Result<(), String> {
    if q.id.trim().is_empty() {
        return Err("empty id".into());
    }
    if q.id.len() > MAX_QUICKLINK_FIELD_LEN
        || q.name.len() > MAX_QUICKLINK_FIELD_LEN
        || q.shortcut.len() > MAX_QUICKLINK_FIELD_LEN
        || q.target.len() > MAX_QUICKLINK_FIELD_LEN
    {
        return Err("field exceeds max length".into());
    }
    match q.link_type.as_str() {
        "command" => validate_command_target(&q.target).map_err(|e| e.to_string())?,
        "url" => validate_url_target(&q.target).map_err(|e| e.to_string())?,
        "folder" => validate_folder_target(&q.target).map_err(|e| e.to_string())?,
        other => return Err(format!("unknown link_type={}", other)),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Push local snippets + quicklinks to Supabase. Requires premium tier.
#[tauri::command]
pub async fn sync_push(
    sync_state: State<'_, SyncState>,
    snippet_state: State<'_, SnippetState>,
    quicklink_state: State<'_, QuicklinkState>,
) -> Result<SyncStatus, String> {
    let session = require_premium().await?;
    let now = chrono::Utc::now().timestamp();
    let client = sync_state.client.clone();

    let snippets = snippet_state.get_all()?;
    let snippets_json = serde_json::to_value(&snippets).map_err(|e| e.to_string())?;
    upsert(&client, &session, "snippets", &snippets_json).await?;

    let quicklinks = quicklink_state.get_all()?;
    let quicklinks_json = serde_json::to_value(&quicklinks).map_err(|e| e.to_string())?;
    upsert(&client, &session, "quicklinks", &quicklinks_json).await?;

    {
        let mut ts = sync_state
            .last_synced_at
            .lock()
            .map_err(|e| e.to_string())?;
        *ts = Some(now);
    }

    info!("Sync push completed");
    // require_premium() guarantees both flags are true at this point.
    Ok(SyncStatus {
        last_synced_at: Some(now),
        is_premium: true,
        is_logged_in: true,
    })
}

/// Pull snippets + quicklinks from Supabase and replace local data. Requires premium tier.
#[tauri::command]
pub async fn sync_pull(
    sync_state: State<'_, SyncState>,
    snippet_state: State<'_, SnippetState>,
    quicklink_state: State<'_, QuicklinkState>,
) -> Result<SyncStatus, String> {
    let session = require_premium().await?;
    let now = chrono::Utc::now().timestamp();
    let client = sync_state.client.clone();

    // Snippets: merge by updated_at (keep newest per ID)
    if let Some(data) = fetch(&client, &session, "snippets").await? {
        let remote: Vec<Snippet> =
            serde_json::from_value(data).map_err(|e| format!("parse remote snippets: {}", e))?;

        let local = snippet_state.get_all()?;
        let mut merged: HashMap<String, Snippet> =
            local.into_iter().map(|s| (s.id.clone(), s)).collect();

        let mut snip_accepted = 0usize;
        let mut snip_rejected = 0usize;
        for remote_snippet in remote {
            if let Err(reason) = validate_remote_snippet(&remote_snippet) {
                warn!(
                    "sync_pull: rejecting snippet id={} reason={}",
                    remote_snippet.id, reason
                );
                snip_rejected += 1;
                continue;
            }
            merged
                .entry(remote_snippet.id.clone())
                .and_modify(|local_s| {
                    if remote_snippet.updated_at > local_s.updated_at {
                        local_s.clone_from(&remote_snippet);
                    }
                })
                .or_insert(remote_snippet);
            snip_accepted += 1;
        }
        info!(
            "sync_pull snippets: accepted={} rejected={}",
            snip_accepted, snip_rejected
        );

        snippet_state.replace_all(merged)?;
    }

    // Quicklinks: full replace (no timestamps on quicklinks)
    if let Some(data) = fetch(&client, &session, "quicklinks").await? {
        let remote: Vec<Quicklink> =
            serde_json::from_value(data).map_err(|e| format!("parse remote quicklinks: {}", e))?;

        let mut map: HashMap<String, Quicklink> = HashMap::new();
        let mut ql_accepted = 0usize;
        let mut ql_rejected = 0usize;
        for ql in remote {
            if let Err(reason) = validate_remote_quicklink(&ql) {
                warn!(
                    "sync_pull: rejecting quicklink id={} reason={}",
                    ql.id, reason
                );
                ql_rejected += 1;
                continue;
            }
            map.insert(ql.id.clone(), ql);
            ql_accepted += 1;
        }
        info!(
            "sync_pull quicklinks: accepted={} rejected={}",
            ql_accepted, ql_rejected
        );
        quicklink_state.replace_all(map)?;
    }

    {
        let mut ts = sync_state
            .last_synced_at
            .lock()
            .map_err(|e| e.to_string())?;
        *ts = Some(now);
    }

    info!("Sync pull completed");
    Ok(SyncStatus {
        last_synced_at: Some(now),
        is_premium: true,
        is_logged_in: true,
    })
}

/// Returns sync status: last sync timestamp, login state, premium state.
#[tauri::command]
pub async fn get_sync_status(sync_state: State<'_, SyncState>) -> Result<SyncStatus, String> {
    let (is_logged_in, is_premium) = match auth::auth_get_profile().await {
        Ok(Some(p)) => (
            true,
            matches!(p.tier.as_str(), "premium" | "developer" | "admin"),
        ),
        Ok(None) => (false, false),
        Err(_) => (false, false),
    };

    let last_synced_at = *sync_state
        .last_synced_at
        .lock()
        .map_err(|e| e.to_string())?;

    Ok(SyncStatus {
        last_synced_at,
        is_premium,
        is_logged_in,
    })
}
