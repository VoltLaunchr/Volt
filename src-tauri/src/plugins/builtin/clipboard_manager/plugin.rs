use crate::core::traits::Plugin;
use crate::plugins::api::{LogLevel, PluginCapability, VoltPluginAPI};
use arboard::Clipboard;
use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose};
use chrono::Utc;
use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::time::{Duration, interval};

/// Metadata tuple: (word_count, char_count, image_width, image_height, file_size)
type ContentMetadata = (
    Option<u32>,
    Option<u32>,
    Option<u32>,
    Option<u32>,
    Option<u64>,
);

/// Clipboard manager plugin
///
/// Monitors clipboard changes and stores history with search capability.
/// Supports text, images, and files with configurable retention and size limits.
pub struct ClipboardManagerPlugin {
    enabled: bool,
    api: Option<Arc<VoltPluginAPI>>,
    config: ClipboardConfig,
    conn: Arc<Mutex<Option<Connection>>>,
    clipboard: Arc<Mutex<Option<Clipboard>>>,
    last_content_hash: Arc<Mutex<Option<String>>>,
    monitoring: Arc<AtomicBool>,
}

/// Configuration for the clipboard manager
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardConfig {
    /// Maximum number of items to keep in history
    max_items: usize,
    /// Maximum days to retain items (0 = forever)
    max_days: u32,
    /// Maximum size for text items (in characters)
    max_text_size: usize,
    /// Maximum size for images (in bytes, ~5MB default)
    max_image_size: usize,
    /// Auto-filter sensitive data (passwords, credit cards)
    filter_sensitive: bool,
    /// Check interval in milliseconds
    check_interval_ms: u64,
}

impl Default for ClipboardConfig {
    fn default() -> Self {
        Self {
            max_items: 1000,
            max_days: 30,
            max_text_size: 100_000,    // 100k chars
            max_image_size: 5_242_880, // 5MB
            filter_sensitive: true,
            check_interval_ms: 500,
        }
    }
}

/// Type of clipboard content
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardType {
    Text,
    Image,
    Files,
}

/// Clipboard item stored in history
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: i64,
    pub content_type: ClipboardType,
    pub content: String, // Text content or base64 for images
    pub preview: String, // Short preview for display
    pub timestamp: i64,  // Unix timestamp
    pub pinned: bool,
    pub content_hash: String,      // MD5 hash for deduplication
    pub source: Option<String>,    // Source application (if available)
    pub word_count: Option<u32>,   // Word count for text
    pub char_count: Option<u32>,   // Character count for text
    pub image_width: Option<u32>,  // Image width in pixels
    pub image_height: Option<u32>, // Image height in pixels
    pub file_size: Option<u64>,    // File size in bytes
}

impl ClipboardManagerPlugin {
    pub fn new() -> Self {
        Self {
            enabled: true,
            api: None,
            config: ClipboardConfig::default(),
            conn: Arc::new(Mutex::new(None)),
            clipboard: Arc::new(Mutex::new(None)),
            last_content_hash: Arc::new(Mutex::new(None)),
            monitoring: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Set the plugin API
    pub fn with_api(mut self, api: Arc<VoltPluginAPI>) -> Self {
        self.api = Some(api);
        self
    }

    /// Initialize database
    fn init_database(&self, db_path: &PathBuf) -> Result<(), String> {
        let conn =
            Connection::open(db_path).map_err(|e| format!("Failed to open database: {}", e))?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS clipboard_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type TEXT NOT NULL,
                content TEXT NOT NULL,
                preview TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT NOT NULL UNIQUE
            )",
            [],
        )
        .map_err(|e| format!("Failed to create table: {}", e))?;

        // Migrate: Add missing columns if they don't exist
        // SQLite's ALTER TABLE ADD COLUMN is safe - it will error if column exists
        // We ignore the error if column already exists
        let _ = conn.execute("ALTER TABLE clipboard_history ADD COLUMN source TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE clipboard_history ADD COLUMN word_count INTEGER",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE clipboard_history ADD COLUMN char_count INTEGER",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE clipboard_history ADD COLUMN image_width INTEGER",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE clipboard_history ADD COLUMN image_height INTEGER",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE clipboard_history ADD COLUMN file_size INTEGER",
            [],
        );

        // Create index on timestamp for efficient queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_timestamp ON clipboard_history(timestamp DESC)",
            [],
        )
        .map_err(|e| format!("Failed to create index: {}", e))?;

