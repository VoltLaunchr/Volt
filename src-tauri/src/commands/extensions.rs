//! Extension management commands
//!
//! This module provides Tauri commands for managing Volt extensions:
//! - Fetching the extension registry from GitHub
//! - Installing/uninstalling extensions
//! - Enabling/disabling extensions
//! - Checking for updates

use crate::core::error::{VoltError, VoltResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tracing::{debug, info, warn};

use crate::utils::extension_state_sig;

/// Reject paths that escape `root` (via `..` or symlink resolution).
/// Returns the canonical path on success.
fn ensure_contained(path: &Path, root: &Path) -> VoltResult<PathBuf> {
    let canonical = path.canonicalize().map_err(|e| {
        VoltError::FileSystem(format!(
            "Failed to canonicalise '{}': {}",
            path.display(),
            e
        ))
    })?;
    let canonical_root = root.canonicalize().map_err(|e| {
        VoltError::FileSystem(format!(
            "Failed to canonicalise root '{}': {}",
            root.display(),
            e
        ))
    })?;
    if !canonical.starts_with(&canonical_root) {
        return Err(VoltError::InvalidConfig(format!(
            "Path '{}' escapes containment root '{}'",
            canonical.display(),
            canonical_root.display()
        )));
    }
    Ok(canonical)
}

/// Directory names under `$HOME` that hold credentials / infrastructure secrets
/// and must never be accepted as dev-extension roots.
const DEV_EXTENSION_FORBIDDEN_DIRS: &[&str] = &[
    ".ssh", ".aws", ".config", ".gnupg", ".docker", ".kube", ".azure", ".netrc",
];

/// Directory names that are legitimate on disk but dangerous to accept as
/// dev-extension roots — they are typical attacker drop locations. We warn
/// rather than reject so developers using non-standard layouts aren't
/// locked out, but the warning lands in both the user-visible return value
/// and the log.
const DEV_EXTENSION_SUSPICIOUS_DIRS: &[&str] = &["downloads", "desktop", "temp", "tmp", "tempo"];

/// Extension author information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionAuthor {
    pub name: String,
    pub github: Option<String>,
    pub email: Option<String>,
}

/// Extension manifest (metadata)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: ExtensionAuthor,
    pub icon: Option<String>,
    pub keywords: Option<Vec<String>>,
    #[serde(default)]
    pub prefix: Option<String>,
    pub category: Option<String>,
    pub repository: Option<String>,
    pub homepage: Option<String>,
    pub license: Option<String>,
    pub min_volt_version: Option<String>,
    pub permissions: Option<Vec<String>>,
    /// Entry point file for the extension (e.g., "index.js" or "src/plugin.ts")
    pub main: Option<String>,
}

/// Extension info from the registry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    pub manifest: ExtensionManifest,
    pub download_url: String,
    pub downloads: u64,
    pub stars: u64,
    pub verified: bool,
    pub featured: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Installed extension info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    pub manifest: ExtensionManifest,
    pub installed_at: String,
    pub enabled: bool,
    pub path: String,
    #[serde(default)]
    pub granted_permissions: Vec<String>,
}

/// Extension registry from GitHub
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRegistry {
    pub version: String,
    pub last_updated: String,
    pub extensions: Vec<ExtensionInfo>,
}

/// State for installed extensions
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtensionsState {
    pub extensions: Vec<InstalledExtension>,
}

/// Validate extension ID to prevent path traversal attacks
fn validate_extension_id(id: &str) -> VoltResult<()> {
    if id.is_empty() {
        return Err(VoltError::InvalidConfig(
            "Extension ID cannot be empty".to_string(),
        ));
    }
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err(VoltError::InvalidConfig(
            "Invalid extension ID: contains forbidden path characters".to_string(),
        ));
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(VoltError::InvalidConfig(
            "Invalid extension ID: only alphanumeric, dash, underscore, and dot allowed"
                .to_string(),
        ));
    }
    if id.len() > 128 {
        return Err(VoltError::InvalidConfig(
            "Extension ID too long (max 128 characters)".to_string(),
        ));
    }
    Ok(())
}

/// Check if host is in the 172.16.0.0/12 private range (172.16.x.x - 172.31.x.x)
fn is_private_172(host: &str) -> bool {
    if let Some(rest) = host.strip_prefix("172.")
        && let Some(second_octet_str) = rest.split('.').next()
        && let Ok(second_octet) = second_octet_str.parse::<u8>()
    {
        return (16..=31).contains(&second_octet);
    }
    false
}

/// Validate download URL to ensure it's a safe HTTPS URL
fn validate_download_url(url: &str) -> VoltResult<()> {
    if url.is_empty() {
        return Err(VoltError::InvalidConfig(
            "Download URL cannot be empty".to_string(),
        ));
    }

    // Parse and validate URL
    let parsed = url::Url::parse(url)
        .map_err(|_| VoltError::InvalidConfig("Invalid URL format".to_string()))?;

    // Only allow HTTPS
    if parsed.scheme() != "https" {
        return Err(VoltError::InvalidConfig(
            "Only HTTPS URLs are allowed for security".to_string(),
        ));
    }

    // Block localhost, private IPs, and link-local addresses
    if let Some(host) = parsed.host_str() {
        let host_lower = host.to_lowercase();
        if host_lower == "localhost"
            || host_lower == "127.0.0.1"
            || host_lower == "0.0.0.0"
            || host_lower == "[::1]"
            || host_lower == "::1"
            || host_lower.starts_with("192.168.")
            || host_lower.starts_with("10.")
            || host_lower.starts_with("169.254.")
            || is_private_172(host_lower.as_str())
            || host_lower.starts_with("fc")
            || host_lower.starts_with("fd")
        {
            return Err(VoltError::InvalidConfig(
                "Downloads from local/private addresses are not allowed".to_string(),
            ));
        }
    } else {
        return Err(VoltError::InvalidConfig(
            "URL must have a valid host".to_string(),
        ));
    }

    Ok(())
}

