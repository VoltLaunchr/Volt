use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, SystemTime};
#[cfg(target_os = "windows")]
use tokio::sync::Semaphore;
use tokio::sync::{Mutex, RwLock};
#[cfg(target_os = "windows")]
use tokio::time::timeout;
use tracing::info;
#[cfg(target_os = "windows")]
use tracing::warn;
use ts_rs::TS;

use crate::commands::launcher::{LaunchHistoryState, execute_launch};
use crate::core::error::{VoltError, VoltResult};
use crate::utils::icon::extract_icon;
use crate::utils::path::find_main_executable;
use tauri::State;

#[cfg(target_os = "windows")]
use crate::utils::path::get_local_drives;

#[cfg(target_os = "windows")]
use lnk::ShellLink;

#[cfg(target_os = "linux")]
use crate::utils::icon::resolve_linux_icon;

#[cfg(target_os = "linux")]
use crate::utils::path::is_executable;

/// Directories that should be skipped during application scanning
#[cfg(target_os = "windows")]
const SKIP_DIRECTORIES: &[&str] = &[
    "WindowsApps",              // Microsoft Store apps - protected by Windows
    "Common Files",             // Shared DLLs, not apps
    "Windows Defender",         // System protection
    "Windows NT",               // System components
    "Windows Kits",             // SDK tools
    "Windows Mail",             // Legacy mail
    "Windows Media Player",     // System media player
    "Windows Photo Viewer",     // Legacy viewer
    "Windows Portable Devices", // System drivers
    "Windows Security",         // System security
    "Windows Sidebar",          // Legacy gadgets
    "WindowsPowerShell",        // System shell
    "Microsoft",                // Typically updates/services
    "Microsoft.NET",            // .NET runtime
    "MSBuild",                  // Build tools
    "Reference Assemblies",     // Dev assemblies
    "dotnet",                   // .NET SDK
    "Package Cache",            // Installer cache
];

/// Check if a directory should be skipped during app scanning
#[cfg(target_os = "windows")]
fn should_skip_directory(dir_name: &str) -> bool {
    SKIP_DIRECTORIES
        .iter()
        .any(|&skip| dir_name.eq_ignore_ascii_case(skip))
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "AppInfo.ts")]
pub struct AppInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    #[ts(optional)]
    pub icon: Option<String>,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub keywords: Option<Vec<String>>,
    // `#[ts(type = "number")]`: serde_json serialises i64 as a JSON number and
    // Tauri's invoke yields a JS `number` (ms timestamps stay within
    // Number.MAX_SAFE_INTEGER); ts-rs would otherwise default i64 to `bigint`.
    #[ts(optional, type = "number")]
    pub last_used: Option<i64>,
    // u32 maps to `number` by default — no override needed.
    pub usage_count: u32,
    // DECISION: `category` is `Option<String>` on the wire, so ts-rs generates
    // `category?: string`. We intentionally do NOT make ts-rs import a
    // hand-written `AppCategory` union here — wiring a non-ts-rs type into a
    // generated file is fragile. The frontend keeps its semantic `AppCategory`
    // enum (src/shared/types/common.types.ts) as the type used at call sites;
    // the generated binding stays a plain `string`, which is the literal wire
    // shape produced by `detect_app_category`.
    #[ts(optional)]
    pub category: Option<String>,
}

fn normalized_app_identity(name: &str) -> String {
    name.trim()
        .trim_end_matches(['.', '_', '-'])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(target_os = "windows")]
fn is_uwp_aumid(path: &str) -> bool {
    path.contains('!') && !path.contains('\\') && !path.contains('/')
}

fn app_source_priority(app: &AppInfo) -> u8 {
    #[cfg(target_os = "windows")]
    {
        if is_uwp_aumid(&app.path) {
            return 30;
        }
    }

    let path = std::path::Path::new(&app.path);
    if path.exists()
        && path
            .extension()
            .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("exe"))
    {
        return 50;
    }

    if path.exists() {
        return 40;
    }

    if app.description.is_some() {
        return 20;
    }

    10
}

fn deduplicate_app_results(apps: &mut Vec<AppInfo>) {
    let mut best_by_name: HashMap<String, usize> = HashMap::new();
    let mut keep = vec![true; apps.len()];

    for idx in 0..apps.len() {
        let path_duplicate = apps[..idx]
            .iter()
            .position(|existing| existing.path == apps[idx].path);
        if path_duplicate.is_some() {
            keep[idx] = false;
            continue;
        }

        let identity = normalized_app_identity(&apps[idx].name);
        if identity.is_empty() {
            continue;
        }

        if let Some(&existing_idx) = best_by_name.get(&identity) {
            let existing_priority = app_source_priority(&apps[existing_idx]);
            let current_priority = app_source_priority(&apps[idx]);
            if current_priority > existing_priority {
                keep[existing_idx] = false;
                best_by_name.insert(identity, idx);
            } else {
                keep[idx] = false;
            }
        } else {
            best_by_name.insert(identity, idx);
        }
    }

    let mut idx = 0;
    apps.retain(|_| {
        let should_keep = keep[idx];
        idx += 1;
        should_keep
    });
}

