pub mod commands;
mod core;
pub mod embeddings;
mod expansion;
mod hotkey;
mod indexer;
pub mod launcher;
mod plugins;
pub mod search;
pub mod utils;
mod window;

/// Narrow public surface used by Criterion benches without exposing the
/// complete internal indexer module as application API.
#[cfg(feature = "tantivy-search")]
#[doc(hidden)]
pub mod benchmark_api {
    pub use crate::indexer::fulltext::FulltextIndex;
    pub use crate::indexer::{FileCategory, FileInfo, SearchEngine, SearchOptions};
}

/// Public surface for the no-admin USN change-journal reader (Pilier D, Track 2).
/// Re-exported so the reviewed primitive is reachable as crate API ahead of its
/// lifecycle wiring (the documented D3 follow-up) — mirroring `benchmark_api`,
/// and keeping the internal `indexer` module otherwise crate-private.
#[cfg(feature = "usn-incremental")]
#[doc(hidden)]
pub mod usn_api {
    pub use crate::indexer::usn::{
        PathResolver, RecordChange, UsnCursor, UsnDelta, UsnError, UsnIndexer, UsnJournal,
        UsnRecord, is_indexable, parse_usn_buffer, strip_extended_prefix,
    };
    // The directory-walk baseline enumeration — re-exported so the cold
    // enumeration benchmark (`examples/enum_bench.rs`) can compare the walk
    // against the USN delta feed apples-to-apples.
    pub use crate::indexer::{IndexConfig, scan_files};
}

use commands::clipboard::ClipboardManagerState;
use commands::files::{FileHistoryState, FileIndexState, WatcherState};
use commands::launcher::LaunchHistoryState;
use commands::notes::NoteState;
use commands::shell::ShellExecutionState;
use commands::sync::SyncState;
use commands::system_monitor::SystemMonitorState;
use commands::*;
use hotkey::HotkeyState;
use plugins::api::VoltPluginAPI;
use plugins::registry::PluginRegistry;
use std::collections::VecDeque;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Listener, Manager};
use tracing::{debug, error, info, warn};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{EnvFilter, Registry, fmt, layer::SubscriberExt, util::SubscriberInitExt};
use window::*;

// ---------------------------------------------------------------------------
// Deep-link rate limiter (H9 defense-in-depth)
// ---------------------------------------------------------------------------
//
// Even with state-bound auth callbacks (C1), an attacker can still spam
// `volt://...` URLs at a victim instance — via a malicious webpage,
// another local app, or an `xdg-open` injection. Each spurious URL goes
// through `handle_auth_deep_link` / `handle_oauth_deep_link` and consumes
// CPU + log file space; sufficient volume can also smother legitimate
// callbacks under a wall of "unknown state" warns.
//
// We keep a sliding 60-second window of arrival times. If more than
// `DEEPLINK_BURST_LIMIT` URLs arrive in that window we drop the rest with
// a single warn-level log (the *first* drop fires a warn, subsequent ones
// are silent until the window clears). Legitimate callbacks fire at most
// twice per OAuth round-trip so this does not interfere with normal use.

const DEEPLINK_BURST_LIMIT: usize = 5;
const DEEPLINK_WINDOW: Duration = Duration::from_secs(60);

static DEEPLINK_TIMES: LazyLock<Mutex<VecDeque<Instant>>> =
    LazyLock::new(|| Mutex::new(VecDeque::with_capacity(DEEPLINK_BURST_LIMIT + 1)));

