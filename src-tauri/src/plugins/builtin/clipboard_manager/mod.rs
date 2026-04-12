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

// ClipboardType is part of the public API (used in ClipboardItem.content_type)
#[allow(unused_imports)]
pub use plugin::{ClipboardItem, ClipboardManagerPlugin, ClipboardType};