/// Extract a ZIP archive into `dest_dir`. Uses `enclosed_name()` to block
/// path-traversal entries (e.g. `../evil.js`).
fn extract_zip(bytes: &[u8], dest_dir: &Path) -> VoltResult<()> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read zip archive: {}", e)))?;

    debug!("ZIP archive contains {} entries", archive.len());

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| VoltError::FileSystem(format!("Failed to read archive entry: {}", e)))?;

        let file_path = match file.enclosed_name() {
            Some(path) => path.to_owned(),
            None => {
                warn!("Skipping invalid path in archive: {:?}", file.name());
                continue;
            }
        };

        // Reject symlink entries — they could point outside dest_dir after extraction.
        // `zip` crate exposes symlinks via `Mode::from_bits` on the unix mode; the
        // simplest defense is to refuse any entry that isn't a regular file or dir.
        if file.is_symlink() {
            warn!("Skipping symlink entry in zip: {:?}", file_path);
            continue;
        }

        let outpath = dest_dir.join(&file_path);

        if file.is_dir() {
            fs::create_dir_all(&outpath)
                .map_err(|e| VoltError::FileSystem(format!("Failed to create directory: {}", e)))?;
            // Defense-in-depth: verify the directory we just created is still
            // inside dest_dir (catches any residual traversal via weird zip paths).
            if ensure_contained(&outpath, dest_dir).is_err() {
                warn!(
                    "Created directory escaped dest_dir, will be ignored: {:?}",
                    outpath
                );
            }
        } else {
            if let Some(parent) = outpath.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent).map_err(|e| {
                        VoltError::FileSystem(format!("Failed to create parent directory: {}", e))
                    })?;
                }
                // Now that the parent exists, canonicalise and verify it is
                // still within dest_dir before writing.
                if ensure_contained(parent, dest_dir).is_err() {
                    warn!("Skipping file whose parent escapes dest_dir: {:?}", outpath);
                    continue;
                }
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| {
                VoltError::FileSystem(format!(
                    "Failed to create file {}: {}",
                    outpath.display(),
                    e
                ))
            })?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| VoltError::FileSystem(format!("Failed to extract file: {}", e)))?;
        }
    }
    Ok(())
}

/// Extract a gzipped tar archive into `dest_dir`. Reject any entry whose
/// resolved path escapes `dest_dir` (path traversal guard).
fn extract_tar_gz(bytes: &[u8], dest_dir: &Path) -> VoltResult<()> {
    let gz = flate2::read::GzDecoder::new(std::io::Cursor::new(bytes));
    let mut archive = tar::Archive::new(gz);

    // `set_overwrite(true)` so re-installs replace existing files cleanly.
    archive.set_overwrite(true);
    // We resolve paths ourselves to stay safe on symlink entries.
    archive.set_preserve_permissions(false);

    for entry in archive
        .entries()
        .map_err(|e| VoltError::FileSystem(format!("Failed to read tar archive: {}", e)))?
    {
        let mut entry =
            entry.map_err(|e| VoltError::FileSystem(format!("Failed to read tar entry: {}", e)))?;

        let entry_path = entry
            .path()
            .map_err(|e| VoltError::FileSystem(format!("Invalid tar entry path: {}", e)))?
            .into_owned();

        // Reject symlinks and hardlinks — they could point outside dest_dir.
        let entry_type = entry.header().entry_type();
        if entry_type == tar::EntryType::Symlink || entry_type == tar::EntryType::Link {
            warn!("Skipping symlink/hardlink tar entry: {:?}", entry_path);
            continue;
        }

        // Reject absolute paths and parent-directory components.
        if entry_path.is_absolute()
            || entry_path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            warn!("Skipping unsafe tar entry: {:?}", entry_path);
            continue;
        }

        let outpath = dest_dir.join(&entry_path);
        entry
            .unpack(&outpath)
            .map_err(|e| VoltError::FileSystem(format!("Failed to unpack tar entry: {}", e)))?;
    }

    Ok(())
}

/// If the extension dir contains exactly one subdirectory (and nothing else),
/// move that subdirectory's contents up one level. Some tarballs wrap
/// everything in a top-level directory (e.g. `plugin-name/manifest.json`).
fn flatten_single_root_dir(extension_dir: &PathBuf) -> VoltResult<()> {
    let entries: Vec<_> = fs::read_dir(extension_dir)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read extension dir: {}", e)))?
        .flatten()
        .collect();

    if entries.len() != 1 || !entries[0].path().is_dir() {
        return Ok(());
    }

    let inner = entries[0].path();
    debug!("Flattening single root dir: {:?}", inner);

    for entry in fs::read_dir(&inner)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read inner dir: {}", e)))?
        .flatten()
    {
        let src = entry.path();
        let dst = extension_dir.join(entry.file_name());
        fs::rename(&src, &dst).map_err(|e| {
            VoltError::FileSystem(format!(
                "Failed to promote {} to extension root: {}",
                src.display(),
                e
            ))
        })?;
    }

    let _ = fs::remove_dir(&inner);
    Ok(())
}

