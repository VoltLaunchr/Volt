use crate::core::error::{VoltError, VoltResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// General application settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub start_with_windows: bool,
    pub max_results: u32,
    pub close_on_launch: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            start_with_windows: false,
            max_results: 8,
            close_on_launch: true,
        }
    }
}

/// Appearance settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: String,
    pub transparency: f32,
    pub window_position: String,
    pub custom_position: Option<CustomPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPosition {
    pub x: i32,
    pub y: i32,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            transparency: 0.85,
            window_position: "center".to_string(),
            custom_position: None,
        }
    }
}

/// Hotkey settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeySettings {
    pub toggle_window: String,
    pub open_settings: String,
}

impl Default for HotkeySettings {
    fn default() -> Self {
        Self {
            // Per documentation: /docs/user-guide/shortcuts
            toggle_window: "Ctrl+Space".to_string(),
            open_settings: "Ctrl+,".to_string(),
        }
    }
}

/// Indexing settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingSettings {
    pub folders: Vec<String>,
    pub excluded_paths: Vec<String>,
    pub file_extensions: Vec<String>,
    pub index_on_startup: bool,
}

impl Default for IndexingSettings {
    fn default() -> Self {
        Self {
            folders: vec![],
            excluded_paths: vec![],
            file_extensions: vec!["exe".to_string(), "lnk".to_string()],
            index_on_startup: true,
        }
    }
}

/// Plugin settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettings {
    pub enabled_plugins: Vec<String>,
    pub clipboard_monitoring: bool,
}

impl Default for PluginSettings {
    fn default() -> Self {
        Self {
            enabled_plugins: vec![
                "calculator".to_string(),
                "web-search".to_string(),
                "system-commands".to_string(),
                "timer".to_string(),
                "system-monitor".to_string(),
                "steam-games".to_string(),
                "clipboard-manager".to_string(),
            ],
            clipboard_monitoring: true,
        }
    }
}

/// Application shortcut
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppShortcut {
    pub id: String,
    pub name: String,
    pub category: String,
    pub icon: Option<String>,
    pub path: String,
    pub alias: Option<String>,
    pub hotkey: Option<String>,
    pub enabled: bool,
}

/// Shortcuts settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsSettings {
    pub app_shortcuts: Vec<AppShortcut>,
}

/// Complete application settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub hotkeys: HotkeySettings,
    #[serde(default)]
    pub indexing: IndexingSettings,
    #[serde(default)]
    pub plugins: PluginSettings,
    #[serde(default)]
    pub shortcuts: ShortcutsSettings,
}

/// Get the settings file path
fn get_settings_path(app_handle: &AppHandle) -> VoltResult<PathBuf> {
    let app_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| VoltError::FileSystem(format!("Failed to get app config directory: {}", e)))?;

    // Ensure directory exists
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| {
            VoltError::FileSystem(format!("Failed to create config directory: {}", e))
        })?;
    }

    Ok(app_dir.join("settings.json"))
}

/// Load settings from disk
#[tauri::command]
pub async fn load_settings(app_handle: AppHandle) -> VoltResult<Settings> {
    let settings_path = get_settings_path(&app_handle)?;

    if !settings_path.exists() {
        // Return default settings if file doesn't exist
        let default_settings = Settings::default();
        // Save default settings to disk
        save_settings_to_file(&settings_path, &default_settings)?;
        return Ok(default_settings);
    }

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read settings file: {}", e)))?;

    let settings: Settings = serde_json::from_str(&content)
        .map_err(|e| VoltError::Serialization(format!("Failed to parse settings: {}", e)))?;

    Ok(settings)
}

/// Save settings to disk
#[tauri::command]
pub async fn save_settings(app_handle: AppHandle, settings: Settings) -> VoltResult<()> {
    let settings_path = get_settings_path(&app_handle)?;
    save_settings_to_file(&settings_path, &settings)
}

/// Helper function to save settings to a file
fn save_settings_to_file(path: &PathBuf, settings: &Settings) -> VoltResult<()> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| VoltError::Serialization(format!("Failed to serialize settings: {}", e)))?;

    fs::write(path, content)
        .map_err(|e| VoltError::FileSystem(format!("Failed to write settings file: {}", e)))?;

    Ok(())
}

/// Generic helper to update a settings section
/// Reduces code duplication across update_*_settings functions
async fn update_settings_section<F>(app_handle: AppHandle, update_fn: F) -> VoltResult<Settings>
where
    F: FnOnce(&mut Settings),
{
    let mut settings = load_settings(app_handle.clone()).await?;
    update_fn(&mut settings);
    save_settings(app_handle, settings.clone()).await?;
    Ok(settings)
}

/// Update a specific section of settings
#[tauri::command]
pub async fn update_general_settings(
    app_handle: AppHandle,
    general: GeneralSettings,
) -> VoltResult<Settings> {
    update_settings_section(app_handle, |s| s.general = general).await
}

