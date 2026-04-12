//! Game icon utilities
//!
//! Utilities for finding and loading game icons from various sources

use std::path::{Path, PathBuf};

/// Try to find an icon file in a game directory
/// Looks for common icon file names and locations
pub fn find_icon_in_directory(game_dir: &Path) -> Option<String> {
    if !game_dir.exists() {
        return None;
    }

    // Common icon file names (in priority order)
    let icon_names = [
        "icon.png", "logo.png", "game.png", "app.png", "icon.ico", "game.ico", "app.ico",
    ];

    // Common icon subdirectories
    let icon_dirs = [
        game_dir.to_path_buf(),
        game_dir.join("Resources"),
        game_dir.join("Content"),
        game_dir.join("Content/UI"),
        game_dir.join("Content/Textures"),
        game_dir.join("Content/Images"),
        game_dir.join("UI"),
        game_dir.join("Textures"),
        game_dir.join("Images"),
        game_dir.join("Assets"),
        game_dir.join("Data"),
    ];

    // Search in each directory for each icon name
    for dir in &icon_dirs {
        if !dir.exists() {
            continue;
        }

        for name in &icon_names {
            let icon_path = dir.join(name);
            if icon_path.exists() {
                // Convert image to base64 data URL
                if let Some(data_url) = image_to_data_url(&icon_path) {
                    return Some(data_url);
                }
            }
        }
    }

    None
}

/// Convert an image file to a base64 data URL
fn image_to_data_url(image_path: &Path) -> Option<String> {
    use std::fs;

    // Read the file
    let data = fs::read(image_path).ok()?;

    // Determine MIME type from extension
    let mime_type = match image_path.extension()?.to_str()? {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        _ => return None,
    };

    // Encode to base64
    let base64_data = base64_encode(&data);

    Some(format!("data:{};base64,{}", mime_type, base64_data))
}

/// Simple base64 encoding
fn base64_encode(data: &[u8]) -> String {
    const BASE64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();

    for chunk in data.chunks(3) {
        let mut buf = [0u8; 3];
        for (i, &byte) in chunk.iter().enumerate() {
            buf[i] = byte;
        }

        result.push(BASE64_CHARS[(buf[0] >> 2) as usize] as char);
        result.push(BASE64_CHARS[(((buf[0] & 0x03) << 4) | (buf[1] >> 4)) as usize] as char);

        if chunk.len() > 1 {
            result.push(BASE64_CHARS[(((buf[1] & 0x0F) << 2) | (buf[2] >> 6)) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(BASE64_CHARS[(buf[2] & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

/// Get Steam icon for a game
/// Tries local cache first, then falls back to Steam CDN URL
pub fn get_steam_cached_icon(steam_path: &Path, app_id: &str) -> Option<String> {
    let cache_dir = steam_path.join("appcache").join("librarycache");

    // First, try local cache if it exists
    if cache_dir.exists() {
        let icon_types = [
            format!("{}_icon.jpg", app_id),
            format!("{}_logo.png", app_id),
            format!("{}_library_600x900.jpg", app_id),
            format!("{}_library_hero.jpg", app_id),
        ];

        for icon_name in &icon_types {
            let icon_path = cache_dir.join(icon_name);
            if icon_path.exists()
                && let Some(data_url) = image_to_data_url(&icon_path)
            {
                return Some(data_url);
            }
        }
    }

    // Fallback to Steam CDN URL (works without downloading)
    // These URLs are publicly accessible and don't require authentication
    Some(format!(
        "https://cdn.akamai.steamstatic.com/steam/apps/{}/header.jpg",
        app_id
    ))
}

/// Try multiple strategies to find a game icon
/// 1. Extract from executable (best quality for EA/Epic games)
/// 2. Look for icon files in game directory
/// 3. Return None if nothing found
pub fn find_game_icon(game_dir: &Path, executable: Option<&PathBuf>) -> Option<String> {
    // Strategy 1: Extract from executable (PRIORITIZED for EA games)
    // This is more reliable than searching for icon files
    if let Some(exe) = executable
        && exe.exists()
        && let Some(icon) = crate::utils::icon::extract_icon(&exe.to_string_lossy())
    {
        return Some(icon);
    }

    // Strategy 2: Look for icon files in directory (fallback)
    if let Some(icon) = find_icon_in_directory(game_dir) {
        return Some(icon);
    }

    None
}
