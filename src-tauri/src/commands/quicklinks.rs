//! Quicklinks management commands
//!
//! CRUD operations for user-defined quicklinks (URL, folder, or shell command shortcuts).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

use crate::core::error::{VoltError, VoltResult};

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

    fn load_from_file(path: &PathBuf) -> Option<HashMap<String, Quicklink>> {
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
            // Execute command *without* passing through a shell (no `cmd /C`, no `sh -c`).
            // This eliminates shell metacharacter interpretation. As defense in depth we
            // also reject tokens containing shell-control characters.
            if quicklink.target.chars().any(|c| SHELL_METACHARS.contains(&c)) {
                return Err(VoltError::Launch(
                    "Command contains forbidden shell metacharacters (|, &, ;, >, <, `, $, newline, parentheses)".into(),
                ));
            }

            let mut tokens = quicklink.target.split_whitespace();
            let program = tokens.next().ok_or_else(|| {
                VoltError::Launch("Command quicklink target is empty".into())
            })?;
            let args: Vec<&str> = tokens.collect();

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
