pub mod commands;
mod core;
mod hotkey;
mod indexer;
pub mod launcher;
mod plugins;
pub mod search;
pub mod utils;
mod window;

use commands::files::{FileHistoryState, FileIndexState, WatcherState};
use commands::launcher::LaunchHistoryState;
use commands::system_monitor::SystemMonitorState;
use commands::*;
use hotkey::HotkeyState;
use plugins::api::VoltPluginAPI;
use plugins::registry::PluginRegistry;
use std::sync::Arc;
use tauri::{Emitter, Listener, Manager};
use tracing::{error, info, warn};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{EnvFilter, Registry, fmt, layer::SubscriberExt, util::SubscriberInitExt};
use window::*;

/// State for the plugin system
pub struct PluginState {
    pub registry: PluginRegistry,
    pub api: Arc<VoltPluginAPI>,
}

/// State for the "show on screen" multi-monitor setting.
/// Read by the global hotkey handler to position the window on the correct monitor.
pub struct ShowOnScreenState {
    pub value: std::sync::Mutex<String>,
}

/// Holds the background worker guard for the rotating file log appender.
/// Dropping the guard flushes and closes the log file, so we keep it in
/// Tauri's managed state for the lifetime of the application.
pub struct LogGuard(#[allow(dead_code)] pub WorkerGuard);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(|app| {
            // Initialize structured logging. We resolve the app data dir first
            // so the rolling file appender can write to <app_data_dir>/logs.
            // The WorkerGuard returned by `non_blocking` is stored in app state
            // so it lives for the whole program (drop = flush + close).
            let log_dir = app
                .handle()
                .path()
                .app_data_dir()
                .ok()
                .map(|d| d.join("logs"));

            let env_filter =
                EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

            let stderr_layer = fmt::layer().with_writer(std::io::stderr);

            let log_guard = if let Some(log_dir) = log_dir {
                // Best-effort directory creation; if it fails we still get stderr.
                match std::fs::create_dir_all(&log_dir) {
                    Ok(_) => {
                        let file_appender = tracing_appender::rolling::daily(&log_dir, "volt.log");
                        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
                        let file_layer = fmt::layer().with_ansi(false).with_writer(non_blocking);

                        let _ = Registry::default()
                            .with(env_filter)
                            .with(stderr_layer)
                            .with(file_layer)
                            .try_init();

                        info!("Logging initialized, file output at {:?}", log_dir);
                        Some(guard)
                    }
                    Err(e) => {
                        let _ = Registry::default()
                            .with(env_filter)
                            .with(stderr_layer)
                            .try_init();
                        warn!(
                            "Failed to create log directory {:?}: {}. File logging disabled.",
                            log_dir, e
                        );
                        None
                    }
                }
            } else {
                let _ = Registry::default()
                    .with(env_filter)
                    .with(stderr_layer)
                    .try_init();
                warn!("No app data dir available; file logging disabled.");
                None
            };

            if let Some(guard) = log_guard {
                app.manage(LogGuard(guard));
            }

            // Initialize hotkey state
            app.manage(HotkeyState {
                current: std::sync::Mutex::new(None),
            });

            // Initialize show-on-screen state (default: cursor)
            app.manage(ShowOnScreenState {
                value: std::sync::Mutex::new("cursor".to_string()),
            });

            // Setup global hotkey (will try default options first)
            hotkey::setup_global_hotkey(app.handle())?;

            // Load settings and apply them (hotkey, autostart, window position)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match commands::settings::load_settings(app_handle.clone()).await {
                    Ok(settings) => {
                        // Apply show_on_screen setting
                        if let Some(state) = app_handle.try_state::<ShowOnScreenState>() {
                            if let Ok(mut val) = state.value.lock() {
                                *val = settings.general.show_on_screen.clone();
                                info!("Applied show_on_screen setting: {}", *val);
                            }
                        }

                        // Apply hotkey from settings
                        if let Some(hotkey_state) = app_handle.try_state::<HotkeyState>() {
                            let toggle_hotkey = settings.hotkeys.toggle_window;
                            match hotkey::set_global_hotkey(
                                app_handle.clone(),
                                hotkey_state,
                                toggle_hotkey.clone(),
                            ) {
                                Ok(_) => {
                                    info!("Applied hotkey from settings: {}", toggle_hotkey)
                                }
                                Err(e) => warn!(
                                    "Could not apply hotkey from settings: {}. Using default.",
                                    e
                                ),
                            }
                        }

                        // Apply autostart setting
                        if settings.general.start_with_windows
                            && let Err(e) = enable_autostart(app_handle.clone()).await
                        {
                            warn!("Could not enable autostart: {}", e);
                        }

                        // Apply window position from settings
                        let position = settings.appearance.window_position;
                        let custom_pos = settings.appearance.custom_position;
                        let custom_x = custom_pos.as_ref().map(|p| p.x);
                        let custom_y = custom_pos.as_ref().map(|p| p.y);

                        if let Err(e) =
                            set_window_position(app_handle.clone(), position, custom_x, custom_y)
                                .await
                        {
                            warn!("Could not set window position: {}", e);
                        }
                    }
                    Err(e) => warn!("Could not load settings: {}. Using defaults.", e),
                }
            });

            // Initialize launch history state and plugin system with validated data directory
            // Try to get app_data_dir and ensure it exists
            let data_dir = if let Ok(dir) = app.path().app_data_dir() {
                // Ensure the directory exists
                if !dir.exists() {
                    if let Err(e) = std::fs::create_dir_all(&dir) {
                        warn!("Failed to create app data directory: {}", e);
                        None
                    } else {
                        Some(dir)
                    }
                } else {
                    Some(dir)
                }
            } else {
                None
            };

            // If app_data_dir is not available, try config_dir as fallback
            let data_dir = if let Some(dir) = data_dir {
                dir
            } else if let Ok(dir) = app.path().config_dir() {
                if !dir.exists() {
                    if let Err(e) = std::fs::create_dir_all(&dir) {
                        warn!("Failed to create config directory: {}", e);
                        // Fall through to temp directory
                        std::env::temp_dir().join("volt_data")
                    } else {
                        warn!("Using config directory as fallback for app data");
                        dir
                    }
                } else {
                    warn!("Using config directory as fallback for app data");
                    dir
                }
            } else {
                // Last resort: use temp directory
                std::env::temp_dir().join("volt_data")
            };

            // Ensure the final directory exists
            if !data_dir.exists() {
                if let Err(e) = std::fs::create_dir_all(&data_dir) {
                    error!("Fatal: Could not create data directory: {}", e);
                    return Err(format!("Failed to create data directory: {}", e).into());
                }
                warn!("Using temporary directory as fallback: {:?}", data_dir);
            }

            // Validate that we have a non-empty, usable directory
            if data_dir.as_os_str().is_empty() {
                error!("Fatal: Could not establish a valid data directory");
                return Err("No valid data directory available".into());
            }

            info!("Data directory: {:?}", data_dir);

            // Initialize file index state backed by SQLite.
            let db_path = data_dir.join("file_index.db");
            app.manage(FileIndexState::with_db(db_path));

            // File-system watcher state (handle starts as None; watcher is
            // started after the initial scan by the frontend).
            app.manage(WatcherState {
                handle: std::sync::Mutex::new(None),
            });

            app.manage(LaunchHistoryState::new(data_dir.clone()));

            // Initialize query binding state for query→result learning
            app.manage(commands::launcher::QueryBindingState::new(data_dir.clone()));

            // Initialize file history state
            app.manage(FileHistoryState::new(data_dir.clone()));

            // Initialize snippet state
            app.manage(SnippetState::new(data_dir.clone()));

            // Initialize quicklink state
            app.manage(QuicklinkState::new(data_dir.clone()));

            // Initialize plugin system
            let plugin_api = Arc::new(VoltPluginAPI::new(data_dir));
            let plugin_registry = PluginRegistry::new();

            // Register built-in plugins
            let builtin_plugins = plugins::builtin::get_builtin_plugins(plugin_api.clone());
            for plugin in builtin_plugins {
                if let Err(e) = plugin_registry.register(plugin) {
                    warn!("Failed to register plugin: {}", e);
                }
            }

            // Store plugin state
            app.manage(PluginState {
                registry: plugin_registry,
                api: plugin_api.clone(),
            });

            // Store persistent system monitor instance for accurate CPU readings
            app.manage(SystemMonitorState {
                monitor: std::sync::Mutex::new(
                    plugins::builtin::SystemMonitorPlugin::new().with_api(plugin_api),
                ),
            });

            // Log plugin count
            if let Ok(count) = app.state::<PluginState>().registry.count() {
                info!("{} backend plugins loaded", count);
            }

            // Register deep link handler for volt:// URLs
            let listener_handle = app.handle().clone();
            let emitter_handle = app.handle().clone();
            listener_handle.listen("deep-link://new-url", move |event: tauri::Event| {
                // The event payload is a JSON array of URL strings
                if let Ok(urls) = serde_json::from_str::<Vec<String>>(event.payload()) {
                    for url_str in &urls {
                        // Redact query params to avoid logging sensitive tokens
                        let redacted_url = url_str.split('?').next().unwrap_or(url_str);
                        info!("Deep link received: {}", redacted_url);
                        if url_str.starts_with("volt://auth/callback") {
                            match commands::auth::handle_auth_deep_link(url_str) {
                                Ok(_session) => {
                                    info!("Auth session saved from deep link");
                                    if let Err(e) = emitter_handle.emit("auth:session-updated", ())
                                    {
                                        error!("Failed to emit auth:session-updated event: {}", e);
                                    }
                                }
                                Err(e) => {
                                    error!("Failed to handle auth deep link: {}", e);
                                }
                            }
                        } else if url_str.starts_with("volt://oauth-callback") {
                            match commands::oauth::handle_oauth_deep_link(url_str) {
                                Ok(result) => {
                                    info!("OAuth token saved for service: {}", result.service);
                                    if let Err(e) =
                                        emitter_handle.emit("oauth:callback-received", &result)
                                    {
                                        error!(
                                            "Failed to emit oauth:callback-received event: {}",
                                            e
                                        );
                                    }
                                }
                                Err(e) => {
                                    error!("Failed to handle OAuth deep link: {}", e);
                                }
                            }
                        }
                    }
                } else {
                    warn!(
                        "Failed to parse deep link event payload: {}",
                        event.payload()
                    );
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Window commands
            show_window,
            hide_window,
            toggle_window,
            center_window,
            position_on_target_monitor,
            update_show_on_screen,
            // App commands
            scan_applications,
            search_applications,
            search_applications_frecency,
            launch_application,
            get_app_icon,
            // Launcher commands (with history tracking)
            launch_app,
            get_recent_apps,
            get_frequent_apps,
            get_pinned_apps,
            pin_app,
            unpin_app,
            add_app_tag,
            remove_app_tag,
            get_apps_by_tag,
            get_all_tags,
            get_app_history,
            clear_launch_history,
            remove_from_history,
            get_history_count,
            get_frecency_suggestions,
            record_search_selection,
            // Batch search command
            search_all,
            // File indexing commands
            start_indexing,
            get_index_status,
            search_files,
            search_files_advanced,
            search_files_with_highlighting,
            get_indexed_file_count,
            get_recent_files,
            get_default_index_folders,
            track_file_access,
            clear_file_history,
            get_file_categories,
            get_index_stats,
            // Persistent index commands (SQLite + watcher)
            invalidate_index,
            get_db_index_stats,
            start_file_watcher,
            stop_file_watcher,
            // Settings commands
            load_settings,
            save_settings,
            update_general_settings,
            update_appearance_settings,
            update_hotkey_settings,
            update_indexing_settings,
            update_plugin_settings,
            update_shortcuts_settings,
            get_theme,
            set_theme,
            get_app_shortcuts,
            save_app_shortcut,
            delete_app_shortcut,
            sync_app_shortcuts,
            export_settings,
            import_settings,
            // Hotkey commands
            hotkey::set_global_hotkey,
            hotkey::get_current_hotkey,
            // Autostart commands
            enable_autostart,
            disable_autostart,
            is_autostart_enabled,
            // Window positioning commands
            set_window_position,
            get_window_position,
            // Plugin system commands
            list_plugins,
            get_all_plugins_info,
            get_plugin_count,
            get_enabled_plugin_count,
            is_plugin_registered,
            get_plugin_capabilities,
            list_external_plugins,
            get_plugins_directory,
            validate_external_plugin,
            load_plugin_from_file,
            load_plugins_from_directory,
            get_builtin_plugin_metadata,
            // Steam Scanner plugin commands
            is_steam_installed,
            get_steam_games,
            launch_steam_game,
            rescan_steam_library,
            get_steam_installation_path,
            // System Monitor plugin commands
            get_cpu_usage,
            get_memory_usage,
            get_disk_usage,
            get_system_metrics,
            // Game Scanner plugin commands
            get_all_games,
            search_games,
            get_games_by_platform,
            launch_game,
            get_game_platforms,
            rescan_all_games,
            get_game_count,
            // Clipboard Manager plugin commands
            get_clipboard_history,
            search_clipboard_history,
            check_clipboard,
            toggle_clipboard_pin,
            delete_clipboard_item,
            clear_clipboard_history,
            copy_to_clipboard,
            start_clipboard_monitoring,
            stop_clipboard_monitoring,
            is_clipboard_monitoring,
            // Extension store commands
            fetch_extension_registry,
            get_installed_extensions,
            install_extension,
            uninstall_extension,
            toggle_extension,
            update_extension_permissions,
            check_extension_updates,
            update_extension,
            get_extension_details,
            read_extension_source,
            get_enabled_extensions_sources,
            // Dev extensions commands
            get_dev_extensions,
            link_dev_extension,
            unlink_dev_extension,
            toggle_dev_extension,
            get_dev_extensions_path,
            refresh_dev_extension,
            // Credentials commands
            save_credential,
            load_credential,
            has_credential,
            delete_credential,
            get_credential_info,
            // Auth commands (Supabase)
            auth_login,
            auth_get_session,
            auth_get_profile,
            auth_refresh_token,
            auth_logout,
            // OAuth commands
            get_github_oauth_url,
            get_notion_oauth_url,
            is_oauth_pending,
            clear_oauth_pending,
            // Logging commands
            get_log_file_path,
            // Preview panel commands
            get_file_preview,
            // Quicklink commands
            get_quicklinks,
            save_quicklink,
            delete_quicklink,
            open_quicklink,
            // Snippet commands
            get_snippets,
            create_snippet,
            update_snippet,
            delete_snippet,
            expand_snippet,
            import_snippets,
            export_snippets,
            // Streaming search
            search_streaming,
            // Window management commands
            snap_window,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            error!("Fatal error while running Tauri application: {}", e);
            std::process::exit(1);
        });
}
