//! Quicklinks management commands
//!
//! CRUD operations for user-defined quicklinks (URL, folder, or shell command shortcuts).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

use crate::core::error::{VoltError, VoltResult};
use crate::utils::launch_validation::validate_launch_path;

/// Characters that allow shell command chaining / redirection / substitution.
/// Rejected in command-type quicklinks to prevent shell injection even though
/// we no longer pass the target through `cmd /C` or `sh -c`.
const SHELL_METACHARS: &[char] = &['|', '&', ';', '>', '<', '`', '$', '\n', '\r', '(', ')'];

/// Allowed URL schemes for `url`-type quicklinks.
const ALLOWED_URL_SCHEMES: &[&str] = &["http", "https", "mailto"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quicklink {
    pub id: String,
    pub name: String,
    pub shortcut: String,
    pub target: String,
    #[serde(rename = "type")]
    pub link_type: String, // "url" | "folder" | "command"
    pub icon: Option<String>,
}

/// State wrapper for quicklink storage
pub struct QuicklinkState {
    quicklinks: Mutex<HashMap<String, Quicklink>>,
    file_path: PathBuf,
}

impl QuicklinkState {
    pub fn new(data_dir: PathBuf) -> Self {
        let file_path = data_dir.join("quicklinks.json");
        let quicklinks = Self::load_from_file(&file_path).unwrap_or_default();
        Self {
            quicklinks: Mutex::new(quicklinks),
            file_path,
        }
    }

    fn load_from_file(path: &Path) -> Option<HashMap<String, Quicklink>> {
        if !path.exists() {
            return None;
        }
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn save(&self) -> Result<(), String> {
        let quicklinks = self.quicklinks.lock().map_err(|e| e.to_string())?;
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&*quicklinks).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<Quicklink>, String> {
        let quicklinks = self.quicklinks.lock().map_err(|e| e.to_string())?;
        Ok(quicklinks.values().cloned().collect())
    }

    pub fn replace_all(&self, new_quicklinks: HashMap<String, Quicklink>) -> Result<(), String> {
        {
            let mut quicklinks = self.quicklinks.lock().map_err(|e| e.to_string())?;
            *quicklinks = new_quicklinks;
        }
        self.save()
    }
}

/// Get all quicklinks
#[tauri::command]
pub async fn get_quicklinks(state: State<'_, QuicklinkState>) -> VoltResult<Vec<Quicklink>> {
    let quicklinks = state
        .quicklinks
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?;
    let mut list: Vec<Quicklink> = quicklinks.values().cloned().collect();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(list)
}

/// Save or update a quicklink
#[tauri::command]
pub async fn save_quicklink(
    state: State<'_, QuicklinkState>,
    quicklink: Quicklink,
) -> VoltResult<Quicklink> {
    let mut ql = quicklink;

    // Generate ID if empty
    if ql.id.is_empty() {
        ql.id = Uuid::new_v4().to_string();
    }

    // --- Validate target based on quicklink type ---
    match ql.link_type.as_str() {
        "command" => {
            validate_command_target(&ql.target)?;
        }
        "url" => {
            // Validate URL scheme on save, not just on open
            let parsed = url::Url::parse(&ql.target).map_err(|e| {
                VoltError::InvalidConfig(format!("Invalid URL '{}': {}", ql.target, e))
            })?;
            if !ALLOWED_URL_SCHEMES.contains(&parsed.scheme()) {
                return Err(VoltError::InvalidConfig(format!(
                    "URL scheme '{}' not allowed (only {} are permitted)",
                    parsed.scheme(),
                    ALLOWED_URL_SCHEMES.join(", ")
                )));
            }
        }
        "folder"
            // Folder validation is lightweight on save (just check non-empty)
            if ql.target.trim().is_empty() => {
                return Err(VoltError::InvalidConfig(
                    "Folder path cannot be empty".into(),
                ));
            }
        _ => {}
    }

    {
        let mut quicklinks = state
            .quicklinks
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        quicklinks.insert(ql.id.clone(), ql.clone());
    }

    state.save().map_err(VoltError::Unknown)?;
    Ok(ql)
}

/// Validate a URL-type quicklink target.
///
/// The URL must parse and use one of `ALLOWED_URL_SCHEMES`. Used both on save
/// and at sync-pull time (to reject malicious rows pushed via Supabase REST).
pub(crate) fn validate_url_target(target: &str) -> VoltResult<()> {
    let parsed = url::Url::parse(target)
        .map_err(|e| VoltError::InvalidConfig(format!("Invalid URL '{}': {}", target, e)))?;
    if !ALLOWED_URL_SCHEMES.contains(&parsed.scheme()) {
        return Err(VoltError::InvalidConfig(format!(
            "URL scheme '{}' not allowed (only {} are permitted)",
            parsed.scheme(),
            ALLOWED_URL_SCHEMES.join(", ")
        )));
    }
    Ok(())
}

/// Validate a folder-type quicklink target. Lightweight: non-empty + no shell
/// metacharacters (we don't require the path to exist on this device, since
/// synced rows may reference paths only valid on the source device).
pub(crate) fn validate_folder_target(target: &str) -> VoltResult<()> {
    if target.trim().is_empty() {
        return Err(VoltError::InvalidConfig(
            "Folder path cannot be empty".into(),
        ));
    }
    if target.chars().any(|c| SHELL_METACHARS.contains(&c)) {
        return Err(VoltError::InvalidConfig(
            "Folder path contains forbidden shell metacharacters".into(),
        ));
    }
    Ok(())
}

/// Validate a command-type quicklink target.
///
/// The program (first whitespace-separated token) must be an absolute path to
/// an existing file. Shell metacharacters are also rejected (same list used at
/// open time).
pub(crate) fn validate_command_target(target: &str) -> VoltResult<()> {
    if target.trim().is_empty() {
        return Err(VoltError::InvalidConfig(
            "Command target cannot be empty".into(),
        ));
    }

    // Reject shell metacharacters (defense in depth - also checked at open time)
    if target.chars().any(|c| SHELL_METACHARS.contains(&c)) {
        return Err(VoltError::InvalidConfig(
            "Command contains forbidden shell metacharacters (|, &, ;, >, <, `, $, newline, parentheses)".into(),
        ));
    }

    let program = target.split_whitespace().next().unwrap_or("");

    // The program must be an absolute path
    let program_path = std::path::Path::new(program);
    if !program_path.is_absolute() {
        return Err(VoltError::InvalidConfig(format!(
            "Command program must be an absolute path, got: {}",
            program
        )));
    }

    // The program must exist on disk
    if !program_path.exists() {
        return Err(VoltError::InvalidConfig(format!(
            "Command program does not exist: {}",
            program
        )));
    }

    // The program must be a file, not a directory
    if !program_path.is_file() {
        return Err(VoltError::InvalidConfig(format!(
            "Command program is not a file: {}",
            program
        )));
    }

    Ok(())
}

/// Delete a quicklink by ID
#[tauri::command]
pub async fn delete_quicklink(state: State<'_, QuicklinkState>, id: String) -> VoltResult<()> {
    {
        let mut quicklinks = state
            .quicklinks
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        quicklinks
            .remove(&id)
            .ok_or_else(|| VoltError::NotFound(format!("Quicklink not found: {}", id)))?;
    }

    state.save().map_err(VoltError::Unknown)?;
    Ok(())
}

/// Open/execute a quicklink
#[tauri::command]
pub async fn open_quicklink(_app: tauri::AppHandle, quicklink: Quicklink) -> VoltResult<()> {
    match quicklink.link_type.as_str() {
        "url" => {
            // Validate scheme to prevent file://, javascript:, vbscript:, ms-cxh:// etc.
            let parsed = url::Url::parse(&quicklink.target).map_err(|e| {
                VoltError::Launch(format!("Invalid URL '{}': {}", quicklink.target, e))
            })?;
            if !ALLOWED_URL_SCHEMES.contains(&parsed.scheme()) {
                return Err(VoltError::Launch(format!(
                    "URL scheme '{}' not allowed (only {} are permitted)",
                    parsed.scheme(),
                    ALLOWED_URL_SCHEMES.join(", ")
                )));
            }
            tauri_plugin_opener::open_url(&quicklink.target, None::<&str>)
                .map_err(|e| VoltError::Launch(format!("Failed to open URL: {}", e)))?;
        }
        "folder" => {
            let path = std::path::Path::new(&quicklink.target);
            if !path.exists() {
                return Err(VoltError::NotFound(format!(
                    "Folder not found: {}",
                    quicklink.target
                )));
            }
            if !path.is_dir() {
                return Err(VoltError::Launch(format!(
                    "Path is not a folder: {}",
                    quicklink.target
                )));
            }
            tauri_plugin_opener::open_path(&quicklink.target, None::<&str>)
                .map_err(|e| VoltError::Launch(format!("Failed to open folder: {}", e)))?;
        }
        "command" => {
            // Re-validate at execution time (the quicklink file could have been
            // edited manually, or saved before validation was added).
            validate_command_target(&quicklink.target)
                .map_err(|e| VoltError::Launch(format!("Command validation failed: {}", e)))?;

            let mut tokens = quicklink.target.split_whitespace();
            let program = tokens
                .next()
                .ok_or_else(|| VoltError::Launch("Command quicklink target is empty".into()))?;
            let args: Vec<&str> = tokens.collect();

            // LOLBIN denylist + Windows extension/UWP validation. Without this,
            // `validate_command_target` accepts any absolute existing file —
            // including cmd.exe, powershell.exe, regsvr32.exe, etc.
            validate_launch_path(program).map_err(VoltError::Launch)?;

            std::process::Command::new(program)
                .args(&args)
                .spawn()
                .map_err(|e| VoltError::Launch(format!("Failed to execute command: {}", e)))?;
        }
        _ => {
            return Err(VoltError::Unknown(format!(
                "Unknown quicklink type: {}",
                quicklink.link_type
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test for the LOLBIN-via-quicklink bypass.
    ///
    /// `validate_command_target` only checks "absolute path + exists + is_file +
    /// no shell metas". On Windows that accepts cmd.exe, powershell.exe, etc.
    /// It must be paired with `validate_launch_path` which carries the LOLBIN
    /// denylist. This test pins the contract: target validation alone is not
    /// enough; launch-path validation is required to refuse LOLBINs.
    #[cfg(target_os = "windows")]
    #[test]
    fn lolbin_blocked_by_validate_launch_path() {
        for prog in [
            r"C:\Windows\System32\cmd.exe",
            r"C:\Windows\System32\powershell.exe",
            r"C:\Windows\System32\regsvr32.exe",
            r"C:\Windows\System32\mshta.exe",
        ] {
            assert!(
                validate_launch_path(prog).is_err(),
                "validate_launch_path must reject LOLBIN: {}",
                prog
            );
        }
    }
}
