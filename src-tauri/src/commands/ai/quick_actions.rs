//! AI Quick Actions
//!
//! Global hotkey-triggered AI actions. The user assigns hotkeys to AI prompts;
//! pressing the hotkey from anywhere reads the clipboard and emits a Tauri
//! event the frontend handles (opens the window, runs AI on the selection).
//!
//! Storage: a dedicated JSON file in the app config dir (`ai_quick_actions.json`)
//! — kept separate from the main settings struct so this feature can evolve
//! independently of `Settings` serde.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQuickAction {
    pub id: String,
    pub label: String,
    pub system_prompt: String,
    /// Optional user-defined hotkey. None = action exists but no hotkey wired.
    #[serde(default)]
    pub hotkey: Option<String>,
    pub enabled: bool,
    /// Provider override for this action (if None, uses default Volt key).
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

/// Process-wide map of action_id → registered hotkey string, so we can unregister
/// individual hotkeys on update without touching others.
#[derive(Default)]
pub struct QuickActionHotkeyState {
    pub registered: Mutex<HashMap<String, String>>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    Ok(dir.join("ai_quick_actions.json"))
}

fn default_actions() -> Vec<AiQuickAction> {
    vec![
        AiQuickAction {
            id: "improve-writing".into(),
            label: "Improve Writing".into(),
            system_prompt: "Improve the writing of the text provided by the user. Keep the same language. Make it clear, concise, and well-structured. Return only the improved text.".into(),
            hotkey: None,
            enabled: true,
            provider: None,
            icon: None,
        },
        AiQuickAction {
            id: "fix-grammar".into(),
            label: "Fix Grammar".into(),
            system_prompt: "Fix all spelling and grammar errors in the text. Return only the corrected text, no explanations.".into(),
            hotkey: None,
            enabled: true,
            provider: None,
            icon: None,
        },
        AiQuickAction {
            id: "translate".into(),
            label: "Translate to English".into(),
            system_prompt: "Translate the following text to English. Return only the translation, no explanations.".into(),
            hotkey: None,
            enabled: true,
            provider: None,
            icon: None,
        },
        AiQuickAction {
            id: "explain-code".into(),
            label: "Explain Code".into(),
            system_prompt: "Explain what the following code does in simple, clear terms. Cover what it does, how it works, and any notable patterns or potential issues.".into(),
            hotkey: None,
            enabled: true,
            provider: None,
            icon: None,
        },
        AiQuickAction {
            id: "summarize".into(),
            label: "Summarize".into(),
            system_prompt: "Summarize the following text in a few concise sentences, capturing the most important points.".into(),
            hotkey: None,
            enabled: true,
            provider: None,
            icon: None,
        },
    ]
}

/// Load actions from disk; if absent, seed with defaults and persist.
#[tauri::command]
pub async fn ai_quick_actions_get(app: AppHandle) -> Result<Vec<AiQuickAction>, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        let defaults = default_actions();
        let json = serde_json::to_string_pretty(&defaults).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| format!("Failed to seed defaults: {}", e))?;
        return Ok(defaults);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))
}

/// Persist actions to disk and re-register all hotkeys.
#[tauri::command]
pub async fn ai_quick_actions_save(
    app: AppHandle,
    state: State<'_, QuickActionHotkeyState>,
    actions: Vec<AiQuickAction>,
) -> Result<(), String> {
    let path = config_path(&app)?;
    let json = serde_json::to_string_pretty(&actions).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Failed to write: {}", e))?;
    register_actions_internal(&app, &state, &actions)?;
    Ok(())
}

/// Read the OS clipboard (used after the user has copied a selection with Ctrl+C).
#[tauri::command]
pub fn ai_quick_actions_read_clipboard() -> Result<String, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard init failed: {}", e))?;
    clipboard
        .get_text()
        .map_err(|e| format!("Clipboard read failed: {}", e))
}

/// Unregister every hotkey we currently have and reset state.
fn unregister_all(app: &AppHandle, state: &State<'_, QuickActionHotkeyState>) {
    let to_remove: Vec<String> = {
        let map = match state.registered.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        map.values().cloned().collect()
    };
    let gs = app.global_shortcut();
    for hk in &to_remove {
        if let Ok(sc) = hk.parse::<Shortcut>()
            && let Err(e) = gs.unregister(sc)
        {
            warn!("Failed to unregister quick-action hotkey '{}': {}", hk, e);
        }
    }
    if let Ok(mut map) = state.registered.lock() {
        map.clear();
    }
}

/// Register one hotkey for an action; on press, emit `volt://ai-quick-action`
/// with the action payload so the frontend can react.
fn register_one(app: &AppHandle, action: &AiQuickAction, hotkey_str: &str) -> Result<(), String> {
    let sc: Shortcut = hotkey_str
        .parse()
        .map_err(|e| format!("Invalid hotkey '{}': {}", hotkey_str, e))?;

    let gs = app.global_shortcut();
    if gs.is_registered(sc) {
        return Err(format!(
            "Hotkey '{}' is already registered (by Volt or another app)",
            hotkey_str
        ));
    }

    let app_handle = app.clone();
    let payload = serde_json::json!({
        "actionId": action.id,
        "label": action.label,
        "systemPrompt": action.system_prompt,
        "provider": action.provider,
    });

    gs.on_shortcut(sc, move |_a, _s, event| {
        if event.state == ShortcutState::Pressed {
            let _ = app_handle.emit("volt://ai-quick-action", payload.clone());
            // Bring the main window forward — the frontend will handle the UI flow.
            if let Some(win) = app_handle.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    })
    .map_err(|e| format!("Failed to register '{}': {}", hotkey_str, e))?;

    Ok(())
}

/// (Re-)register hotkeys for the current set of actions. Returns a per-action
/// status map so the UI can surface which assignments succeeded/failed.
fn register_actions_internal(
    app: &AppHandle,
    state: &State<'_, QuickActionHotkeyState>,
    actions: &[AiQuickAction],
) -> Result<HashMap<String, String>, String> {
    unregister_all(app, state);

    let mut report = HashMap::new();
    for action in actions {
        let Some(hk) = action.hotkey.as_ref() else {
            continue;
        };
        if !action.enabled || hk.trim().is_empty() {
            continue;
        }

        match register_one(app, action, hk) {
            Ok(()) => {
                if let Ok(mut map) = state.registered.lock() {
                    map.insert(action.id.clone(), hk.clone());
                }
                report.insert(action.id.clone(), "ok".to_string());
                info!("Quick action '{}' bound to '{}'", action.id, hk);
            }
            Err(e) => {
                report.insert(action.id.clone(), e.clone());
                warn!("Quick action '{}' failed to bind: {}", action.id, e);
            }
        }
    }
    Ok(report)
}

/// Public command — used at startup and after edits — to refresh all bindings
/// from the persisted file. Returns a status report keyed by action id.
#[tauri::command]
pub async fn ai_quick_actions_apply_all(
    app: AppHandle,
    state: State<'_, QuickActionHotkeyState>,
) -> Result<HashMap<String, String>, String> {
    let actions = ai_quick_actions_get(app.clone()).await?;
    register_actions_internal(&app, &state, &actions)
}