/// Detect application category based on path and name.
///
/// [SYNC: src/shared/types/common.types.ts::AppCategory] — every string
/// returned here MUST be a value of the TS `AppCategory` enum. The frontend's
/// category icon/name lookups depend on exact match (lowercase / camelCase).
fn detect_app_category(name: &str, path: &str) -> String {
    let name_lower = name.to_lowercase();
    let path_lower = path.to_lowercase();

    // Games detection
    let game_keywords = [
        "game",
        "steam",
        "epic games",
        "riot",
        "blizzard",
        "battle.net",
        "origin",
        "ubisoft",
        "gog",
        "ea app",
        "minecraft",
        "roblox",
        "fortnite",
        "valorant",
        "league of legends",
        "world of warcraft",
        "overwatch",
        "apex",
        "pubg",
        "genshin",
        "hogwarts",
        "cyberpunk",
        "witcher",
        "assassin",
        "call of duty",
        "battlefield",
        "fifa",
        "nba",
        "rocket league",
        "dota",
        "counter-strike",
        "csgo",
        "cs2",
    ];
    let game_paths = [
        "steamapps",
        "epic games",
        "riot games",
        "gog galaxy",
        "origin games",
    ];

    if game_keywords.iter().any(|k| name_lower.contains(k))
        || game_paths.iter().any(|p| path_lower.contains(p))
    {
        return "gaming".to_string();
    }

    // Browsers
    let browser_keywords = [
        "chrome",
        "firefox",
        "edge",
        "opera",
        "brave",
        "vivaldi",
        "safari",
        "tor browser",
        "chromium",
        "waterfox",
        "librewolf",
    ];
    if browser_keywords.iter().any(|k| name_lower.contains(k)) {
        return "browsers".to_string();
    }

    // Development tools
    let dev_keywords = [
        "visual studio",
        "vscode",
        "code",
        "jetbrains",
        "intellij",
        "pycharm",
        "webstorm",
        "rider",
        "clion",
        "goland",
        "phpstorm",
        "datagrip",
        "sublime",
        "atom",
        "notepad++",
        "vim",
        "neovim",
        "emacs",
        "git",
        "github",
        "postman",
        "insomnia",
        "docker",
        "terminal",
        "powershell",
        "cmd",
        "wsl",
        "node",
        "python",
        "rust",
        "go",
        "android studio",
        "xcode",
        "unity",
        "unreal",
        "godot",
    ];
    if dev_keywords.iter().any(|k| name_lower.contains(k)) {
        return "development".to_string();
    }

    // Communication
    let comm_keywords = [
        "discord",
        "slack",
        "teams",
        "zoom",
        "skype",
        "telegram",
        "whatsapp",
        "signal",
        "messenger",
        "viber",
        "webex",
        "meet",
    ];
    if comm_keywords.iter().any(|k| name_lower.contains(k)) {
        return "communication".to_string();
    }

    // Media & Entertainment
    let media_keywords = [
        "spotify",
        "vlc",
        "media player",
        "itunes",
        "music",
        "video",
        "netflix",
        "youtube",
        "twitch",
        "obs",
        "audacity",
        "premiere",
        "after effects",
        "davinci",
        "handbrake",
        "plex",
        "kodi",
        "foobar",
        "winamp",
        "mpv",
        "mpc-hc",
        "potplayer",
    ];
    if media_keywords.iter().any(|k| name_lower.contains(k)) {
        return "media".to_string();
    }

    // Graphics & Design
    let design_keywords = [
        "photoshop",
        "illustrator",
        "figma",
        "sketch",
        "gimp",
        "inkscape",
        "blender",
        "maya",
        "3ds max",
        "cinema 4d",
        "zbrush",
        "substance",
        "lightroom",
        "affinity",
        "canva",
        "paint",
        "krita",
        "coreldraw",
    ];
    if design_keywords.iter().any(|k| name_lower.contains(k)) {
        return "graphics".to_string();
    }

    // Office & Productivity
    let office_keywords = [
        "word",
        "excel",
        "powerpoint",
        "outlook",
        "onenote",
        "access",
        "libreoffice",
        "openoffice",
        "notion",
        "obsidian",
        "evernote",
        "todoist",
        "trello",
        "asana",
        "pdf",
        "acrobat",
        "foxit",
    ];
    if office_keywords.iter().any(|k| name_lower.contains(k)) {
        return "office".to_string();
    }

    // System utilities
    let system_keywords = [
        "control panel",
        "settings",
        "task manager",
        "device manager",
        "disk",
        "defrag",
        "cleanup",
        "backup",
        "restore",
        "recovery",
        "antivirus",
        "firewall",
        "security",
        "defender",
        "malware",
        "ccleaner",
        "7-zip",
        "winrar",
        "zip",
        "uninstall",
        "driver",
        "system",
        "admin",
        "monitor",
        "resource",
        "performance",
    ];
    if system_keywords.iter().any(|k| name_lower.contains(k)) {
        return "system".to_string();
    }

    // File managers
    let file_keywords = [
        "explorer",
        "file manager",
        "total commander",
        "dopus",
        "files",
    ];
    if file_keywords.iter().any(|k| name_lower.contains(k)) {
        return "fileManagement".to_string();
    }

    // Default category — must match TS `AppCategory.Other`.
    "other".to_string()
}

#[derive(Debug, Clone)]
struct ScanCache {
    apps: Arc<Vec<AppInfo>>,
    timestamp: SystemTime,
}

impl ScanCache {
    fn is_expired(&self, max_age: Duration) -> bool {
        SystemTime::now()
            .duration_since(self.timestamp)
            .map(|age| age > max_age)
            .unwrap_or(true)
    }
}

// Global cache with 5-minute expiry
static SCAN_CACHE: LazyLock<Arc<RwLock<Option<ScanCache>>>> =
    LazyLock::new(|| Arc::new(RwLock::new(None)));

// Single-flight lock: serializes concurrent fresh scans so a second caller
// piggybacks on the first's result via the cache instead of running its own
// scan in parallel. Without this, two simultaneous scan_applications calls
// would both miss the cache, both run a full scan, and the doubled icon
// extraction + .lnk parsing can OOM the process.
static SCAN_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Scans system for installed applications (cross-platform)
/// Uses caching to avoid expensive rescans
#[tauri::command]
pub async fn scan_applications() -> VoltResult<Vec<AppInfo>> {
    scan_applications_with_options(false).await
}

