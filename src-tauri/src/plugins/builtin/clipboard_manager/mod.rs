//! Clipboard Manager Plugin
//!
//! Provides comprehensive clipboard history management with:
//! - Automatic clipboard monitoring
//! - Text, image, and file support
//! - Search and filtering
//! - Pin important items
//! - Smart sensitive data filtering
//! - Configurable retention policies

mod plugin;

pub use plugin::{ClipboardItem, ClipboardManagerPlugin};
