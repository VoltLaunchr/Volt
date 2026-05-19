//! Custom Emoji Generation — HuggingFace → Replicate → Pollinations fallback.
//!
//! ## Routing model (Volt Pro)
//!
//! The desktop client **must not** carry Volt's paid API tokens in production.
//! Providers are selected at runtime by [`select_providers`] and tried in
//! priority order by [`generate_with_fallback`]:
//!
//! - **HuggingFace** — dev-only. Reads `HF_TOKEN`. Calls the Inference
//!   Providers router (`router.huggingface.co/hf-inference/models/...`) on
//!   `black-forest-labs/FLUX.1-schnell` (distilled FLUX, 4-step). The legacy
//!   `api-inference.huggingface.co/models/<X>` endpoint was retired in 2025 —
//!   it now returns a bare 404 "Cannot POST" for every model. The token must
//!   carry the **Inference Providers** permission scope; old "Inference API"
//!   tokens no longer authorize this route. FLUX is generalist, so the
//!   prompt embeds an explicit "emoji sticker" style hint to substitute for
//!   the LoRA trigger phrase we used with the previous model.
//! - **Replicate** — dev-only. Reads `REPLICATE_TOKEN`. Calls `fofr/sdxl-emoji`
//!   LoRA. Highest quality but paid (no free tier — credits required).
//! - **Pollinations** — dev-only. No auth, no token, no env var. Hits
//!   `image.pollinations.ai/prompt/...` via GET, returns the PNG directly.
//!   Lowest quality of the three (and the prompt transits a public service),
//!   but always available — the safety net so the feature still works when
//!   the paid chains are down or out of credit. Always enabled in debug
//!   builds; deliberately omitted from release builds where prompts must
//!   stay on the Volt Pro backend.
//! - **VoltBackend** (implicit) — prod path. Release builds carry no direct
//!   provider; the chain returns the "Volt Pro" placeholder error until the
//!   server-side proxy at voltlaunchr.com ships (it will verify the user's
//!   Supabase JWT + Pro tier and pick a provider server-side).
//!
//! ## Flow
//!
//! 1. Each provider returns the generated PNG as `Vec<u8>` (HF emits bytes
//!    directly; Replicate returns a URL we download internally).
//! 2. We save the bytes to `app_data_dir/custom_emojis/{id}.png`.
//! 3. We persist a tiny index JSON so the UI can list/manage them.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tracing::{info, warn};

/// Redact `Bearer <token>` patterns from upstream error bodies before they
/// land in logs. Replicate / HuggingFace error responses occasionally echo
/// the request `Authorization` header back in JSON; treating them as opaque
/// would leak the user's API token via the tracing-appender file. We keep
/// the redaction conservative so a bad upstream message still has enough
/// shape to debug (status code, error code, etc.) — only the credential
/// fragment is replaced.
static BEARER_TOKEN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)bearer\s+[A-Za-z0-9_\-\.=]{8,}").unwrap());

fn redact_secrets(body: &str) -> String {
    BEARER_TOKEN_RE
        .replace_all(body, "Bearer [REDACTED]")
        .into_owned()
}

/// The `fofr/sdxl-emoji` LoRA was trained with the trigger phrase
/// `A TOK emoji of …`. Prepending it consistently produces sticker-style emojis;
/// without it, the model defaults to base SDXL.
const REPLICATE_PROMPT_PREFIX: &str = "A TOK emoji of ";

/// HuggingFace Inference Providers router endpoint for
/// `black-forest-labs/FLUX.1-schnell`.
///
/// The legacy `api-inference.huggingface.co/models/<X>` endpoint was retired
/// in 2025 — it now returns 404 "Cannot POST /models/..." for every model,
/// including the ones HF still officially recommends. Text-to-image lives on
/// the new router at `router.huggingface.co/<provider>/models/<X>`; the JS/
/// Python SDKs both target this URL pattern.
///
/// FLUX is a generalist text-to-image model with no emoji-specific LoRA, so
/// the prompt encodes the visual style explicitly. The 4-step schnell variant
/// is distilled and runs without classifier-free guidance (`guidance_scale: 0`).
const HUGGINGFACE_INFERENCE_ENDPOINT: &str =
    "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell";
