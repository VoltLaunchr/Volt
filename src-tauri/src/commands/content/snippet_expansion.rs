//! Tauri command to toggle global snippet expansion (Pilier E1) at runtime.
//!
//! Kept separate from `commands::system::settings` (which owns the
//! `SnippetExpansionSettings` struct and the generic settings
//! read-modify-write helper) so that file does not grow a Win32-flavoured
//! command among its plain settings CRUD.

use crate::commands::content::snippets::SnippetState;
use crate::commands::system::settings::SnippetExpansionSettings;
use crate::core::error::VoltResult;
use crate::expansion::SnippetExpansionState;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

/// Enable or disable the global snippet-expansion hook, persisting the
/// choice to settings so it is restored on next launch.
///
/// No-op (but still persists the setting) on platforms/builds where the
/// underlying hook is unavailable — `SnippetExpansionState::start`/`stop`
/// degrade to no-ops outside Windows + the `snippet-global-expansion`
/// feature, so this command stays a single code path everywhere.
#[tauri::command]
pub async fn set_snippet_expansion_enabled(
    app_handle: AppHandle,
    state: State<'_, SnippetExpansionState>,
    snippet_state: State<'_, SnippetState>,
    enabled: bool,
) -> VoltResult<()> {
    let settings =
        crate::commands::system::settings::update_settings_section(app_handle.clone(), |s| {
            s.snippet_expansion.enabled = enabled
        })
        .await?;

    let SnippetExpansionSettings {
        excluded_apps,
        max_trigger_len,
        ..
    } = settings.snippet_expansion;

    let result = if enabled {
        state.start(
            snippet_state.shared_map(),
            Arc::new(Mutex::new(excluded_apps)),
            max_trigger_len,
        )
    } else {
        state.stop()
    };

    result.map_err(crate::core::error::VoltError::Unknown)
}
