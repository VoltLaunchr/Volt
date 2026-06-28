use crate::core::error::{VoltError, VoltResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use ts_rs::TS;

/// Mutex to serialize settings read-modify-write operations and prevent race conditions
static SETTINGS_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// General application settings
///
/// NOTE (single-source-of-truth scope): these structs are exported via ts-rs so
/// the IPC wire shape is captured in `src/shared/types/generated/`. The
/// frontend's hand-written `src/features/settings/types/settings.types.ts` is
/// intentionally kept as the UI-facing type because it carries richer literal
/// unions (`Theme`, `WindowPosition`, `ShowOnScreen`, `language`, etc.) and a
/// frontend-only `integrations?` field that has no Rust counterpart. ts-rs can
/// only emit `string` for those `String` fields, so collapsing the UI type onto
/// the generated one would *lose* type safety. The generated bindings therefore
/// serve as a verifiable contract / reference for the wire format, not as the
/// UI type.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "GeneralSettings.ts")]
pub struct GeneralSettings {
    pub start_with_windows: bool,
    pub max_results: u32,
    pub close_on_launch: bool,
    #[serde(default)]
    pub has_seen_onboarding: bool,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub feature_preview: bool,
    #[serde(default = "default_search_sensitivity")]
    pub search_sensitivity: String,
    #[serde(default = "default_show_on_screen")]
    pub show_on_screen: String,
    #[serde(default = "default_true")]
    pub auto_check_for_updates: bool,
    #[serde(default = "default_stable")]
    pub update_channel: String,
}

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "auto".to_string()
}

fn default_search_sensitivity() -> String {
    "medium".to_string()
}

fn default_show_on_screen() -> String {
    "cursor".to_string()
}

fn default_stable() -> String {
    "stable".to_string()
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            start_with_windows: false,
            max_results: 8,
            close_on_launch: true,
            has_seen_onboarding: false,
            language: "auto".to_string(),
            feature_preview: false,
            search_sensitivity: "medium".to_string(),
            show_on_screen: "cursor".to_string(),
            auto_check_for_updates: true,
            update_channel: "stable".to_string(),
        }
    }
}

/// Appearance settings
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "AppearanceSettings.ts")]
pub struct AppearanceSettings {
    pub theme: String,
    #[serde(default = "default_window_effect")]
    pub window_effect: String,
    #[serde(default = "default_transparency")]
    pub transparency: f32,
    pub window_position: String,
    #[ts(optional)]
    pub custom_position: Option<CustomPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "CustomPosition.ts")]
pub struct CustomPosition {
    pub x: i32,
    pub y: i32,
}

fn default_window_effect() -> String {
    "volt-glass".to_string()
}

fn default_transparency() -> f32 {
    0.85
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            window_effect: default_window_effect(),
            transparency: default_transparency(),
            window_position: "center".to_string(),
            custom_position: None,
        }
    }
}

/// Hotkey settings
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "HotkeySettings.ts")]
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
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "IndexingSettings.ts")]
pub struct IndexingSettings {
    pub folders: Vec<String>,
    pub excluded_paths: Vec<String>,
    pub file_extensions: Vec<String>,
    pub index_on_startup: bool,
    #[serde(default)]
    pub deep_search: bool,
    /// Re-walk the index on launch when the persisted snapshot is older than
    /// this many seconds (the no-admin offline catch-up — see D3 in
    /// `REFONTE-PILIER-D-SEARCH.md`). `0` disables the catch-up entirely.
    #[serde(default = "default_stale_threshold_secs")]
    pub stale_threshold_secs: u32,
}

/// Default offline-catch-up staleness threshold: one hour.
pub fn default_stale_threshold_secs() -> u32 {
    3600
}

