//! Operating-system integration and application-wide settings.

pub mod autostart;
pub mod clipboard;
pub mod logging;
pub mod monitor;
pub mod notifications;
pub mod settings;
pub mod web_search;
pub mod window_management;

pub use autostart::*;
pub use clipboard::*;
pub use logging::*;
pub use monitor as system_monitor;
pub use monitor::*;
pub use notifications::*;
pub use settings::*;
pub use web_search::*;
pub use window_management::*;
