//! Custom Emoji Generation via Replicate's `fofr/sdxl-emoji` LoRA.
//!
//! ## Routing model (Volt Pro)
//!
//! The desktop client **must not** carry Volt's paid API tokens in production.
//! Two paths are wired here, selected at runtime by [`EmojiProxy::select`]:
//!
//! - **DirectReplicate** — dev-only. Reads `REPLICATE_TOKEN` from the process env
//!   (loaded by `dotenvy` in `main.rs`). Used when `cfg!(debug_assertions)` is
//!   true *and* the env var is set. This is the path the maintainer uses while
//!   iterating; the user's machine is the only one ever charged.
//!
//! - **VoltBackend** — prod path. Will call the Volt backend (voltlaunchr.com)
//!   which verifies the user's Supabase JWT, checks their Pro tier, then proxies
//!   to Replicate using Volt's server-side token. Today this variant returns a
//!   "not yet available" error — backend implementation is Phase 2.
//!
//! ## Flow (DirectReplicate)
//!
//! 1. POST to `https://api.replicate.com/v1/models/fofr/sdxl-emoji/predictions`
//!    with `Prefer: wait` (blocks server-side up to 60 s; if it times out the API
//!    returns the in-progress prediction and we poll).
//! 2. Once `status == "succeeded"`, GET the first output URL.
//! 3. Save the PNG bytes to `app_data_dir/custom_emojis/{id}.png`.
//! 4. Persist a tiny index JSON so the UI can list/manage them.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tracing::{info, warn};

/// The `fofr/sdxl-emoji` LoRA was trained with the trigger phrase
/// `A TOK emoji of …`. Prepending it consistently produces sticker-style emojis;
/// without it, the model defaults to base SDXL.
const PROMPT_PREFIX: &str = "A TOK emoji of ";

/// Replicate API endpoint for the model (latest version is auto-selected).
const REPLICATE_ENDPOINT: &str = "https://api.replicate.com/v1/models/fofr/sdxl-emoji/predictions";

/// Maximum poll attempts after the initial `Prefer: wait` request returns
/// without a terminal state. 1.5 s per attempt → ~90 s ceiling.
const MAX_POLL_ATTEMPTS: usize = 60;
const POLL_INTERVAL_MS: u64 = 1500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomEmoji {
    pub id: String,
    pub prompt: String,
    /// File path on disk. Tauri's `convertFileSrc` wraps this for the webview.
    pub path: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
struct ReplicatePrediction {
    id: String,
    status: String,
    #[serde(default)]
    output: serde_json::Value,
    #[serde(default)]
    error: Option<String>,
    urls: ReplicateUrls,
}

#[derive(Debug, Deserialize)]
struct ReplicateUrls {
    get: String,
}

fn emoji_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app_data_dir: {}", e))?;
    let dir = base.join("custom_emojis");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create emoji dir: {}", e))?;
    Ok(dir)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(emoji_dir(app)?.join("index.json"))
}

fn read_index(app: &AppHandle) -> Result<Vec<CustomEmoji>, String> {
    let path = index_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("Index parse error: {}", e))
}

fn write_index(app: &AppHandle, entries: &[CustomEmoji]) -> Result<(), String> {
    let path = index_path(app)?;
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Failed to write index: {}", e))
}

/// Routes the emoji generation request to the correct backend.
///
/// See module-level docs for the rationale. Selection is performed once per
/// command invocation (cheap — just an env read).
enum EmojiProxy {
    /// Dev-only: hits Replicate directly using a maintainer-supplied token.
    DirectReplicate { token: String },
    /// Prod: hits the Volt backend which proxies to Replicate using Volt's
    /// own token after authenticating + authorising the user. Phase 2.
    VoltBackend,
}