/// Standard directory names that are always excluded from the file index.
/// Component-based (not absolute) so they match at any depth in the tree.
pub fn default_excluded_paths() -> Vec<String> {
    vec![
        // JS / Python ecosystem noise
        "node_modules".into(),
        ".git".into(),
        ".svn".into(),
        "__pycache__".into(),
        ".venv".into(),
        "venv".into(),
        // Build outputs
        "target".into(), // Rust
        "dist".into(),
        "build".into(),
        ".next".into(), // Next.js
        ".nuxt".into(), // Nuxt
        // Temp & cache (maps to **/tmp/**, **/temp/**)
        "tmp".into(),
        "temp".into(),
        "Temp".into(),
        // Cache dirs (maps to **/{C}ache/**, **/{C}aches/**)
        "Cache".into(),
        "cache".into(),
        "Caches".into(),
        "caches".into(),
        ".cache".into(),
        // Windows system
        "$Recycle.Bin".into(),
        "System Volume Information".into(),
        "AppData".into(),
        "Windows".into(),
        // macOS system
        "Library".into(),
    ]
}

impl Default for IndexingSettings {
    fn default() -> Self {
        Self {
            folders: vec![],
            excluded_paths: default_excluded_paths(),
            file_extensions: vec![
                "pdf".into(),
                "docx".into(),
                "doc".into(),
                "txt".into(),
                "xlsx".into(),
                "xls".into(),
                "pptx".into(),
                "ppt".into(),
                "md".into(),
                "csv".into(),
            ],
            index_on_startup: true,
            deep_search: false,
            stale_threshold_secs: default_stale_threshold_secs(),
        }
    }
}

/// Plugin settings
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "PluginSettings.ts")]
pub struct PluginSettings {
    pub enabled_plugins: Vec<String>,
    pub clipboard_monitoring: bool,
    #[serde(default = "default_clipboard_retention_days")]
    pub clipboard_retention_days: u32,
    #[serde(default)]
    pub clipboard_disabled_apps: Vec<String>,
}

fn default_clipboard_retention_days() -> u32 {
    30
}

impl Default for PluginSettings {
    fn default() -> Self {
        Self {
            // Canonical runtime plugin ids — must match `Plugin.id` and the
            // frontend `MANAGED_PLUGINS` manifest. The frontend also normalises
            // legacy ids on load, so stored installs migrate transparently.
            enabled_plugins: vec![
                "calculator".to_string(),
                "websearch".to_string(),
                "systemcommands".to_string(),
                "timer".to_string(),
                "system_monitor".to_string(),
                "games".to_string(),
                "clipboard".to_string(),
                "emoji-picker".to_string(),
                "notes".to_string(),
                "snippets".to_string(),
                "shellcommand".to_string(),
                "quicklinks".to_string(),
                "window-management".to_string(),
                "developer-tools".to_string(),
            ],
            clipboard_monitoring: true,
            clipboard_retention_days: default_clipboard_retention_days(),
            clipboard_disabled_apps: Vec::new(),
        }
    }
}

/// Application shortcut
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "AppShortcut.ts")]
pub struct AppShortcut {
    pub id: String,
    pub name: String,
    pub category: String,
    #[ts(optional)]
    pub icon: Option<String>,
    pub path: String,
    #[ts(optional)]
    pub alias: Option<String>,
    #[ts(optional)]
    pub hotkey: Option<String>,
    pub enabled: bool,
}

/// Shortcuts settings
#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ShortcutsSettings.ts")]
pub struct ShortcutsSettings {
    pub app_shortcuts: Vec<AppShortcut>,
}

