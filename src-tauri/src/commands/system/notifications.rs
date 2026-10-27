use crate::core::error::VoltResult;
use tauri::AppHandle;
#[cfg(target_os = "windows")]
use tauri::Manager;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNotificationPayload {
    pub title: String,
    pub body: Option<String>,
}

#[tauri::command]
pub fn send_native_notification(
    app: AppHandle,
    payload: NativeNotificationPayload,
) -> VoltResult<()> {
    send_platform_notification(app, payload)
}

#[cfg(target_os = "windows")]
fn send_platform_notification(
    app: AppHandle,
    payload: NativeNotificationPayload,
) -> VoltResult<()> {
    let app_id = notification_app_id(&app);
    let mut notification = notify_rust::Notification::new();
    notification
        .appname("Volt")
        .app_id(&app_id)
        .summary(&payload.title);

    if let Some(body) = payload.body.as_deref() {
        notification.body(body);
    }

    if let Some(icon_path) = volt_icon_path(&app) {
        notification.icon(&icon_path);
    }

    notification.show().map(|_| ()).map_err(|err| {
        crate::core::error::VoltError::InvalidConfig(format!(
            "Failed to show Windows notification: {}",
            err
        ))
    })
}

/// AppUserModelID used for Windows toasts.
///
/// Installer builds (NSIS/MSI) register `identifier` (`volt.launch`) on the
/// Start-menu shortcut. An MSIX package has no such shortcut: its tile is
/// registered as `<PackageFamilyName>!<Application Id>`, so toasts must use
/// that AUMID or Windows drops them silently.
#[cfg(all(target_os = "windows", feature = "store"))]
fn notification_app_id(app: &AppHandle) -> String {
    /// Must match `Application/@Id` in packaging/msix/AppxManifest.template.xml.
    const MSIX_APPLICATION_ID: &str = "Volt";

    windows::ApplicationModel::Package::Current()
        .and_then(|package| package.Id())
        .and_then(|id| id.FamilyName())
        .map(|family| format!("{}!{}", family, MSIX_APPLICATION_ID))
        .unwrap_or_else(|_| app.config().identifier.clone())
}

#[cfg(all(target_os = "windows", not(feature = "store")))]
fn notification_app_id(app: &AppHandle) -> String {
    app.config().identifier.clone()
}

#[cfg(target_os = "windows")]
fn volt_icon_path(app: &AppHandle) -> Option<String> {
    let dev_icon = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("icons")
        .join("icon.ico");
    if dev_icon.exists() {
        return Some(dev_icon.to_string_lossy().to_string());
    }

    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("icons").join("icon.ico"))
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(not(target_os = "windows"))]
fn send_platform_notification(
    app: AppHandle,
    payload: NativeNotificationPayload,
) -> VoltResult<()> {
    use tauri_plugin_notification::NotificationExt;

    let mut builder = app.notification().builder().title(payload.title);
    if let Some(body) = payload.body {
        builder = builder.body(body);
    }

    builder.show().map_err(|err| {
        crate::core::error::VoltError::InvalidConfig(format!(
            "Failed to show notification: {}",
            err
        ))
    })
}
