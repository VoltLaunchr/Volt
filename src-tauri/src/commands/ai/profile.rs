//! AI Profile (Personalization)
//!
//! A persistent user-context system prompt that gets prepended to the system
//! prompt of every AI Chat request — mirrors Raycast's AI Profile feature.
//!
//! Storage: a dedicated JSON file in the app config dir (`ai_profile.json`),
//! kept separate from the main `Settings` struct so it can evolve independently.
//! The profile is *not* injected into AI Commands / Quick Actions — those have
//! task-specific system prompts.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tracing::warn;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProfile {
    #[serde(default)]
    pub profile: String,
    #[serde(default)]
    pub updated_at: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    Ok(dir.join("ai_profile.json"))
}

/// Read the profile from disk. Returns an empty `AiProfile` if the file is
/// missing or corrupt (logged at warn level).
#[tauri::command]
pub async fn ai_profile_get(app: AppHandle) -> Result<AiProfile, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(AiProfile::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))
}

/// Persist the profile to disk. Stamps `updated_at` with the current UTC time
/// (ISO 8601). Trims whitespace — empty profiles are stored as `""` so the UI
/// shows "never saved" semantics consistently.
#[tauri::command]
pub async fn ai_profile_set(app: AppHandle, profile: String) -> Result<(), String> {
    let path = config_path(&app)?;
    let next = AiProfile {
        profile: profile.trim().to_string(),
        updated_at: Utc::now().to_rfc3339(),
    };
    let json = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Failed to write: {}", e))?;
    Ok(())
}

/// Synchronous helper for use inside other Tauri commands (e.g.
/// `ai_ask_builtin_stream`). Returns `Some(profile_text)` if the persisted
/// profile is non-empty, else `None`. Never panics: any I/O or parse error
/// degrades to `None` with a warn log so chat continues to work.
pub fn load_profile_blocking(app: &AppHandle) -> Option<String> {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(e) => {
            warn!("ai_profile: could not resolve config path: {}", e);
            return None;
        }
    };
    if !path.exists() {
        return None;
    }
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            warn!("ai_profile: read failed ({}): {}", path.display(), e);
            return None;
        }
    };
    let parsed: AiProfile = match serde_json::from_str(&content) {
        Ok(p) => p,
        Err(e) => {
            warn!("ai_profile: parse failed: {}", e);
            return None;
        }
    };
    let trimmed = parsed.profile.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