/// Shell command settings
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ShellSettings.ts")]
pub struct ShellSettings {
    /// Whether shell commands (> prefix) are enabled
    #[serde(default = "default_true")]
    pub enabled: bool,
    // `default_shell`/`working_dir`: no `#[ts(optional)]` — serde serialises
    // `None` as `null` and the field is always present, so ts-rs emits
    // `string | null`, matching the hand-written TS (`defaultShell: string | null`).
    /// Shell override (e.g. "powershell", "pwsh", "bash", "zsh"). None = system default.
    #[serde(default)]
    pub default_shell: Option<String>,
    /// Default working directory. None = user home directory.
    #[serde(default)]
    pub working_dir: Option<String>,
    /// Command timeout in milliseconds. `u64`/`usize` over the wire are JSON
    /// numbers; override ts-rs's default `bigint` mapping.
    #[serde(default = "default_shell_timeout")]
    #[ts(type = "number")]
    pub timeout_ms: u64,
    /// Maximum history entries to keep
    #[serde(default = "default_history_size")]
    #[ts(type = "number")]
    pub history_size: usize,
}

fn default_shell_timeout() -> u64 {
    30_000
}
fn default_history_size() -> usize {
    500
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            default_shell: None,
            working_dir: None,
            timeout_ms: default_shell_timeout(),
            history_size: default_history_size(),
        }
    }
}

/// Global snippet expansion settings (Pilier E1).
///
/// Controls the system-wide `WH_KEYBOARD_LL` keyboard hook that expands
/// `;trigger`-style snippets in any foreground application — a parallel
/// mechanism to the in-app snippet plugin, which only operates on Volt's own
/// search bar. Windows-only at runtime; on other platforms (or when the
/// `snippet-global-expansion` Cargo feature is disabled) toggling `enabled`
/// is a no-op.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "SnippetExpansionSettings.ts")]
pub struct SnippetExpansionSettings {
    /// Whether the global low-level keyboard hook is active. Defaults to
    /// `false`: a system-wide keyboard hook is opt-in, never active by
    /// default.
    #[serde(default)]
    pub enabled: bool,
    /// Executable basenames (case-insensitive) in which expansion never
    /// fires, e.g. password managers.
    #[serde(default = "default_snippet_expansion_excluded_apps")]
    pub excluded_apps: Vec<String>,
    /// Maximum trigger length (in characters) the in-memory match buffer
    /// retains. `u64`/`usize` over the wire are JSON numbers; override
    /// ts-rs's default `bigint` mapping.
    #[serde(default = "default_snippet_expansion_max_trigger_len")]
    #[ts(type = "number")]
    pub max_trigger_len: usize,
}

fn default_snippet_expansion_excluded_apps() -> Vec<String> {
    vec![
        "keepass".to_string(),
        "1password".to_string(),
        "bitwarden".to_string(),
        "lastpass".to_string(),
    ]
}

fn default_snippet_expansion_max_trigger_len() -> usize {
    32
}

impl Default for SnippetExpansionSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            excluded_apps: default_snippet_expansion_excluded_apps(),
            max_trigger_len: default_snippet_expansion_max_trigger_len(),
        }
    }
}

/// Kind of action a fallback command performs when invoked.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "FallbackKind.ts")]
pub enum FallbackKind {
    /// Open a URL in the default browser. `target` is a URL template that
    /// can contain `{query}` (URL-encoded) and `{rawQuery}` (unencoded).
    WebSearch,
    /// Run a shell command. `target` is the command template with the same
    /// placeholders as WebSearch.
    Shell,
    /// Open a plain URL (no query substitution); `target` is the full URL.
    Url,
}

/// A single fallback command that takes over when the regular search returns
/// no results. Inspired by Raycast's "Fallback Commands": the typed query is
/// substituted into the `target` template and the action runs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "FallbackCommand.ts")]
pub struct FallbackCommand {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub icon: Option<String>,
    pub kind: FallbackKind,
    /// URL/command template — supports `{query}` (URL-encoded) and
    /// `{rawQuery}` (unencoded) placeholders.
    pub target: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Display order in the fallback list (lower = higher in the result list).
    #[serde(default)]
    pub order: u32,
}

/// Fallback commands settings — the configurable list shown when a search
/// returns no regular results.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "FallbacksSettings.ts")]
pub struct FallbacksSettings {
    #[serde(default = "default_fallback_commands")]
    pub commands: Vec<FallbackCommand>,
}

