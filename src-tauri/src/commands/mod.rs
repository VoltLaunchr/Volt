//! Tauri IPC commands grouped by product domain.
//!
//! Domain modules are the preferred paths for new backend code. The public
//! re-exports keep legacy paths such as `commands::files` and
//! `commands::ai_profile` working while call sites migrate incrementally.

pub mod ai;
pub mod auth;
pub mod content;
pub mod extensions;
pub mod files;
pub mod launcher;
pub mod shell;
pub mod system;

// Compatibility facade for the pre-domain module layout. Tauri command names
// are based on function names, so these re-exports do not change the IPC API.
pub use ai::*;
pub use auth::*;
pub use content::*;
pub use extensions::*;
pub use files::*;
pub use launcher::*;
pub use shell::*;
pub use system::*;