/// Extracts icon for a single application by its executable path.
/// Used for lazy icon loading after the initial scan returns apps without icons.
#[tauri::command]
pub fn get_app_icon(path: String) -> Option<String> {
    extract_icon(&path)
}

/// Force a fresh scan without using cache (for sync operations)
pub async fn scan_applications_fresh() -> VoltResult<Vec<AppInfo>> {
    scan_applications_with_options(true).await
}

/// Scans applications with option to force refresh cache
pub(crate) async fn scan_applications_with_options(
    force_refresh: bool,
) -> VoltResult<Vec<AppInfo>> {
    // Fast path: cache hit before acquiring the single-flight lock.
    if !force_refresh {
        let cache = SCAN_CACHE.read().await;
        if let Some(cached) = cache.as_ref()
            && !cached.is_expired(Duration::from_secs(300))
        {
            info!("Using cached application scan ({} apps)", cached.apps.len());
            let arc = Arc::clone(&cached.apps);
            drop(cache);
            return Ok((*arc).clone());
        }
    }

    // Serialize concurrent fresh scans. Whoever wins the lock runs the scan;
    // anyone waiting will fall through to the double-check below and grab the
    // freshly-written cache instead of running a duplicate scan.
    let _scan_guard = SCAN_LOCK.lock().await;

    // Double-check the cache: while we were waiting on the lock, another
    // caller may have already populated it.
    if !force_refresh {
        let cache = SCAN_CACHE.read().await;
        if let Some(cached) = cache.as_ref()
            && !cached.is_expired(Duration::from_secs(300))
        {
            info!(
                "Using cached application scan after wait ({} apps)",
                cached.apps.len()
            );
            let arc = Arc::clone(&cached.apps);
            drop(cache);
            return Ok((*arc).clone());
        }
    }

    // Perform fresh scan
    let apps = {
        #[cfg(target_os = "windows")]
        {
            scan_applications_windows()
                .await
                .map_err(VoltError::FileSystem)?
        }

        #[cfg(target_os = "macos")]
        {
            scan_applications_macos()
                .await
                .map_err(VoltError::FileSystem)?
        }

        #[cfg(target_os = "linux")]
        {
            scan_applications_linux()
                .await
                .map_err(VoltError::FileSystem)?
        }
    };

    // Update cache; wrap in Arc so future cache hits clone only the pointer.
    let arc = Arc::new(apps);
    let result = (*arc).clone();
    let mut cache = SCAN_CACHE.write().await;
    *cache = Some(ScanCache {
        apps: arc,
        timestamp: SystemTime::now(),
    });
    drop(cache);

    Ok(result)
}

// ============================================================================
// WINDOWS Implementation
// ============================================================================

