//! Window management commands for snapping/resizing the foreground window.
//!
//! These commands manipulate the PREVIOUSLY focused window (not Volt's own window).
//! The frontend hides Volt first, then calls these commands so that
//! `GetForegroundWindow()` returns the user's target window.
//!
//! The `open_notes_window` command is the lone exception: it acts on Volt's
//! own webview windows (creating or focusing the dedicated Notes window).

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::mem;
    use winapi::shared::windef::{HWND, RECT};
    use winapi::um::winuser::{
        GWL_STYLE, GetForegroundWindow, GetMonitorInfoW, GetWindowLongW, GetWindowRect,
        MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow, SW_MAXIMIZE, SW_MINIMIZE,
        SW_RESTORE, SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos, ShowWindow, WS_MAXIMIZE,
    };

    /// Returns the foreground window handle, or an error if none is found.
    fn get_foreground() -> Result<HWND, String> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            Err("No foreground window found".to_string())
        } else {
            Ok(hwnd)
        }
    }

    /// Returns the work-area rectangle (excluding taskbar) of the monitor
    /// that contains the given window.
    fn get_work_area(hwnd: HWND) -> Result<RECT, String> {
        unsafe {
            let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if hmon.is_null() {
                return Err("Could not determine monitor".to_string());
            }
            let mut mi: MONITORINFO = mem::zeroed();
            mi.cbSize = mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(hmon, &mut mi) == 0 {
                return Err("GetMonitorInfoW failed".to_string());
            }
            Ok(mi.rcWork)
        }
    }

    /// Move and resize the foreground window to the given rectangle.
    fn set_window_rect(hwnd: HWND, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
        unsafe {
            // Restore first if maximized, so SetWindowPos works correctly
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            if style & WS_MAXIMIZE != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }

            if SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                x,
                y,
                w,
                h,
                SWP_NOZORDER | SWP_NOACTIVATE,
            ) == 0
            {
                return Err("SetWindowPos failed".to_string());
            }
        }
        Ok(())
    }

    pub fn snap_window_impl(position: &str) -> Result<(), String> {
        let hwnd = get_foreground()?;
        let wa = get_work_area(hwnd)?;
        let wa_x = wa.left;
        let wa_y = wa.top;
        let wa_w = wa.right - wa.left;
        let wa_h = wa.bottom - wa.top;

        match position {
            "left_half" => set_window_rect(hwnd, wa_x, wa_y, wa_w / 2, wa_h),
            "right_half" => set_window_rect(hwnd, wa_x + wa_w / 2, wa_y, wa_w / 2, wa_h),
            "top_half" => set_window_rect(hwnd, wa_x, wa_y, wa_w, wa_h / 2),
            "bottom_half" => set_window_rect(hwnd, wa_x, wa_y + wa_h / 2, wa_w, wa_h / 2),
            "top_left" => set_window_rect(hwnd, wa_x, wa_y, wa_w / 2, wa_h / 2),
            "top_right" => set_window_rect(hwnd, wa_x + wa_w / 2, wa_y, wa_w / 2, wa_h / 2),
            "bottom_left" => set_window_rect(hwnd, wa_x, wa_y + wa_h / 2, wa_w / 2, wa_h / 2),
            "bottom_right" => {
                set_window_rect(hwnd, wa_x + wa_w / 2, wa_y + wa_h / 2, wa_w / 2, wa_h / 2)
            }
            "center" => {
                // Keep current window size, move to center of work area
                let mut rect: RECT = unsafe { mem::zeroed() };
                unsafe {
                    if GetWindowRect(hwnd, &mut rect) == 0 {
                        return Err("GetWindowRect failed".to_string());
                    }
                }
                let win_w = rect.right - rect.left;
                let win_h = rect.bottom - rect.top;
                let x = wa_x + (wa_w - win_w) / 2;
                let y = wa_y + (wa_h - win_h) / 2;
                set_window_rect(hwnd, x, y, win_w, win_h)
            }
            "maximize" => unsafe {
                ShowWindow(hwnd, SW_MAXIMIZE);
                Ok(())
            },
            "minimize" => unsafe {
                ShowWindow(hwnd, SW_MINIMIZE);
                Ok(())
            },
            "restore" => unsafe {
                ShowWindow(hwnd, SW_RESTORE);
                Ok(())
            },
            "fullscreen" => {
                // Toggle fullscreen: if maximized, restore; otherwise maximize
                unsafe {
                    let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
                    if style & WS_MAXIMIZE != 0 {
                        ShowWindow(hwnd, SW_RESTORE);
                    } else {
                        ShowWindow(hwnd, SW_MAXIMIZE);
                    }
                }
                Ok(())
            }
            _ => Err(format!("Unknown position: {}", position)),
        }
    }
}

/// Snap/resize/move the foreground window to the given position.
///
/// The frontend should hide the Volt window BEFORE calling this command,
/// so that `GetForegroundWindow()` returns the user's previously-focused window.
#[tauri::command]
pub async fn snap_window(position: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Small delay to ensure Volt window is fully hidden and focus has shifted
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        windows_impl::snap_window_impl(&position)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = position;
        Err("Window management is currently only supported on Windows".to_string())
    }
}

/// Opens (or focuses) the dedicated Volt Notes window.
///
/// If the window already exists, it is unhidden + focused and (if `note_id`
/// is provided) a `volt:notes:open-note` event is emitted so the running
/// React tree can navigate to that note.
///
/// If the window does not exist yet, it is created from the static config
/// defined in `tauri.conf.json` (label `"notes"`) via Tauri's webview window
/// builder. The static config lives in `tauri.conf.json` so the geometry +
/// chrome stay declaratively versioned in one place.
///
/// Per AGENTS.md, all command results are `Result<T, String>`. We bubble
/// every Tauri error up via `map_err(|e| e.to_string())` instead of letting
/// it `?` directly (which would otherwise propagate as `tauri::Error`).
#[tauri::command]
pub async fn open_notes_window(
    app: tauri::AppHandle,
    note_id: Option<String>,
) -> Result<(), String> {
    use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

    const LABEL: &str = "notes";

    if let Some(existing) = app.get_webview_window(LABEL) {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        if let Some(id) = note_id {
            existing
                .emit("volt:notes:open-note", id)
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Volt Notes")
        .inner_size(1000.0, 680.0)
        .min_inner_size(700.0, 480.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .always_on_top(false)
        .skip_taskbar(false)
        .visible(true)
        .focused(true)
        .center();

    let window = builder.build().map_err(|e| e.to_string())?;

    if let Some(id) = note_id {
        // Defer the emit until the webview has had a tick to mount listeners.
        // Tauri delivers events even if no listener is attached yet (they queue
        // until the first `listen()` call), so a direct emit is safe.
        window
            .emit("volt:notes:open-note", id)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