/// Get the extensions directory path
fn get_extensions_dir(app: &AppHandle) -> VoltResult<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| VoltError::FileSystem(format!("Failed to get app data dir: {}", e)))?;
    let extensions_dir = data_dir.join("extensions");

    // Create directory if it doesn't exist
    if !extensions_dir.exists() {
        fs::create_dir_all(&extensions_dir).map_err(|e| {
            VoltError::FileSystem(format!("Failed to create extensions directory: {}", e))
        })?;
    }

    Ok(extensions_dir)
}

/// Get the path to the installed extensions state file
fn get_installed_state_path(app: &AppHandle) -> VoltResult<PathBuf> {
    let extensions_dir = get_extensions_dir(app)?;
    Ok(extensions_dir.join("installed.json"))
}

/// Load installed extensions state from disk.
///
/// Also verifies the detached HMAC signature (`installed.json.sig`). A
/// missing or mismatching signature is logged but never causes load failure
/// — see `extension_state_sig` for the rationale.
fn load_installed_state(app: &AppHandle) -> VoltResult<InstalledExtensionsState> {
    let state_path = get_installed_state_path(app)?;

    let content = extension_state_sig::read_state_with_verification(&state_path, "installed")
        .map_err(|e| VoltError::FileSystem(format!("Failed to read installed state: {}", e)))?;

    let Some(content) = content else {
        return Ok(InstalledExtensionsState::default());
    };

    serde_json::from_str(&content)
        .map_err(|e| VoltError::Serialization(format!("Failed to parse installed state: {}", e)))
}

/// Save installed extensions state to disk, along with the HMAC signature.
fn save_installed_state(app: &AppHandle, state: &InstalledExtensionsState) -> VoltResult<()> {
    let state_path = get_installed_state_path(app)?;

    let content = serde_json::to_string_pretty(state).map_err(|e| {
        VoltError::Serialization(format!("Failed to serialize installed state: {}", e))
    })?;

    extension_state_sig::write_state_with_signature(&state_path, &content)
        .map_err(|e| VoltError::FileSystem(format!("Failed to write installed state: {}", e)))?;

    Ok(())
}

/// Allowed hosts for extension registry fetches (prevents SSRF)
const ALLOWED_REGISTRY_HOSTS: &[&str] = &[
    "github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "api.github.com",
];

/// Validate that a registry URL points to an allowed host
fn validate_registry_url(url: &str) -> VoltResult<()> {
    let parsed = url::Url::parse(url)
        .map_err(|_| VoltError::InvalidConfig("Invalid registry URL format".to_string()))?;

    if parsed.scheme() != "https" {
        return Err(VoltError::InvalidConfig(
            "Only HTTPS registry URLs are allowed".to_string(),
        ));
    }

    match parsed.host_str() {
        Some(host) => {
            let host_lower = host.to_lowercase();
            if !ALLOWED_REGISTRY_HOSTS.iter().any(|&h| host_lower == h) {
                return Err(VoltError::InvalidConfig(format!(
                    "Registry host '{}' is not in the allowlist",
                    host
                )));
            }
        }
        None => {
            return Err(VoltError::InvalidConfig(
                "Registry URL must have a valid host".to_string(),
            ));
        }
    }

    Ok(())
}

/// Fetch the extension registry from GitHub
#[tauri::command]
pub async fn fetch_extension_registry(url: String) -> VoltResult<ExtensionRegistry> {
    validate_registry_url(&url)?;

    let client = reqwest::Client::new();

    let response = client
        .get(&url)
        .header("User-Agent", "Volt-Launcher")
        .send()
        .await
        .map_err(|e| VoltError::Unknown(format!("Failed to fetch registry: {}", e)))?;

    if !response.status().is_success() {
        return Err(VoltError::Unknown(format!(
            "Failed to fetch registry: HTTP {}",
            response.status()
        )));
    }

    let registry: ExtensionRegistry = response
        .json()
        .await
        .map_err(|e| VoltError::Serialization(format!("Failed to parse registry: {}", e)))?;

    Ok(registry)
}

/// Get list of installed extensions
#[tauri::command]
pub async fn get_installed_extensions(app: AppHandle) -> VoltResult<Vec<InstalledExtension>> {
    let state = load_installed_state(&app)?;
    Ok(state.extensions)
}

