//! Global snippet expansion (Pilier E1): a parallel, system-wide mechanism
//! that expands `;trigger`-style snippets in *any* foreground Windows
//! application, via a `WH_KEYBOARD_LL` low-level keyboard hook — no
//! `uiAccess`, no administrator privileges.
//!
//! This is intentionally separate from the in-app snippet plugin
//! (`src/features/plugins/builtin/snippets`), which only operates on Volt's
//! own search bar and is not touched by this module. The two paths share
//! the same snippet storage (`commands::content::snippets::SnippetState`)
//! and the same `{variable}` resolution logic.
//!
//! Compiled and active only on Windows with the `snippet-global-expansion`
//! Cargo feature enabled (off by default — this is an opt-in, low-level
//! keyboard hook). On every other target, `SnippetExpansionState` degrades
//! to a safe no-op so call sites (`lib.rs`, the Tauri command) never need
//! their own `#[cfg]`.

#[cfg(all(windows, feature = "snippet-global-expansion"))]
mod hook;
#[cfg(all(windows, feature = "snippet-global-expansion"))]
mod injector;
#[cfg(all(windows, feature = "snippet-global-expansion"))]
mod keyboard_layout;
mod state;
// Keep the platform-independent tests on every target, but only compile
// production matching code when its Windows consumer is enabled.
#[cfg(any(test, all(windows, feature = "snippet-global-expansion")))]
pub(crate) mod trigger_buffer;

pub use state::SnippetExpansionState;
