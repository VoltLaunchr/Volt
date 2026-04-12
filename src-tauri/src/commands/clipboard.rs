use crate::PluginState;
use crate::core::error::{VoltError, VoltResult};
use crate::plugins::builtin::clipboard_manager::{ClipboardItem, ClipboardManagerPlugin};
use std::sync::Arc;
use tauri::State;
use tokio::sync::OnceCell;

/// Global clipboard manager instance (initialized exactly once)
static CLIPBOARD_MANAGER: OnceCell<Arc<ClipboardManagerPlugin>> = OnceCell::const_new();

/// Initialize clipboard manager (called once)
async fn get_or_init_clipboard_manager(
    plugin_state: &State<'_, PluginState>,
) -> VoltResult<Arc<ClipboardManagerPlugin>> {
    use crate::core::traits::Plugin;

    // Use get_or_try_init to ensure only one initialization occurs
    CLIPBOARD_MANAGER
        .get_or_try_init(|| async {
            let mut plugin = ClipboardManagerPlugin::new().with_api(plugin_state.api.clone());
            plugin.initialize().await?;
            Ok::<_, String>(Arc::new(plugin))
        })
        .await
        .cloned()
        .map_err(VoltError::Plugin)
}

/// Get clipboard history
///
/// # Arguments
/// * `limit` - Maximum number of items to return (default: 50)
#[tauri::command]
pub async fn get_clipboard_history(
    plugin_state: State<'_, PluginState>,
    limit: Option<usize>,
) -> VoltResult<Vec<ClipboardItem>> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    manager.get_history(limit).map_err(VoltError::Plugin)
}

/// Search clipboard history
///
/// # Arguments
/// * `query` - Search query string
/// * `limit` - Maximum number of results (default: 50)
#[tauri::command]
pub async fn search_clipboard_history(
    plugin_state: State<'_, PluginState>,
    query: String,
    limit: Option<usize>,
) -> VoltResult<Vec<ClipboardItem>> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    manager
        .search_history(&query, limit)
        .map_err(VoltError::Plugin)
}

/// Check clipboard for changes and update history
#[tauri::command]
pub async fn check_clipboard(plugin_state: State<'_, PluginState>) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    manager.check_clipboard().map_err(VoltError::Plugin)
}

/// Toggle pin status of a clipboard item
///
/// # Arguments
/// * `id` - ID of the clipboard item
#[tauri::command]
pub async fn toggle_clipboard_pin(plugin_state: State<'_, PluginState>, id: i64) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    manager.toggle_pin(id).map_err(VoltError::Plugin)
}

/// Delete a clipboard item
///
/// # Arguments
/// * `id` - ID of the clipboard item to delete
#[tauri::command]
pub async fn delete_clipboard_item(
    plugin_state: State<'_, PluginState>,
    id: i64,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    manager.delete_item(id).map_err(VoltError::Plugin)
}

/// Clear clipboard history
///
/// # Arguments
/// * `include_pinned` - Whether to also clear pinned items
#[tauri::command]
pub async fn clear_clipboard_history(
    plugin_state: State<'_, PluginState>,
    include_pinned: bool,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    manager
        .clear_history(include_pinned)
        .map_err(VoltError::Plugin)
}

/// Copy clipboard item back to clipboard
///
/// # Arguments
/// * `content` - Content to copy to clipboard
#[tauri::command]
pub async fn copy_to_clipboard(
    plugin_state: State<'_, PluginState>,
    content: String,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    manager.copy_content(content).map_err(VoltError::Plugin)
}

/// Start automatic clipboard monitoring
#[tauri::command]
pub async fn start_clipboard_monitoring(plugin_state: State<'_, PluginState>) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    manager.start_monitoring().map_err(VoltError::Plugin)
}

/// Stop automatic clipboard monitoring
#[tauri::command]
pub async fn stop_clipboard_monitoring(plugin_state: State<'_, PluginState>) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    manager.stop_monitoring().map_err(VoltError::Plugin)
}

/// Check if clipboard monitoring is active
#[tauri::command]
pub async fn is_clipboard_monitoring(plugin_state: State<'_, PluginState>) -> VoltResult<bool> {
    let manager = get_or_init_clipboard_manager(&plugin_state).await?;
    Ok(manager.is_monitoring())
}
