//! Shell AppsFolder enumeration
//!
//! Uses PowerShell to enumerate all installed applications from the
//! Shell AppsFolder, including Microsoft Store/UWP apps.

use crate::commands::apps::AppInfo;
use crate::utils::process::no_window;
use std::process::Command;
use tracing::{info, warn};

/// Enumerate Start Menu applications via PowerShell Get-StartApps.
/// This intentionally uses the Start surface rather than all AppX packages:
/// AppX manifests include background/system endpoints that are not useful
/// launch targets.
pub fn enumerate_apps_folder() -> Result<Vec<AppInfo>, String> {
    let mut cmd = Command::new("powershell");
    no_window(&mut cmd);
    let output = cmd
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"
Get-StartApps | ForEach-Object {
    if ($_.Name -and $_.AppID -and $_.AppID -match '^[A-Za-z0-9][A-Za-z0-9.]+_[A-Za-z0-9]{13}!.+$') {
        Write-Output "$($_.AppID)`t$($_.Name)"
    }
}
"#,
        ])
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.is_empty() {
            warn!("AppsFolder enumeration warning: {}", stderr.trim());
        }
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut apps = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() < 2 {
            continue;
        }

        let aumid = parts[0].trim().to_string();
        let name = parts[1].trim().to_string();

        if name.is_empty() || aumid.is_empty() {
            continue;
        }

        // Skip known system/framework apps
        if name.starts_with("Microsoft.") && is_system_app(&name) {
            continue;
        }

        let clean_name = clean_app_name(&name);

        // Skip junk apps (SDK samples, documentation, system endpoints)
        if is_junk_app(&clean_name) {
            continue;
        }

        let id = crate::utils::hash_id(&aumid);

        apps.push(AppInfo {
            id,
            name: clean_name,
            path: aumid, // AUMID used as path for launching
            icon: None,
            description: Some("Microsoft Store".to_string()),
            keywords: None,
            last_used: None,
            usage_count: 0,
            category: None,
        });
    }

    info!("AppsFolder: Found {} Store apps", apps.len());
    Ok(apps)
}

/// Clean up package names like "Microsoft.WindowsCalculator" → "Windows Calculator"
fn clean_app_name(name: &str) -> String {
    // If it looks like a package name (e.g., Microsoft.WindowsCalculator), make it human-readable
    if name.contains('.') && !name.contains(' ') {
        let last_part = name.rsplit('.').next().unwrap_or(name);
        // Insert spaces before uppercase letters: "WindowsCalculator" → "Windows Calculator"
        let mut result = String::new();
        for (i, c) in last_part.chars().enumerate() {
            if i > 0 && c.is_uppercase() {
                result.push(' ');
            }
            result.push(c);
        }
        return result;
    }
    name.to_string()
}

/// Filter out known system/SDK apps that shouldn't appear in search
fn is_system_app(name: &str) -> bool {
    let system_prefixes = [
        "Microsoft.NET",
        "Microsoft.VCLibs",
        "Microsoft.UI.Xaml",
        "Microsoft.WindowsAppRuntime",
        "Microsoft.DirectX",
        "Microsoft.Services",
        "Microsoft.Advertising",
        "Microsoft.WinAppRuntime",
        "Microsoft.WindowsAppSDK",
        "Microsoft.Office.ActionsServer",
        "Microsoft.OfficePushNotification",
        "MicrosoftCorporationII.WinML",
    ];
    system_prefixes.iter().any(|p| name.starts_with(p))
}

/// Filter out obvious junk app names (SDK samples, documentation, internal tools)
/// and known Store/system endpoints that Get-StartApps may still expose.
pub fn is_junk_app(name: &str) -> bool {
    let lower = name.to_lowercase();

    let junk_patterns = [
        // SDK / dev samples
        "sample uwp",
        "sample desktop",
        "sample app",
        "tools for uwp",
        "tools for desktop",
        "documentation for",
        // Installers / uninstallers
        "uninstall",
        "désinstall",
        // System internals (very specific)
        "appvdllsurrogate",
        "gameinputrawinputproxy",
        "store purchase app",
        "aimgr",
        "aitoolkit.inference",
        // Store/system endpoints surfaced by Windows app packages
        "desktop app installer",
        "app installer",
        "gaming services",
        "xbox identity provider",
        "xbox game bar plugin",
        "xbox game bar widgets",
        "xbox tcui",
        "xbox speech to text overlay",
        "game bar presence writer",
        "microsoft gameinput",
        "microsoft gaming services",
        "package installer",
        "package support framework",
        "update service",
        "updater",
    ];
    junk_patterns.iter().any(|p| lower.contains(p))
}

#[cfg(test)]
mod tests {
    use super::is_junk_app;

    #[test]
    fn filters_known_windows_store_endpoints() {
        assert!(is_junk_app("Gaming Services"));
        assert!(is_junk_app("Desktop App Installer"));
        assert!(is_junk_app("Xbox Identity Provider"));
        assert!(is_junk_app("Xbox Game Bar Plugin"));
    }

    #[test]
    fn keeps_user_facing_apps() {
        assert!(!is_junk_app("Xbox"));
        assert!(!is_junk_app("Calculator"));
    }
}