#[cfg(target_os = "windows")]
async fn scan_applications_windows() -> Result<Vec<AppInfo>, String> {
    let username = whoami::username();

    // Get only local fixed drives (skip network, removable, CD-ROM)
    let drives = get_local_drives();
    info!("Scanning {} local drive(s): {:?}", drives.len(), drives);

    // Semaphore to limit concurrent scans (max 3 drives at once)
    let semaphore = Arc::new(Semaphore::new(3));
    let mut scan_tasks = Vec::new();

    // Scan each drive in parallel with timeout
    for drive in drives {
        let sem = semaphore.clone();

        let task = tokio::spawn(async move {
            let _permit = sem.acquire().await.ok()?;

            // Define search paths for this drive
            let search_paths = vec![
                format!(r"{}:\Program Files", drive),
                format!(r"{}:\Program Files (x86)", drive),
                format!(r"{}:\Games", drive),
                format!(r"{}:\Jeux", drive),
                format!(r"{}:\SteamLibrary", drive),
                format!(r"{}:\Epic Games", drive),
                format!(r"{}:\GOG Games", drive),
                format!(r"{}:\Origin Games", drive),
                format!(r"{}:\EA Games", drive),
                format!(r"{}:\Riot Games", drive),
                format!(r"{}:\Ubisoft", drive),
                format!(r"{}:\Battle.net", drive),
                format!(r"{}:\Steam", drive),
            ];

            let mut drive_apps = Vec::new();

            for base_path in search_paths {
                if !std::path::Path::new(&base_path).exists() {
                    continue;
                }

                // Scan with 30-second timeout per path
                let path_for_log = base_path.clone();
                match timeout(
                    Duration::from_secs(30),
                    tokio::task::spawn_blocking(move || scan_directory_recursive(&base_path, 0, 3)),
                )
                .await
                {
                    Ok(Ok(Ok(scanned_apps))) => {
                        info!(
                            "Drive {}: Found {} apps in {}",
                            drive,
                            scanned_apps.len(),
                            path_for_log
                        );
                        drive_apps.extend(scanned_apps);
                    }
                    Ok(Ok(Err(e))) => {
                        warn!("Drive {}: Scan failed for {}: {}", drive, path_for_log, e);
                    }
                    Ok(Err(e)) => {
                        warn!("Drive {}: Task failed for {}: {}", drive, path_for_log, e);
                    }
                    Err(_) => {
                        warn!("Drive {}: Timeout scanning {}", drive, path_for_log);
                    }
                }
            }

            Some(drive_apps)
        });

        scan_tasks.push(task);
    }

    // Collect results from all drives
    let mut apps = Vec::new();
    for task in scan_tasks {
        if let Ok(Some(drive_apps)) = task.await {
            apps.extend(drive_apps);
        }
    }

    // Scan user-specific paths with timeout
    let user_paths = if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let profile_path = std::path::PathBuf::from(user_profile);
        vec![
            profile_path
                .join("AppData")
                .join("Local")
                .join("Programs")
                .to_string_lossy()
                .to_string(),
            profile_path
                .join("AppData")
                .join("Roaming")
                .to_string_lossy()
                .to_string(),
        ]
    } else {
        // Fallback to default C:\ drive if USERPROFILE is not set
        vec![
            format!(r"C:\Users\{}\AppData\Local\Programs", username),
            format!(r"C:\Users\{}\AppData\Roaming", username),
        ]
    };

    for base_path in user_paths {
        match timeout(
            Duration::from_secs(15),
            tokio::task::spawn_blocking({
                let path = base_path.clone();
                move || scan_directory_recursive(&path, 0, 2)
            }),
        )
        .await
        {
            Ok(Ok(Ok(scanned_apps))) => {
                info!(
                    "User path: Found {} apps in {}",
                    scanned_apps.len(),
                    base_path
                );
                apps.extend(scanned_apps);
            }
            _ => warn!("User path: Timeout or error scanning {}", base_path),
        }
    }

    // Scan Start Menu shortcuts with timeout
    let start_menu_paths = if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let profile_path = std::path::PathBuf::from(user_profile);
        let user_start_menu = profile_path
            .join("AppData")
            .join("Roaming")
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .to_string_lossy()
            .to_string();
        // Taskbar pinned shortcuts (like Raycast's Search Scopes)
        let taskbar_pins = profile_path
            .join("AppData")
            .join("Roaming")
            .join("Microsoft")
            .join("Internet Explorer")
            .join("Quick Launch")
            .join("User Pinned")
            .join("TaskBar")
            .to_string_lossy()
            .to_string();
        // User Desktop shortcuts
        let user_desktop = profile_path.join("Desktop").to_string_lossy().to_string();

        vec![
            r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs".to_string(),
            user_start_menu,
            taskbar_pins,
            user_desktop,
            // Public Desktop shortcuts (shared for all users)
            r"C:\Users\Public\Desktop".to_string(),
        ]
    } else {
        let user_start_menu = format!(
            r"C:\Users\{}\AppData\Roaming\Microsoft\Windows\Start Menu\Programs",
            username
        );

        vec![
            r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs".to_string(),
            user_start_menu,
            format!(
                r"C:\Users\{}\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar",
                username
            ),
            format!(r"C:\Users\{}\Desktop", username),
            r"C:\Users\Public\Desktop".to_string(),
        ]
    };

    for base_path in start_menu_paths {
        match timeout(
            Duration::from_secs(10),
            tokio::task::spawn_blocking({
                let path = base_path.clone();
                move || scan_shortcuts(&path)
            }),
        )
        .await
        {
            Ok(Ok(Ok(apps_from_shortcuts))) => {
                info!(
                    "Shortcuts: Found {} apps in {}",
                    apps_from_shortcuts.len(),
                    base_path
                );
                apps.extend(apps_from_shortcuts);
            }
            _ => warn!("Shortcuts: Timeout or error scanning {}", base_path),
        }
    }

    // Scan registry for installed applications (better names)
    match scan_registry_apps() {
        Ok(registry_apps) => {
            info!("Registry: Found {} apps", registry_apps.len());
            apps.extend(registry_apps);
        }
        Err(e) => warn!("Registry scan failed: {}", e),
    }

    // Scan Shell AppsFolder for Store/UWP apps
    match crate::utils::shell_apps::enumerate_apps_folder() {
        Ok(shell_apps) => {
            info!("AppsFolder: Found {} apps", shell_apps.len());
            apps.extend(shell_apps);
        }
        Err(e) => warn!("AppsFolder scan failed: {}", e),
    }

    // Filter junk apps from ALL sources (SDK samples, documentation, dev tools)
    let before_filter = apps.len();
    apps.retain(|app| !crate::utils::shell_apps::is_junk_app(&app.name));
    let filtered = before_filter - apps.len();
    if filtered > 0 {
        info!("Filtered {} junk apps (SDK, docs, tools)", filtered);
    }

    // Remove duplicate launch targets and duplicate app identities.
    deduplicate_app_results(&mut apps);
    apps.sort_by_key(|a| a.name.to_lowercase());

    info!("Application scan complete: {} apps found", apps.len());

    Ok(apps)
}

/// Scan Windows registry Uninstall keys for installed applications
#[cfg(target_os = "windows")]
fn scan_registry_apps() -> Result<Vec<AppInfo>, String> {
    use winreg::RegKey;
    use winreg::enums::*;

    let mut apps = Vec::new();
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let keys = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for key_path in &keys {
        let Ok(uninstall_key) = hklm.open_subkey(key_path) else {
            continue;
        };

        for name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
            let Ok(subkey) = uninstall_key.open_subkey(&name) else {
                continue;
            };

            let display_name: String = match subkey.get_value("DisplayName") {
                Ok(v) => v,
                Err(_) => continue,
            };

            // Skip system components and updates
            let system_component: u32 = subkey.get_value("SystemComponent").unwrap_or(0);
            if system_component == 1 {
                continue;
            }

            // Skip junk entries (uninstallers, updaters, SDK tools, etc.)
            if crate::utils::shell_apps::is_junk_app(&display_name) {
                continue;
            }

            // Need either InstallLocation or DisplayIcon to find the executable
            let install_location: String = subkey.get_value("InstallLocation").unwrap_or_default();
            let display_icon: String = subkey.get_value("DisplayIcon").unwrap_or_default();

            let path = if !install_location.is_empty() {
                // Try to find an executable in the install location
                let install_path = std::path::PathBuf::from(&install_location);
                if let Some(exe) = find_main_executable(&install_path) {
                    exe.to_string_lossy().to_string()
                } else {
                    install_location.clone()
                }
            } else if !display_icon.is_empty() {
                // DisplayIcon often points to the executable
                let icon_path = display_icon
                    .split(',')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if icon_path.to_lowercase().ends_with(".exe")
                    && std::path::Path::new(&icon_path).exists()
                {
                    icon_path
                } else {
                    continue;
                }
            } else {
                continue;
            };

            if path.is_empty() {
                continue;
            }

            let publisher: String = subkey.get_value("Publisher").unwrap_or_default();
            let id = crate::utils::hash_id(&path);

            apps.push(AppInfo {
                id,
                name: display_name,
                path,
                icon: None,
                description: if publisher.is_empty() {
                    None
                } else {
                    Some(publisher)
                },
                keywords: None,
                last_used: None,
                usage_count: 0,
                category: None,
            });
        }
    }

    Ok(apps)
}