        Ok(())
    }

    /// Calculate hash for content deduplication
    fn calculate_hash(&self, content: &str) -> String {
        crate::utils::hash_id(content)
    }

    /// Add item to clipboard history
    fn add_to_history(&self, content_type: ClipboardType, content: String) -> Result<(), String> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or("Database not initialized")?;

        let content_hash = self.calculate_hash(&content);
        Self::insert_and_cleanup(
            conn,
            content_type,
            &content,
            &content_hash,
            self.config.max_items,
            self.config.max_days,
        )
    }

    /// Get clipboard history
    pub fn get_history(&self, limit: Option<usize>) -> Result<Vec<ClipboardItem>, String> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or("Database not initialized")?;

        let limit = limit.unwrap_or(50);
        let mut stmt = conn
            .prepare(
                "SELECT id, content_type, content, preview, timestamp, pinned, content_hash,
                        source, word_count, char_count, image_width, image_height, file_size
                 FROM clipboard_history
                 ORDER BY pinned DESC, timestamp DESC
                 LIMIT ?1",
            )
            .map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let items = stmt
            .query_map(params![limit], |row| {
                let content_type_str: String = row.get(1)?;
                let content_type = match content_type_str.as_str() {
                    "text" => ClipboardType::Text,
                    "image" => ClipboardType::Image,
                    "files" => ClipboardType::Files,
                    _ => ClipboardType::Text,
                };

                Ok(ClipboardItem {
                    id: row.get(0)?,
                    content_type,
                    content: row.get(2)?,
                    preview: row.get(3)?,
                    timestamp: row.get(4)?,
                    pinned: row.get::<_, i32>(5)? == 1,
                    content_hash: row.get(6)?,
                    source: row.get(7).ok(),
                    word_count: row.get(8).ok(),
                    char_count: row.get(9).ok(),
                    image_width: row.get(10).ok(),
                    image_height: row.get(11).ok(),
                    file_size: row
                        .get::<_, Option<i64>>(12)
                        .ok()
                        .flatten()
                        .map(|s| s as u64),
                })
            })
            .map_err(|e| format!("Failed to query history: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect results: {}", e))?;

        Ok(items)
    }

    /// Search clipboard history
    pub fn search_history(
        &self,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<ClipboardItem>, String> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or("Database not initialized")?;

        let limit = limit.unwrap_or(50);
        let escaped = query.replace('%', "\\%").replace('_', "\\_");
        let search_pattern = format!("%{}%", escaped);

        let mut stmt = conn
            .prepare(
                "SELECT id, content_type, content, preview, timestamp, pinned, content_hash,
                        source, word_count, char_count, image_width, image_height, file_size
                 FROM clipboard_history
                 WHERE content LIKE ?1 ESCAPE '\\' OR preview LIKE ?1 ESCAPE '\\'
                 ORDER BY pinned DESC, timestamp DESC
                 LIMIT ?2",
            )
            .map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let items = stmt
            .query_map(params![search_pattern, limit], |row| {
                let content_type_str: String = row.get(1)?;
                let content_type = match content_type_str.as_str() {
                    "text" => ClipboardType::Text,
                    "image" => ClipboardType::Image,
                    "files" => ClipboardType::Files,
                    _ => ClipboardType::Text,
                };

                Ok(ClipboardItem {
                    id: row.get(0)?,
                    content_type,
                    content: row.get(2)?,
                    preview: row.get(3)?,
                    timestamp: row.get(4)?,
                    pinned: row.get::<_, i32>(5)? == 1,
                    content_hash: row.get(6)?,
                    source: row.get(7).ok(),
                    word_count: row.get(8).ok(),
                    char_count: row.get(9).ok(),
                    image_width: row.get(10).ok(),
                    image_height: row.get(11).ok(),
                    file_size: row
                        .get::<_, Option<i64>>(12)
                        .ok()
                        .flatten()
                        .map(|s| s as u64),
                })
            })
            .map_err(|e| format!("Failed to search history: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect results: {}", e))?;

        Ok(items)
    }

    /// Pin/unpin clipboard item
    pub fn toggle_pin(&self, id: i64) -> Result<(), String> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or("Database not initialized")?;

        conn.execute(
            "UPDATE clipboard_history SET pinned = NOT pinned WHERE id = ?1",
            params![id],
        )
        .map_err(|e| format!("Failed to toggle pin: {}", e))?;

        Ok(())
    }

    /// Delete clipboard item
    pub fn delete_item(&self, id: i64) -> Result<(), String> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or("Database not initialized")?;

        conn.execute("DELETE FROM clipboard_history WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete item: {}", e))?;

        Ok(())
    }

    /// Clear all clipboard history (except pinned items)
    pub fn clear_history(&self, include_pinned: bool) -> Result<(), String> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or("Database not initialized")?;

        if include_pinned {
            conn.execute("DELETE FROM clipboard_history", [])
                .map_err(|e| format!("Failed to clear history: {}", e))?;
        } else {
            conn.execute("DELETE FROM clipboard_history WHERE pinned = 0", [])
                .map_err(|e| format!("Failed to clear history: {}", e))?;
        }

        Ok(())
    }

    /// Copy content to clipboard
    ///
    /// # Arguments
    /// * `content` - Content to copy to clipboard
    pub fn copy_content(&self, content: String) -> Result<(), String> {
        let mut clipboard_guard = self.clipboard.lock().unwrap();
        let clipboard = clipboard_guard
            .as_mut()
            .ok_or("Clipboard not initialized")?;

        clipboard
            .set_text(&content)
            .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;

        Ok(())
    }

    /// Check clipboard and update history if changed
    pub fn check_clipboard(&self) -> Result<(), String> {
        let mut clipboard_guard = self.clipboard.lock().unwrap();
        let clipboard = clipboard_guard
            .as_mut()
            .ok_or("Clipboard not initialized")?;

        // Try to read image first (higher priority to avoid text representation of image path)
        if let Ok(image_data) = clipboard.get_image() {
            // Convert image to PNG bytes using image crate (more reliable)
            let width = image_data.width;
            let height = image_data.height;

            // Create an image buffer from the raw bytes
            let img_result =
                image::RgbaImage::from_raw(width as u32, height as u32, image_data.bytes.to_vec());

            if let Some(img) = img_result {
                // Encode to PNG
                let mut png_bytes = Vec::new();
                if img
                    .write_to(
                        &mut std::io::Cursor::new(&mut png_bytes),
                        image::ImageFormat::Png,
                    )
                    .is_ok()
                {
                    // Check size limit
                    if png_bytes.len() > self.config.max_image_size {
                        return Ok(());
                    }

                    // Convert to base64
                    let base64_content = general_purpose::STANDARD.encode(&png_bytes);

                    // Check if content has changed
                    let current_hash = self.calculate_hash(&base64_content);
                    let mut last_hash_guard = self.last_content_hash.lock().unwrap();

                    if let Some(last_hash) = last_hash_guard.as_ref()
                        && last_hash == &current_hash
                    {
                        return Ok(()); // No change
                    }

                    // Update last hash
                    *last_hash_guard = Some(current_hash.clone());
                    drop(last_hash_guard);

                    // Add to history
                    self.add_to_history(ClipboardType::Image, base64_content)?;
                    return Ok(());
                }
            }
        }

        // Try to read text if no image
        if let Ok(text) = clipboard.get_text() {
            // Skip if too long
            if text.len() > self.config.max_text_size {
                return Ok(());
            }

            // Skip if sensitive
            if self.config.filter_sensitive && Self::is_sensitive_text(&text) {
                return Ok(());
            }

            // Check if content has changed
            let current_hash = self.calculate_hash(&text);
            let mut last_hash_guard = self.last_content_hash.lock().unwrap();

            if let Some(last_hash) = last_hash_guard.as_ref()
                && last_hash == &current_hash
            {
                return Ok(()); // No change
            }

            // Update last hash
            *last_hash_guard = Some(current_hash.clone());
            drop(last_hash_guard);

            // Add to history
            self.add_to_history(ClipboardType::Text, text)?;
        }

        Ok(())
    }

    /// Check if monitoring is active
    pub fn is_monitoring(&self) -> bool {
        self.monitoring.load(Ordering::Relaxed)
    }

    /// Start monitoring clipboard in background
    pub fn start_monitoring(&self) -> Result<(), String> {
        // Atomically check and set to prevent duplicate task spawns
        if self
            .monitoring
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(()); // Already monitoring
        }

        if let Some(api) = &self.api {
            api.log(
                self.id(),
                LogLevel::Info,
                "Starting clipboard monitoring...",
            );
        }

        // Clone Arc references for the async task
        let conn = self.conn.clone();
        let clipboard = self.clipboard.clone();
        let last_content_hash = self.last_content_hash.clone();
        let monitoring = self.monitoring.clone();
        let check_interval_ms = self.config.check_interval_ms;
        let max_text_size = self.config.max_text_size;
        let filter_sensitive = self.config.filter_sensitive;
        let api = self.api.clone();
        let plugin_id = self.id().to_string();

        // Clone additional config values for image monitoring
        let max_image_size = self.config.max_image_size;
        let max_items = self.config.max_items;
        let max_days = self.config.max_days;

        // Spawn background monitoring task
        tokio::spawn(async move {
            let mut interval_timer = interval(Duration::from_millis(check_interval_ms));

            while monitoring.load(Ordering::Relaxed) {
                interval_timer.tick().await;

                // Check clipboard
                let mut image_processed = false;

                // Try to read image first (higher priority)
                {
                    let mut clipboard_guard = clipboard.lock().unwrap();
                    if let Some(cb) = clipboard_guard.as_mut()
                        && let Ok(image_data) = cb.get_image()
                    {
                        let width = image_data.width;
                        let height = image_data.height;

                        // Create an image buffer from the raw bytes
                        if let Some(img) = image::RgbaImage::from_raw(
                            width as u32,
                            height as u32,
                            image_data.bytes.to_vec(),
                        ) {
                            // Encode to PNG
                            let mut png_bytes = Vec::new();
                            if img
                                .write_to(
                                    &mut std::io::Cursor::new(&mut png_bytes),
                                    image::ImageFormat::Png,
                                )
                                .is_ok()
                            {
                                // Check size limit
                                if png_bytes.len() <= max_image_size {
                                    // Convert to base64
                                    let base64_content =
                                        general_purpose::STANDARD.encode(&png_bytes);
                                    let current_hash = crate::utils::hash_id(&base64_content);

                                    let mut last_hash_guard = last_content_hash.lock().unwrap();
                                    let should_add =
                                        if let Some(last_hash) = last_hash_guard.as_ref() {
                                            last_hash != &current_hash
                                        } else {
                                            true
                                        };

                                    if should_add {
                                        *last_hash_guard = Some(current_hash.clone());
                                        drop(last_hash_guard);
                                        drop(clipboard_guard);

                                        // Add to database
                                        if let Err(e) = Self::add_to_db_static(
                                            &conn,
                                            ClipboardType::Image,
                                            base64_content,
                                            current_hash,
                                            max_items,
                                            max_days,
                                        ) && let Some(api) = &api
                                        {
                                            api.log(
                                                &plugin_id,
                                                LogLevel::Error,
                                                &format!("Failed to add clipboard image: {}", e),
                                            );
                                        }
                                        image_processed = true;
                                    }
                                }
                            }
                        }
                    }
                }

                // Only check text if no image was processed
                if !image_processed {
                    let mut clipboard_guard = clipboard.lock().unwrap();
                    if let Some(cb) = clipboard_guard.as_mut()
                        && let Ok(text) = cb.get_text()
                    {
                        // Skip if too long
                        if text.len() > max_text_size {
                            continue;
                        }

                        // Skip if sensitive
                        if filter_sensitive && Self::is_sensitive_text(&text) {
                            continue;
                        }

                        // Check if content has changed
                        let current_hash = crate::utils::hash_id(&text);
                        let mut last_hash_guard = last_content_hash.lock().unwrap();

                        let should_add = if let Some(last_hash) = last_hash_guard.as_ref() {
                            last_hash != &current_hash
                        } else {
                            true
                        };

                        if should_add {
                            *last_hash_guard = Some(current_hash.clone());
                            drop(last_hash_guard);
                            drop(clipboard_guard);

                            // Add to database
                            if let Err(e) = Self::add_to_db_static(
                                &conn,
                                ClipboardType::Text,
                                text,
                                current_hash,
                                max_items,
                                max_days,
                            ) && let Some(api) = &api
                            {
                                api.log(
                                    &plugin_id,
                                    LogLevel::Error,
                                    &format!("Failed to add clipboard item: {}", e),
                                );
                            }
                        }
                    }
                }
            }

            if let Some(api) = &api {
                api.log(&plugin_id, LogLevel::Info, "Clipboard monitoring stopped");
            }
        });

        Ok(())
    }

    /// Stop monitoring clipboard
    pub fn stop_monitoring(&self) -> Result<(), String> {
        self.monitoring.store(false, Ordering::Relaxed);

        if let Some(api) = &self.api {
            api.log(
                self.id(),
                LogLevel::Info,
                "Stopping clipboard monitoring...",
            );
        }

        Ok(())
    }

    /// Static helper to check if text is sensitive
    fn is_sensitive_text(text: &str) -> bool {
        let text_lower = text.to_lowercase();

        // Common password patterns
        if text_lower.contains("password")
            || text_lower.contains("passwd")
            || text_lower.contains("secret")
        {
            return true;
        }

        // Credit card pattern (basic check)
        let digits_only: String = text.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits_only.len() >= 13 && digits_only.len() <= 19 {
            return true;
        }

        false
    }

    /// Static helper to calculate metadata
    fn calculate_metadata_static(content_type: &ClipboardType, content: &str) -> ContentMetadata {
        match content_type {
            ClipboardType::Text => {
                let char_count = content.chars().count() as u32;
                let word_count = content.split_whitespace().count() as u32;
                (
                    Some(word_count),
                    Some(char_count),
                    None,
                    None,
                    Some(content.len() as u64),
                )
            }
            ClipboardType::Image => {
                if let Ok(image_data) = general_purpose::STANDARD.decode(content)
                    && let Ok(img) = image::load_from_memory(&image_data)
                {
                    let (width, height) = (img.width(), img.height());
                    return (
                        None,
                        None,
                        Some(width),
                        Some(height),
                        Some(image_data.len() as u64),
                    );
                }
                (None, None, None, None, Some(content.len() as u64))
            }
            ClipboardType::Files => (None, None, None, None, Some(content.len() as u64)),
        }
    }

    /// Static helper to add item to database (for use in async context)
    fn add_to_db_static(
        conn: &Arc<Mutex<Option<Connection>>>,
        content_type: ClipboardType,
        content: String,
        content_hash: String,
        max_items: usize,
        max_days: u32,
    ) -> Result<(), String> {
        let conn_guard = conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or("Database not initialized")?;

        Self::insert_and_cleanup(
            conn,
            content_type,
            &content,
            &content_hash,
            max_items,
            max_days,
        )
    }

    /// Insert an item and run retention cleanup. Caller supplies the connection
    /// so pooling can be added later without changing the call sites.
    fn insert_and_cleanup(
        conn: &Connection,
        content_type: ClipboardType,
        content: &str,
        content_hash: &str,
        max_items: usize,
        max_days: u32,
    ) -> Result<(), String> {
        let preview = Self::generate_preview_static(content, &content_type);
        let timestamp = Utc::now().timestamp();

        let (word_count, char_count, image_width, image_height, file_size) =
            Self::calculate_metadata_static(&content_type, content);

        conn.execute(
            "INSERT OR IGNORE INTO clipboard_history
             (content_type, content, preview, timestamp, pinned, content_hash,
              source, word_count, char_count, image_width, image_height, file_size)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, NULL, ?6, ?7, ?8, ?9, ?10)",
            params![
                match content_type {
                    ClipboardType::Text => "text",
                    ClipboardType::Image => "image",
                    ClipboardType::Files => "files",
                },
                content,
                preview,
                timestamp,
                content_hash,
                word_count,
                char_count,
                image_width,
                image_height,
                file_size.map(|s| s as i64),
            ],
        )
        .map_err(|e| format!("Failed to insert: {}", e))?;

        conn.execute(
            "DELETE FROM clipboard_history
             WHERE id NOT IN (
                SELECT id FROM clipboard_history
                WHERE pinned = 1
                UNION
                SELECT id FROM (
                    SELECT id FROM clipboard_history
                    ORDER BY timestamp DESC
                    LIMIT ?1
                )
             )",
            params![max_items],
        )
        .map_err(|e| format!("Failed to cleanup: {}", e))?;

        if max_days > 0 {
            let cutoff_timestamp = Utc::now().timestamp() - (max_days as i64 * 86400);
            conn.execute(
                "DELETE FROM clipboard_history
                 WHERE timestamp < ?1 AND pinned = 0",
                params![cutoff_timestamp],
            )
            .map_err(|e| format!("Failed to cleanup old items: {}", e))?;
        }

        Ok(())
    }

    /// Static helper to generate preview
    fn generate_preview_static(content: &str, content_type: &ClipboardType) -> String {
        match content_type {
            ClipboardType::Text => {
                let first_line = content.lines().next().unwrap_or("");
                let mut chars = first_line.chars();
                let preview: String = chars.by_ref().take(100).collect();
                let has_more = chars.next().is_some() || content.lines().nth(1).is_some();
                if has_more {
                    format!("{}...", preview)
                } else {
                    preview
                }
            }
            ClipboardType::Image => {
                let now = chrono::Local::now();
                format!("Image ({})", now.format("%d/%m/%Y %H:%M:%S"))
            }
            ClipboardType::Files => "[Files]".to_string(),
        }
    }

    /// Load configuration from file
    async fn load_config(&mut self) -> Result<(), String> {
        if let Some(api) = &self.api {
            match api.load_config(self.id(), "settings") {
                Ok(config_value) => {
                    self.config = serde_json::from_value(config_value)
                        .unwrap_or_else(|_| ClipboardConfig::default());
                    api.log(
                        self.id(),
                        LogLevel::Info,
                        "Configuration loaded successfully",
                    );
                }
                Err(_) => {
                    api.log(self.id(), LogLevel::Warn, "No config found, using defaults");
                }
            }
        }
        Ok(())
    }

    /// Save configuration to file
    async fn save_config(&self) -> Result<(), String> {
        if let Some(api) = &self.api {
            let config_value = serde_json::to_value(&self.config)
                .map_err(|e| format!("Failed to serialize config: {}", e))?;

            api.save_config(self.id(), "settings", &config_value)?;
            api.log(
                self.id(),
                LogLevel::Info,
                "Configuration saved successfully",
            );
        }
        Ok(())
    }
}

