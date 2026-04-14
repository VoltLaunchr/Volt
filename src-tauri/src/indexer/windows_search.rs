//! Windows Search Index integration
//!
//! Queries the native Windows Search service to supplement our custom
//! SQLite indexer. The Windows Search Index is maintained by the OS and
//! covers files that our scanner might miss.

use super::types::{FileCategory, FileInfo};
use std::process::Command;
use tracing::{info, warn};

/// Query the Windows Search Index for files matching a query.
/// Uses PowerShell + OLE DB to query the SystemIndex catalog.
/// Returns up to `limit` results.
pub fn search_windows_index(query: &str, limit: usize) -> Result<Vec<FileInfo>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    // Escape single quotes in query
    let safe_query = query.replace('\'', "''");

    // Build a PowerShell script that queries Windows Search via OLE DB
    let ps_script = format!(
        r#"
$conn = New-Object System.Data.OleDb.OleDbConnection
$conn.ConnectionString = "Provider=Search.CollatorDSO;Extended Properties='Application=Windows';"
try {{
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT TOP {limit} System.ItemPathDisplay, System.ItemNameDisplay, System.Size, System.DateModified, System.ItemType FROM SystemIndex WHERE SCOPE='file:' AND CONTAINS(*,'\""{safe_query}*""') ORDER BY System.Search.Rank DESC"
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

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
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

    if !results.is_empty() {
        info!(
            "Windows Search: found {} results for '{}'",
            results.len(),
            query
        );
    }

    Ok(results)
}
