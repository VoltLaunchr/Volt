//! Operating-system integration and application-wide settings.

pub mod autostart;
pub mod clipboard;
pub mod logging;
pub mod monitor;
pub mod settings;
pub mod window_management;

pub use autostart::*;
pub use clipboard::*;
pub use logging::*;
pub use monitor as system_monitor;
pub use monitor::*;
pub use settings::*;
pub use window_management::*;
