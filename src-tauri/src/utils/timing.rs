//! Lightweight IPC command timing instrumentation.
//!
//! Resolves audit item **F2 (timings IPC)**: opt-in latency telemetry for the
//! highest-traffic Tauri commands, logged through `tracing` at the `debug`
//! level.
//!
//! # Zero cost when disabled
//!
//! The whole mechanism is gated behind [`tracing::enabled!`] for the `debug`
//! level. With the default `EnvFilter` (`info`), `debug` is filtered out, so:
//!
//! * [`TimedSpan::new`] returns [`None`] immediately — no [`Instant`] is taken
//!   and no allocation happens, and
//! * the `time_command!` macro expands to a no-op binding.
//!
//! Tracing's level filtering short-circuits before the format args are
//! evaluated, so there is no measurable overhead in the hot path unless timing
//! is explicitly turned on.
//!
//! # Enabling timing logs
//!
//! Set the `RUST_LOG` environment variable so the `volt` target emits at
//! `debug` (or lower) before launching:
//!
//! ```text
//! # Windows (PowerShell)
//! $env:RUST_LOG = "volt=debug"; volt.exe
//!
//! # Unix
//! RUST_LOG=volt=debug volt
//! ```
//!
//! Each instrumented command then logs a line like:
//!
//! ```text
//! DEBUG volt::utils::timing: ipc command finished command="search_files" elapsed_us=842
//! ```

use std::time::Instant;
use tracing::Level;

/// RAII timing guard for a single Tauri command invocation.
///
/// Construct one at the top of a command with [`TimedSpan::new`] (or the
/// [`time_command!`](crate::time_command) macro) and let it drop at the end of
/// the function. On drop it logs the elapsed time at `debug` level. When the
/// `debug` level is disabled the guard is [`None`] and dropping it is a no-op.
pub struct TimedSpan {
    command: &'static str,
    start: Instant,
}

impl TimedSpan {
    /// Create a timing guard, but only if the `debug` level is enabled for this
    /// crate. Returns [`None`] otherwise so callers pay nothing when timing is
    /// off.
    #[inline]
    pub fn new(command: &'static str) -> Option<Self> {
        if tracing::enabled!(Level::DEBUG) {
            Some(Self {
                command,
                start: Instant::now(),
            })
        } else {
            None
        }
    }
}

impl Drop for TimedSpan {
    fn drop(&mut self) {
        let elapsed_us = self.start.elapsed().as_micros();
        tracing::debug!(command = self.command, elapsed_us, "ipc command finished");
    }
}

/// Instrument the enclosing scope with an IPC timing guard.
///
/// Binds a [`TimedSpan`] (held in an `_` binding so it lives until the end of
/// the scope) for the given command name. Expands to effectively nothing when
/// the `debug` level is disabled.
///
/// ```ignore
/// #[tauri::command]
/// pub async fn search_files(/* … */) -> VoltResult<Vec<FileSearchResult>> {
///     time_command!("search_files");
///     // … work …
/// }
/// ```
#[macro_export]
macro_rules! time_command {
    ($name:expr) => {
        let _timed_span = $crate::utils::timing::TimedSpan::new($name);
    };
}