/// Install an extension
#[tauri::command]
pub async fn install_extension(
    app: AppHandle,
    extension_id: String,
    download_url: String,
) -> VoltResult<InstalledExtension> {
    // Validate inputs for security
    validate_extension_id(&extension_id)?;
    validate_download_url(&download_url)?;

    let extensions_dir = get_extensions_dir(&app)?;
    let extension_dir = extensions_dir.join(&extension_id);

    // Create extension directory
    if extension_dir.exists() {
        fs::remove_dir_all(&extension_dir).map_err(|e| {
            VoltError::FileSystem(format!("Failed to remove existing extension: {}", e))
        })?;
    }
    fs::create_dir_all(&extension_dir).map_err(|e| {
        VoltError::FileSystem(format!("Failed to create extension directory: {}", e))
    })?;

    // Download the extension
    info!("Downloading extension from: {}", download_url);
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .header("User-Agent", "Volt-Launcher")
        .send()
        .await
        .map_err(|e| VoltError::Unknown(format!("Failed to download extension: {}", e)))?;

    debug!("Download response status: {}", response.status());

    if !response.status().is_success() {
        return Err(VoltError::Unknown(format!(
            "Failed to download extension: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| VoltError::Unknown(format!("Failed to read extension data: {}", e)))?;

    debug!("Downloaded {} bytes", bytes.len());

    // Detect archive format from the URL. We treat anything ending in .tar.gz
    // or .tgz as a gzipped tar, otherwise fall back to ZIP (the original format).
    let url_lower = download_url.to_lowercase();
    let is_tar_gz = url_lower.ends_with(".tar.gz") || url_lower.ends_with(".tgz");

    if is_tar_gz {
        extract_tar_gz(&bytes, &extension_dir)?;
    } else {
        extract_zip(&bytes, &extension_dir)?;
    }

    debug!("Extraction complete, checking for manifest...");

    // Some publishers wrap everything in a single top-level directory
    // (e.g. a tarball that extracts to `github/manifest.json`). If the manifest
    // isn't at the root but is exactly one level deep, promote that folder's
    // contents to the extension root.
    if !extension_dir.join("manifest.json").exists() {
        flatten_single_root_dir(&extension_dir)?;
    }

    // Read the manifest
    let manifest_path = extension_dir.join("manifest.json");
    debug!("Looking for manifest at: {:?}", manifest_path);
    debug!("Manifest exists: {}", manifest_path.exists());

    // List files in extension_dir for debugging
    if let Ok(entries) = fs::read_dir(&extension_dir) {
        debug!("Files in extension directory:");
        for entry in entries.flatten() {
            debug!("  - {:?}", entry.path());
        }
    }

    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read manifest: {}", e)))?;
    let manifest: ExtensionManifest = serde_json::from_str(&manifest_content)
        .map_err(|e| VoltError::Serialization(format!("Failed to parse manifest: {}", e)))?;

    if manifest.id != extension_id {
        return Err(VoltError::InvalidConfig(format!(
            "Manifest id '{}' does not match requested extension id '{}'",
            manifest.id, extension_id
        )));
    }

    // Create installed extension record
    let installed = InstalledExtension {
        manifest,
        installed_at: chrono::Utc::now().to_rfc3339(),
        enabled: true,
        path: extension_dir.to_string_lossy().to_string(),
        granted_permissions: Vec::new(),
    };

    // Update installed state
    let mut state = load_installed_state(&app)?;
    state.extensions.retain(|e| e.manifest.id != extension_id);
    state.extensions.push(installed.clone());
    save_installed_state(&app, &state)?;

    info!("Installed extension: {}", extension_id);
    Ok(installed)
}

/// Uninstall an extension
#[tauri::command]
pub async fn uninstall_extension(app: AppHandle, extension_id: String) -> VoltResult<()> {
    validate_extension_id(&extension_id)?;
    let extensions_dir = get_extensions_dir(&app)?;
    let extension_dir = extensions_dir.join(&extension_id);

    // Remove extension directory
    if extension_dir.exists() {
        fs::remove_dir_all(&extension_dir).map_err(|e| {
            VoltError::FileSystem(format!("Failed to remove extension directory: {}", e))
        })?;
    }

    // Update installed state
    let mut state = load_installed_state(&app)?;
    state.extensions.retain(|e| e.manifest.id != extension_id);
    save_installed_state(&app, &state)?;

    info!("Uninstalled extension: {}", extension_id);
    Ok(())
}

/// Enable or disable an extension
#[tauri::command]
pub async fn toggle_extension(
    app: AppHandle,
    extension_id: String,
    enabled: bool,
) -> VoltResult<()> {
    validate_extension_id(&extension_id)?;
    let mut state = load_installed_state(&app)?;

    if let Some(ext) = state
        .extensions
        .iter_mut()
        .find(|e| e.manifest.id == extension_id)
    {
        ext.enabled = enabled;
        save_installed_state(&app, &state)?;
        info!(
            "Extension {} {}",
            extension_id,
            if enabled { "enabled" } else { "disabled" }
        );
        Ok(())
    } else {
        Err(VoltError::NotFound(format!(
            "Extension not found: {}",
            extension_id
        )))
    }
}

/// Update granted permissions for an installed extension
#[tauri::command]
pub async fn update_extension_permissions(
    app: AppHandle,
    extension_id: String,
    permissions: Vec<String>,
) -> VoltResult<()> {
    validate_extension_id(&extension_id)?;

    let mut state = load_installed_state(&app)?;

    let ext = state
        .extensions
        .iter_mut()
        .find(|e| e.manifest.id == extension_id)
        .ok_or_else(|| VoltError::NotFound(format!("Extension {} not found", extension_id)))?;

    ext.granted_permissions = permissions;
    save_installed_state(&app, &state)?;

    Ok(())
}

/// Check for extension updates
#[tauri::command]
pub async fn check_extension_updates(
    app: AppHandle,
    registry_url: String,
) -> VoltResult<Vec<ExtensionUpdateInfo>> {
    let registry = fetch_extension_registry(registry_url).await?;
    let installed = load_installed_state(&app)?;

    let mut updates = Vec::new();

    for installed_ext in &installed.extensions {
        if let Some(registry_ext) = registry
            .extensions
            .iter()
            .find(|e| e.manifest.id == installed_ext.manifest.id)
        {
            // Use semver comparison: only show update if registry version is newer
            let is_newer = match (
                semver::Version::parse(&registry_ext.manifest.version),
                semver::Version::parse(&installed_ext.manifest.version),
            ) {
                (Ok(reg_ver), Ok(inst_ver)) => reg_ver > inst_ver,
                // Fall back to string comparison if semver parsing fails
                _ => registry_ext.manifest.version != installed_ext.manifest.version,
            };
            if is_newer {
                updates.push(ExtensionUpdateInfo {
                    extension_id: installed_ext.manifest.id.clone(),
                    current_version: installed_ext.manifest.version.clone(),
                    new_version: registry_ext.manifest.version.clone(),
                    download_url: registry_ext.download_url.clone(),
                });
            }
        }
    }

    Ok(updates)
}

/// Extension update information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionUpdateInfo {
    pub extension_id: String,
    pub current_version: String,
    pub new_version: String,
    pub download_url: String,
}

/// Update an extension
#[tauri::command]
pub async fn update_extension(
    app: AppHandle,
    extension_id: String,
    download_url: String,
) -> VoltResult<InstalledExtension> {
    // Just reinstall the extension
    install_extension(app, extension_id, download_url).await
}

/// Get extension details
#[tauri::command]
pub async fn get_extension_details(
    app: AppHandle,
    extension_id: String,
) -> VoltResult<Option<InstalledExtension>> {
    validate_extension_id(&extension_id)?;
    let state = load_installed_state(&app)?;

    Ok(state
        .extensions
        .into_iter()
        .find(|e| e.manifest.id == extension_id))
}

/// Read extension source code
/// Returns the JavaScript/TypeScript source code of an extension including all files
#[tauri::command]
pub async fn read_extension_source(
    app: AppHandle,
    extension_id: String,
) -> VoltResult<ExtensionSource> {
    validate_extension_id(&extension_id)?;
    let extensions_dir = get_extensions_dir(&app)?;
    let extension_dir = extensions_dir.join(&extension_id);

    if !extension_dir.exists() {
        return Err(VoltError::NotFound(format!(
            "Extension not found: {}",
            extension_id
        )));
    }

    // Read the manifest to get the entry point
    let manifest_path = extension_dir.join("manifest.json");
    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read manifest: {}", e)))?;
    let manifest: ExtensionManifest = serde_json::from_str(&manifest_content)
        .map_err(|e| VoltError::Serialization(format!("Failed to parse manifest: {}", e)))?;

    // Determine entry point - use manifest.main field, otherwise use default
    let entry_point = manifest
        .main
        .clone()
        .unwrap_or_else(|| "index.js".to_string());

    let source_path = extension_dir.join(&entry_point);

    // Also check for .ts extension if .js doesn't exist
    let source_path = if !source_path.exists() && entry_point.ends_with(".js") {
        let ts_path = extension_dir.join(entry_point.replace(".js", ".ts"));
        if ts_path.exists() {
            ts_path
        } else {
            source_path
        }
    } else {
        source_path
    };

    if !source_path.exists() {
        return Err(VoltError::NotFound(format!(
            "Extension entry point not found: {}",
            source_path.display()
        )));
    }

    // Containment check: manifest.main may contain `..` or point at a symlink.
    // Reject any entry point that resolves outside the extension's own directory.
    ensure_contained(&source_path, &extension_dir).map_err(|_| {
        VoltError::InvalidConfig(format!(
            "Extension entry point '{}' escapes extension directory",
            entry_point
        ))
    })?;

    let source_code = fs::read_to_string(&source_path)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read extension source: {}", e)))?;

    // Read all source files in the extension directory
    let files = read_all_source_files(&extension_dir)?;

    Ok(ExtensionSource {
        id: extension_id,
        manifest,
        source: source_code,
        entry_point,
        files,
    })
}

/// Recursively read all .ts and .js files in a directory
fn read_all_source_files(dir: &PathBuf) -> VoltResult<std::collections::HashMap<String, String>> {
    let mut files = std::collections::HashMap::new();
    read_source_files_recursive(dir, dir, &mut files)?;
    Ok(files)
}

fn read_source_files_recursive(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    files: &mut std::collections::HashMap<String, String>,
) -> VoltResult<()> {
    let entries = fs::read_dir(current_dir)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read directory: {}", e)))?;

    for entry in entries.flatten() {
        let path = entry.path();

        // Containment check: canonicalize and verify the path is within base_dir.
        // This prevents symlinks from escaping the extension root.
        if let Ok(canonical) = path.canonicalize()
            && let Ok(canonical_base) = base_dir.canonicalize()
            && !canonical.starts_with(&canonical_base)
        {
            warn!("Skipping path that escapes extension root: {:?}", path);
            continue;
        }

        if path.is_dir() {
            // Skip node_modules, .git, etc.
            let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !dir_name.starts_with('.') && dir_name != "node_modules" {
                read_source_files_recursive(base_dir, &path, files)?;
            }
        } else if path.is_file() {
            // Only read .ts, .js, .json files (not images, etc.)
            if let Some(ext) = path.extension().and_then(|e| e.to_str())
                && (ext == "ts" || ext == "js" || ext == "json")
            {
                // Get relative path from extension root
                let relative_path = path
                    .strip_prefix(base_dir)
                    .map_err(|e| VoltError::Unknown(format!("Failed to get relative path: {}", e)))?
                    .to_string_lossy()
                    .replace('\\', "/"); // Normalize to forward slashes

                if let Ok(content) = fs::read_to_string(&path) {
                    files.insert(relative_path, content);
                }
            }
        }
    }

    Ok(())
}

/// Extension source code response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSource {
    pub id: String,
    pub manifest: ExtensionManifest,
    pub source: String,
    pub entry_point: String,
    /// All source files in the extension (path relative to extension root -> content)
    pub files: std::collections::HashMap<String, String>,
}

/// Get all enabled extensions with their source code
#[tauri::command]
pub async fn get_enabled_extensions_sources(app: AppHandle) -> VoltResult<Vec<ExtensionSource>> {
    let state = load_installed_state(&app)?;
    let mut sources = Vec::new();

    // Load installed extensions
    for ext in state.extensions.iter().filter(|e| e.enabled) {
        match read_extension_source(app.clone(), ext.manifest.id.clone()).await {
            Ok(source) => sources.push(source),
            Err(e) => {
                warn!("Failed to read extension {}: {}", ext.manifest.id, e);
            }
        }
    }

    // Load dev extensions
    //
    // Defense-in-depth: even though `link_dev_extension` rejects id collisions
    // with installed extensions, the dev-extensions state file lives on disk in
    // the user's app data directory and could be tampered with outside our
    // IPC. Skip any dev entry whose id matches an installed (non-dev) extension
    // so a tampered file cannot cause the dev code to inherit the installed
    // extension's `granted_permissions` via the id-keyed frontend lookup.
    let installed_ids: std::collections::HashSet<String> = state
        .extensions
        .iter()
        .map(|e| e.manifest.id.clone())
        .collect();
    match get_dev_extensions(app.clone()).await {
        Ok(dev_exts) => {
            for dev_ext in dev_exts.iter().filter(|e| e.enabled) {
                if installed_ids.contains(&dev_ext.manifest.id) {
                    warn!(
                        "Skipping dev extension '{}': id collides with an installed extension",
                        dev_ext.manifest.id
                    );
                    continue;
                }
                match read_dev_extension_source(&dev_ext.path).await {
                    Ok(source) => sources.push(source),
                    Err(e) => {
                        warn!(
                            "Failed to read dev extension {}: {}",
                            dev_ext.manifest.id, e
                        );
                    }
                }
            }
        }
        Err(e) => {
            warn!("Failed to load dev extensions: {}", e);
        }
    }

    Ok(sources)
}

// ============================================================================
// DEV EXTENSIONS - Development mode for extension developers
// ============================================================================

/// Dev extension info (linked from local folder)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevExtension {
    pub manifest: ExtensionManifest,
    pub path: String,
    pub linked_at: String,
    pub enabled: bool,
    /// Always true for dev extensions
    pub is_dev: bool,
}

/// State for dev extensions
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DevExtensionsState {
    pub extensions: Vec<DevExtension>,
}

/// Get the dev extensions directory path
fn get_dev_extensions_dir(app: &AppHandle) -> VoltResult<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| VoltError::FileSystem(format!("Failed to get app data dir: {}", e)))?;
    let dev_extensions_dir = data_dir.join("dev-extensions");

    // Create directory if it doesn't exist
    if !dev_extensions_dir.exists() {
        fs::create_dir_all(&dev_extensions_dir).map_err(|e| {
            VoltError::FileSystem(format!("Failed to create dev-extensions directory: {}", e))
        })?;
    }

    Ok(dev_extensions_dir)
}

