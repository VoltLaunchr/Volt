use crate::plugins::api::PluginCapability;
/// Core traits for the application
use async_trait::async_trait;
use std::any::Any;

/// Trait for plugin implementations
///
/// Plugins extend Volt's functionality by implementing this trait.
/// The plugin system supports both built-in and third-party plugins.
#[async_trait]
pub trait Plugin: Send + Sync {
    /// Downcast to Any for type-specific operations
    fn as_any(&self) -> &dyn Any;
    /// Get plugin unique identifier
    fn id(&self) -> &str;

    /// Get plugin display name
    fn name(&self) -> &str;

    /// Get plugin description
    fn description(&self) -> &str;

    /// Check if plugin is enabled
    fn is_enabled(&self) -> bool {
        true
    }

    /// Get plugin required capabilities
    ///
    /// Plugins should declare which capabilities they need.
    /// This is used for security and transparency.
    fn required_capabilities(&self) -> Vec<PluginCapability> {
        Vec::new()
    }

    /// Initialize plugin (called on app startup)
    async fn initialize(&mut self) -> Result<(), String> {
        Ok(())
    }

    /// Shutdown plugin (called on app exit)
    async fn shutdown(&mut self) -> Result<(), String> {
        Ok(())
    }
}
