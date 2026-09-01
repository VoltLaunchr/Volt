//! Window management commands for snapping/resizing the foreground window.
//!
//! These commands manipulate the PREVIOUSLY focused window (not Volt's own window).
//! The backend uses the last external foreground window recorded immediately
//! before Volt took focus, then hides Volt only after validating that target.
//! On failure Volt is shown again so the user is not left without the launcher.
//!
//! The `open_notes_window` command is the lone exception: it acts on Volt's
//! own webview windows (creating or focusing the dedicated Notes window).

#[cfg(any(target_os = "windows", target_os = "linux"))]
use tauri::Manager;

/// Last non-Volt foreground window observed immediately before the launcher
/// was shown. A focus target must come from this explicit history, not from
/// Z-order (which is not a focus history and may contain tool/always-on-top
/// windows between Volt and the user's application).
#[derive(Default)]
pub struct SnapTargetState {
    window: std::sync::Mutex<Option<u64>>,
}

impl SnapTargetState {
    fn validated_target(&self) -> Option<u64> {
        match self.window.lock() {
            Ok(stored) => *stored,
            Err(poisoned) => {
                tracing::warn!("snap target lock poisoned; recovering state");
                *poisoned.into_inner()
            }
        }
    }
}

/// Record the current external foreground window before Volt takes focus.
pub(crate) fn remember_foreground_target(app: &tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    let target = windows_impl::current_external_window();
    #[cfg(target_os = "linux")]
    let target = linux_impl::current_external_window();
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let target: Option<u64> = None;

    if let Some(target) = target
        && let Some(state) = app.try_state::<SnapTargetState>()
    {
        match state.window.lock() {
            Ok(mut stored) => *stored = Some(target),
            Err(poisoned) => {
                tracing::warn!("snap target lock poisoned; recovering state");
                *poisoned.into_inner() = Some(target);
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::mem;
    use tauri::{AppHandle, Manager};
    use winapi::shared::windef::{HWND, RECT};
    use winapi::um::winuser::{
        GWL_STYLE, GetForegroundWindow, GetMonitorInfoW, GetWindowLongW, GetWindowRect,
        GetWindowThreadProcessId, IsWindow, IsWindowVisible, MONITOR_DEFAULTTONEAREST, MONITORINFO,
        MonitorFromWindow, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, SWP_NOACTIVATE, SWP_NOZORDER,
        SetWindowPos, ShowWindow, WS_MAXIMIZE,
    };

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

    fn external_window(hwnd: HWND) -> Option<HWND> {
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 || unsafe { IsWindowVisible(hwnd) } == 0
        {
            return None;
        }
        let current_pid = std::process::id();
        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid as *mut u32);
        }
        (pid != current_pid).then_some(hwnd)
    }

    pub(super) fn current_external_window() -> Option<u64> {
        external_window(unsafe { GetForegroundWindow() }).map(|hwnd| hwnd as usize as u64)
    }

    pub fn snap_window_impl(app: &AppHandle, position: &str) -> Result<(), String> {
        let target_hwnd = app
            .try_state::<super::SnapTargetState>()
            .and_then(|state| state.validated_target())
            .and_then(|stored| external_window(stored as usize as HWND));

        let hwnd = target_hwnd.ok_or_else(|| "No previously focused window found".to_string())?;

        // Hide Volt now that we have captured the target.
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }

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

/// X11/EWMH implementation, also covers XWayland (native Wayland clients have
/// no equivalent unprivileged foreign-window-control protocol, so this is a
/// best-effort path rather than full Wayland support).
#[cfg(target_os = "linux")]
mod linux_impl {
    use crate::utils::x11::{X11, active_window, atom, connect, wm_class};
    use tauri::{AppHandle, Manager};
    use x11rb::connection::Connection as _;
    use x11rb::protocol::randr::ConnectionExt as _;
    use x11rb::protocol::xproto::{
        AtomEnum, ClientMessageEvent, ConnectionExt as _, EventMask, Window,
    };

    /// Root-relative geometry of `window` (its own coordinates are relative to
    /// its parent, which for a reparenting WM is the decoration frame, not root).
    fn absolute_geometry(x: &X11, window: Window) -> Result<(i16, i16, u16, u16), String> {
        let geom = x
            .conn
            .get_geometry(window)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        let translated = x
            .conn
            .translate_coordinates(window, x.root, 0, 0)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        Ok((translated.dst_x, translated.dst_y, geom.width, geom.height))
    }

    /// Geometry of the RandR monitor containing `window`'s center point.
    /// Falls back to the full root-window geometry when RandR is unavailable
    /// or reports no monitors (nested/virtual X servers). Unlike the Windows
    /// path this does not subtract panel/taskbar struts (`_NET_WORKAREA` is
    /// not reliably per-monitor across window managers) — snapped windows may
    /// slightly overlap a panel on some desktops.
    fn monitor_rect_for_window(x: &X11, window: Window) -> Result<(i16, i16, u16, u16), String> {
        let (win_x, win_y, win_w, win_h) = absolute_geometry(x, window)?;
        // RandR coordinates are signed while dimensions are unsigned. Keep
        // the comparison in i32 so large virtual desktops cannot wrap an i16.
        let center_x = i32::from(win_x) + i32::from(win_w) / 2;
        let center_y = i32::from(win_y) + i32::from(win_h) / 2;

        if let Some(monitors) = x
            .conn
            .randr_get_monitors(x.root, true)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
        {
            let containing = monitors.monitors.iter().find(|m| {
                center_x >= i32::from(m.x)
                    && center_x < i32::from(m.x) + i32::from(m.width)
                    && center_y >= i32::from(m.y)
                    && center_y < i32::from(m.y) + i32::from(m.height)
            });
            if let Some(m) = containing.or_else(|| monitors.monitors.first()) {
                return Ok((m.x, m.y, m.width, m.height));
            }
        }

        let root_geom = x
            .conn
            .get_geometry(x.root)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        Ok((0, 0, root_geom.width, root_geom.height))
    }

    fn send_root_client_message(x: &X11, event: ClientMessageEvent) -> Result<(), String> {
        let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
        x.conn
            .send_event(false, x.root, mask, event)
            .map_err(|e| e.to_string())?
            .check()
            .map_err(|e| e.to_string())?;
        x.conn.flush().map_err(|e| e.to_string())
    }

    /// Removes both maximized states via `_NET_WM_STATE`, mirroring the
    /// Windows path's `ShowWindow(SW_RESTORE)` before repositioning.
    fn unmaximize(x: &X11, window: Window) -> Result<(), String> {
        const NET_WM_STATE_REMOVE: u32 = 0;
        set_maximized_state(x, window, NET_WM_STATE_REMOVE)
    }

    fn maximize(x: &X11, window: Window) -> Result<(), String> {
        const NET_WM_STATE_ADD: u32 = 1;
        set_maximized_state(x, window, NET_WM_STATE_ADD)
    }

    /// Toggles both maximized states together in one atomic `_NET_WM_STATE`
    /// message. Used for the "fullscreen" position, matching the existing
    /// Windows semantics where "fullscreen" toggles maximize rather than
    /// requesting a true borderless-fullscreen state.
    fn toggle_maximize(x: &X11, window: Window) -> Result<(), String> {
        const NET_WM_STATE_TOGGLE: u32 = 2;
        set_maximized_state(x, window, NET_WM_STATE_TOGGLE)
    }

    fn set_maximized_state(x: &X11, window: Window, action: u32) -> Result<(), String> {
        let net_wm_state = atom(&x.conn, "_NET_WM_STATE")?;
        let horz = atom(&x.conn, "_NET_WM_STATE_MAXIMIZED_HORZ")?;
        let vert = atom(&x.conn, "_NET_WM_STATE_MAXIMIZED_VERT")?;
        let event = ClientMessageEvent::new(32, window, net_wm_state, [action, horz, vert, 1, 0]);
        send_root_client_message(x, event)
    }

    /// Moves/resizes `window` via `_NET_MOVERESIZE_WINDOW`, which (unlike a
    /// raw `ConfigureWindow`) is routed through the window manager so
    /// reparenting WMs move the decorated frame correctly.
    fn move_resize(
        x: &X11,
        window: Window,
        rx: i32,
        ry: i32,
        w: u32,
        h: u32,
    ) -> Result<(), String> {
        let net_moveresize_window = atom(&x.conn, "_NET_MOVERESIZE_WINDOW")?;
        const FLAG_X: u32 = 1 << 8;
        const FLAG_Y: u32 = 1 << 9;
        const FLAG_W: u32 = 1 << 10;
        const FLAG_H: u32 = 1 << 11;
        const SOURCE_NORMAL: u32 = 1 << 12;
        let gravity_and_flags = FLAG_X | FLAG_Y | FLAG_W | FLAG_H | SOURCE_NORMAL;
        let event = ClientMessageEvent::new(
            32,
            window,
            net_moveresize_window,
            [gravity_and_flags, rx as u32, ry as u32, w, h],
        );
        send_root_client_message(x, event)
    }

    /// ICCCM iconify request — there is no `_NET_WM_STATE` equivalent that
    /// reliably minimizes across window managers.
    fn minimize(x: &X11, window: Window) -> Result<(), String> {
        let wm_change_state = atom(&x.conn, "WM_CHANGE_STATE")?;
        const ICONIC_STATE: u32 = 3;
        let event =
            ClientMessageEvent::new(32, window, wm_change_state, [ICONIC_STATE, 0, 0, 0, 0]);
        send_root_client_message(x, event)
    }

    /// Requests activation, which deiconifies + raises + focuses on virtually
    /// every EWMH-compliant window manager.
    fn activate(x: &X11, window: Window) -> Result<(), String> {
        let net_active_window = atom(&x.conn, "_NET_ACTIVE_WINDOW")?;
        const SOURCE_NORMAL: u32 = 1;
        let event =
            ClientMessageEvent::new(32, window, net_active_window, [SOURCE_NORMAL, 0, 0, 0, 0]);
        send_root_client_message(x, event)
    }

    fn external_window(x: &X11, window: Window) -> Option<Window> {
        if window == 0 || wm_class(x, window)?.contains("volt") {
            return None;
        }
        x.conn.get_window_attributes(window).ok()?.reply().ok()?;
        Some(window)
    }

    pub(super) fn current_external_window() -> Option<u64> {
        let x = connect().ok()?;
        external_window(&x, active_window(&x).ok()?).map(u64::from)
    }

    pub fn snap_window_impl(app: &AppHandle, position: &str) -> Result<(), String> {
        let x = connect()?;

        let target_window = app
            .try_state::<super::SnapTargetState>()
            .and_then(|state| state.validated_target())
            .and_then(|stored| u32::try_from(stored).ok())
            .and_then(|stored| external_window(&x, stored));
        let window =
            target_window.ok_or_else(|| "No previously focused window found".to_string())?;

        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }

        match position {
            "maximize" => maximize(&x, window),
            "minimize" => minimize(&x, window),
            "restore" => {
                unmaximize(&x, window)?;
                activate(&x, window)
            }
            "fullscreen" => toggle_maximize(&x, window),
            "left_half" | "right_half" | "top_half" | "bottom_half" | "top_left" | "top_right"
            | "bottom_left" | "bottom_right" | "center" => {
                let (wa_x, wa_y, wa_w, wa_h) = monitor_rect_for_window(&x, window)?;
                let (wa_x, wa_y, wa_w, wa_h) = (wa_x as i32, wa_y as i32, wa_w as i32, wa_h as i32);
                let left_w = wa_w / 2;
                let right_w = wa_w - left_w;
                let top_h = wa_h / 2;
                let bottom_h = wa_h - top_h;
                unmaximize(&x, window)?;
                match position {
                    "left_half" => move_resize(&x, window, wa_x, wa_y, left_w as u32, wa_h as u32),
                    "right_half" => move_resize(
                        &x,
                        window,
                        wa_x + wa_w / 2,
                        wa_y,
                        right_w as u32,
                        wa_h as u32,
                    ),
                    "top_half" => move_resize(&x, window, wa_x, wa_y, wa_w as u32, top_h as u32),
                    "bottom_half" => move_resize(
                        &x,
                        window,
                        wa_x,
                        wa_y + wa_h / 2,
                        wa_w as u32,
                        bottom_h as u32,
                    ),
                    "top_left" => move_resize(&x, window, wa_x, wa_y, left_w as u32, top_h as u32),
                    "top_right" => move_resize(
                        &x,
                        window,
                        wa_x + wa_w / 2,
                        wa_y,
                        right_w as u32,
                        top_h as u32,
                    ),
                    "bottom_left" => move_resize(
                        &x,
                        window,
                        wa_x,
                        wa_y + wa_h / 2,
                        left_w as u32,
                        bottom_h as u32,
                    ),
                    "bottom_right" => move_resize(
                        &x,
                        window,
                        wa_x + wa_w / 2,
                        wa_y + wa_h / 2,
                        right_w as u32,
                        bottom_h as u32,
                    ),
                    "center" => {
                        let (_, _, win_w, win_h) = absolute_geometry(&x, window)?;
                        let x_pos = wa_x + (wa_w - win_w as i32) / 2;
                        let y_pos = wa_y + (wa_h - win_h as i32) / 2;
                        move_resize(&x, window, x_pos, y_pos, win_w as u32, win_h as u32)
                    }
                    _ => unreachable!(),
                }
            }
            _ => Err(format!("Unknown position: {}", position)),
        }
    }
}

/// Snap/resize/move the foreground window to the given position.
///
/// The backend validates the explicit target recorded before Volt took focus,
/// so a Z-order neighbor or a focus change after hide cannot become the target.
/// On failure Volt is shown again.
#[tauri::command]
#[allow(clippy::needless_return, clippy::collapsible_if)]
pub async fn snap_window(app: tauri::AppHandle, position: String) -> Result<(), String> {
    // Validate early to avoid hiding for bad input
    const VALID: &[&str] = &[
        "left_half",
        "right_half",
        "top_half",
        "bottom_half",
        "top_left",
        "top_right",
        "bottom_left",
        "bottom_right",
        "center",
        "maximize",
        "minimize",
        "restore",
        "fullscreen",
    ];
    if !VALID.contains(&position.as_str()) {
        return Err(format!("Unknown position: {}", position));
    }

    #[cfg(target_os = "windows")]
    {
        let res = windows_impl::snap_window_impl(&app, &position);
        if res.is_err() {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        return res;
    }
    #[cfg(target_os = "linux")]
    {
        let res = linux_impl::snap_window_impl(&app, &position);
        if res.is_err() {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        return res;
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = app;
        let _ = position;
        Err("Window management is currently only supported on Windows and Linux".to_string())
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
        .decorations(false);

    // `.transparent(true)` on `WebviewWindowBuilder` is only compiled on macOS
    // when the `macos-private-api` Tauri Cargo feature is enabled (Apple gates
    // the underlying NSWindow API). Volt doesn't enable that feature, so on
    // macOS we ship the Notes window opaque rather than fail to build.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);

    let builder = builder
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
