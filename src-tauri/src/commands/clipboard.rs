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
pub async fn check_clipboard(
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.check_clipboard().map_err(VoltError::Plugin)
}

/// Toggle pin status of a clipboard item
///
/// # Arguments
/// * `id` - ID of the clipboard item
#[tauri::command]
pub async fn toggle_clipboard_pin(
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
    id: i64,
) -> VoltResult<()> {
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
pub async fn start_clipboard_monitoring(
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.start_monitoring().map_err(VoltError::Plugin)
}

/// Stop automatic clipboard monitoring
#[tauri::command]
pub async fn stop_clipboard_monitoring(
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.stop_monitoring().map_err(VoltError::Plugin)
}

/// Check if clipboard monitoring is active
#[tauri::command]
pub async fn is_clipboard_monitoring(
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
) -> VoltResult<bool> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    Ok(manager.is_monitoring())
}

/// Update clipboard retention period at runtime
#[tauri::command]
pub async fn set_clipboard_retention_days(
    days: u32,
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.set_retention_days(days);
    Ok(())
}

/// Update the list of apps excluded from clipboard monitoring at runtime.
#[tauri::command]
pub async fn set_clipboard_disabled_apps(
    apps: Vec<String>,
    clipboard_state: State<'_, ClipboardManagerState>,
    plugin_state: State<'_, PluginState>,
) -> VoltResult<()> {
    let manager = get_or_init_clipboard_manager(&clipboard_state, &plugin_state).await?;
    manager.set_disabled_apps(apps);
    Ok(())
}

/// Paste text into the previously-focused window.
///
/// Copies the given text to the clipboard, then after a short delay
/// (to let the Volt window hide and the previous window regain focus)
/// simulates Ctrl+V via the OS input API.
#[tauri::command]
pub async fn paste_text(text: String) -> VoltResult<()> {
    use arboard::Clipboard;

    let mut cb =
        Clipboard::new().map_err(|e| crate::core::error::VoltError::Unknown(e.to_string()))?;
    cb.set_text(&text)
        .map_err(|e| crate::core::error::VoltError::Unknown(e.to_string()))?;
    drop(cb);

    // Spawn a fire-and-forget task: wait for the Volt window to hide, then
    // simulate Ctrl+V to the now-focused window.
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;
        #[cfg(windows)]
        unsafe {
            simulate_ctrl_v_windows();
        }
    });

    Ok(())
}

/// Paste multiple texts in sequence into the previously-focused window.
///
/// After the initial delay (for window focus transfer), each text is written
/// to the clipboard and pasted via Ctrl+V with a 600ms inter-item gap so the
/// target application can process each paste before the next one arrives.
#[tauri::command]
pub async fn paste_sequentially(texts: Vec<String>) -> VoltResult<()> {
    use arboard::Clipboard;

    if texts.is_empty() {
        return Ok(());
    }

    tokio::spawn(async move {
        // Initial delay: let Volt window hide and previous window regain focus.
        tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;

        for text in texts {
            if let Ok(mut cb) = Clipboard::new()
                && cb.set_text(&text).is_ok()
            {
                drop(cb);
                #[cfg(windows)]
                unsafe {
                    simulate_ctrl_v_windows();
                }
                // Gap between pastes so the target app can process each one.
                tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
            }
        }
    });

    Ok(())
}

/// Simulate Ctrl+V via Win32 SendInput (4 key events: Ctrl↓ V↓ V↑ Ctrl↑).
#[cfg(windows)]
unsafe fn simulate_ctrl_v_windows() {
    use std::mem;
    use winapi::um::winuser::{
        INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput, VK_CONTROL,
    };

    const VK_V: u16 = 0x56;

    let make_key = |vk: u16, flags: u32| -> INPUT {
        let mut input: INPUT = unsafe { mem::zeroed() };
        input.type_ = INPUT_KEYBOARD;
        *unsafe { input.u.ki_mut() } = KEYBDINPUT {
            wVk: vk,
            wScan: 0,
            dwFlags: flags,
            time: 0,
            dwExtraInfo: 0,
        };
        input
    };

    let mut inputs = [
        make_key(VK_CONTROL as u16, 0),
        make_key(VK_V, 0),
        make_key(VK_V, KEYEVENTF_KEYUP),
        make_key(VK_CONTROL as u16, KEYEVENTF_KEYUP),
    ];

    unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            mem::size_of::<INPUT>() as i32,
        );
    }
}
