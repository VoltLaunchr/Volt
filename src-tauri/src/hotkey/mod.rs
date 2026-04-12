use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tracing::{error, info, warn};

// Store the currently registered hotkey
pub struct HotkeyState {
    pub current: Mutex<Option<String>>,
}

pub fn setup_global_hotkey(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.clone();

    // Per documentation (/docs/user-guide/shortcuts): Ctrl+Space is the default
    // No fallback - if it fails, user can configure a different hotkey in settings
    let hotkey_str = "ctrl+space";

    // Parse the shortcut string
    let shortcut: Shortcut = match hotkey_str.parse() {
        Ok(s) => s,
        Err(e) => {
            error!("Invalid hotkey format {}: {}", hotkey_str, e);
            warn!("You can configure a different hotkey in Settings > Hotkeys");
            return Ok(()); // Don't fail the app, just skip hotkey registration
        }
    };

    // Check if hotkey is already registered by another application
    if app.global_shortcut().is_registered(shortcut) {
        error!(
            "Hotkey {} is already registered by another application",
            hotkey_str
        );
        warn!("You can configure a different hotkey in Settings > Hotkeys");
        return Ok(()); // Don't fail the app
    }

    // Try to register it with callback
    let handle_clone = app_handle.clone();
    let result = app
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed
                && let Some(window) = handle_clone.get_webview_window("main")
            {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });

    match result {
        Ok(_) => {
            info!("Successfully registered hotkey: {}", hotkey_str);
            info!("Volt is ready! Press {} to toggle the window.", hotkey_str);

            // Store the current hotkey in state
            if let Some(state) = app.try_state::<HotkeyState>()
                && let Ok(mut current) = state.current.lock()
            {
                *current = Some(hotkey_str.to_string());
            }

            Ok(())
        }
        Err(e) => {
            error!("Failed to register hotkey {}: {}", hotkey_str, e);
            warn!("You can configure a different hotkey in Settings > Hotkeys");
            Ok(()) // Don't fail the app, user can configure later
        }
    }
}

/// Change the global hotkey dynamically
#[tauri::command]
pub fn set_global_hotkey(
    app: AppHandle,
    hotkey_state: State<'_, HotkeyState>,
    new_hotkey: String,
) -> Result<(), String> {
    // Parse the new shortcut
    let new_shortcut: Shortcut = new_hotkey
        .parse()
        .map_err(|e| format!("Invalid hotkey format: {}", e))?;

    // Check if the new hotkey is already the current one (registered by Volt)
    // In that case, we don't need to do anything
    if let Ok(current) = hotkey_state.current.lock()
        && let Some(current_hotkey) = current.as_ref()
        && current_hotkey.to_lowercase() == new_hotkey.to_lowercase()
    {
        // Already using this hotkey, nothing to do
        return Ok(());
    }

    // Check if the new hotkey is already registered by another app
    if app.global_shortcut().is_registered(new_shortcut) {
        return Err(format!(
            "Hotkey '{}' is already registered by another application",
            new_hotkey
        ));
    }

    // Try to register the new hotkey FIRST (before touching the old one)
    let app_handle = app.clone();
    let registration_result =
        app.global_shortcut()
            .on_shortcut(new_shortcut, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed
                    && let Some(window) = app_handle.get_webview_window("main")
                {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });

    // Only proceed if new registration succeeded
    match registration_result {
        Ok(_) => {
            // New hotkey registered successfully, now unregister the old one
            if let Ok(mut current) = hotkey_state.current.lock() {
                // Unregister old hotkey if it exists
                if let Some(old_hotkey) = current.as_ref()
                    && let Ok(old_shortcut) = old_hotkey.parse::<Shortcut>()
                {
                    if let Err(e) = app.global_shortcut().unregister(old_shortcut) {
                        // Failed to unregister old hotkey - try to clean up new registration
                        error!("Failed to unregister old hotkey '{}': {}", old_hotkey, e);
                        warn!("Attempting to rollback new hotkey registration...");

                        // Attempt to unregister the newly registered hotkey to restore previous state
                        if let Err(cleanup_err) = app.global_shortcut().unregister(new_shortcut) {
                            error!(
                                "Failed to rollback new hotkey registration: {}",
                                cleanup_err
                            );
                            warn!("Both hotkeys may now be registered!");
                        } else {
                            info!("Successfully rolled back new hotkey registration");
                        }

                        return Err(format!(
                            "Failed to unregister old hotkey '{}': {}. New hotkey registration rolled back.",
                            old_hotkey, e
                        ));
                    } else {
                        info!("Successfully unregistered old hotkey: {}", old_hotkey);
                    }
                }

                // Update state with new hotkey
                *current = Some(new_hotkey.clone());
                info!("Successfully changed hotkey to: {}", new_hotkey);
                Ok(())
            } else {
                // Failed to lock state - try to clean up new registration
                error!("Failed to access hotkey state");
                if let Err(e) = app.global_shortcut().unregister(new_shortcut) {
                    error!("Failed to clean up new hotkey registration: {}", e);
                }
                Err("Failed to access hotkey state".to_string())
            }
        }
        Err(e) => {
            // New registration failed - old hotkey remains unchanged
            Err(format!("Failed to register new hotkey: {}", e))
        }
    }
}

/// Get the currently registered hotkey
#[tauri::command]
pub fn get_current_hotkey(hotkey_state: State<'_, HotkeyState>) -> Result<String, String> {
    if let Ok(current) = hotkey_state.current.lock() {
        current
            .clone()
            .ok_or_else(|| "No hotkey registered".to_string())
    } else {
        Err("Failed to access hotkey state".to_string())
    }
}