/// Returns `true` if this deep-link should be dropped due to rate limiting.
/// Side effect: records the arrival time and logs once when transitioning
/// from "below" to "above" the burst threshold.
fn deeplink_rate_limited() -> bool {
    let now = Instant::now();
    let mut times = match DEEPLINK_TIMES.lock() {
        Ok(g) => g,
        Err(p) => {
            warn!(
                "DEEPLINK_TIMES mutex poisoned; recovering — prior panic may have corrupted rate limiter"
            );
            p.into_inner()
        }
    };

    // Drop entries older than the window. Times are pushed in order so we
    // can stop scanning at the first within-window entry.
    while let Some(front) = times.front() {
        if now.duration_since(*front) > DEEPLINK_WINDOW {
            times.pop_front();
        } else {
            break;
        }
    }

    if times.len() >= DEEPLINK_BURST_LIMIT {
        // Was the previous arrival also above the limit? If so, suppress
        // the warn to avoid log spam — we only fire on the transition.
        let already_alerting = times.len() > DEEPLINK_BURST_LIMIT;
        times.push_back(now);
        // Cap the queue so a sustained flood doesn't grow unboundedly.
        if times.len() > DEEPLINK_BURST_LIMIT * 4 {
            times.pop_front();
        }
        if !already_alerting {
            warn!(
                "Deep-link burst limit exceeded ({} in {:?}) — dropping further \
                 callbacks until the window clears. Possible spam / probe.",
                times.len(),
                DEEPLINK_WINDOW
            );
        }
        return true;
    }

    times.push_back(now);
    false
}

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
    let mut builder = tauri::Builder::default();

    // Single-instance MUST be registered before any other plugin so that
    // subsequent `volt://` launches forward the URL to the running instance
    // (via the `deep-link` feature) instead of spawning a new process that
    // fails to grab the global hotkey. The callback fires on the existing
    // instance with the new process's argv — we use it to re-focus the window.
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // H9: log every second-instance launch for forensic trail.
            // The deep-link plugin rewrites argv into a "deep-link://new-url"
            // event that the listener below handles, so we don't act on the
            // URLs here — but we DO log them (with query-params redacted) so
            // a security investigation can attribute a tampered session to
            // its original delivery vector. Any local process can deliver
            // these URLs (we can't attest to the source), which is precisely
            // why C1 (state-bound callbacks) and the rate limiter below are
            // the primary defense.
            for arg in argv.iter().skip(1) {
                if arg.starts_with("volt://") {
                    let redacted = arg.split('?').next().unwrap_or(arg);
                    info!("[single-instance] forwarded deep link: {}", redacted);
                } else {
                    debug!("[single-instance] forwarded argv: {}", arg);
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
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

            // Initialize AI quick-action hotkey state
            app.manage(commands::ai_quick_actions::QuickActionHotkeyState::default());

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
                        if let Some(state) = app_handle.try_state::<ShowOnScreenState>()
                            && let Ok(mut val) = state.value.lock()
                        {
                            *val = settings.general.show_on_screen.clone();
                            info!("Applied show_on_screen setting: {}", *val);
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

                        // Apply autostart setting — blocked in debug builds since the dev
                        // binary requires the Vite dev server (localhost:1420) which is not
                        // running at boot. On dev launches we also clean up any stale entry
                        // left by a previous dev session to prevent ERR_CONNECTION_REFUSED.
                        if !cfg!(debug_assertions) {
                            if settings.general.start_with_windows
                                && let Err(e) = enable_autostart(app_handle.clone()).await
                            {
                                warn!("Could not enable autostart: {}", e);
                            }
                        } else if let Err(e) = disable_autostart(app_handle.clone()).await {
                            warn!("Could not clean up dev autostart registration: {}", e);
                        }

                        // Register AI Quick Action hotkeys (best-effort; failures
                        // surface in the Settings UI on next refresh).
                        if let Some(state) = app_handle
                            .try_state::<commands::ai_quick_actions::QuickActionHotkeyState>()
                        {
                            match commands::ai_quick_actions::ai_quick_actions_apply_all(
                                app_handle.clone(),
                                state,
                            )
                            .await
                            {
                                Ok(report) => info!(
                                    "AI quick actions bound: {} entries",
                                    report.len()
                                ),
                                Err(e) => warn!("Could not bind AI quick actions: {}", e),
                            }
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

                        // Auto-reveal the main window on launch once onboarding is done.
                        // The window is created with `visible: false`. We wait for React to
                        // emit `volt://main-ready` (after its first paint of the search bar
                        // has landed on screen), then reveal — guaranteeing the user never
                        // sees an empty dark rectangle.
                        //
                        // Two paths, same pattern:
                        // • Returning user (has_seen_onboarding=true): wait for
                        //   `volt://main-ready` with a 5s fallback.
                        // • First-time user (has_seen_onboarding=false): wait for
                        //   `volt://onboarding-complete` with a 30s fallback, then give
                        //   App.tsx's double-rAF 300 ms to call win.show() first; if it
                        //   already did, this show() is a no-op.
                        let event_name = if settings.general.has_seen_onboarding {
                            "volt://main-ready"
                        } else {
                            "volt://onboarding-complete"
                        };
                        // Dev mode serves the frontend unbundled via Vite (per-module HTTP
                        // transforms + cold esbuild dep pre-bundling on first request), which
                        // routinely exceeds 5s — that's not present in production, where the
                        // bundle is prebuilt and loads from disk almost instantly. Give dev
                        // builds a much longer leash so the fallback only fires on a genuine
                        // frontend hang, not on Vite's cold-start latency.
                        let fallback_secs = if settings.general.has_seen_onboarding {
                            if cfg!(debug_assertions) { 20u64 } else { 5u64 }
                        } else {
                            30
                        };
                        let show_handle = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let (tx, rx) = tokio::sync::oneshot::channel::<()>();
                            let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
                            let listener_handle = show_handle.clone();
                            let event_id = listener_handle.listen(event_name, {
                                let tx = tx.clone();
                                move |_event| {
                                    if let Ok(mut guard) = tx.lock()
                                        && let Some(sender) = guard.take()
                                    {
                                        let _ = sender.send(());
                                    }
                                }
                            });

                            let waited = tokio::time::timeout(
                                std::time::Duration::from_secs(fallback_secs),
                                rx,
                            )
                            .await;

                            listener_handle.unlisten(event_id);

                            // For first-time users, give App.tsx's double-rAF a head start
                            // so the OS doesn't reveal an empty webview.
                            if event_name == "volt://onboarding-complete" {
                                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                            }

                            if let Some(window) = show_handle.get_webview_window("main") {
                                if let Err(e) = window.show() {
                                    warn!("Failed to auto-show main window: {}", e);
                                } else {
                                    let _ = window.set_focus();
                                    match waited {
                                        Ok(Ok(_)) => info!(
                                            "Main window revealed on frontend ready signal ({})",
                                            event_name
                                        ),
                                        // In debug builds this is expected Vite cold-start
                                        // latency, not a sign of a broken frontend — keep it
                                        // at info. In release, the bundle is prebuilt and
                                        // should always signal in time, so a warn is warranted.
                                        _ if cfg!(debug_assertions) => info!(
                                            "Main window revealed via {}s fallback (frontend never signaled via {}) — expected in dev mode",
                                            fallback_secs, event_name
                                        ),
                                        _ => warn!(
                                            "Main window revealed via {}s fallback (frontend never signaled via {})",
                                            fallback_secs, event_name
                                        ),
                                    }
                                }
                            }
                        });
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

            // Initialize global snippet expansion state (Pilier E1). The
            // hook itself is only actually started below, once settings are
            // loaded and `settings.snippet_expansion.enabled` is checked —
            // this just registers the (initially idle) Tauri-managed handle.
            app.manage(expansion::SnippetExpansionState::new());

            // Start the global snippet-expansion hook if the user has opted
            // in. Spawned independently from the earlier settings-apply
            // block (which runs concurrently with `setup()` and races
            // against `SnippetState`/`SnippetExpansionState` being managed
            // below it) so this can safely rely on both already being
            // present via `try_state`.
            let expansion_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match commands::settings::load_settings(expansion_handle.clone()).await {
                    Ok(settings) if settings.snippet_expansion.enabled => {
                        let snippet_state = expansion_handle.try_state::<SnippetState>();
                        let expansion_state =
                            expansion_handle.try_state::<expansion::SnippetExpansionState>();
                        if let (Some(snippet_state), Some(expansion_state)) =
                            (snippet_state, expansion_state)
                        {
                            let excluded_apps = Arc::new(Mutex::new(
                                settings.snippet_expansion.excluded_apps.clone(),
                            ));
                            match expansion_state.start(
                                snippet_state.shared_map(),
                                excluded_apps,
                                settings.snippet_expansion.max_trigger_len,
                            ) {
                                Ok(()) => info!("Global snippet expansion enabled"),
                                Err(e) => warn!("Could not start global snippet expansion: {}", e),
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(e) => warn!(
                        "Could not load settings for global snippet expansion: {}",
                        e
                    ),
                }
            });

            // Initialize shell history state
            app.manage(ShellHistoryState::new(data_dir.clone()));

            // Initialize quicklink state
            app.manage(QuicklinkState::new(data_dir.clone()));

            // Initialize notes state (SQLite + FTS5)
            match NoteState::new(data_dir.clone()) {
                Ok(notes_state) => {
                    app.manage(notes_state);
                }
                Err(e) => {
                    error!("Failed to init notes state: {}", e);
                    return Err(format!("Failed to init notes state: {}", e).into());
                }
            }

            // Initialize sync state
            app.manage(SyncState::default());

            // Initialize embedding engine (lazy: model is NOT loaded here,
            // only when the frontend calls `embeddings_prepare` or an
            // embed-needing command fires for the first time). The ~120 MB
            // ONNX model is downloaded to `embeddings/` on first use.
            let embeddings_dir = data_dir.join("embeddings");
            let embedding_engine = Arc::new(embeddings::EmbeddingEngine::new(embeddings_dir));
            app.manage(embedding_engine);

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

            // Clipboard manager state (lazy-init on first command, participates
            // in Tauri lifecycle instead of living in a process-global static).
            app.manage(ClipboardManagerState::new());

            // Tracks the in-flight paste task so rapid paste invocations don't
            // accumulate orphan SendInput timers. Replaces the previous
            // `tokio::spawn(...)` fire-and-forget pattern in `paste_text`.
            app.manage(commands::clipboard::PasteState::new());

            // Store persistent system monitor instance for accurate CPU readings
            app.manage(ShellExecutionState::new());

            app.manage(SystemMonitorState {
                monitor: std::sync::Arc::new(std::sync::Mutex::new(
                    plugins::builtin::SystemMonitorPlugin::new().with_api(plugin_api),
                )),
            });

            // Prime the CPU baseline in the background so the first user
            // query returns a meaningful value. sysinfo requires two
            // `refresh_cpu_usage()` calls separated by MINIMUM_CPU_UPDATE_INTERVAL.
            // The prime itself does a synchronous `std::thread::sleep` inside
            // sysinfo's dual-sample, so we offload it to a blocking worker
            // (same pattern as the ticker below) to avoid parking a Tokio
            // worker thread for ~200ms at boot.
            let priming_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL).await;
                if let Some(state) = priming_handle.try_state::<SystemMonitorState>() {
                    let monitor_arc = state.monitor.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        match monitor_arc.lock() {
                            Ok(monitor) => {
                                if let Err(e) = monitor.prime_cpu() {
                                    warn!("Failed to prime CPU baseline: {}", e);
                                } else {
                                    info!("System monitor CPU baseline primed");
                                }
                            }
                            Err(e) => {
                                warn!("SystemMonitorState lock poisoned during prime: {}", e)
                            }
                        }
                    })
                    .await;
                }
            });

            // Background ticker: refresh the system monitor's in-memory cache
            // every ~5s so frontend queries are served instantly instead of
            // running a full sysinfo refresh per keystroke. Interval is
            // hard-coded for now since `PluginRegistry::initialize_all` is a
            // stub (config wiring is out of scope for this phase).
            let ticker_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait for the CPU prime task to finish its dual-sample before
                // the first cache refresh, so the ticker's first tick produces
                // meaningful CPU readings without blocking.
                tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL).await;
                loop {
                    if let Some(state) = ticker_handle.try_state::<SystemMonitorState>() {
                        // `refresh_cache` calls `std::thread::sleep` internally
                        // (CPU dual-sample). Offload to a blocking thread so the
                        // Tokio worker thread is not parked during the sleep.
                        let monitor_arc = state.monitor.clone();
                        let _ = tokio::task::spawn_blocking(move || {
                            match monitor_arc.lock() {
                                Ok(monitor) => {
                                    if let Err(e) = monitor.refresh_cache() {
                                        warn!("System monitor cache refresh failed: {}", e);
                                    }
                                }
                                Err(e) => {
                                    warn!("SystemMonitorState lock poisoned in ticker: {}", e)
                                }
                            }
                        })
                        .await;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            });

            // Log plugin count
            if let Ok(count) = app.state::<PluginState>().registry.count() {
                info!("{} backend plugins loaded", count);
            }

            // Register deep link handler for volt:// URLs
            // On Windows/Linux in dev mode, the OS scheme registration normally done
            // by the installer doesn't happen — we must register it at runtime so
            // the browser knows which app to launch for volt:// URLs.
            #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    warn!("Failed to register deep link schemes: {}", e);
                } else {
                    info!("Deep link schemes registered for dev mode");
                }
            }

            let listener_handle = app.handle().clone();
            let emitter_handle = app.handle().clone();
            listener_handle.listen("deep-link://new-url", move |event: tauri::Event| {
                // The event payload is a JSON array of URL strings
                if let Ok(urls) = serde_json::from_str::<Vec<String>>(event.payload()) {
                    for url_str in &urls {
                        // Redact query params to avoid logging sensitive tokens
                        let redacted_url = url_str.split('?').next().unwrap_or(url_str);

                        // H9: cap deep-link processing rate. Legitimate flows
                        // produce ≤2 callbacks per round-trip; anything
                        // beyond DEEPLINK_BURST_LIMIT in DEEPLINK_WINDOW is
                        // either a probe or unrelated noise. We drop after
                        // the cap; the auth/oauth state nonces (C1, OAuth
                        // state map) already prevent any single forged URL
                        // from succeeding, but we don't want a flood to
                        // smother legitimate callbacks under "unknown state"
                        // warnings either.
                        if deeplink_rate_limited() {
                            debug!("Deep link dropped by rate limiter: {}", redacted_url);
                            continue;
                        }

                        info!("Deep link received: {}", redacted_url);
                        if url_str.starts_with("volt://auth/callback") {
                            // `handle_auth_deep_link` is async because it
                            // hits the project JWKS endpoint to verify the
                            // ES256 signature of the access token. The
                            // listener closure is sync, so spawn the work
                            // on Tauri's async runtime and emit the
                            // session-updated event from there.
                            let url_owned = url_str.clone();
                            let emitter = emitter_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                match commands::auth::handle_auth_deep_link(&url_owned).await {
                                    Ok(_session) => {
                                        info!("Auth session saved from deep link");
                                        // Broadcast to every webview that's listening.
                                        if let Err(e) = emitter.emit("auth:session-updated", ()) {
                                            error!(
                                                "Failed to emit auth:session-updated event: {}",
                                                e
                                            );
                                        }
                                        // Defence-in-depth: also dispatch
                                        // explicitly to the named windows we
                                        // know host the auth UI. Tauri's
                                        // global emit *should* reach every
                                        // webview, but in practice we've seen
                                        // the Settings window miss the event
                                        // (likely a listener-timing issue
                                        // when its React tree hadn't yet
                                        // attached the listener). Dispatching
                                        // by label closes that gap.
                                        for label in ["main", "settings"] {
                                            if let Err(e) =
                                                emitter.emit_to(label, "auth:session-updated", ())
                                            {
                                                debug!(
                                                    "auth:session-updated emit_to({}) failed: {}",
                                                    label, e
                                                );
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        error!("Failed to handle auth deep link: {}", e);
                                    }
                                }
                            });
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
                        } else if url_str.starts_with("volt://ext-oauth-callback") {
                            let url_owned = url_str.clone();
                            let emitter = emitter_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                match commands::extensions::handle_ext_oauth_deep_link(
                                    &emitter,
                                    &url_owned,
                                )
                                .await
                                {
                                    Ok(result) => {
                                        info!(
                                            "ext OAuth complete for extension '{}'",
                                            result.extension_id
                                        );
                                    }
                                    Err(e) => {
                                        error!("Failed to handle ext OAuth deep link: {}", e);
                                    }
                                }
                            });
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
            open_path,
            open_file_with_dialog,
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
            refresh_index_if_stale,
            // Settings commands
            load_settings,
            save_settings,
            update_general_settings,
            update_appearance_settings,
            update_hotkey_settings,
            update_indexing_settings,
            update_plugin_settings,
            update_shortcuts_settings,
            update_shell_settings,
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
            get_system_metrics_v2,
            kill_process_by_pid,
            open_task_manager,
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
            set_clipboard_retention_days,
            set_clipboard_disabled_apps,
            paste_text,
            paste_sequentially,
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
            get_extension_tamper_alert,
            acknowledge_extension_tamper_alert,
            // Extension storage API
            ext_storage_get,
            ext_storage_set,
            ext_storage_remove,
            ext_storage_clear,
            // Extension preferences API
            get_extension_preference,
            set_extension_preference,
            get_extension_secret,
            set_extension_secret,
            delete_extension_secret,
            // Extension OAuth API
            ext_oauth_start,
            ext_oauth_get_token,
            ext_oauth_revoke_token,
            // Extension AI API
            ext_ai_ask_stream,
            // Global AI key management
            ai_set_global_key,
            ai_delete_global_key,
            ai_get_providers_status,
            ai_verify_key,
            // Built-in AI Chat
            ai_ask_builtin_stream,
            // Built-in AI Chat — transparent IPC proxy for the Vercel AI SDK (A3)
            commands::ai::proxy::ai_proxy_stream,
            // AI Profile (personalization prefix for AI Chat)
            commands::ai_profile::ai_profile_get,
            commands::ai_profile::ai_profile_set,
            // AI Quick Actions
            commands::ai_quick_actions::ai_quick_actions_get,
            commands::ai_quick_actions::ai_quick_actions_save,
            commands::ai_quick_actions::ai_quick_actions_apply_all,
            commands::ai_quick_actions::ai_quick_actions_read_clipboard,
            // Custom emojis (SDXL Emoji via Replicate)
            commands::custom_emojis::custom_emojis_generate,
            commands::custom_emojis::custom_emojis_list,
            commands::custom_emojis::custom_emojis_delete,
            commands::custom_emojis::custom_emojis_has_token,
            commands::custom_emojis::custom_emojis_copy_image,
            commands::custom_emojis::ai_pro_features_enabled,
            // Local embeddings (lazy-loaded ONNX model for semantic search)
            commands::embeddings::embeddings_is_ready,
            commands::embeddings::embeddings_prepare,
            #[cfg(debug_assertions)]
            commands::embeddings::embeddings_test,
            // Extension System API
            ext_get_applications,
            ext_show_in_folder,
            ext_move_to_trash,
            fetch_extension_downloads,
            increment_extension_download,
            // Dev extensions commands
            scaffold_extension,
            get_dev_extensions,
            link_dev_extension,
            unlink_dev_extension,
            toggle_dev_extension,
            get_dev_extensions_path,
            refresh_dev_extension,
            get_dev_reload_signal,
            // Credentials commands
            save_credential,
            has_credential,
            delete_credential,
            get_credential_info,
            test_credential,
            extension_authenticated_fetch,
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
            // Sync commands (premium)
            sync_push,
            sync_pull,
            get_sync_status,
            // Snippet commands
            get_snippets,
            create_snippet,
            update_snippet,
            delete_snippet,
            expand_snippet,
            import_snippets,
            export_snippets,
            set_snippet_expansion_enabled,
            // Notes commands
            notes::get_notes,
            notes::get_note,
            notes::get_trash,
            notes::create_note,
            notes::update_note,
            notes::delete_note,
            notes::restore_note,
            notes::empty_trash,
            notes::search_notes,
            notes::export_notes,
            notes::import_notes,
            // Shell command execution
            execute_shell_command,
            execute_shell_command_streaming,
            cancel_shell_command,
            // Shell command history
            record_shell_command,
            get_shell_history,
            get_shell_suggestions,
            pin_shell_command,
            clear_shell_history,
            remove_shell_command,
            // Streaming search
            search_streaming,
            // Window management commands
            snap_window,
            open_notes_window,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            error!("Fatal error while running Tauri application: {}", e);
            std::process::exit(1);
        });
}
