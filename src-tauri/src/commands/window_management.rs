//! Window management commands for snapping/resizing the foreground window.
//!
//! These commands manipulate the PREVIOUSLY focused window (not Volt's own window).
//! The frontend hides Volt first, then calls these commands so that
//! `GetForegroundWindow()` returns the user's target window.

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::mem;
    use winapi::shared::windef::{HWND, RECT};
    use winapi::um::winuser::{
        GetForegroundWindow, GetMonitorInfoW, GetWindowLongW, GetWindowRect, MonitorFromWindow,
        SetWindowPos, ShowWindow, GWL_STYLE, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        SWP_NOACTIVATE, SWP_NOZORDER, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, WS_MAXIMIZE,
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

            if SetWindowPos(hwnd, std::ptr::null_mut(), x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE) == 0 {
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
