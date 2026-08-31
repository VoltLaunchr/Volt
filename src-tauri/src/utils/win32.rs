//! Small foreground-window helpers shared across modules (clipboard manager,
//! global snippet expansion). Kept separate from `utils::process` (which
//! deals with generic process lookups) because these are specific to "what
//! window/app currently has focus". Historically Windows-only (hence the
//! filename); now also covers Linux (Hyprland via `hyprctl`, X11/XWayland via
//! `utils::x11`). Generic Wayland compositors without a Hyprland-style CLI
//! IPC have no unprivileged way to answer this, so they fall back to `None`.

/// Return the lowercase executable basename of the current foreground window's
/// process, or `None` if it cannot be determined.
#[cfg(windows)]
pub(crate) fn get_foreground_app_name() -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::psapi::GetModuleFileNameExW;
    use winapi::um::winnt::{PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
    use winapi::um::winuser::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid as *mut u32);
        if pid == 0 {
            return None;
        }

        let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
        if handle.is_null() {
            return None;
        }

        let mut buf = vec![0u16; 512];
        let len = GetModuleFileNameExW(
            handle,
            std::ptr::null_mut(),
            buf.as_mut_ptr(),
            buf.len() as u32,
        );
        CloseHandle(handle);

        if len == 0 {
            return None;
        }

        let path = OsString::from_wide(&buf[..len as usize]);
        let path_str = path.to_string_lossy().to_lowercase();
        // Extract just the filename without extension
        std::path::Path::new(&path_str)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
    }
}

/// Runs `hyprctl -j activewindow` and extracts the `class` field, if Hyprland
/// is the running compositor (`HYPRLAND_INSTANCE_SIGNATURE` is set by Hyprland
/// for every client, including the one launching Volt). `hyprctl` is
/// Hyprland's own IPC CLI, always present alongside the compositor — no
/// optional dependency to detect or degrade around.
#[cfg(target_os = "linux")]
fn get_foreground_app_name_hyprland() -> Option<String> {
    let output = std::process::Command::new("hyprctl")
        .args(["-j", "activewindow"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    value
        .get("class")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
}

#[cfg(target_os = "linux")]
pub(crate) fn get_foreground_app_name() -> Option<String> {
    if std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some() {
        return get_foreground_app_name_hyprland();
    }
    // Other Wayland compositors (GNOME Mutter, KDE KWin, ...) have no
    // standard unprivileged protocol for "which app is focused" — only
    // XWayland clients are visible via the X11 path below.
    let x = crate::utils::x11::connect().ok()?;
    let window = crate::utils::x11::active_window(&x).ok()?;
    crate::utils::x11::wm_class(&x, window)
}

#[cfg(not(any(windows, target_os = "linux")))]
pub(crate) fn get_foreground_app_name() -> Option<String> {
    None
}