/// Get the path to the dev extensions state file
fn get_dev_state_path(app: &AppHandle) -> VoltResult<PathBuf> {
    let dev_dir = get_dev_extensions_dir(app)?;
    Ok(dev_dir.join("dev-extensions.json"))
}

/// Load dev extensions state from disk.
///
/// Also verifies the detached HMAC signature (`dev-extensions.json.sig`).
/// A missing or mismatching signature is logged but never causes load
/// failure — see `extension_state_sig` for the rationale.
fn load_dev_state(app: &AppHandle) -> VoltResult<DevExtensionsState> {
    let state_path = get_dev_state_path(app)?;

    let content = extension_state_sig::read_state_with_verification(&state_path, "dev-extensions")
        .map_err(|e| VoltError::FileSystem(format!("Failed to read dev state: {}", e)))?;

    let Some(content) = content else {
        return Ok(DevExtensionsState::default());
    };

    serde_json::from_str(&content)
        .map_err(|e| VoltError::Serialization(format!("Failed to parse dev state: {}", e)))
}

/// Save dev extensions state to disk, along with the HMAC signature.
fn save_dev_state(app: &AppHandle, state: &DevExtensionsState) -> VoltResult<()> {
    let state_path = get_dev_state_path(app)?;

    let content = serde_json::to_string_pretty(state)
        .map_err(|e| VoltError::Serialization(format!("Failed to serialize dev state: {}", e)))?;

    extension_state_sig::write_state_with_signature(&state_path, &content)
        .map_err(|e| VoltError::FileSystem(format!("Failed to write dev state: {}", e)))?;

    Ok(())
}

