//! Cloud sync commands (premium feature)
//!
//! Push/pull snippets and quicklinks to Supabase.
//! All commands gate on `profiles.tier = 'premium'`.

use crate::commands::auth;
use crate::commands::quicklinks::{Quicklink, QuicklinkState};
use crate::commands::snippets::{Snippet, SnippetState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use tracing::info;

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

/// Validate session and check premium tier. Returns the active session.
async fn require_premium() -> Result<auth::AuthSession, String> {
    let session = auth::auth_get_session()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "not_logged_in".to_string())?;

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
        let remote: Vec<Snippet> = serde_json::from_value(data)
            .map_err(|e| format!("parse remote snippets: {}", e))?;

        let local = snippet_state.get_all()?;
        let mut merged: HashMap<String, Snippet> =
            local.into_iter().map(|s| (s.id.clone(), s)).collect();

        for remote_snippet in remote {
            merged
                .entry(remote_snippet.id.clone())
                .and_modify(|local_s| {
                    if remote_snippet.updated_at > local_s.updated_at {
                        local_s.clone_from(&remote_snippet);
                    }
                })
                .or_insert(remote_snippet);
        }

        snippet_state.replace_all(merged)?;
    }

    // Quicklinks: full replace (no timestamps on quicklinks)
    if let Some(data) = fetch(&client, &session, "quicklinks").await? {
        let remote: Vec<Quicklink> = serde_json::from_value(data)
            .map_err(|e| format!("parse remote quicklinks: {}", e))?;

        let map: HashMap<String, Quicklink> =
            remote.into_iter().map(|q| (q.id.clone(), q)).collect();
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
