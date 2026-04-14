//! Snippet management commands
//!
//! CRUD operations for text expansion snippets with variable support.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

use crate::core::error::{VoltError, VoltResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub trigger: String,
    pub content: String,
    pub category: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// State wrapper for snippet storage
pub struct SnippetState {
    snippets: Mutex<HashMap<String, Snippet>>,
    file_path: PathBuf,
}

impl SnippetState {
    pub fn new(data_dir: PathBuf) -> Self {
        let file_path = data_dir.join("snippets.json");
        let snippets = Self::load_from_file(&file_path).unwrap_or_default();
        Self {
            snippets: Mutex::new(snippets),
            file_path,
        }
    }

    fn load_from_file(path: &PathBuf) -> Option<HashMap<String, Snippet>> {
        if !path.exists() {
            return None;
        }
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn save(&self) -> Result<(), String> {
        let snippets = self.snippets.lock().map_err(|e| e.to_string())?;
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&*snippets).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, json).map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn resolve_variables(content: &str, clipboard: Option<&str>) -> String {
    let now = chrono::Local::now();
    let mut result = content.to_string();

    result = result.replace("{date}", &now.format("%Y-%m-%d").to_string());
    result = result.replace("{time}", &now.format("%H:%M:%S").to_string());
    result = result.replace(
        "{datetime}",
        &now.format("%Y-%m-%d %H:%M:%S").to_string(),
    );
    result = result.replace("{random}", &Uuid::new_v4().to_string());

    if let Some(clip) = clipboard {
        result = result.replace("{clipboard}", clip);
    } else {
        result = result.replace("{clipboard}", "");
    }

    result
}

/// Get all snippets
#[tauri::command]
pub async fn get_snippets(state: State<'_, SnippetState>) -> VoltResult<Vec<Snippet>> {
    let snippets = state
        .snippets
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?;
    let mut list: Vec<Snippet> = snippets.values().cloned().collect();
    list.sort_by(|a, b| a.trigger.cmp(&b.trigger));
    Ok(list)
}

/// Create a new snippet
#[tauri::command]
pub async fn create_snippet(
    state: State<'_, SnippetState>,
    trigger: String,
    content: String,
    category: Option<String>,
    description: Option<String>,
) -> VoltResult<Snippet> {
    let now = now_millis();
    let snippet = Snippet {
        id: Uuid::new_v4().to_string(),
        trigger,
        content,
        category,
        description,
        enabled: true,
        created_at: now,
        updated_at: now,
    };

    {
        let mut snippets = state
            .snippets
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        snippets.insert(snippet.id.clone(), snippet.clone());
    }

    state.save().map_err(VoltError::Unknown)?;
    Ok(snippet)
}

/// Update an existing snippet
#[tauri::command]
pub async fn update_snippet(
    state: State<'_, SnippetState>,
    id: String,
    trigger: Option<String>,
    content: Option<String>,
    category: Option<String>,
    description: Option<String>,
    enabled: Option<bool>,
) -> VoltResult<Snippet> {
    let updated = {
        let mut snippets = state
            .snippets
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;

        let snippet = snippets
            .get_mut(&id)
            .ok_or_else(|| VoltError::NotFound(format!("Snippet not found: {}", id)))?;

        if let Some(t) = trigger {
            snippet.trigger = t;
        }
        if let Some(c) = content {
            snippet.content = c;
        }
        if let Some(cat) = category {
            snippet.category = Some(cat);
        }
        if let Some(d) = description {
            snippet.description = Some(d);
        }
        if let Some(e) = enabled {
            snippet.enabled = e;
        }
        snippet.updated_at = now_millis();
        snippet.clone()
    };

    state.save().map_err(VoltError::Unknown)?;
    Ok(updated)
}

/// Delete a snippet
#[tauri::command]
pub async fn delete_snippet(state: State<'_, SnippetState>, id: String) -> VoltResult<()> {
    {
        let mut snippets = state
            .snippets
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        snippets
            .remove(&id)
            .ok_or_else(|| VoltError::NotFound(format!("Snippet not found: {}", id)))?;
    }

    state.save().map_err(VoltError::Unknown)?;
    Ok(())
}

/// Expand a snippet trigger, resolving variables
#[tauri::command]
pub async fn expand_snippet(
    state: State<'_, SnippetState>,
    trigger: String,
    clipboard: Option<String>,
) -> VoltResult<Option<String>> {
    let snippets = state
        .snippets
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?;

    let snippet = snippets
        .values()
        .find(|s| s.enabled && s.trigger == trigger);

    Ok(snippet.map(|s| resolve_variables(&s.content, clipboard.as_deref())))
}

/// Import snippets from JSON string
#[tauri::command]
pub async fn import_snippets(
    state: State<'_, SnippetState>,
    json: String,
) -> VoltResult<usize> {
    let imported: Vec<Snippet> =
        serde_json::from_str(&json).map_err(|e| VoltError::Unknown(e.to_string()))?;

    let count = imported.len();
    {
        let mut snippets = state
            .snippets
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;

        for mut snippet in imported {
            // Generate new ID to avoid conflicts
            snippet.id = Uuid::new_v4().to_string();
            snippet.updated_at = now_millis();
            snippets.insert(snippet.id.clone(), snippet);
        }
    }

    state.save().map_err(VoltError::Unknown)?;
    Ok(count)
}

/// Export all snippets as JSON string
#[tauri::command]
pub async fn export_snippets(state: State<'_, SnippetState>) -> VoltResult<String> {
    let snippets = state
        .snippets
        .lock()
        .map_err(|e| VoltError::Unknown(e.to_string()))?;

    let list: Vec<&Snippet> = snippets.values().collect();
    serde_json::to_string_pretty(&list).map_err(|e| VoltError::Unknown(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_variables_date() {
        let result = resolve_variables("Today is {date}", None);
        assert!(result.starts_with("Today is 20"));
        assert!(!result.contains("{date}"));
    }

    #[test]
    fn test_resolve_variables_clipboard() {
        let result = resolve_variables("Pasted: {clipboard}", Some("hello"));
        assert_eq!(result, "Pasted: hello");
    }

    #[test]
    fn test_resolve_variables_random() {
        let result = resolve_variables("{random}", None);
        assert!(!result.contains("{random}"));
        assert!(result.len() == 36); // UUID format
    }

    #[test]
    fn test_resolve_variables_multiple() {
        let result = resolve_variables("{date} at {time}", None);
        assert!(!result.contains("{date}"));
        assert!(!result.contains("{time}"));
    }

    #[test]
    fn test_resolve_no_variables() {
        let result = resolve_variables("plain text", None);
        assert_eq!(result, "plain text");
    }
}