// ============================================================================
// macOS Implementation
// ============================================================================

#[cfg(target_os = "macos")]
async fn scan_applications_macos() -> Result<Vec<AppInfo>, String> {
    let mut apps = Vec::new();

    // macOS application directories
    let home = std::env::var("HOME").unwrap_or_default();
    let search_paths = vec![
        "/Applications".to_string(),
        "/System/Applications".to_string(),
        format!("{}/Applications", home),
        "/Applications/Utilities".to_string(),
    ];

    for base_path in search_paths {
        if let Ok(entries) = std::fs::read_dir(&base_path) {
            for entry in entries.flatten() {
                let path = entry.path();

                // macOS apps are .app bundles (directories)
                if path.extension().map(|e| e == "app").unwrap_or(false)
                    && let Some(app_name) = path.file_stem()
                {
                    let name = app_name.to_string_lossy().to_string();
                    let path_str = path.to_string_lossy().to_string();

                    // Try to get app icon from Info.plist
                    let icon = extract_macos_app_icon(&path);

                    let category = detect_app_category(&name, &path_str);
                    apps.push(AppInfo {
                        id: crate::utils::hash_id(&path_str),
                        name,
                        path: path_str,
                        icon,
                        description: None,
                        keywords: None,
                        last_used: None,
                        usage_count: 0,
                        category: Some(category),
                    });
                }
            }
        }
    }

    // Remove duplicates
    deduplicate_app_results(&mut apps);
    apps.sort_by_key(|a| a.name.to_lowercase());

    info!("Application scan complete: {} apps found", apps.len());

    Ok(apps)
}

#[cfg(target_os = "macos")]
fn extract_macos_app_icon(app_path: &std::path::Path) -> Option<String> {
    use plist::Value;

    // Try to find and parse Info.plist
    let info_plist_path = app_path.join("Contents").join("Info.plist");

    if !info_plist_path.exists() {
        return None;
    }

    let plist_data = match std::fs::read(&info_plist_path) {
        Ok(data) => data,
        Err(_) => return None,
    };

    let plist_value: Value = match plist::from_reader(std::io::Cursor::new(plist_data)) {
        Ok(v) => v,
        Err(_) => return None,
    };

    // Extract CFBundleIconFile from plist
    let icon_file_name = plist_value
        .as_dictionary()?
        .get("CFBundleIconFile")
        .and_then(|v| v.as_string())?;

    // Try without extension first (macOS adds .icns automatically)
    let icon_filename_with_ext = if icon_file_name.ends_with(".icns") {
        icon_file_name.to_string()
    } else {
        format!("{}.icns", icon_file_name)
    };

    let icon_path = app_path
        .join("Contents")
        .join("Resources")
        .join(&icon_filename_with_ext);

    if !icon_path.exists() {
        return None;
    }

    // Read and convert .icns to PNG
    match convert_icns_to_base64_png(&icon_path) {
        Ok(base64_data) => Some(format!("data:image/png;base64,{}", base64_data)),
        Err(_) => None,
    }
}

#[cfg(target_os = "macos")]
fn convert_icns_to_base64_png(icns_path: &std::path::Path) -> Result<String, String> {
    use icns::{IconFamily, IconType, PixelFormat};
    use std::io::Cursor;

    let icns_data = std::fs::read(icns_path).map_err(|e| e.to_string())?;

    let icon_family = IconFamily::read(Cursor::new(icns_data)).map_err(|e| e.to_string())?;

    // Extract the best available icon (512x512 preferred, then 256x256, then 128x128)
    let image_data = icon_family
        .get_icon_with_type(IconType::RGBA32_512x512)
        .or_else(|_| icon_family.get_icon_with_type(IconType::RGBA32_256x256))
        .or_else(|_| icon_family.get_icon_with_type(IconType::RGBA32_128x128))
        .map_err(|_| "Could not extract icon from icns file".to_string())?;

    let width = image_data.width();
    let height = image_data.height();
    let rgba_image = image_data.convert_to(PixelFormat::RGBA);
    let rgba_data = rgba_image.data();

    // Convert to PNG
    let mut png_buffer = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_buffer, width, height);
        encoder.set_color(png::ColorType::Rgba);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("PNG encoding error: {}", e))?;
        writer
            .write_image_data(rgba_data)
            .map_err(|e| format!("PNG write error: {}", e))?;
    }

    // Convert to base64
    use base64::{Engine as _, engine::general_purpose};
    Ok(general_purpose::STANDARD.encode(&png_buffer))
}

// ============================================================================
// Linux Implementation
// ============================================================================