impl Default for ClipboardManagerPlugin {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Plugin for ClipboardManagerPlugin {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "clipboard_manager"
    }

    fn name(&self) -> &str {
        "Clipboard Manager"
    }

    fn description(&self) -> &str {
        "Manages clipboard history with search, pin, and smart filtering"
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn required_capabilities(&self) -> Vec<PluginCapability> {
        vec![PluginCapability::FileSystem, PluginCapability::SystemInfo]
    }

    async fn initialize(&mut self) -> Result<(), String> {
        let has_api = self.api.is_some();

        if has_api {
            if let Some(api) = &self.api {
                api.log(
                    self.id(),
                    LogLevel::Info,
                    "Initializing Clipboard Manager plugin...",
                );

                // Create plugin directories
                let data_dir = api.get_plugin_data_dir(self.id())?;
                let _ = api.get_plugin_cache_dir(self.id())?;

                // Initialize database (short-lived connection for schema + migrations)
                let db_path = data_dir.join("clipboard.db");
                self.init_database(&db_path)?;

                // Open the long-lived reused connection
                let conn = Connection::open(&db_path)
                    .map_err(|e| format!("Failed to open database: {}", e))?;
                *self.conn.lock().unwrap() = Some(conn);

                // Initialize clipboard
                let clipboard = Clipboard::new()
                    .map_err(|e| format!("Failed to initialize clipboard: {}", e))?;
                *self.clipboard.lock().unwrap() = Some(clipboard);
            }

            // Load configuration
            self.load_config().await?;

            if let Some(api) = &self.api {
                api.log(
                    self.id(),
                    LogLevel::Info,
                    &format!(
                        "Clipboard Manager initialized (max items: {}, max days: {})",
                        self.config.max_items, self.config.max_days
                    ),
                );
            }
        }

        Ok(())
    }

    async fn shutdown(&mut self) -> Result<(), String> {
        if let Some(api) = &self.api {
            api.log(
                self.id(),
                LogLevel::Info,
                "Shutting down Clipboard Manager plugin...",
            );

            // Save configuration
            self.save_config().await?;

            api.log(self.id(), LogLevel::Info, "Clipboard Manager shut down");
        }

        Ok(())
    }
}
