//! Local embeddings infrastructure for semantic search ("Ask my notes" RAG).
//!
//! Uses fastembed-rs with `multilingual-e5-small` (multilingual, FR + EN
//! supported, 384-dim). The model itself is **NOT** bundled into the binary —
//! it is downloaded on demand to `app_data_dir/embeddings/` on first use
//! (~120 MB on disk, one-time cost).
//!
//! ## Threading model
//!
//! `TextEmbedding::embed` takes `&mut self` in fastembed v5 (the underlying
//! ONNX session mutates internal scratch buffers), so we **must** serialize
//! inference behind a mutex — there is no `&self` fast path. The single
//! `Mutex<Option<TextEmbedding>>` therefore guards both the one-time lazy
//! initialization (download + ONNX session creation) AND every subsequent
//! `embed` call. CPU-bound inference is offloaded to `spawn_blocking` so
//! Tokio worker threads stay responsive, and we use `tokio::sync::Mutex`
//! (not `std::sync::Mutex`) so the lock can be held across the await.
//!
//! Concurrency note: under heavy load, callers will queue. The bottleneck
//! is the ONNX session itself; if we ever need parallel inference we'll
//! pool multiple `TextEmbedding` instances.
//!
//! ## E5 prefix convention
//!
//! E5-family models are trained with task-specific prefixes:
//! - `passage: <text>` for documents stored in the vector index
//! - `query: <text>` for search queries against that index
//!
//! Callers MUST add these prefixes themselves — this module exposes raw
//! `embed`/`embed_batch` so the caller decides the task. Mixing prefixes
//! between indexing and querying silently degrades recall, so this is a
//! load-bearing contract once Agent 1's `note_chunks` integration lands.

use std::path::PathBuf;
use std::sync::Arc;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use thiserror::Error;
use tokio::sync::Mutex;
use tracing::info;

/// Tauri-managed state alias for the embedding engine.
///
/// The engine is registered with `app.manage(Arc::new(EmbeddingEngine::new(...)))`
/// in `lib.rs`. Commands inject it via
/// `State<'_, EmbeddingState>` (or the equivalent `State<'_, Arc<EmbeddingEngine>>`,
/// which is the same type). The `Option` layer the original spec proposed is
/// folded *into* `EmbeddingEngine` itself: `EmbeddingEngine::new` does not load
/// the model, and the inner `Mutex<Option<TextEmbedding>>` performs the lazy
/// init on first `embed`. This keeps the load-on-first-use contract while
/// hiding the synchronization details from every caller.
pub type EmbeddingState = Arc<EmbeddingEngine>;

/// Errors emitted by the embedding engine.
#[derive(Debug, Error)]
pub enum EmbeddingError {
    /// Model failed to initialize. Causes include: network failure during
    /// the first-use download, corrupted ONNX session, missing tokenizer.
    #[error("Failed to initialize embedding model: {0}")]
    ModelInit(String),

    /// Inference itself failed (tokenizer overflow, ONNX runtime error).
    #[error("Embedding inference failed: {0}")]
    Inference(String),