impl Default for FallbacksSettings {
    fn default() -> Self {
        Self {
            commands: default_fallback_commands(),
        }
    }
}

/// Seed default fallbacks for a fresh install. Mirrors the previously
/// hardcoded set in `useSearchPipeline.ts` (Google, DuckDuckGo, YouTube),
/// extended with a couple of high-value defaults (ChatGPT, Perplexity).
fn default_fallback_commands() -> Vec<FallbackCommand> {
    vec![
        FallbackCommand {
            id: "fallback-google".to_string(),
            label: "Search {rawQuery} on Google".to_string(),
            icon: Some("globe".to_string()),
            kind: FallbackKind::WebSearch,
            target: "https://www.google.com/search?q={query}".to_string(),
            enabled: true,
            order: 0,
        },
        FallbackCommand {
            id: "fallback-duckduckgo".to_string(),
            label: "Search {rawQuery} on DuckDuckGo".to_string(),
            icon: Some("shield".to_string()),
            kind: FallbackKind::WebSearch,
            target: "https://duckduckgo.com/?q={query}".to_string(),
            enabled: true,
            order: 1,
        },
        FallbackCommand {
            id: "fallback-youtube".to_string(),
            label: "Search {rawQuery} on YouTube".to_string(),
            icon: Some("youtube".to_string()),
            kind: FallbackKind::WebSearch,
            target: "https://www.youtube.com/results?search_query={query}".to_string(),
            enabled: true,
            order: 2,
        },
        FallbackCommand {
            id: "fallback-chatgpt".to_string(),
            label: "Ask ChatGPT about {rawQuery}".to_string(),
            icon: Some("message-circle".to_string()),
            kind: FallbackKind::WebSearch,
            target: "https://chat.openai.com/?q={query}".to_string(),
            enabled: false,
            order: 3,
        },
        FallbackCommand {
            id: "fallback-perplexity".to_string(),
            label: "Ask Perplexity about {rawQuery}".to_string(),
            icon: Some("sparkles".to_string()),
            kind: FallbackKind::WebSearch,
            target: "https://www.perplexity.ai/search?q={query}".to_string(),
            enabled: false,
            order: 4,
        },
    ]
}

/// Complete application settings
#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export, export_to = "Settings.ts")]
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
    #[serde(default)]
    pub shell: ShellSettings,
    #[serde(default)]
    pub fallbacks: FallbacksSettings,
    // `Settings` has no struct-level `rename_all`, and every other field
    // here is a single word (camelCase-identical to snake_case), so this is
    // the first field that actually needs an explicit rename to keep the
    // wire format — and the generated `Settings.ts` — camelCase.
    #[serde(default, rename = "snippetExpansion")]
    pub snippet_expansion: SnippetExpansionSettings,
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

    let mut json_value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| VoltError::Serialization(format!("Failed to parse settings: {}", e)))?;

    let mut needs_save = false;

    // Migration: add `windowEffect` while preserving legacy `transparency` values.
    if let Some(appearance) = json_value
        .get_mut("appearance")
        .and_then(|v| v.as_object_mut())
    {
        let should_default_window_effect = !appearance.contains_key("windowEffect")
            || (appearance.get("windowEffect") == Some(&serde_json::Value::String("mica".into()))
                && appearance.contains_key("transparency"));

        if should_default_window_effect {
            appearance.insert(
                "windowEffect".into(),
                serde_json::Value::String("volt-glass".into()),
            );
            needs_save = true;
        }

        if !appearance.contains_key("transparency") {
            appearance.insert(
                "transparency".into(),
                serde_json::json!(default_transparency()),
            );
            needs_save = true;
        }
    }

    let mut settings: Settings = serde_json::from_value(json_value)
        .map_err(|e| VoltError::Serialization(format!("Failed to parse settings: {}", e)))?;

    // Migration: the old Rust default was ["exe", "lnk"] which silently blocked all
    // document/markdown files from being indexed. The correct default is [] (all types).
    // Since the Settings UI never exposed this field, anyone with exactly ["exe", "lnk"]
    // got there from the old default — reset them to [].
    let legacy_ext = &settings.indexing.file_extensions;
    let is_legacy_default = legacy_ext.len() == 2
        && legacy_ext.iter().any(|e| e == "exe")
        && legacy_ext.iter().any(|e| e == "lnk");

    if is_legacy_default {
        settings.indexing.file_extensions.clear();
        needs_save = true;
    }

    // Additive migration: ensure the default noise exclusions are always present.
    // Existing user exclusions are kept; we only add missing ones.
    for p in default_excluded_paths() {
        if !settings.indexing.excluded_paths.contains(&p) {
            settings.indexing.excluded_paths.push(p);
            needs_save = true;
        }
    }

    if needs_save {
        save_settings_to_file(&settings_path, &settings)?;
    }

    Ok(settings)
}