impl EmojiProxy {
    /// Decide which path to use:
    /// - Debug build **and** `REPLICATE_TOKEN` set → DirectReplicate (dev).
    /// - Otherwise → VoltBackend (today returns "not yet available").
    fn select() -> Self {
        if cfg!(debug_assertions)
            && let Ok(token) = std::env::var("REPLICATE_TOKEN")
        {
            let trimmed = token.trim();
            if !trimmed.is_empty() {
                return Self::DirectReplicate {
                    token: trimmed.to_string(),
                };
            }
        }
        Self::VoltBackend
    }

    async fn generate(&self, prompt: &str) -> Result<String, String> {
        match self {
            Self::DirectReplicate { token } => run_replicate_prediction(token, prompt).await,
            Self::VoltBackend => Err(
                "Custom emoji generation requires Volt Pro. This will be enabled once Volt Pro launches."
                    .to_string(),
            ),
        }
    }
}

/// Kick off a prediction and poll until it terminates. Returns the first output URL.
async fn run_replicate_prediction(token: &str, prompt: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "input": {
            "prompt": format!("{}{}", PROMPT_PREFIX, prompt),
            "width": 1024,
            "height": 1024,
            "num_outputs": 1,
            "num_inference_steps": 50,
            "guidance_scale": 7.5,
            "scheduler": "K_EULER",
            "lora_scale": 0.6,
            "apply_watermark": false,
        }
    });

    // Initial request — `Prefer: wait` blocks up to 60 s server-side.
    let resp = client
        .post(REPLICATE_ENDPOINT)
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .header("Prefer", "wait")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Replicate POST failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("Replicate returned HTTP {}: {}", status, txt));
    }

    let mut prediction: ReplicatePrediction = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Replicate response: {}", e))?;

    // Poll until terminal
    for attempt in 0..MAX_POLL_ATTEMPTS {
        match prediction.status.as_str() {
            "succeeded" => break,
            "failed" | "canceled" => {
                return Err(format!(
                    "Replicate prediction {}: {} ({})",
                    prediction.status,
                    prediction.error.as_deref().unwrap_or(""),
                    prediction.id
                ));
            }
            _ => {
                tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
                let poll = client
                    .get(&prediction.urls.get)
                    .bearer_auth(token)
                    .send()
                    .await
                    .map_err(|e| format!("Poll attempt {} failed: {}", attempt, e))?;
                prediction = poll
                    .json()
                    .await
                    .map_err(|e| format!("Poll parse error: {}", e))?;
            }
        }
    }

    if prediction.status != "succeeded" {
        return Err(format!(
            "Replicate prediction timed out after {} polls (last status: {})",
            MAX_POLL_ATTEMPTS, prediction.status
        ));
    }

    // Output shape: either a string or an array of strings depending on the model.
    let first_url = match &prediction.output {
        serde_json::Value::Array(arr) => arr.first().and_then(|v| v.as_str()).map(String::from),
        serde_json::Value::String(s) => Some(s.clone()),
        _ => None,
    };
    first_url.ok_or_else(|| "Replicate succeeded but returned no output URL".to_string())
}

async fn download_to_file(url: &str, dest: &PathBuf) -> Result<(), String> {
    // 120 s total ceiling — Replicate CDN occasionally lags right after a
    // prediction succeeds, but anything past two minutes is a stuck request.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Download body read failed: {}", e))?;
    fs::write(dest, &bytes).map_err(|e| format!("File write failed: {}", e))
}

/// Generate a new custom emoji from a free-text prompt.
///
/// Persists the PNG to disk and appends a metadata entry to the index.
/// Returns the freshly-created `CustomEmoji`.
#[tauri::command]
pub async fn custom_emojis_generate(app: AppHandle, prompt: String) -> Result<CustomEmoji, String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err("Prompt cannot be empty".into());
    }
    if trimmed.len() > 300 {
        return Err("Prompt is too long (max 300 chars)".into());
    }

    let proxy = EmojiProxy::select();
    info!(
        "Custom emoji: starting generation (proxy={}) for prompt='{}'",
        match &proxy {
            EmojiProxy::DirectReplicate { .. } => "direct",
            EmojiProxy::VoltBackend => "backend",
        },
        trimmed
    );

    let output_url = proxy.generate(trimmed).await?;

    let id = uuid::Uuid::new_v4().to_string();
    let dir = emoji_dir(&app)?;
    let dest = dir.join(format!("{}.png", id));
    download_to_file(&output_url, &dest).await?;

    let emoji = CustomEmoji {
        id: id.clone(),
        prompt: trimmed.to_string(),
        path: dest.to_string_lossy().to_string(),
        created_at: chrono_now_iso(),
    };

    let mut entries = read_index(&app).unwrap_or_default();
    entries.insert(0, emoji.clone());
    write_index(&app, &entries)?;

    info!("Custom emoji {} saved to {}", id, dest.display());
    Ok(emoji)
}