const HUGGINGFACE_PROMPT_PREFIX: &str = "A cute emoji sticker, flat vector illustration, bold outline, vibrant colors, centered on a plain white background, of ";

/// Pollinations.ai — free, auth-less image generation. GET the URL and you
/// get a PNG back. Used as the last-resort fallback in the provider chain.
/// We URL-encode the prompt into the path and pin the model to `flux` for
/// consistent results with the same style hint we send to HF.
const POLLINATIONS_BASE_URL: &str = "https://image.pollinations.ai/prompt/";

/// Cold-start retry: HF serverless spins up the model on first hit and may
/// return 503 with `estimated_time` even when `wait_for_model: true` is set.
/// We re-POST once after a short wait.
const HUGGINGFACE_COLD_START_WAIT_SECS: u64 = 15;

/// Replicate API endpoints.
///
/// We previously POSTed to `/v1/models/fofr/sdxl-emoji/predictions`, which is
/// the dedicated "run-the-latest-version" endpoint. Replicate reserves that
/// endpoint for *official* models — community models like `fofr/sdxl-emoji`
/// return HTTP 404 on it. The portable way is a two-step flow:
///
/// 1. GET `/v1/models/{owner}/{name}` to resolve `latest_version.id`.
/// 2. POST `/v1/predictions` with `{ "version": "<sha256>", "input": ... }`.
///
/// See <https://replicate.com/docs/reference/http>.
const REPLICATE_MODEL_INFO_ENDPOINT: &str = "https://api.replicate.com/v1/models/fofr/sdxl-emoji";
const REPLICATE_PREDICTIONS_ENDPOINT: &str = "https://api.replicate.com/v1/predictions";

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

#[derive(Debug, Deserialize)]
struct ReplicateModelInfo {
    latest_version: ReplicateModelVersion,
}

#[derive(Debug, Deserialize)]
struct ReplicateModelVersion {
    id: String,
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

/// Routes the emoji generation request to a concrete provider.
///
/// See module-level docs for the rationale. Each variant returns the final
/// PNG as `Vec<u8>` — HF emits bytes directly, Replicate downloads its own
/// output URL internally — so callers never see the URL-vs-bytes split.
enum EmojiProvider {
    HuggingFace {
        token: String,
    },
    Replicate {
        token: String,
    },
    /// Free, no-auth fallback. Pollinations does not need any state — we
    /// keep the variant unit-like so adding it to the chain is just
    /// `providers.push(EmojiProvider::Pollinations)` with no env-var dance.
    Pollinations,
}

impl EmojiProvider {
    fn name(&self) -> &'static str {
        match self {
            Self::HuggingFace { .. } => "huggingface",
            Self::Replicate { .. } => "replicate",
            Self::Pollinations => "pollinations",
        }
    }

    async fn generate(&self, prompt: &str) -> Result<Vec<u8>, String> {
        match self {
            Self::HuggingFace { token } => run_huggingface_inference(token, prompt).await,
            Self::Replicate { token } => run_replicate_prediction(token, prompt).await,
            Self::Pollinations => run_pollinations(prompt).await,
        }
    }
}

/// Build the provider chain (dev builds only). Paid providers first when
/// configured, then Pollinations as a free safety net so the feature works
/// even when both paid quotas are exhausted. Release builds return an empty
/// chain — generation must go through the Volt Pro backend proxy instead of
/// shipping prompts to public services from the user's machine.
fn select_providers() -> Vec<EmojiProvider> {
    if !cfg!(debug_assertions) {
        return Vec::new();
    }
    let mut providers = Vec::new();
    if let Ok(t) = std::env::var("HF_TOKEN") {
        let trimmed = t.trim();
        if !trimmed.is_empty() {
            providers.push(EmojiProvider::HuggingFace {
                token: trimmed.to_string(),
            });
        }
    }
    if let Ok(t) = std::env::var("REPLICATE_TOKEN") {
        let trimmed = t.trim();
        if !trimmed.is_empty() {
            providers.push(EmojiProvider::Replicate {
                token: trimmed.to_string(),
            });
        }
    }
    // Always end the chain with Pollinations in dev — keeps the feature
    // working when paid providers are out of credit / mis-configured.
    providers.push(EmojiProvider::Pollinations);
    providers
}