/// Read extension source from a dev extension path
async fn read_dev_extension_source(path: &str) -> VoltResult<ExtensionSource> {
    let extension_dir = PathBuf::from(path);

    if !extension_dir.exists() {
        return Err(VoltError::NotFound(format!(
            "Dev extension directory not found: {}",
            path
        )));
    }

    // Re-validate sensitive-directory policy every time we read. The dev
    // extension list is persisted to disk and could be tampered with; verifying
    // at read time prevents a previously-linked path from surfacing creds.
    let canonical = extension_dir.canonicalize().map_err(|e| {
        VoltError::FileSystem(format!("Failed to resolve dev extension path: {}", e))
    })?;
    for component in canonical.components() {
        let name = component.as_os_str().to_string_lossy().to_lowercase();
        if DEV_EXTENSION_FORBIDDEN_DIRS.contains(&name.as_str()) {
            return Err(VoltError::InvalidConfig(format!(
                "Dev extension path contains sensitive directory '{}'",
                name
            )));
        }
    }
    let extension_dir = canonical;

    // Read the manifest
    let manifest_path = extension_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Err(VoltError::NotFound(format!(
            "manifest.json not found in: {}",
            path
        )));
    }

    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read manifest: {}", e)))?;
    let manifest: ExtensionManifest = serde_json::from_str(&manifest_content)
        .map_err(|e| VoltError::Serialization(format!("Failed to parse manifest: {}", e)))?;

    // Determine entry point
    let entry_point = manifest
        .main
        .clone()
        .unwrap_or_else(|| "index.ts".to_string());
    let source_path = extension_dir.join(&entry_point);

    // Try .ts first, then .js
    let source_path = if !source_path.exists() && entry_point.ends_with(".ts") {
        let js_path = extension_dir.join(entry_point.replace(".ts", ".js"));
        if js_path.exists() {
            js_path
        } else {
            source_path
        }
    } else if !source_path.exists() && entry_point.ends_with(".js") {
        let ts_path = extension_dir.join(entry_point.replace(".js", ".ts"));
        if ts_path.exists() {
            ts_path
        } else {
            source_path
        }
    } else {
        source_path
    };

    let source_code = if source_path.exists() {
        fs::read_to_string(&source_path)
            .map_err(|e| VoltError::FileSystem(format!("Failed to read source: {}", e)))?
    } else {
        String::new()
    };

    // Read all source files
    let files = read_all_source_files(&extension_dir)?;

    Ok(ExtensionSource {
        id: manifest.id.clone(),
        manifest,
        source: source_code,
        entry_point,
        files,
    })
}

