//! Shared X11 (EWMH/ICCCM) connection helpers for Linux. Used by window
//! snapping, foreground-app-name resolution (clipboard source tagging), and
//! simulated paste (XTEST). Also works against XWayland — the X11
//! compatibility server most Wayland compositors run for legacy apps — but
//! NOT against native Wayland clients, which have no equivalent
//! foreign-window-control protocol available to an unprivileged app.

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt as _, Window};
use x11rb::rust_connection::RustConnection;

pub(crate) struct X11 {
    pub(crate) conn: RustConnection,
    pub(crate) root: Window,
}

pub(crate) fn connect() -> Result<X11, String> {
    let (conn, screen_num) =
        RustConnection::connect(None).map_err(|e| format!("X11 connect failed: {e}"))?;
    let root = conn.setup().roots[screen_num].root;
    Ok(X11 { conn, root })
}

pub(crate) fn atom(conn: &RustConnection, name: &str) -> Result<Atom, String> {
    conn.intern_atom(false, name.as_bytes())
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())
        .map(|r| r.atom)
}

/// The window most recently focused by the window manager — the X11
/// equivalent of `GetForegroundWindow()`.
pub(crate) fn active_window(x: &X11) -> Result<Window, String> {
    let net_active_window = atom(&x.conn, "_NET_ACTIVE_WINDOW")?;
    let reply = x
        .conn
        .get_property(false, x.root, net_active_window, AtomEnum::WINDOW, 0, 1)
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?;
    reply
        .value32()
        .and_then(|mut it| it.next())
        .filter(|w| *w != 0)
        .ok_or_else(|| "No active window found".to_string())
}

/// The `WM_CLASS` "class" component (the second NUL-separated string; falls
/// back to the first/"instance" component if the class is empty) of
/// `window` — the conventional per-application identifier (e.g. "firefox",
/// "code"), closest Linux/X11 equivalent of a Windows executable basename.
pub(crate) fn wm_class(x: &X11, window: Window) -> Option<String> {
    let reply = x
        .conn
        .get_property(false, window, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 1024)
        .ok()?
        .reply()
        .ok()?;
    let mut parts = reply.value.split(|&b| b == 0).filter(|p| !p.is_empty());
    let instance = parts.next();
    let class = parts.next().or(instance)?;
    Some(String::from_utf8_lossy(class).to_lowercase())
}

#[cfg(test)]
mod tests {
    #[test]
    fn wm_class_prefers_second_nul_separated_component() {
        // WM_CLASS payload: "code\0Code\0" -> instance="code", class="Code".
        let value = b"code\0Code\0".to_vec();
        let mut parts = value.split(|&b| b == 0).filter(|p| !p.is_empty());
        let instance = parts.next();
        let class = parts.next().or(instance).unwrap();
        assert_eq!(String::from_utf8_lossy(class).to_lowercase(), "code");
    }

    #[test]
    fn wm_class_falls_back_to_instance_when_class_missing() {
        let value = b"onlyinstance\0".to_vec();
        let mut parts = value.split(|&b| b == 0).filter(|p| !p.is_empty());
        let instance = parts.next();
        let class = parts.next().or(instance).unwrap();
        assert_eq!(
            String::from_utf8_lossy(class).to_lowercase(),
            "onlyinstance"
        );
    }
}
