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
// Pure and platform-independent: compiled unconditionally (not gated behind
// `windows`) so its unit tests run in CI on every OS, regardless of whether
// the `snippet-global-expansion` feature is enabled.
pub(crate) mod trigger_buffer;

pub use state::SnippetExpansionState;