/// Get list of linked dev extensions
#[tauri::command]
pub async fn get_dev_extensions(app: AppHandle) -> VoltResult<Vec<DevExtension>> {
    let state = load_dev_state(&app)?;

    // Validate each extension still exists and update manifest if needed
    let mut valid_extensions = Vec::new();

    for mut ext in state.extensions {
        let path = PathBuf::from(&ext.path);
        let manifest_path = path.join("manifest.json");

        if manifest_path.exists() {
            // Re-read manifest to get latest changes (hot reload)
            if let Ok(content) = fs::read_to_string(&manifest_path)
                && let Ok(manifest) = serde_json::from_str::<ExtensionManifest>(&content)
            {
                ext.manifest = manifest;
            }
            valid_extensions.push(ext);
        } else {
            warn!("Dev extension no longer exists: {}", ext.path);
        }
    }

    Ok(valid_extensions)
}

/// Link a dev extension from a local folder
/// This is like `npm link` - it creates a symbolic reference to the local folder
#[tauri::command]
pub async fn link_dev_extension(app: AppHandle, path: String) -> VoltResult<DevExtension> {
    let extension_dir = PathBuf::from(&path);

    if !extension_dir.exists() {
        return Err(VoltError::NotFound(format!(
            "Directory not found: {}",
            path
        )));
    }

    // Canonicalize path to prevent symlink traversal
    let canonical_path = extension_dir
        .canonicalize()
        .map_err(|e| VoltError::FileSystem(format!("Failed to resolve path: {}", e)))?;

    // Validate that the path is within the user's home directory
    if let Some(home) = dirs::home_dir()
        && !canonical_path.starts_with(&home)
    {
        return Err(VoltError::InvalidConfig(
            "Dev extensions must be within the user's home directory".to_string(),
        ));
    }

    // Reject sensitive directories (credentials, SSH keys, cloud provider
    // configs). A dev extension's whole tree is read and shipped to the
    // extension loader, so refusing these at link time is critical.
    for component in canonical_path.components() {
        let name = component.as_os_str().to_string_lossy().to_lowercase();
        if DEV_EXTENSION_FORBIDDEN_DIRS.contains(&name.as_str()) {
            return Err(VoltError::InvalidConfig(format!(
                "Path contains sensitive directory '{}'. Dev extensions cannot be linked from credential/config directories.",
                name
            )));
        }
    }

    // Warn — but do not reject — when the dev-extension root lives inside a
    // classic attacker drop location (Downloads, Desktop, Temp). The log
    // line gives a forensic trail; a future UI layer can surface it as a
    // confirmation prompt without changing the backend contract.
    for component in canonical_path.components() {
        let name = component.as_os_str().to_string_lossy().to_lowercase();
        if DEV_EXTENSION_SUSPICIOUS_DIRS.contains(&name.as_str()) {
            warn!(
                "Linking dev extension from suspicious location '{}' — verify you trust the source",
                canonical_path.display()
            );
            break;
        }
    }

    let extension_dir = canonical_path.clone();

    // Check for manifest.json
    let manifest_path = extension_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Err(VoltError::NotFound(format!(
            "manifest.json not found in {}. Create a manifest.json file first.",
            path
        )));
    }

    // Read and validate manifest
    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| VoltError::FileSystem(format!("Failed to read manifest: {}", e)))?;
    let manifest: ExtensionManifest = serde_json::from_str(&manifest_content)
        .map_err(|e| VoltError::Serialization(format!("Failed to parse manifest: {}", e)))?;

    info!("Linking dev extension: {} ({})", manifest.name, manifest.id);

    // Security: block id collision with an already-installed (non-dev) extension.
    //
    // Without this check, a local folder whose manifest declares an existing
    // installed extension's id would cause the frontend's permission lookup
    // (keyed on manifest.id against `get_installed_extensions`) to return the
    // installed extension's `granted_permissions` for the dev code — an
    // unauthorized permission escalation / identity spoof.
    //
    // Replacing a previous dev extension with the same id is still allowed;
    // that's the intended dev workflow (re-link the same folder).
    let installed_state = load_installed_state(&app)?;
    if installed_state
        .extensions
        .iter()
        .any(|e| e.manifest.id == manifest.id)
    {
        return Err(VoltError::InvalidConfig(format!(
            "Cannot link dev extension '{}': an installed extension with the same id already exists. Uninstall it first.",
            manifest.id
        )));
    }

    // Create dev extension record.
    //
    // We persist the CANONICAL path, not the raw user-supplied `path`.
    // Rationale: every read-time check (sensitive-directory scan,
    // containment verification) is applied to the canonical form. If we
    // stored the raw input and the target later became a symlink or was
    // renamed, the pre-flight validation done at link time would no longer
    // reflect what `read_dev_extension_source` actually resolves.
    let dev_ext = DevExtension {
        manifest,
        path: canonical_path.to_string_lossy().into_owned(),
        linked_at: chrono::Utc::now().to_rfc3339(),
        enabled: true,
        is_dev: true,
    };

    // Update state
    let mut state = load_dev_state(&app)?;

    // Remove existing link with same ID
    state
        .extensions
        .retain(|e| e.manifest.id != dev_ext.manifest.id);
    state.extensions.push(dev_ext.clone());

    save_dev_state(&app, &state)?;

    info!("Dev extension linked: {}", dev_ext.manifest.name);
    Ok(dev_ext)
}