/// Try each provider in order. First success wins; if all fail, return the
/// aggregated error so the UI can show which providers were attempted.
async fn generate_with_fallback(
    providers: &[EmojiProvider],
    prompt: &str,
) -> Result<Vec<u8>, String> {
    if providers.is_empty() {
        return Err(
            "Custom emoji generation requires Volt Pro. This will be enabled once Volt Pro launches."
                .into(),
        );
    }
    let mut errors = Vec::with_capacity(providers.len());
    for provider in providers {
        info!("Custom emoji: trying provider '{}'", provider.name());
        match provider.generate(prompt).await {
            Ok(bytes) => {
                info!(
                    "Custom emoji: provider '{}' succeeded ({} bytes)",
                    provider.name(),
                    bytes.len()
                );
                return Ok(bytes);
            }
            Err(e) => {
                warn!("Custom emoji: provider '{}' failed: {}", provider.name(), e);
                errors.push(format!("{}: {}", provider.name(), e));
            }
        }
    }
    Err(format!(
        "All emoji providers failed.\n{}",
        errors.join("\n")
    ))
}

/// Resolve the latest version SHA for the configured Replicate community model.
///
/// `POST /v1/predictions` requires a concrete version identifier; the
/// `owner/name` shorthand only works for official models. We look it up here
/// so the rest of the flow can target a stable version for each generation.
async fn fetch_latest_version(client: &reqwest::Client, token: &str) -> Result<String, String> {
    let resp = client
        .get(REPLICATE_MODEL_INFO_ENDPOINT)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Replicate model fetch failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        warn!(
            "Replicate model lookup HTTP {} body: {}",
            status,
            redact_secrets(&txt)
        );
        return Err(format!("Replicate model lookup returned HTTP {}", status));
    }

    let info: ReplicateModelInfo = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Replicate model info: {}", e))?;
    Ok(info.latest_version.id)
}

/// POST a prompt to HF's serverless Inference API and return the PNG bytes.
///
/// Success path returns `Content-Type: image/png` and the raw bytes.
/// Failure cases:
/// - 503 with JSON `{ error, estimated_time }` → cold start; we retry once
///   after a short pause despite `wait_for_model: true`, which HF doesn't
///   always honour for community SD checkpoints.
/// - 404 → model not on serverless tier (common for SD community fine-tunes).
///   Caller's responsibility to fall back to Replicate.
/// - 401/429 → bad token or rate-limited; surfaced directly.
async fn run_huggingface_inference(token: &str, prompt: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    // FLUX.1-schnell is distilled (4-step turbo) and trained without classifier-
    // free guidance — `num_inference_steps: 4` matches HF's quickstart and
    // `guidance_scale: 0` avoids artefact-prone CFG. Bumping steps higher
    // doesn't improve quality with this checkpoint, it just wastes credits.
    let body = serde_json::json!({
        "inputs": format!("{}{}", HUGGINGFACE_PROMPT_PREFIX, prompt),
        "options": { "wait_for_model": true },
        "parameters": {
            "num_inference_steps": 4,
            "guidance_scale": 0.0,
            "width": 1024,
            "height": 1024,
        }
    });

    for attempt in 0..2 {
        let resp = client
            .post(HUGGINGFACE_INFERENCE_ENDPOINT)
            .bearer_auth(token)
            .header("Content-Type", "application/json")
            .header("x-wait-for-model", "true")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HuggingFace POST failed: {}", e))?;

        let status = resp.status();
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if status.is_success() && content_type.starts_with("image/") {
            return resp
                .bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| format!("HuggingFace body read failed: {}", e));
        }

        let txt = resp.text().await.unwrap_or_default();
        let redacted = redact_secrets(&txt);
        if status.as_u16() == 503 && attempt == 0 {
            warn!("HuggingFace cold-start (503), retrying once: {}", redacted);
            tokio::time::sleep(Duration::from_secs(HUGGINGFACE_COLD_START_WAIT_SECS)).await;
            continue;
        }
        warn!("HuggingFace HTTP {} body: {}", status, redacted);
        return Err(format!("HuggingFace returned HTTP {}", status));
    }
    Err("HuggingFace: exhausted retries on cold start".into())
}

