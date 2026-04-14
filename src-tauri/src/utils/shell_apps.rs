//! Shell AppsFolder enumeration
//!
//! Uses PowerShell to enumerate all installed applications from the
//! Shell AppsFolder, including Microsoft Store/UWP apps.

use crate::commands::apps::AppInfo;
use std::process::Command;
use tracing::{info, warn};

/// Enumerate all Store/UWP applications via PowerShell Get-StartApps.
/// This returns apps visible in the Start Menu including Store apps
/// that don't have .lnk shortcuts.
pub fn enumerate_apps_folder() -> Result<Vec<AppInfo>, String> {
    // Use Get-AppxPackage for Store apps (faster and more reliable than COM)
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"
Get-AppxPackage -PackageTypeFilter Main | Where-Object { $_.IsFramework -eq $false -and $_.SignatureKind -eq 'Store' } | ForEach-Object {
    $pkg = $_
    try {
        $apps = (Get-AppxPackageManifest $pkg).Package.Applications.Application
        if ($apps) {
            foreach ($app in $apps) {
                $aumid = "$($pkg.PackageFamilyName)!$($app.Id)"
                $name = $pkg.Name
                # Try to get a display name from the manifest
                $displayName = $app.VisualElements.DisplayName
                if ($displayName -and -not $displayName.StartsWith('ms-resource:')) {
                    $name = $displayName
                }
                Write-Output "$aumid`t$name"
            }
        }
    } catch {}
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

        // Skip junk apps (SDK samples, documentation, dev tools)
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
    ];
    system_prefixes.iter().any(|p| name.starts_with(p))
}

/// Filter out junk app names (SDK samples, documentation, dev tools)
pub fn is_junk_app(name: &str) -> bool {
    let lower = name.to_lowercase();
    let junk_patterns = [
        "sample uwp",
        "sample desktop",
        "tools for uwp",
        "tools for desktop",
        "documentation for",
        "sdk ",
        "debug ",
        "developer ",
        "uninstall",
        "setup",
        "installer",
        "updater",
        "update helper",
        "crash report",
        "error report",
        "compatibility",
        "redistributable",
        "runtime",
    ];
    junk_patterns.iter().any(|p| lower.contains(p))
}
