use crate::PluginState;
use crate::core::error::{VoltError, VoltResult};
use crate::plugins::builtin::clipboard_manager::{ClipboardItem, ClipboardManagerPlugin};
use std::sync::Arc;
use tauri::State;
use tokio::sync::OnceCell;

/// Tauri-managed clipboard manager state. Lives in the normal Tauri state
/// lifecycle instead of a process-global `static`, so it can be replaced
/// if `PluginState` is ever recreated (app reset, integration tests, etc.).
pub struct ClipboardManagerState {
    inner: OnceCell<Arc<ClipboardManagerPlugin>>,
}

impl ClipboardManagerState {
    pub fn new() -> Self {
        Self {
            inner: OnceCell::const_new(),
        }
    }
}

impl Default for ClipboardManagerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Initialize clipboard manager (called once per app lifecycle)
async fn get_or_init_clipboard_manager(
    clipboard_state: &State<'_, ClipboardManagerState>,
    plugin_state: &State<'_, PluginState>,
) -> VoltResult<Arc<ClipboardManagerPlugin>> {
    use crate::core::traits::Plugin;

    clipboard_state
        .inner
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
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
    limit: Option<usize>,
) -> VoltResult<Vec<ClipboardItem>> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.get_history(limit).map_err(VoltError::Plugin)
}

/// Search clipboard history
///
/// # Arguments
/// * `query` - Search query string
/// * `limit` - Maximum number of results (default: 50)
#[tauri::command]
pub async fn search_clipboard_history(
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
    query: String,
    limit: Option<usize>,
) -> VoltResult<Vec<ClipboardItem>> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager
        .search_history(&query, limit)
        .map_err(VoltError::Plugin)
}

/// Check clipboard for changes and update history
#[tauri::command]
pub async fn check_clipboard(clipboard_state: State<'_, ClipboardManagerState>, plugin_state: State<'_, PluginState>) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.check_clipboard().map_err(VoltError::Plugin)
}

/// Toggle pin status of a clipboard item
///
/// # Arguments
/// * `id` - ID of the clipboard item
#[tauri::command]
pub async fn toggle_clipboard_pin(clipboard_state: State<'_, ClipboardManagerState>, plugin_state: State<'_, PluginState>, id: i64) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.toggle_pin(id).map_err(VoltError::Plugin)
}

/// Delete a clipboard item
///
/// # Arguments
/// * `id` - ID of the clipboard item to delete
#[tauri::command]
pub async fn delete_clipboard_item(
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
    id: i64,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.delete_item(id).map_err(VoltError::Plugin)
}

/// Clear clipboard history
///
/// # Arguments
/// * `include_pinned` - Whether to also clear pinned items
#[tauri::command]
pub async fn clear_clipboard_history(
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
    include_pinned: bool,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager
        .clear_history(include_pinned)
        .map_err(VoltError::Plugin)
}

/// Maximum length (in bytes) accepted by `copy_to_clipboard`.
/// A 1 MB cap comfortably covers real clipboard usage (text documents,
/// source code) while preventing a malicious extension or XSS from OOMing
/// the renderer with a very large buffer.
const MAX_CLIPBOARD_BYTES: usize = 1_000_000;

/// Copy clipboard item back to clipboard
///
/// # Arguments
/// * `content` - Content to copy to clipboard
#[tauri::command]
pub async fn copy_to_clipboard(
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
    content: String,
) -> VoltResult<()> {
    if content.len() > MAX_CLIPBOARD_BYTES {
        return Err(VoltError::InvalidConfig(format!(
            "Clipboard content exceeds maximum size ({} bytes, max {})",
            content.len(),
            MAX_CLIPBOARD_BYTES
        )));
    }
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.copy_content(content).map_err(VoltError::Plugin)
}

/// Start automatic clipboard monitoring
#[tauri::command]
pub async fn start_clipboard_monitoring(clipboard_state: State<'_, ClipboardManagerState>, plugin_state: State<'_, PluginState>) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.start_monitoring().map_err(VoltError::Plugin)
}

/// Stop automatic clipboard monitoring
#[tauri::command]
pub async fn stop_clipboard_monitoring(clipboard_state: State<'_, ClipboardManagerState>, plugin_state: State<'_, PluginState>) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.stop_monitoring().map_err(VoltError::Plugin)
}

/// Check if clipboard monitoring is active
#[tauri::command]
pub async fn is_clipboard_monitoring(clipboard_state: State<'_, ClipboardManagerState>, plugin_state: State<'_, PluginState>) -> VoltResult<bool> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    Ok(manager.is_monitoring())
}
