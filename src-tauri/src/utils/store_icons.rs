//! Resolve Store logos in one bounded PowerShell call, shared by all windows.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

struct Catalog {
    paths: HashMap<String, PathBuf>,
    refreshed: Instant,
    ttl: Duration,
}

static CATALOG: LazyLock<Mutex<Option<Catalog>>> = LazyLock::new(|| Mutex::new(None));

pub async fn icon_path(aumid: &str) -> Option<PathBuf> {
    let mut catalog = CATALOG.lock().await;
    if catalog
        .as_ref()
        .is_none_or(|catalog| catalog.refreshed.elapsed() >= catalog.ttl)
    {
        let mut command = tokio::process::Command::new("powershell");
        crate::utils::process::no_window_tokio(&mut command);
        command.args(["-NoProfile", "-NonInteractive", "-Command", STORE_LOGOS]);
        let result =
            crate::utils::process::bounded_output(command, Duration::from_secs(8), 4 * 1024 * 1024)
                .await;
        let paths = result
            .ok()
            .and_then(|bytes| serde_json::from_slice::<HashMap<String, PathBuf>>(&bytes).ok());
        let ttl = if paths.is_some() {
            Duration::from_secs(300)
        } else {
            Duration::from_secs(30)
        };
        if paths.is_none() {
            tracing::warn!("Store icon catalog unavailable; using placeholders for 30 seconds");
        }
        *catalog = Some(Catalog {
            paths: paths.unwrap_or_default(),
            refreshed: Instant::now(),
            ttl,
        });
    }
    catalog.as_ref()?.paths.get(aumid).cloned()
}

// No request input is interpolated into the script. Package paths come from Windows.
const STORE_LOGOS: &str = r#"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$icons = @{}
$visible = @{}
$families = @{}
Get-StartApps -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.AppID -match '^([^!]+)!.+$') {
        $visible[$_.AppID] = $true
        $families[$Matches[1]] = $true
    }
}
Get-AppxPackage -PackageTypeFilter Main -ErrorAction SilentlyContinue |
    Where-Object { $families.ContainsKey($_.PackageFamilyName) } | ForEach-Object {
    $pkg = $_
    if ($pkg.InstallLocation) {
        try {
            $manifestPath = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
            [xml]$manifest = Get-Content -LiteralPath $manifestPath -ErrorAction Stop
            foreach ($app in @($manifest.Package.Applications.Application)) {
                $aumid = $pkg.PackageFamilyName + '!' + $app.Id
                if (-not $visible.ContainsKey($aumid)) { continue }
                $logo = $app.VisualElements.Square44x44Logo
                if (-not $logo) { $logo = $app.VisualElements.Logo }
                if (-not $app.Id -or -not $logo) { continue }
                $candidate = Join-Path $pkg.InstallLocation $logo
                $candidates = @()
                if (Test-Path -LiteralPath $candidate) { $candidates += Get-Item -LiteralPath $candidate }
                $dir = Split-Path -Parent $candidate
                $base = [System.IO.Path]::GetFileNameWithoutExtension($candidate)
                if ($dir -and (Test-Path -LiteralPath $dir)) {
                    $candidates += Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
                        Where-Object { $_.BaseName.StartsWith($base) -and $_.Extension -match '^\.(png|jpg|jpeg|ico)$' }
                }
                $best = $candidates | Sort-Object @{ Expression = {
                    if ($_.Name -match 'scale-200') { 0 }
                    elseif ($_.Name -match 'scale-100') { 1 }
                    elseif ($_.Extension -eq '.png') { 2 }
                    else { 3 }
                } }, Length | Select-Object -First 1
                if ($best) { $icons[$aumid] = $best.FullName }
            }
        } catch { }
    }
}
ConvertTo-Json -InputObject $icons -Compress -Depth 3
"#;