#[cfg(target_os = "linux")]
async fn scan_applications_linux() -> Result<Vec<AppInfo>, String> {
    let mut apps = Vec::new();

    // Linux .desktop file locations (XDG standard)
    let home = std::env::var("HOME").unwrap_or_default();
    let search_paths = vec![
        "/usr/share/applications".to_string(),
        "/usr/local/share/applications".to_string(),
        format!("{}/.local/share/applications", home),
        "/var/lib/flatpak/exports/share/applications".to_string(),
        format!("{}/.local/share/flatpak/exports/share/applications", home),
        "/snap/bin".to_string(), // Snap apps
    ];

    for base_path in search_paths {
        if let Ok(entries) = std::fs::read_dir(&base_path) {
            for entry in entries.flatten() {
                let path = entry.path();

                // Parse .desktop files
                if path.extension().map(|e| e == "desktop").unwrap_or(false)
                    && let Some(app_info) = parse_desktop_file(&path)
                {
                    apps.push(app_info);
                }
            }
        }
    }

    // Also scan for executables in common bin directories
    let local_bin = format!("{}/.local/bin", home);
    let bin_paths = vec!["/usr/bin", "/usr/local/bin", &local_bin];

    // Seed a HashSet with the paths we already collected from .desktop files so
    // the dedup check stays O(1) instead of the previous `apps.iter().any(...)`
    // pattern. On a typical Ubuntu the bin loop visits 2000+ entries and `apps`
    // already holds 200+ from the .desktop scan — the old quadratic check was
    // 200 * 2000 = 400 000 string comparisons before we even reached the unrelated
    // `sort + dedup_by` pass below.
    let mut seen_paths: std::collections::HashSet<String> =
        apps.iter().map(|a| a.path.clone()).collect();

    for bin_path in bin_paths {
        if let Ok(entries) = std::fs::read_dir(bin_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(metadata) = entry.metadata()
                    && metadata.is_file()
                    && is_executable(&path)
                    && let Some(name) = path.file_name()
                {
                    let name_str = name.to_string_lossy().into_owned();
                    let path_str = path.to_string_lossy().into_owned();

                    // `HashSet::insert` returns false if the value was already
                    // present — single-lookup dedup.
                    if seen_paths.insert(path_str.clone()) {
                        let category = detect_app_category(&name_str, &path_str);
                        apps.push(AppInfo {
                            id: crate::utils::hash_id(&path_str),
                            name: name_str,
                            path: path_str,
                            icon: None,
                            description: None,
                            keywords: None,
                            last_used: None,
                            usage_count: 0,
                            category: Some(category),
                        });
                    }
                }
            }
        }
    }

    // Defense-in-depth: the HashSet above guarantees no duplicates from the
    // bin scan, but the .desktop pass may have produced its own duplicates.
    deduplicate_app_results(&mut apps);
    apps.sort_by_key(|a| a.name.to_lowercase());

    info!("Application scan complete: {} apps found", apps.len());

    Ok(apps)
}

/// Parse a .desktop file and extract application info
#[cfg(target_os = "linux")]
fn parse_desktop_file(path: &std::path::Path) -> Option<AppInfo> {
    let content = std::fs::read_to_string(path).ok()?;

    let mut name = None;
    let mut exec = None;
    let mut icon = None;
    let mut description = None;
    let mut keywords = None;
    let mut no_display = false;
    let mut hidden = false;

    let mut in_desktop_entry = false;

    for line in content.lines() {
        let line = line.trim();

        if line == "[Desktop Entry]" {
            in_desktop_entry = true;
            continue;
        }

        if line.starts_with('[') && line != "[Desktop Entry]" {
            in_desktop_entry = false;
            continue;
        }

        if !in_desktop_entry {
            continue;
        }

        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim();

            match key {
                "Name" => name = Some(value.to_string()),
                "Exec" => {
                    // Remove field codes like %u, %U, %f, %F, etc.
                    let clean_exec = value
                        .replace("%u", "")
                        .replace("%U", "")
                        .replace("%f", "")
                        .replace("%F", "")
                        .replace("%i", "")
                        .replace("%c", "")
                        .replace("%k", "")
                        .trim()
                        .to_string();
                    exec = Some(clean_exec);
                }
                "Icon" => icon = Some(value.to_string()),
                "Comment" => description = Some(value.to_string()),
                "Keywords" => {
                    keywords = Some(
                        value
                            .split(';')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect(),
                    );
                }
                "NoDisplay" => no_display = value.eq_ignore_ascii_case("true"),
                "Hidden" => hidden = value.eq_ignore_ascii_case("true"),
                _ => {}
            }
        }
    }

    // Skip hidden or no-display apps
    if no_display || hidden {
        return None;
    }

    let name = name?;
    let exec = exec?;

    // Try to resolve icon to full path
    let icon_data = icon.and_then(|i| resolve_linux_icon(&i));

    let category = detect_app_category(&name, &exec);
    Some(AppInfo {
        id: crate::utils::hash_id(&exec),
        name,
        path: exec,
        icon: icon_data,
        description,
        keywords,
        last_used: None,
        usage_count: 0,
        category: Some(category),
    })
}

// ============================================================================
// Common Functions
// ============================================================================

/// Searches applications based on query
#[tauri::command]
pub async fn search_applications(query: String, apps: Vec<AppInfo>) -> VoltResult<Vec<AppInfo>> {
    crate::time_command!("search_applications");
    Ok(crate::search::search_applications(&query, apps))
}