    /// IO error while touching the cache directory.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Lazy-initialized embedding engine.
///
/// The model is NOT loaded until the first call to `embed` / `embed_batch` /
/// `ensure_loaded`. First call triggers a ~120 MB download to `cache_dir`.
/// Subsequent calls are cheap (in-memory ONNX session, ~5–20 ms per text on
/// CPU depending on length).
pub struct EmbeddingEngine {
    cache_dir: PathBuf,
    // `embed` takes `&mut self` in fastembed v5, so the model lives behind a
    // single async mutex. We hold the lock across `spawn_blocking` to keep
    // the inference call serialized; the lock is released the moment the
    // blocking task returns.
    model: Mutex<Option<TextEmbedding>>,
}

impl EmbeddingEngine {
    /// Create a new engine. Does **not** load the model.
    ///
    /// `cache_dir` is where fastembed will store the downloaded ONNX model
    /// and tokenizer. The directory is created on first `ensure_loaded`.
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            cache_dir,
            model: Mutex::new(None),
        }
    }

    /// Returns the cache directory configured for this engine.
    /// Useful for diagnostics / settings UI.
    pub fn cache_dir(&self) -> &PathBuf {
        &self.cache_dir
    }

    /// Returns `true` if the model is already loaded in memory.
    /// Does **not** trigger loading. Used by the frontend to decide whether
    /// to show a "preparing AI" indicator.
    pub async fn is_ready(&self) -> bool {
        self.model.lock().await.is_some()
    }

    /// Ensure the model is loaded. First call triggers the ~120 MB download.
    /// Subsequent calls are essentially free (single mutex acquire + check).
    ///
    /// Returns `Ok(())` on success — callers that need to invoke `embed`
    /// must re-acquire the mutex via `embed`/`embed_batch`, since
    /// `TextEmbedding::embed` takes `&mut self` and cannot be called on a
    /// shared handle.
    pub async fn ensure_loaded(&self) -> Result<(), EmbeddingError> {
        let mut guard = self.model.lock().await;
        if guard.is_some() {
            return Ok(());
        }

        info!(
            "Loading embedding model (multilingual-e5-small, ~120 MB download on first use) into {:?}",
            self.cache_dir
        );

        std::fs::create_dir_all(&self.cache_dir)?;

        // fastembed v5 InitOptions builder: take ownership of self in each
        // `with_*` method, so we chain inline.
        let init_opts = InitOptions::new(EmbeddingModel::MultilingualE5Small)
            .with_cache_dir(self.cache_dir.clone())
            .with_show_download_progress(true);

        // `try_new` performs the hf-hub download (if needed) + ONNX session
        // creation. It can block for tens of seconds on a cold cache, so run
        // it on the blocking thread pool to keep Tokio workers responsive.
        let model = tokio::task::spawn_blocking(move || TextEmbedding::try_new(init_opts))
            .await
            .map_err(|e| EmbeddingError::ModelInit(format!("join error: {e}")))?
            .map_err(|e| EmbeddingError::ModelInit(e.to_string()))?;

        *guard = Some(model);
        info!("Embedding model loaded.");
        Ok(())
    }

    /// Embed a single text. Triggers model load on first call.
    ///
    /// **Reminder:** prepend `query: ` or `passage: ` per E5 conventions —
    /// this method does not do it for you (see module docs).
    pub async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbeddingError> {
        let mut out = self.embed_batch(&[text.to_string()]).await?;
        // `embed_batch` always returns one entry per input on success.
        out.pop().ok_or_else(|| {
            EmbeddingError::Inference("embed_batch returned empty result".to_string())
        })
    }

    /// Embed a batch of texts. Triggers model load on first call.
    ///
    /// Batch size is delegated to fastembed's default (256 in v5). For very
    /// large batches the caller should chunk upstream — we don't pre-split
    /// since fastembed already handles internal sub-batching.
    ///
    /// Inference is serialized: `TextEmbedding::embed` takes `&mut self`,
    /// so concurrent callers will queue on the engine's mutex.
    pub async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        // Make sure the model is loaded; this short-circuits if already in.
        self.ensure_loaded().await?;

        // Hold the lock across the blocking call. We use `tokio::sync::Mutex`
        // precisely so we can keep the guard live across `.await`. The
        // ONNX session is CPU-bound, so we offload to `spawn_blocking` to
        // avoid parking a Tokio worker; we move the locked guard into the
        // closure via a small dance (clone the input, take ownership of
        // the model out of the Option, then put it back).
        let owned: Vec<String> = texts.to_vec();
        let mut guard = self.model.lock().await;
        // Take the model out so we can move it into spawn_blocking. We're
        // still holding the mutex guard, so no other caller can race in.
        let mut model = guard.take().ok_or_else(|| {
            EmbeddingError::Inference("model went missing after load".to_string())
        })?;

        let (model, result) = tokio::task::spawn_blocking(move || {
            let r = model.embed(owned, None);
            (model, r)
        })
        .await
        .map_err(|e| EmbeddingError::Inference(format!("join error: {e}")))?;

        // Put the model back regardless of inference outcome so the next
        // caller does not have to re-download.
        *guard = Some(model);

        result.map_err(|e| EmbeddingError::Inference(e.to_string()))
    }
}