/// Save settings to disk
#[tauri::command]
pub async fn save_settings(app_handle: AppHandle, settings: Settings) -> VoltResult<()> {
    let settings_path = get_settings_path(&app_handle)?;
    save_settings_to_file(&settings_path, &settings)?;
    // Broadcast to all windows so they can update their in-memory settings state
    let _ = app_handle.emit("settings-changed", &settings);
    Ok(())
}

/// Helper function to save settings to a file
///
/// Uses a write-to-temp-then-rename pattern so that a crash during the write
/// never leaves a zero-byte (or partially-written) settings file behind.
fn save_settings_to_file(path: &Path, settings: &Settings) -> VoltResult<()> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| VoltError::Serialization(format!("Failed to serialize settings: {}", e)))?;

    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &content)
        .map_err(|e| VoltError::FileSystem(format!("Failed to write temp settings file: {}", e)))?;

    if let Err(rename_err) = fs::rename(&tmp_path, path) {
        // Rename failed (e.g. cross-device); fall back to direct write and
        // clean up the temp file so we don't leave orphaned files behind.
        let _ = fs::remove_file(&tmp_path);
        fs::write(path, &content).map_err(|e| {
            VoltError::FileSystem(format!(
                "Failed to write settings file (rename failed: {}; fallback error: {})",
                rename_err, e
            ))
        })?;
    }

    Ok(())
}

/// Generic helper to update a settings section
/// Reduces code duplication across update_*_settings functions.
/// Uses a mutex to serialize read-modify-write and prevent concurrent overwrites.
pub(crate) async fn update_settings_section<F>(
    app_handle: AppHandle,
    update_fn: F,
) -> VoltResult<Settings>
where
    F: FnOnce(&mut Settings),
{
    let _guard = SETTINGS_LOCK.lock().await;
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

#[tauri::command]
pub async fn update_shell_settings(
    app_handle: AppHandle,
    shell: ShellSettings,
) -> VoltResult<Settings> {
    update_settings_section(app_handle, |s| s.shell = shell).await
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
    update_settings_section(app_handle, |s| s.appearance.theme = theme)
        .await
        .map(|_| ())
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
    update_settings_section(app_handle, |s| {
        // Find and update existing shortcut or add new one
        if let Some(existing) = s
            .shortcuts
            .app_shortcuts
            .iter_mut()
            .find(|e| e.id == shortcut.id)
        {
            *existing = shortcut;
        } else {
            s.shortcuts.app_shortcuts.push(shortcut);
        }
    })
    .await
    .map(|_| ())
}

/// Delete an app shortcut
#[tauri::command]
pub async fn delete_app_shortcut(app_handle: AppHandle, shortcut_id: String) -> VoltResult<()> {
    update_settings_section(app_handle, |s| {
        s.shortcuts.app_shortcuts.retain(|e| e.id != shortcut_id);
    })
    .await
    .map(|_| ())
}

/// Wrapper for exported settings with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsExport {
    pub version: String,
    pub export_date: String,
    pub volt_version: String,
    pub settings: Settings,
}

