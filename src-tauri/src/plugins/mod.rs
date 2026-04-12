/// Plugin system for extending Volt's functionality
///
/// This module provides a plugin architecture for Rust-based extensions.
/// While frontend plugins handle UI interactions (calculator, timer, etc.),
/// backend plugins can provide system-level integrations like:
/// - Custom application scanners
/// - Cloud storage integrations
/// - AI-powered suggestions
/// - System monitoring
pub mod api;
pub mod builtin;
pub mod loader;
pub mod registry;