/// Search applications with frecency scoring from launch history
#[tauri::command]
pub async fn search_applications_frecency(
    query: String,
    apps: Vec<AppInfo>,
    history_state: tauri::State<'_, crate::commands::launcher::LaunchHistoryState>,
    binding_state: tauri::State<'_, crate::commands::launcher::QueryBindingState>,
) -> VoltResult<Vec<AppInfoWithScore>> {
    crate::time_command!("search_applications_frecency");
    // Project the history into a path→frecency map under the lock instead of
    // cloning every LaunchRecord just to read its score.
    let frecency = history_state.history.with_records(|records| {
        records
            .iter()
            .map(|(path, record)| (path.clone(), record.frecency_date))
            .collect::<std::collections::HashMap<String, i64>>()
    });
    let bindings = binding_state
        .store
        .lock()
        .map_err(|e| crate::core::error::VoltError::Unknown(e.to_string()))?;
    let results = crate::search::search_applications_with_frecency(
        &query,
        apps,
        &frecency,
        Some(&bindings),
        &std::collections::HashMap::new(),
    );
    Ok(results
        .into_iter()
        .map(|(app, score)| AppInfoWithScore { app, score })
        .collect())
}

/// App info with an attached score for frontend consumption
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfoWithScore {
    #[serde(flatten)]
    pub app: AppInfo,
    pub score: f32,
}

/// Launches an application by its path.
///
/// Thin wrapper over `launch_app` (in `commands/launcher.rs`) that records
/// the launch in history and accepts an optional `as_admin` flag for
/// elevated launches (Shift+Enter on Windows). Both this command and
/// `launch_app` route through the same `execute_launch` helper so frecency
/// scores stay consistent regardless of which command the caller chose.
#[tauri::command]
pub async fn launch_application(
    path: String,
    as_admin: Option<bool>,
    history_state: State<'_, LaunchHistoryState>,
) -> VoltResult<()> {
    execute_launch(&path, as_admin.unwrap_or(false), &history_state.history)
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Recursively scans a directory for applications up to a given depth
#[allow(dead_code)]
fn scan_directory_recursive(
    dir_path: &str,
    current_depth: usize,
    max_depth: usize,
) -> Result<Vec<AppInfo>, String> {
    let mut apps = Vec::new();

    // Stop if we've reached max depth
    if current_depth >= max_depth {
        return Ok(apps);
    }

    let path = std::path::Path::new(dir_path);
    if !path.exists() {
        return Ok(apps);
    }

    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return Ok(apps),
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();

        // Skip known system/protected directories on Windows
        #[cfg(target_os = "windows")]
        if let Some(dir_name) = entry_path.file_name().and_then(|n| n.to_str())
            && should_skip_directory(dir_name)
        {
            continue;
        }

        // Skip if not a directory
        if let Ok(metadata) = entry.metadata()
            && metadata.is_dir()
            && !metadata.is_symlink()
        {
            // Try to find an executable in this directory
            if let Some(exe_path) = find_main_executable(&entry_path)
                && let Some(app_name) = exe_path.file_stem()
            {
                let path_str = exe_path.to_string_lossy().to_string();
                let app_name_str = app_name.to_string_lossy().to_string();
                let category = detect_app_category(&app_name_str, &path_str);

                // Icons are loaded lazily via get_app_icon command
                apps.push(AppInfo {
                    id: crate::utils::hash_id(&path_str),
                    name: app_name_str,
                    path: path_str,
                    icon: None,
                    description: None,
                    keywords: None,
                    last_used: None,
                    usage_count: 0,
                    category: Some(category),
                });
            }

            // Recursively scan subdirectories
            if current_depth + 1 < max_depth
                && let Ok(sub_apps) = scan_directory_recursive(
                    &entry_path.to_string_lossy(),
                    current_depth + 1,
                    max_depth,
                )
            {
                apps.extend(sub_apps);
            }
        }
    }

    Ok(apps)
}

/// Resolves a Windows .lnk shortcut file to get the target path and icon location.
/// Returns (target_path, icon_location) where icon_location may differ from target.
#[cfg(target_os = "windows")]
fn resolve_lnk_shortcut(lnk_path: &std::path::Path) -> Option<(String, Option<String>)> {
    match ShellLink::open(lnk_path, lnk::encoding::WINDOWS_1252) {
        Ok(shell_link) => {
            // Use the high-level link_target() which handles all path resolution
            if let Some(target_path) = shell_link.link_target()
                && std::path::Path::new(&target_path).exists()
            {
                let icon_location = shell_link
                    .string_data()
                    .icon_location()
                    .as_ref()
                    .map(|s| s.to_string());
                return Some((target_path, icon_location));
            }

            // Fallback: try relative path from string_data
            if let Some(relative_path) = shell_link.string_data().relative_path()
                && !relative_path.is_empty()
                && let Some(parent) = lnk_path.parent()
            {
                let resolved = parent.join(relative_path);
                if resolved.exists() {
                    let icon_location = shell_link
                        .string_data()
                        .icon_location()
                        .as_ref()
                        .map(|s| s.to_string());
                    return Some((resolved.to_string_lossy().to_string(), icon_location));
                }
            }

            None
        }
        Err(e) => {
            warn!("Failed to parse .lnk file {:?}: {:?}", lnk_path, e);
            None
        }
    }
}