/// Validate and sanitize a settings import/export path.
///
/// - Rejects paths containing `..` traversal segments
/// - Canonicalizes the parent directory (must exist)
/// - Blocks writes into system directories
/// - Optionally enforces a required file extension
fn validate_settings_path(path: &str, required_extension: Option<&str>) -> VoltResult<PathBuf> {
    let path_buf = PathBuf::from(path);

    // Block path traversal
    for component in path_buf.components() {
        if let std::path::Component::ParentDir = component {
            return Err(VoltError::PermissionDenied(
                "Path traversal ('..') is not allowed".to_string(),
            ));
        }
    }

    // Enforce file extension when required (e.g. ".json" for export)
    if let Some(ext) = required_extension {
        match path_buf.extension().and_then(|e| e.to_str()) {
            Some(e) if e.eq_ignore_ascii_case(ext) => {}
            _ => {
                return Err(VoltError::PermissionDenied(format!(
                    "File must have a .{} extension",
                    ext
                )));
            }
        }
    }

    // Canonicalize the parent directory so symlinks / junctions are resolved
    let parent = path_buf
        .parent()
        .ok_or_else(|| VoltError::FileSystem("Invalid path: no parent directory".to_string()))?;

    let canonical_parent = parent.canonicalize().map_err(|e| {
        VoltError::FileSystem(format!(
            "Cannot resolve parent directory '{}': {}",
            parent.display(),
            e
        ))
    })?;

    // Block system directories
    let canonical_str = canonical_parent.to_str().unwrap_or_default().to_lowercase();

    #[cfg(target_os = "windows")]
    {
        let blocked = [
            "c:\\windows",
            "c:\\program files",
            "c:\\program files (x86)",
            "c:\\programdata",
        ];
        // Also handle the \\?\ extended-path prefix that canonicalize adds on Windows
        let normalized = canonical_str
            .strip_prefix("\\\\?\\")
            .unwrap_or(&canonical_str);
        for prefix in blocked {
            if normalized.starts_with(prefix) {
                return Err(VoltError::PermissionDenied(format!(
                    "Writing to system directory '{}' is not allowed",
                    parent.display()
                )));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let blocked = ["/etc", "/usr", "/bin", "/sbin", "/var"];
        for prefix in blocked {
            if canonical_str.starts_with(prefix) {
                return Err(VoltError::PermissionDenied(format!(
                    "Writing to system directory '{}' is not allowed",
                    parent.display()
                )));
            }
        }
    }

    // Reconstruct the full path with the canonical parent + original file name
    let file_name = path_buf
        .file_name()
        .ok_or_else(|| VoltError::FileSystem("Invalid path: no file name".to_string()))?;

    Ok(canonical_parent.join(file_name))
}

/// Validate a path for *importing* settings.
///
/// Applies all checks from `validate_settings_path` and additionally restricts
/// the path to the user's home directory, excluding application-data
/// subdirectories (AppData / Library / .config) so that `import_settings`
/// cannot be abused as a file-read primitive for other apps' JSON configs.
fn validate_import_path(path: &str) -> VoltResult<PathBuf> {
    // Base checks: traversal, .json extension, system-dir blocklist, symlink resolution.
    let validated = validate_settings_path(path, Some("json"))?;

    // `validated` is canonical_parent/filename; .parent() is the resolved dir.
    let canonical_parent = validated
        .parent()
        .ok_or_else(|| VoltError::FileSystem("Invalid path: no parent directory".to_string()))?;
    let canonical_str = canonical_parent.to_str().unwrap_or_default().to_lowercase();

    let home_dir = dirs::home_dir()
        .ok_or_else(|| VoltError::FileSystem("Cannot determine home directory".to_string()))?;
    let home_str = home_dir.to_str().unwrap_or_default().to_lowercase();

    // Must reside under the user's home directory.
    if !canonical_str.starts_with(&home_str) {
        return Err(VoltError::PermissionDenied(
            "Settings import is only allowed from within your home directory".to_string(),
        ));
    }

    // Block application-data subdirs to prevent reading other apps' JSON configs.
    #[cfg(target_os = "windows")]
    {
        let appdata = format!("{}\\appdata", home_str);
        if canonical_str.starts_with(&appdata) {
            return Err(VoltError::PermissionDenied(
                "Settings import from AppData directories is not allowed".to_string(),
            ));
        }
    }
    #[cfg(target_os = "macos")]
    {
        let library = format!("{}/library", home_str);
        if canonical_str.starts_with(&library) {
            return Err(VoltError::PermissionDenied(
                "Settings import from Library directories is not allowed".to_string(),
            ));
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let dot_config = format!("{}/.config", home_str);
        let dot_local = format!("{}/.local", home_str);
        if canonical_str.starts_with(&dot_config) || canonical_str.starts_with(&dot_local) {
            return Err(VoltError::PermissionDenied(
                "Settings import from config directories is not allowed".to_string(),
            ));
        }
    }

    Ok(validated)
}

/// Export settings to a JSON file at the given path
///
/// Uses the same `validate_import_path` restriction as import — the path must
/// be under the user's home directory and outside AppData/Library/.config —
/// so that an extension that can invoke this command cannot drop arbitrary
/// JSON files onto the user's Desktop, Documents, or other apps' data
/// directories. Previously the export side only blocked traversal + system
/// dirs, which left the entire filesystem (minus a handful of system roots)
/// open as a file-drop primitive.
#[tauri::command]
pub async fn export_settings(app_handle: AppHandle, path: String) -> VoltResult<String> {
    let validated_path = validate_import_path(&path)?;

    let settings = load_settings(app_handle).await?;

    let export_data = SettingsExport {
        version: "1.0".to_string(),
        export_date: chrono::Utc::now().to_rfc3339(),
        volt_version: env!("CARGO_PKG_VERSION").to_string(),
        settings,
    };

    let content = serde_json::to_string_pretty(&export_data)
        .map_err(|e| VoltError::Serialization(format!("Failed to serialize settings: {}", e)))?;

    fs::write(&validated_path, &content)
        .map_err(|e| VoltError::FileSystem(format!("Failed to write export file: {}", e)))?;

    Ok(validated_path.to_string_lossy().to_string())
}

/// Sanitize a list of indexing folders coming from an import file.
///
/// Drops entries that would let an attacker craft a settings export aimed
/// at an unwitting victim. We reject:
///   * empty / whitespace-only paths
///   * any path containing a `..` component (traversal)
///   * absolute Windows paths under known system roots
///   * absolute Unix paths under /etc, /usr, /bin, /sbin, /var
///
/// Excluded-path entries can be plain directory names (matched component-
/// wise by the indexer), so we do not require absoluteness — we only reject
/// traversal and obvious system roots.
fn sanitize_imported_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| {
            let trimmed = p.trim();
            if trimmed.is_empty() {
                return false;
            }
            let pb = std::path::PathBuf::from(trimmed);
            if pb
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return false;
            }
            let lower = trimmed.to_lowercase();
            #[cfg(target_os = "windows")]
            {
                let blocked = [
                    "c:\\windows",
                    "c:\\program files",
                    "c:\\program files (x86)",
                    "c:\\programdata",
                ];
                if blocked.iter().any(|b| lower.starts_with(b)) {
                    return false;
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let blocked = ["/etc", "/usr", "/bin", "/sbin", "/var", "/proc", "/sys"];
                if blocked.iter().any(|b| lower.starts_with(b)) {
                    return false;
                }
            }
            true
        })
        .collect()
}

/// Import settings from a JSON file at the given path
#[tauri::command]
pub async fn import_settings(app_handle: AppHandle, path: String) -> VoltResult<Settings> {
    // Scope-restricted validator: blocks AppData/Library/.config in addition to the
    // base checks (traversal, .json extension, system dirs, symlink resolution).
    let validated_path = validate_import_path(&path)?;

    // Cap at 1 MiB before parsing to prevent a 2 GB JSON blob from exhausting memory.
    const MAX_IMPORT_BYTES: usize = 1_048_576;
    let bytes = fs::read(&validated_path)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read import file: {}", e)))?;
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(VoltError::InvalidConfig(
            "Invalid settings file".to_string(),
        ));
    }

    // Uniform error for all parse/structure failures — callers cannot distinguish
    // "not JSON" from "missing key" from "wrong shape" (partial-oracle prevention).
    let invalid = || VoltError::InvalidConfig("Invalid settings file".to_string());

    let content = String::from_utf8(bytes).map_err(|_| invalid())?;
    let export_data: serde_json::Value = serde_json::from_str(&content).map_err(|_| invalid())?;
    let settings_value = export_data.get("settings").ok_or_else(invalid)?;
    let mut settings: Settings =
        serde_json::from_value(settings_value.clone()).map_err(|_| invalid())?;

    // Re-validate path-bearing fields. A crafted import could otherwise point
    // the indexer at sensitive system roots or smuggle traversal sequences.
    settings.indexing.folders =
        sanitize_imported_paths(std::mem::take(&mut settings.indexing.folders));
    settings.indexing.excluded_paths =
        sanitize_imported_paths(std::mem::take(&mut settings.indexing.excluded_paths));

    // Save the imported settings
    save_settings(app_handle, settings.clone()).await?;

    Ok(settings)
}