/// Unlink a dev extension
#[tauri::command]
pub async fn unlink_dev_extension(app: AppHandle, extension_id: String) -> VoltResult<()> {
    let mut state = load_dev_state(&app)?;

    let before_count = state.extensions.len();
    state.extensions.retain(|e| e.manifest.id != extension_id);

    if state.extensions.len() == before_count {
        return Err(VoltError::NotFound(format!(
            "Dev extension not found: {}",
            extension_id
        )));
    }

    save_dev_state(&app, &state)?;

    info!("Dev extension unlinked: {}", extension_id);
    Ok(())
}

/// Toggle a dev extension enabled/disabled
#[tauri::command]
pub async fn toggle_dev_extension(
    app: AppHandle,
    extension_id: String,
    enabled: bool,
) -> VoltResult<()> {
    let mut state = load_dev_state(&app)?;

    if let Some(ext) = state
        .extensions
        .iter_mut()
        .find(|e| e.manifest.id == extension_id)
    {
        ext.enabled = enabled;
        save_dev_state(&app, &state)?;
        info!(
            "Dev extension {} {}",
            extension_id,
            if enabled { "enabled" } else { "disabled" }
        );
        Ok(())
    } else {
        Err(VoltError::NotFound(format!(
            "Dev extension not found: {}",
            extension_id
        )))
    }
}

/// Get the dev extensions directory path (for UI display)
#[tauri::command]
pub async fn get_dev_extensions_path(app: AppHandle) -> VoltResult<String> {
    let path = get_dev_extensions_dir(&app)?;
    Ok(path.to_string_lossy().to_string())
}

/// Refresh a dev extension (re-read from disk)
#[tauri::command]
pub async fn refresh_dev_extension(
    app: AppHandle,
    extension_id: String,
) -> VoltResult<DevExtension> {
    let state = load_dev_state(&app)?;

    let ext = state
        .extensions
        .iter()
        .find(|e| e.manifest.id == extension_id)
        .ok_or_else(|| VoltError::NotFound(format!("Dev extension not found: {}", extension_id)))?;

    // Re-link to refresh
    link_dev_extension(app, ext.path.clone()).await
}

/// Return whether the extension-state HMAC key was forcibly rotated during
/// this process run (i.e. the keyring entry was malformed at startup, which
/// can only happen from external tampering or data corruption). The
/// frontend should surface a banner while this is true and call
/// `acknowledge_extension_tamper_alert` when the user dismisses it.
#[tauri::command]
pub async fn get_extension_tamper_alert() -> bool {
    crate::utils::extension_state_sig::has_tamper_detected()
}

/// Acknowledge the tamper alert so the UI banner is dismissed.
#[tauri::command]
pub async fn acknowledge_extension_tamper_alert() {
    crate::utils::extension_state_sig::acknowledge_tamper_detected();
}
