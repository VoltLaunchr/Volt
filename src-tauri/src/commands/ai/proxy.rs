//! Transparent IPC proxy for the built-in AI chat (Sprint 2 — Pari A3).
//!
//! The renderer drives the Vercel AI SDK (`createOpenAICompatible`) with a
//! custom `fetch`. That `fetch` forwards the SDK-built request body to
//! [`ai_proxy_stream`], which injects the API key from the OS keyring, posts to
//! the provider's OpenAI-compatible `/chat/completions` endpoint, and re-streams
//! the raw SSE bytes back over a `Channel`. Rust does NOT parse the SSE — it is
//! a near-transparent relay so the AI SDK keeps full ownership of the wire
//! format. The API key never crosses the JS boundary.

use base64::Engine as _;
use futures_util::StreamExt;
use serde::Serialize;

/// Events streamed back to the renderer, where they rebuild a `Response` body.
///
/// Enum-level `rename_all` renames only the variant tags (`Done` → `done`); the
/// inner field names are camelCase already, so no per-field rename is needed.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiProxyEvent {
    /// A raw slice of the provider's response body, base64-encoded so binary-safe
    /// bytes survive the JSON IPC channel without UTF-8 boundary corruption.
    Chunk { data: String },
    /// The upstream response finished (the body stream ended).
    Done,
    /// The proxy or the upstream provider failed. `status` carries the HTTP code
    /// when the failure originated from the provider response.
    Error {
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<u16>,
    },
}

/// Providers that expose an OpenAI-compatible `/chat/completions` surface.
const KNOWN_PROXY_PROVIDERS: &[&str] = &["openai", "anthropic", "groq", "huggingface"];

/// Resolve the OpenAI-compatible base URL for a provider.
///
/// `custom_base_url` overrides the built-in routing table — groundwork for
/// Pari B (local Ollama / LM Studio at `http://localhost:11434/v1` etc.). The
/// override is not surfaced in Settings yet; only the Rust plumbing is ready.
fn resolve_base_url(provider: &str, custom_base_url: Option<&str>) -> Result<String, String> {
    if let Some(custom) = custom_base_url {
        let trimmed = custom.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            return Err("Custom base URL cannot be empty".to_string());
        }
        if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
            return Err("Custom base URL must start with http:// or https://".to_string());
        }
        return Ok(trimmed.to_string());
    }

    let base = match provider {
        "openai" => "https://api.openai.com/v1",
        "groq" => "https://api.groq.com/openai/v1",
        // Anthropic's OpenAI-compatible surface (decision actée: compat, pas de
        // traduction). The native `/v1/messages` path (`ext_ai_anthropic_stream`)
        // stays intact as a fallback for Anthropic-specific features.
        "anthropic" => "https://api.anthropic.com/v1",
        // Hugging Face Inference Providers OpenAI-compatible router. Kept on the
        // same endpoint the hand-rolled path already used (no risky migration).
        "huggingface" => "https://router.huggingface.co/v1",
        other => return Err(format!("Unknown provider '{}'", other)),
    };
    Ok(base.to_string())
}

/// Proxy a single streaming chat completion for the built-in AI chat.
///
/// `request_body` is the JSON object the AI SDK built (model, messages, stream,
/// tools, …); it is forwarded UNCHANGED apart from forcing `stream: true`. The
/// caller never sends an API key — this command injects it from the keyring.
#[tauri::command]
pub async fn ai_proxy_stream(
    provider: String,
    request_body: serde_json::Value,
    base_url: Option<String>,
    channel: tauri::ipc::Channel<AiProxyEvent>,
) -> Result<(), String> {
    let fail = |channel: &tauri::ipc::Channel<AiProxyEvent>, msg: String, status: Option<u16>| {
        let _ = channel.send(AiProxyEvent::Error {
            error: msg.clone(),
            status,
        });
        msg
    };

    if !KNOWN_PROXY_PROVIDERS.contains(&provider.as_str()) && base_url.is_none() {
        return Err(fail(
            &channel,
            format!(
                "Unknown provider '{}'. Supported: {}.",
                provider,
                KNOWN_PROXY_PROVIDERS.join(", ")
            ),
            None,
        ));
    }

    // Align the built-in chat with the per-extension limiter, under a dedicated
    // bucket so it never shares an extension's budget. A higher cap than the
    // per-extension 10/min absorbs the multi-step tool-loop (J1): one user turn
    // can issue several proxied requests (one per model→tool→model step).
    if let Err(e) = crate::commands::extensions::ai_check_rate_limit_n("builtin:chat", 40) {
        return Err(fail(&channel, e, None));
    }

    let base = match resolve_base_url(&provider, base_url.as_deref()) {
        Ok(b) => b,
        Err(e) => return Err(fail(&channel, e, None)),
    };

    let api_key = {
        let tag = format!("volt:ai:key:{}", provider);
        match crate::commands::keyring_store::retrieve_signed(&tag) {
            Ok(Some(key)) => Some(key),
            Ok(None) => None,
            Err(e) => return Err(fail(&channel, e.to_string(), None)),
        }
    };

    // A keyless request is only valid for a custom (local) base URL, e.g. Ollama.
    if api_key.is_none() && base_url.is_none() {
        return Err(fail(
            &channel,
            format!(
                "No API key for '{}'. Add one in Volt Settings → AI.",
                provider
            ),
            None,
        ));
    }

    // Force streaming regardless of what the SDK sent — the renderer always
    // reconstructs a streamed `Response`.
    let mut body = request_body;
    if let Some(obj) = body.as_object_mut() {
        obj.insert("stream".to_string(), serde_json::Value::Bool(true));
    }

    let url = format!("{}/chat/completions", base);
    let mut request = reqwest::Client::new().post(&url).json(&body);
    if let Some(key) = api_key.as_deref() {
        request = request.bearer_auth(key);
    }

    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => return Err(fail(&channel, format!("AI request failed: {}", e), None)),
    };

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(fail(
            &channel,
            format!("AI provider error {}: {}", status, text),
            Some(status.as_u16()),
        ));
    }

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => return Err(fail(&channel, format!("AI stream read error: {}", e), None)),
        };
        if bytes.is_empty() {
            continue;
        }
        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
        channel
            .send(AiProxyEvent::Chunk { data })
            .map_err(|e| e.to_string())?;
    }

    channel
        .send(AiProxyEvent::Done)
        .map_err(|e| e.to_string())?;
    Ok(())
}