/// Free, auth-less fallback: hit pollinations.ai with the prompt URL-encoded
/// into the path. Returns the PNG bytes directly. We pin `model=flux` for
/// consistency with HF's FLUX.1-schnell choice and pass the same emoji-style
/// hint we use for HF. `nologo=true` strips the watermark.
///
/// Quality is generally below paid SDXL emoji LoRAs but adequate as a safety
/// net, and it removes the "feature is just broken" UX when both paid
/// providers fail. We don't expose a knob for this in the UI yet — the chain
/// resolution is implicit.
async fn run_pollinations(prompt: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    // Pollinations parses the prompt out of the URL path, so the prompt MUST
    // be percent-encoded. `url::form_urlencoded` over-encodes commas/spaces
    // exactly the way the service expects.
    let styled_prompt = format!("{}{}", HUGGINGFACE_PROMPT_PREFIX, prompt);
    let encoded: String = url::form_urlencoded::byte_serialize(styled_prompt.as_bytes()).collect();
    let url = format!(
        "{}{}?model=flux&width=1024&height=1024&nologo=true",
        POLLINATIONS_BASE_URL, encoded
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Pollinations GET failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        warn!(
            "Pollinations HTTP {} body: {}",
            status,
            redact_secrets(&txt)
        );
        return Err(format!("Pollinations returned HTTP {}", status));
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !content_type.starts_with("image/") {
        let txt = resp.text().await.unwrap_or_default();
        warn!(
            "Pollinations non-image content-type '{}' body: {}",
            content_type,
            redact_secrets(&txt)
        );
        return Err(format!(
            "Pollinations succeeded but returned non-image content-type '{}'",
            content_type
        ));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Pollinations body read failed: {}", e))
}

/// Kick off a Replicate prediction, poll until it terminates, download the
/// resulting PNG and return its bytes.
async fn run_replicate_prediction(token: &str, prompt: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let version = fetch_latest_version(&client, token).await?;

    let body = serde_json::json!({
        "version": version,
        "input": {
            "prompt": format!("{}{}", REPLICATE_PROMPT_PREFIX, prompt),
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
        .post(REPLICATE_PREDICTIONS_ENDPOINT)
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
        warn!("Replicate HTTP {} body: {}", status, redact_secrets(&txt));
        return Err(format!("Replicate returned HTTP {}", status));
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
    }
    .ok_or_else(|| "Replicate succeeded but returned no output URL".to_string())?;

    // Download the PNG. 120 s ceiling — Replicate's CDN occasionally lags right
    // after a prediction succeeds, but anything past two minutes is stuck.
    let download_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = download_client
        .get(&first_url)
        .send()
        .await
        .map_err(|e| format!("Replicate download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Replicate body read failed: {}", e))?;
    Ok(bytes.to_vec())
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

    let providers = select_providers();
    info!(
        "Custom emoji: generating with chain [{}] for prompt='{}'",
        providers
            .iter()
            .map(|p| p.name())
            .collect::<Vec<_>>()
            .join(","),
        trimmed
    );

    let bytes = generate_with_fallback(&providers, trimmed).await?;

    // Normalize whatever the provider returned to PNG bytes. Pollinations
    // emits JPEG even when the route looks PNG-ish, and the index promises
    // a `.png` file. Re-encoding once at write-time keeps the rest of the
    // pipeline (preview, copy-as-image, future thumbnail cache) free of
    // format-sniffing branches. Round-trip cost is negligible for a single
    // 1024² image.
    let png_bytes = {
        let img = image::load_from_memory(&bytes)
            .map_err(|e| format!("Provider returned undecodable image bytes: {}", e))?;
        let mut buf = std::io::Cursor::new(Vec::with_capacity(bytes.len()));
        img.write_to(&mut buf, image::ImageFormat::Png)
            .map_err(|e| format!("Failed to re-encode emoji as PNG: {}", e))?;
        buf.into_inner()
    };

    let id = uuid::Uuid::new_v4().to_string();
    let dir = emoji_dir(&app)?;
    let dest = dir.join(format!("{}.png", id));
    fs::write(&dest, &png_bytes).map_err(|e| format!("Failed to write emoji PNG: {}", e))?;

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

/// Set an RGBA image on the OS clipboard with retry on Windows clipboard
/// contention.
///
/// `SetClipboardData` returns `ERROR_CLIPBOARD_NOT_OPEN` (os error 1418) when
/// another process owns the clipboard at the moment arboard tries to call
/// `OpenClipboard`. Volt's own clipboard-history monitor polls the clipboard
/// every ~500 ms via the `clipboard_manager` plugin, and any other clipboard
/// manager the user has installed (Ditto, Windows clipboard history, etc.)
/// will compete for the same lock. The contention window is short — usually
/// under a few milliseconds — so a small retry budget recovers cleanly.
///
/// We rebuild `arboard::ImageData` inside the loop because its `bytes` field
/// is `Cow<[u8]>` and the cheapest way to avoid borrow-checker grief across
/// retry boundaries is to construct it fresh each attempt (the RGBA slice
/// itself is borrowed, no copy).
fn set_clipboard_image_with_retry(width: usize, height: usize, rgba: &[u8]) -> Result<(), String> {
    const MAX_ATTEMPTS: u32 = 8;
    let mut last_err = String::new();

    for attempt in 0..MAX_ATTEMPTS {
        if attempt > 0 {
            // Linear backoff 25, 50, 75, … ms. Total worst case ≈ 700 ms,
            // well under any user-perceptible threshold for a copy action.
            std::thread::sleep(std::time::Duration::from_millis(25 * attempt as u64));
        }

        let clipboard = match arboard::Clipboard::new() {
            Ok(cb) => cb,
            Err(e) => {
                last_err = format!("Clipboard init failed: {}", e);
                continue;
            }
        };

        let image = arboard::ImageData {
            width,
            height,
            bytes: std::borrow::Cow::Borrowed(rgba),
        };

        // arboard moves the clipboard handle on `set_image`; the next attempt
        // gets a fresh one via `Clipboard::new()`. This is intentional —
        // re-opening clears any half-stuck state on the previous failure.
        let mut cb = clipboard;
        match cb.set_image(image) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = format!("set_image attempt {}: {}", attempt + 1, e),
        }
    }

    Err(format!(
        "Clipboard set_image failed after {} attempts: {}",
        MAX_ATTEMPTS, last_err
    ))
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

    // We can't trust the `.png` file extension: some providers (notably
    // Pollinations.ai) reply with JPEG bytes even when the URL implies PNG,
    // and `image::open` picks its decoder from the file extension. Read the
    // bytes ourselves and let the image crate sniff the format from the
    // magic header so we decode whatever was actually written to disk.
    let bytes =
        fs::read(&entry.path).map_err(|e| format!("Failed to read {}: {}", entry.path, e))?;
    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("Failed to decode {}: {}", entry.path, e))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let rgba_bytes = rgba.into_raw();

    set_clipboard_image_with_retry(width as usize, height as usize, &rgba_bytes)?;

    info!(
        "Custom emoji {} copied to clipboard as {}x{} image",
        id, width, height
    );
    Ok(())
}

/// Whether this build can actually run a generation right now.
///
/// True when at least one direct provider (HF or Replicate) is wired up via
/// env. The VoltBackend proxy is stubbed until the server-side route exists,
/// so release builds always return `false`.
#[tauri::command]
pub async fn custom_emojis_has_token() -> bool {
    !select_providers().is_empty()
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
