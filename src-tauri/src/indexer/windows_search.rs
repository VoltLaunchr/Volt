//! Windows Search Index integration
//!
//! Queries the native Windows Search service to supplement our custom
//! SQLite indexer. The Windows Search Index is maintained by the OS and
//! covers files that our scanner might miss.

use super::types::{FileCategory, FileInfo};
use crate::utils::process::no_window;
use std::process::Command;
use tracing::{info, warn};

/// Query the Windows Search Index for files matching a query.
/// Uses PowerShell + OLE DB to query the SystemIndex catalog.
/// Returns up to `limit` results.
///
/// The blocking PowerShell process is executed on a dedicated thread via
/// `tokio::task::spawn_blocking` so the async executor is never stalled.
pub async fn search_windows_index(query: &str, limit: usize) -> Result<Vec<FileInfo>, String> {
    const MAX_QUERY_LEN: usize = 256;

    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    // Reject pathologically long queries and any control characters: both
    // protect the embedded PowerShell script from injection attempts and
    // resource exhaustion.
    if query.len() > MAX_QUERY_LEN || query.chars().any(|c| c.is_control()) {
        return Ok(Vec::new());
    }

    let query_owned = query.to_string();
    tokio::task::spawn_blocking(move || search_windows_index_blocking(&query_owned, limit))
        .await
        .unwrap_or_else(|e| Err(format!("spawn_blocking panicked: {e}")))
}

/// Inner synchronous implementation — runs inside `spawn_blocking`.
fn search_windows_index_blocking(query: &str, limit: usize) -> Result<Vec<FileInfo>, String> {
    // SQL escape: single quotes doubled (SQL convention); double quotes doubled
    // so the WQL CONTAINS phrase parser sees them as escaped delimiters rather
    // than closing the phrase.
    let safe_query = query.replace('\'', "''").replace('"', "\"\"");

    // The query is passed via an environment variable, NEVER interpolated into
    // the PowerShell source. PS variable expansion does not recursively parse
    // substituted values, so an attacker cannot smuggle `$(...)`, backticks,
    // or `;` separators through the query parameter to achieve command
    // injection inside the inlined script.
    let ps_script = format!(
        r#"
$q = $env:VOLT_QUERY
if ([string]::IsNullOrEmpty($q)) {{ return }}
$conn = New-Object System.Data.OleDb.OleDbConnection
$conn.ConnectionString = "Provider=Search.CollatorDSO;Extended Properties='Application=Windows';"
try {{
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT TOP {limit} System.ItemPathDisplay, System.ItemNameDisplay, System.Size, System.DateModified, System.ItemType FROM SystemIndex WHERE SCOPE='file:' AND CONTAINS(System.ItemNameDisplay,'""$($q)*""') ORDER BY System.Search.Rank DESC"
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {{
        $path = $reader["System.ItemPathDisplay"]
        $name = $reader["System.ItemNameDisplay"]
        $size = $reader["System.Size"]
        $modified = $reader["System.DateModified"]
        if ($path -ne $null -and $path -ne "") {{
            $sizeVal = if ($size -ne $null -and $size -ne [DBNull]::Value) {{ [long]$size }} else {{ 0 }}
            $modVal = if ($modified -ne $null -and $modified -ne [DBNull]::Value) {{ [DateTimeOffset]::new([DateTime]$modified).ToUnixTimeSeconds() }} else {{ 0 }}
            $nameVal = if ($name -ne $null -and $name -ne [DBNull]::Value) {{ $name }} else {{ [System.IO.Path]::GetFileName($path) }}
            Write-Output "$path`t$nameVal`t$sizeVal`t$modVal"
        }}
    }}
    $reader.Close()
}} catch {{
    Write-Error $_.Exception.Message
}} finally {{
    $conn.Close()
}}
"#
    );

    let mut cmd = Command::new("powershell");
    no_window(&mut cmd);
    let output = cmd
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
        .env("VOLT_QUERY", &safe_query)
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.is_empty() {
            warn!("Windows Search query warning: {}", stderr.trim());
        }
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 4 {
            continue;
        }

        let path = parts[0].to_string();
        let name = parts[1].to_string();
        let size: u64 = parts[2].parse().unwrap_or(0);
        let modified: i64 = parts[3].parse().unwrap_or(0);

        let extension = std::path::Path::new(&path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let category = FileCategory::from_path(&path, &extension, false);

        let id = crate::utils::hash_id(&path);

        results.push(FileInfo {
            id,
            name,
            path,
            extension,
            size,
            modified,
            created: None,
            accessed: None,
            icon: None,
            category,
        });
    }

    // Post-filter 1: only keep results whose filename actually contains the query.
    // CONTAINS() in WQL can still match via content indexing.
    let query_lower = query.to_lowercase();
    results.retain(|r| r.name.to_lowercase().contains(&query_lower));

    // Post-filter 2: exclude results from noisy directories.
    // Mirrors the component-based exclusions used by the Volt scanner.
    let excluded_components: &[&str] = &[
        "node_modules",
        ".git",
        ".svn",
        "__pycache__",
        ".venv",
        "venv",
        "target",
        "dist",
        "build",
        ".next",
        ".nuxt",
        "tmp",
        "temp",
        "Temp",
        "Cache",
        "cache",
        "Caches",
        "caches",
        ".cache",
        "$Recycle.Bin",
        "System Volume Information",
        "AppData",
        "Windows",
        "Library",
    ];
    results.retain(|r| {
        !std::path::Path::new(&r.path).components().any(|c| {
            c.as_os_str()
                .to_str()
                .is_some_and(|s| excluded_components.contains(&s))
        })
    });

    // Post-filter 3: drop temp/junk file extensions (*.tmp, *.temp).
    let excluded_exts: &[&str] = &["tmp", "temp", "bak", "log"];
    results.retain(|r| !excluded_exts.contains(&r.extension.as_str()));

    if !results.is_empty() {
        info!(
            "Windows Search: found {} results for '{}'",
            results.len(),
            query
        );
    }

    Ok(results)
}
