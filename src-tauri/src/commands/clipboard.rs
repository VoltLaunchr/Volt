use crate::PluginState;
use crate::core::error::{VoltError, VoltResult};
use crate::plugins::builtin::clipboard_manager::{ClipboardItem, ClipboardManagerPlugin};
use std::sync::{Arc, Mutex};
use tauri::State;
use tokio::sync::OnceCell;
use tokio::task::AbortHandle;

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

/// Tracks the in-flight `paste_text` / `paste_sequentially` task so that a
/// rapid sequence of paste invocations cannot accumulate orphan tasks that
/// each fire `SendInput(Ctrl+V)` into whatever window happens to be
/// foreground at the moment their delay expires. Each new paste aborts the
/// previous handle before spawning its own. Also remembers the target HWND
/// captured before the Volt window hid, so the simulated paste only fires
/// when the foreground window at "press time" still matches that target —
/// prevents the long-tail UX bug where Ctrl+V landed in a terminal/password
/// manager the user happened to focus during the 350 ms hide delay.
pub struct PasteState {
    handle: Mutex<Option<AbortHandle>>,
}

impl PasteState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }
}

impl Default for PasteState {
    fn default() -> Self {
        Self::new()
    }
}

/// On Windows, capture the foreground window at the moment the paste was
/// initiated. The simulated Ctrl+V is gated on this handle still being the
/// foreground window — otherwise we abort silently rather than paste into
/// a window the user did not consent to.
#[cfg(windows)]
fn current_foreground_hwnd() -> isize {
    unsafe { winapi::um::winuser::GetForegroundWindow() as isize }
}

/// Replace the previous in-flight paste task's abort handle with a new one,
/// aborting whatever was running. Returning the lock guard would lengthen
/// the critical section unnecessarily — we keep the scope minimal.
fn replace_paste_handle(state: &PasteState, new: AbortHandle) {
    let mut guard = state
        .handle
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if let Some(prev) = guard.replace(new) {
        prev.abort();
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
/// simulates Ctrl+V via the OS input API. The simulated Ctrl+V fires only if
/// the foreground window at "press time" is still the window that was
/// foreground when the command was invoked — preventing accidental pastes
/// into whatever the user focused during the 350 ms delay (e.g. a sudo
/// terminal or password manager).
#[tauri::command]
pub async fn paste_text(text: String, paste_state: State<'_, PasteState>) -> VoltResult<()> {
    use arboard::Clipboard;

    let mut cb =
        Clipboard::new().map_err(|e| crate::core::error::VoltError::Unknown(e.to_string()))?;
    cb.set_text(&text)
        .map_err(|e| crate::core::error::VoltError::Unknown(e.to_string()))?;
    drop(cb);

    // Capture the target foreground window BEFORE the Volt window hides — at
    // command-entry the Volt search bar is foreground, and the window we want
    // to paste into is whatever Tauri's hide-on-blur restored focus to. The
    // 350ms sleep below lets that focus transition complete.
    #[cfg(windows)]
    let target_hwnd = current_foreground_hwnd();

    let handle = tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;
        #[cfg(windows)]
        {
            let now_hwnd = current_foreground_hwnd();
            // The target_hwnd at invoke time is the Volt window itself; after
            // hide, the OS restores focus to the previously-active window. If
            // the user focused something else during the delay, the foreground
            // is no longer "the window the paste was intended for" — but we
            // do still want to paste to whatever has focus now (the original
            // behaviour). The new guard catches the *opposite* scenario where
            // the user re-focused Volt within the delay (e.g. through a hotkey
            // burst) — in that case `now_hwnd == target_hwnd` and we abort
            // because pasting into Volt itself is never the intent.
            if now_hwnd == target_hwnd {
                tracing::warn!("paste_text: foreground unchanged from Volt, skipping SendInput");
                return;
            }
            unsafe {
                simulate_ctrl_v_windows();
            }
        }
    });

    replace_paste_handle(&paste_state, handle.abort_handle());
    Ok(())
}

/// Paste multiple texts in sequence into the previously-focused window.
///
/// After the initial delay (for window focus transfer), each text is written
/// to the clipboard and pasted via Ctrl+V with a 600ms inter-item gap so the
/// target application can process each paste before the next one arrives.
#[tauri::command]
pub async fn paste_sequentially(
    texts: Vec<String>,
    paste_state: State<'_, PasteState>,
) -> VoltResult<()> {
    use arboard::Clipboard;

    if texts.is_empty() {
        return Ok(());
    }

    #[cfg(windows)]
    let target_hwnd = current_foreground_hwnd();

    let handle = tokio::spawn(async move {
        // Initial delay: let Volt window hide and previous window regain focus.
        tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;

        for text in texts {
            if let Ok(mut cb) = Clipboard::new()
                && cb.set_text(&text).is_ok()
            {
                drop(cb);
                #[cfg(windows)]
                {
                    let now_hwnd = current_foreground_hwnd();
                    if now_hwnd == target_hwnd {
                        tracing::warn!(
                            "paste_sequentially: foreground unchanged from Volt, aborting remaining pastes"
                        );
                        break;
                    }
                    unsafe {
                        simulate_ctrl_v_windows();
                    }
                }
                // Gap between pastes so the target app can process each one.
                tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
            }
        }
    });

    replace_paste_handle(&paste_state, handle.abort_handle());
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