/// List all previously-generated emojis, newest first.
#[tauri::command]
pub async fn custom_emojis_list(app: AppHandle) -> Result<Vec<CustomEmoji>, String> {
    read_index(&app)
}

/// Delete an emoji from disk and remove it from the index.
#[tauri::command]
pub async fn custom_emojis_delete(app: AppHandle, id: String) -> Result<(), String> {
    let mut entries = read_index(&app)?;
    let before = entries.len();
    entries.retain(|e| {
        if e.id == id {
            if let Err(err) = fs::remove_file(&e.path) {
                warn!("Failed to delete emoji file {}: {}", e.path, err);
            }
            false
        } else {
            true
        }
    });
    if entries.len() == before {
        return Err(format!("Emoji '{}' not found", id));
    }
    write_index(&app, &entries)
}

/// Copy a generated emoji's PNG to the OS clipboard as an **image** (not a path).
///
/// Decoded to RGBA so it can be pasted into Slack, Discord, Photoshop, etc.
/// On most apps this gives a "real" image paste; on plain text targets it'll
/// usually fail silently — which is intentional (use `path` action instead).
#[tauri::command]
pub async fn custom_emojis_copy_image(app: AppHandle, id: String) -> Result<(), String> {
    let entries = read_index(&app)?;
    let entry = entries
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("Emoji '{}' not found", id))?;

    let img =
        image::open(&entry.path).map_err(|e| format!("Failed to decode {}: {}", entry.path, e))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let bytes = rgba.into_raw();

    let clipboard_image = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: std::borrow::Cow::Owned(bytes),
    };

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard init failed: {}", e))?;
    clipboard
        .set_image(clipboard_image)
        .map_err(|e| format!("Clipboard set_image failed: {}", e))?;

    info!(
        "Custom emoji {} copied to clipboard as {}x{} image",
        id, width, height
    );
    Ok(())
}

/// Whether this build can actually run a generation right now.
///
/// Returns `true` if either:
/// - we're in a debug build with `REPLICATE_TOKEN` available (dev path); or
/// - the VoltBackend proxy is fully wired (Phase 2 — not yet).
#[tauri::command]
pub async fn custom_emojis_has_token() -> bool {
    match EmojiProxy::select() {
        EmojiProxy::DirectReplicate { .. } => true,
        // VoltBackend proxy is stubbed until the server-side route exists.
        EmojiProxy::VoltBackend => false,
    }
}

/// Whether the current build exposes AI Pro features (custom emoji generation,
/// future image-based actions) in the UI.
///
/// Today: only in debug builds — keeps the feature out of release binaries
/// until the Volt backend proxy is implemented and a subscription check is in
/// place.
///
/// **Roadmap**: replace with `is_volt_pro_subscriber()` once the backend lands.
#[tauri::command]
pub fn ai_pro_features_enabled() -> bool {
    cfg!(debug_assertions)
}

/// Minimal ISO 8601 UTC formatter without pulling in a date crate.
/// Format: `YYYY-MM-DDTHH:MM:SSZ`
fn chrono_now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // Days since unix epoch
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let hour = rem / 3600;
    let minute = (rem % 3600) / 60;
    let second = rem % 60;

    // Civil-from-days (Howard Hinnant's algorithm)
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, m, d, hour, minute, second
    )
}