#[tauri::command]
pub async fn update_appearance_settings(
    app_handle: AppHandle,
    appearance: AppearanceSettings,
) -> VoltResult<Settings> {
    update_settings_section(app_handle, |s| s.appearance = appearance).await
}

#[tauri::command]
pub async fn update_hotkey_settings(
    app_handle: AppHandle,
    hotkeys: HotkeySettings,
) -> VoltResult<Settings> {
    update_settings_section(app_handle, |s| s.hotkeys = hotkeys).await
}

#[tauri::command]
pub async fn update_indexing_settings(
    app_handle: AppHandle,
    indexing: IndexingSettings,
) -> VoltResult<Settings> {
    update_settings_section(app_handle, |s| s.indexing = indexing).await
}

#[tauri::command]
pub async fn update_plugin_settings(
    app_handle: AppHandle,
    plugins: PluginSettings,
) -> VoltResult<Settings> {
    update_settings_section(app_handle, |s| s.plugins = plugins).await
}

/// Get the current theme
#[tauri::command]
pub async fn get_theme(app_handle: AppHandle) -> VoltResult<String> {
    let settings = load_settings(app_handle).await?;
    Ok(settings.appearance.theme)
}

/// Set the theme
#[tauri::command]
pub async fn set_theme(app_handle: AppHandle, theme: String) -> VoltResult<()> {
    let mut settings = load_settings(app_handle.clone()).await?;
    settings.appearance.theme = theme;
    save_settings(app_handle, settings).await
}

/// Update shortcuts settings
#[tauri::command]
pub async fn update_shortcuts_settings(
    app_handle: AppHandle,
    shortcuts: ShortcutsSettings,
) -> VoltResult<Settings> {
    update_settings_section(app_handle, |s| s.shortcuts = shortcuts).await
}

/// Get all app shortcuts
#[tauri::command]
pub async fn get_app_shortcuts(app_handle: AppHandle) -> VoltResult<Vec<AppShortcut>> {
    let settings = load_settings(app_handle).await?;
    Ok(settings.shortcuts.app_shortcuts)
}

/// Add or update an app shortcut
#[tauri::command]
pub async fn save_app_shortcut(app_handle: AppHandle, shortcut: AppShortcut) -> VoltResult<()> {
    let mut settings = load_settings(app_handle.clone()).await?;

    // Find and update existing shortcut or add new one
    if let Some(existing) = settings
        .shortcuts
        .app_shortcuts
        .iter_mut()
        .find(|s| s.id == shortcut.id)
    {
        *existing = shortcut;
    } else {
        settings.shortcuts.app_shortcuts.push(shortcut);
    }

    save_settings(app_handle, settings).await
}

/// Delete an app shortcut
#[tauri::command]
pub async fn delete_app_shortcut(app_handle: AppHandle, shortcut_id: String) -> VoltResult<()> {
    let mut settings = load_settings(app_handle.clone()).await?;
    settings
        .shortcuts
        .app_shortcuts
        .retain(|s| s.id != shortcut_id);
    save_settings(app_handle, settings).await
}

/// Sync shortcuts from installed applications
#[tauri::command]
pub async fn sync_app_shortcuts(app_handle: AppHandle) -> VoltResult<Vec<AppShortcut>> {
    use crate::commands::apps::scan_applications_fresh;

    // Force fresh scan to get updated categories
    let apps = scan_applications_fresh().await?;
    let mut settings = load_settings(app_handle.clone()).await?;

    // Keep existing shortcuts data (aliases, hotkeys) but update category from fresh scan
    let existing_shortcuts: std::collections::HashMap<String, AppShortcut> = settings
        .shortcuts
        .app_shortcuts
        .iter()
        .map(|s| (s.id.clone(), s.clone()))
        .collect();

    let mut new_shortcuts = Vec::new();

    for app in apps {
        let shortcut = if let Some(existing) = existing_shortcuts.get(&app.id) {
            // Keep existing alias/hotkey but update category from fresh scan
            AppShortcut {
                id: existing.id.clone(),
                name: app.name,
                category: app.category.unwrap_or_else(|| "Applications".to_string()),
                icon: app.icon,
                path: app.path,
                alias: existing.alias.clone(),
                hotkey: existing.hotkey.clone(),
                enabled: existing.enabled,
            }
        } else {
            // Create new shortcut
            AppShortcut {
                id: app.id.clone(),
                name: app.name,
                category: app.category.unwrap_or_else(|| "Applications".to_string()),
                icon: app.icon,
                path: app.path,
                alias: None,
                hotkey: None,
                enabled: true,
            }
        };

        new_shortcuts.push(shortcut);
    }

    settings.shortcuts.app_shortcuts = new_shortcuts.clone();
    save_settings(app_handle, settings).await?;

    Ok(new_shortcuts)
}
