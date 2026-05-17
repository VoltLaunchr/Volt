//! Tauri commands exposing the local embedding engine to the frontend.
//!
//! Frontend contract:
//! - `embeddings_is_ready` — non-blocking probe, returns whether the model is
//!   resident in memory. Use this to decide whether to show a "preparing AI"
//!   indicator before triggering a search.
//! - `embeddings_prepare` — trigger the lazy load (downloads ~120 MB on first
//!   call). Long-running on a cold cache. Frontend should display progress UI.
//! - `embeddings_test` — debug-only end-to-end check that returns a raw
//!   embedding vector. Gated to `cfg(debug_assertions)` so release builds
//!   never expose it.
//!
//! The full RAG pipeline (chunking, indexing, hybrid search) builds on top
//! of these but lives in a separate phase.

use std::sync::Arc;
use tauri::State;
use tracing::warn;

use crate::core::error::{VoltError, VoltResult};
use crate::embeddings::EmbeddingEngine;

/// Returns `true` if the embedding model is loaded in memory.
///
/// Does **not** trigger model load. Safe to call repeatedly.
#[tauri::command]
pub async fn embeddings_is_ready(engine: State<'_, Arc<EmbeddingEngine>>) -> VoltResult<bool> {
    Ok(engine.is_ready().await)
}

/// Eagerly load the embedding model (downloading it on first use).
///
/// This is the only frontend-facing entry point that performs the ~120 MB
/// download. Call from a user-initiated action (e.g. enabling "Ask my notes"
/// in Settings) so the user is aware of the wait. Subsequent calls are cheap.
#[tauri::command]
pub async fn embeddings_prepare(engine: State<'_, Arc<EmbeddingEngine>>) -> VoltResult<()> {
    engine.ensure_loaded().await.map_err(|e| {
        warn!("Failed to load embedding model: {e}");
        VoltError::Unknown(e.to_string())
    })?;
    Ok(())
}

/// Debug-only: embed a string and return the raw vector. Used by the dev
/// console / integration tests to verify the engine works end-to-end without
/// touching the production RAG pipeline.
///
/// Gated to debug builds so release binaries do not expose a way to dump
/// arbitrary embeddings via IPC — this would otherwise be an oracle for
/// model fingerprinting attacks against installed users.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn embeddings_test(
    engine: State<'_, Arc<EmbeddingEngine>>,
    text: String,
) -> VoltResult<Vec<f32>> {
    engine
        .embed(&text)
        .await
        .map_err(|e| VoltError::Unknown(e.to_string()))
}