/// Sync shortcuts from installed applications
#[tauri::command]
pub async fn sync_app_shortcuts(app_handle: AppHandle) -> VoltResult<Vec<AppShortcut>> {
    use crate::commands::apps::scan_applications_fresh;

    // Perform the expensive scan *before* acquiring the settings lock so we
    // hold the lock only for the read-modify-write cycle, not for the I/O.
    let apps = scan_applications_fresh().await?;

    let mut new_shortcuts_out = Vec::new();

    update_settings_section(app_handle, |settings| {
        // Keep existing shortcuts data (aliases, hotkeys) but update category from fresh scan
        let existing_shortcuts: std::collections::HashMap<String, AppShortcut> = settings
            .shortcuts
            .app_shortcuts
            .iter()
            .map(|s| (s.id.clone(), s.clone()))
            .collect();

        let mut new_shortcuts = Vec::new();

        for app in &apps {
            let shortcut = if let Some(existing) = existing_shortcuts.get(&app.id) {
                // Keep existing alias/hotkey but update category from fresh scan
                AppShortcut {
                    id: existing.id.clone(),
                    name: app.name.clone(),
                    category: app
                        .category
                        .clone()
                        .unwrap_or_else(|| "Applications".to_string()),
                    icon: app.icon.clone(),
                    path: app.path.clone(),
                    alias: existing.alias.clone(),
                    hotkey: existing.hotkey.clone(),
                    enabled: existing.enabled,
                }
            } else {
                // Create new shortcut
                AppShortcut {
                    id: app.id.clone(),
                    name: app.name.clone(),
                    category: app
                        .category
                        .clone()
                        .unwrap_or_else(|| "Applications".to_string()),
                    icon: app.icon.clone(),
                    path: app.path.clone(),
                    alias: None,
                    hotkey: None,
                    enabled: true,
                }
            };

            new_shortcuts.push(shortcut);
        }

        settings.shortcuts.app_shortcuts = new_shortcuts.clone();
        new_shortcuts_out = new_shortcuts;
    })
    .await?;

    Ok(new_shortcuts_out)
}