#[allow(dead_code)]
fn scan_shortcuts(dir_path: &str) -> Result<Vec<AppInfo>, String> {
    let mut apps = Vec::new();

    if let Ok(entries) = std::fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            let path = entry.path();

            // Skip symlinks to avoid infinite loops
            if let Ok(metadata) = entry.metadata() {
                // Recursively scan subdirectories (but not symlinks)
                if metadata.is_dir()
                    && !metadata.is_symlink()
                    && let Ok(sub_apps) = scan_shortcuts(&path.to_string_lossy())
                {
                    apps.extend(sub_apps);
                } else if metadata.is_file()
                    && let Some(ext) = path.extension()
                    && ext == "lnk"
                    && let Some(name) = path.file_stem()
                {
                    #[cfg(target_os = "windows")]
                    let path_str = {
                        // Try to resolve the .lnk shortcut to its actual target
                        match resolve_lnk_shortcut(&path) {
                            Some((target_path, _icon_location)) => target_path,
                            None => path.to_string_lossy().to_string(),
                        }
                    };

                    #[cfg(not(target_os = "windows"))]
                    let path_str = path.to_string_lossy().to_string();

                    // Icons are loaded lazily via get_app_icon command
                    let name_str = name.to_string_lossy().to_string();
                    let category = detect_app_category(&name_str, &path_str);
                    apps.push(AppInfo {
                        id: crate::utils::hash_id(&path_str),
                        name: name_str,
                        path: path_str,
                        icon: None,
                        description: None,
                        keywords: None,
                        last_used: None,
                        usage_count: 0,
                        category: Some(category),
                    });
                }
            }
        }
    }

    Ok(apps)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Categories are emitted in the lowercase/camelCase form expected by the
    // TS `AppCategory` enum (`src/shared/types/common.types.ts`). The
    // appCategoryStrings.test.ts vitest cross-checks the contract against
    // both sides; keep these literals in sync with that source of truth.

    #[test]
    fn test_detect_app_category_games() {
        assert_eq!(detect_app_category("Steam", "/usr/bin/steam"), "gaming");
        assert_eq!(detect_app_category("Minecraft", "/games/mc"), "gaming");
        assert_eq!(
            detect_app_category("Anything", "C:/SteamApps/common/foo"),
            "gaming"
        );
    }

    #[test]
    fn test_deduplicate_apps_collapses_same_name_aumids() {
        let mut apps = vec![
            AppInfo {
                id: "xbox-app".to_string(),
                name: "Xbox".to_string(),
                path: "Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App".to_string(),
                icon: None,
                description: Some("Microsoft Store".to_string()),
                keywords: None,
                last_used: None,
                usage_count: 0,
                category: None,
            },
            AppInfo {
                id: "xbox-appl".to_string(),
                name: "Xbox".to_string(),
                path: "Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.AppL".to_string(),
                icon: None,
                description: Some("Microsoft Store".to_string()),
                keywords: None,
                last_used: None,
                usage_count: 0,
                category: None,
            },
        ];

        deduplicate_app_results(&mut apps);

        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].name, "Xbox");
    }

    #[test]
    fn test_deduplicate_apps_prefers_existing_executable_over_registry_entry() {
        let exe = std::env::current_exe()
            .expect("test executable path")
            .to_string_lossy()
            .to_string();
        let mut apps = vec![
            AppInfo {
                id: "registry".to_string(),
                name: "Volt".to_string(),
                path: "C:\\missing\\Volt".to_string(),
                icon: None,
                description: Some("Volt".to_string()),
                keywords: None,
                last_used: None,
                usage_count: 0,
                category: None,
            },
            AppInfo {
                id: "exe".to_string(),
                name: "Volt".to_string(),
                path: exe.clone(),
                icon: None,
                description: None,
                keywords: None,
                last_used: None,
                usage_count: 0,
                category: None,
            },
        ];

        deduplicate_app_results(&mut apps);

        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].path, exe);
    }

    #[test]
    fn test_detect_app_category_browsers() {
        assert_eq!(
            detect_app_category("Firefox", "/usr/bin/firefox"),
            "browsers"
        );
        assert_eq!(
            detect_app_category("Google Chrome", "/Applications/Chrome.app"),
            "browsers"
        );
    }

    #[test]
    fn test_detect_app_category_development() {
        assert_eq!(
            detect_app_category("Visual Studio Code", "/usr/bin/code"),
            "development"
        );
        assert_eq!(
            detect_app_category("IntelliJ IDEA", "/opt/intellij"),
            "development"
        );
    }

    #[test]
    fn test_detect_app_category_communication() {
        assert_eq!(
            detect_app_category("Discord", "/usr/bin/discord"),
            "communication"
        );
        assert_eq!(
            detect_app_category("Slack", "/Applications/Slack.app"),
            "communication"
        );
    }

    #[test]
    fn test_detect_app_category_default() {
        assert_eq!(detect_app_category("RandomApp42", "/opt/random"), "other");
    }

    #[test]
    fn test_detect_app_category_case_insensitive() {
        assert_eq!(detect_app_category("FIREFOX", "/X"), "browsers");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_should_skip_windows_system_dirs() {
        assert!(should_skip_directory("WindowsApps"));
        assert!(should_skip_directory("windowsapps")); // case insensitive
        assert!(should_skip_directory("Microsoft"));
        assert!(should_skip_directory("Common Files"));
        assert!(!should_skip_directory("Mozilla Firefox"));
        assert!(!should_skip_directory("Steam"));
    }

    #[test]
    fn test_scan_directory_recursive_returns_empty_for_missing_dir() {
        let result = scan_directory_recursive("/this/path/definitely/does/not/exist", 0, 5);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_scan_directory_recursive_respects_max_depth() {
        // Calling with current_depth >= max_depth should immediately return empty
        let result = scan_directory_recursive("/", 5, 5);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_scan_cache_expiry() {
        let cache = ScanCache {
            apps: Arc::new(vec![]),
            timestamp: SystemTime::now() - Duration::from_secs(600),
        };
        assert!(cache.is_expired(Duration::from_secs(60)));
    }

    #[test]
    fn test_scan_cache_fresh() {
        let cache = ScanCache {
            apps: Arc::new(vec![]),
            timestamp: SystemTime::now(),
        };
        assert!(!cache.is_expired(Duration::from_secs(300)));
    }
}