/// Cosine similarity between two equal-dimension vectors. Returns a value in
/// `[-1, 1]`. Returns `0.0` for mismatched or empty inputs (defensive: no
/// panics in production).
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }

    // Clamp the denominator away from zero so a degenerate (all-zero) vector
    // returns 0.0 instead of NaN.
    let denom = (na.sqrt() * nb.sqrt()).max(1e-12);
    dot / denom
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn cosine_similarity_identical_is_one() {
        let v = vec![1.0, 2.0, 3.0];
        let s = cosine_similarity(&v, &v);
        assert!((s - 1.0).abs() < 1e-5, "expected 1.0, got {s}");
    }

    #[test]
    fn cosine_similarity_orthogonal_is_zero() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let s = cosine_similarity(&a, &b);
        assert!(s.abs() < 1e-5, "expected ~0, got {s}");
    }

    #[test]
    fn cosine_similarity_opposite_is_minus_one() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![-1.0, -2.0, -3.0];
        let s = cosine_similarity(&a, &b);
        assert!((s + 1.0).abs() < 1e-5, "expected -1.0, got {s}");
    }

    #[test]
    fn cosine_similarity_mismatched_dims_returns_zero() {
        let a = vec![1.0, 2.0];
        let b = vec![1.0, 2.0, 3.0];
        let s = cosine_similarity(&a, &b);
        assert_eq!(s, 0.0);
    }

    #[test]
    fn cosine_similarity_empty_returns_zero() {
        let a: Vec<f32> = Vec::new();
        let b: Vec<f32> = Vec::new();
        let s = cosine_similarity(&a, &b);
        assert_eq!(s, 0.0);
    }

    #[test]
    fn cosine_similarity_zero_vector_does_not_nan() {
        let a = vec![0.0, 0.0, 0.0];
        let b = vec![1.0, 2.0, 3.0];
        let s = cosine_similarity(&a, &b);
        assert!(s.is_finite(), "cosine sim of zero vector must be finite, got {s}");
        assert_eq!(s, 0.0);
    }

    #[tokio::test]
    async fn engine_not_ready_before_load() {
        let dir = TempDir::new().expect("create tempdir");
        let engine = EmbeddingEngine::new(dir.path().to_path_buf());
        assert!(!engine.is_ready().await);
        assert_eq!(engine.cache_dir(), &dir.path().to_path_buf());
    }

    #[tokio::test]
    async fn embed_batch_empty_input_short_circuits() {
        // Critical: this must NOT trigger model load. We assert the engine is
        // still "not ready" after the call.
        let dir = TempDir::new().expect("create tempdir");
        let engine = EmbeddingEngine::new(dir.path().to_path_buf());
        let result = engine.embed_batch(&[]).await.expect("empty batch ok");
        assert!(result.is_empty());
        assert!(
            !engine.is_ready().await,
            "empty batch must not trigger model download"
        );
    }

    /// Real end-to-end test against the downloaded model.
    /// **Expensive** (~120 MB download on first run, then cached).
    /// Gated behind the `test-embeddings` Cargo feature so routine
    /// `cargo test` does not pull the model. Run with:
    ///
    /// ```bash
    /// cargo test --features test-embeddings -- --test-threads=1
    /// ```
    #[cfg(feature = "test-embeddings")]
    #[tokio::test]
    async fn embed_real_multilingual_e5_small() {
        let dir = TempDir::new().expect("tempdir");
        let engine = EmbeddingEngine::new(dir.path().to_path_buf());

        // Use the recommended E5 prefixes for indexing-style embeddings.
        let v = engine
            .embed("passage: hello world")
            .await
            .expect("embed failed");
        assert_eq!(
            v.len(),
            384,
            "expected 384-dim embedding from multilingual-e5-small, got {}",
            v.len()
        );
        assert!(engine.is_ready().await);

        // Sanity: semantically close texts should out-score a distant one.
        let v_similar = engine
            .embed("passage: hi there")
            .await
            .expect("similar embed failed");
        let v_far = engine
            .embed("passage: the weather is rainy today")
            .await
            .expect("far embed failed");

        let s_close = cosine_similarity(&v, &v_similar);
        let s_far = cosine_similarity(&v, &v_far);

        assert!(
            s_close > s_far,
            "expected similar > different, got close={s_close} vs far={s_far}"
        );
    }
}
