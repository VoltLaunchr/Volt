//! Translates raw `WH_KEYBOARD_LL` key events into the Unicode character(s)
//! they produce, honoring the foreground application's active keyboard
//! layout (so AZERTY/QWERTY/dead-keys etc. resolve correctly even though the
//! hook itself runs on a dedicated thread with no keyboard layout of its
//! own).
//!
//! Windows + `snippet-global-expansion` only. Not unit-tested: doing so
//! would require driving real `ToUnicodeEx`/keyboard-layout state, which the
//! project's safety rules for this feature explicitly forbid exercising
//! automatically (see CLAUDE.md / task instructions for this module).

use winapi::shared::minwindef::{BYTE, UINT};
use winapi::um::winuser::{
    GetAsyncKeyState, GetForegroundWindow, GetKeyState, GetKeyboardLayout,
    GetWindowThreadProcessId, ToUnicodeEx,
};

/// A raw, minimally-processed `WM_KEYDOWN`/`WM_SYSKEYDOWN` event captured by
/// the low-level keyboard hook.
#[derive(Debug, Clone, Copy)]
pub struct RawKeyEvent {
    pub vk_code: u32,
    pub scan_code: u32,
    pub flags: u32,
    pub time: u32,
}

/// Resolve a raw key event to the Unicode character(s) it produces under the
/// *foreground* window's keyboard layout.
///
/// Returns an empty `Vec` for non-printing keys (arrows, function keys,
/// modifiers alone, dead-key first stage, etc.) — callers should simply skip
/// pushing anything into the trigger buffer in that case.
pub fn resolve_to_chars(event: &RawKeyEvent) -> Vec<char> {
    // SAFETY: all calls are standard, well-defined Win32 APIs. `GetKeyState`
    // is read from this thread (per-thread input state, but modifier key
    // state — Shift/Ctrl/Alt/CapsLock — is global enough for our purposes);
    // `ToUnicodeEx` writes into a stack buffer we own and bound-check.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return Vec::new();
        }

        let mut foreground_pid: u32 = 0;
        let foreground_thread_id = GetWindowThreadProcessId(hwnd, &mut foreground_pid as *mut u32);
        if foreground_thread_id == 0 {
            return Vec::new();
        }

        let hkl = GetKeyboardLayout(foreground_thread_id);

        // Build a 256-entry virtual-key state array as ToUnicodeEx expects,
        // populated with the live state of modifier keys so Shift/AltGr
        // combinations and dead keys resolve correctly.
        //
        // Two easy-to-get-backwards Win32 conventions here:
        // 1. `GetKeyState` reports "is this key down" relative to the
        //    *calling thread's* input queue — this background processor
        //    thread never pumps any messages, so `GetKeyState` would read a
        //    frozen/stale snapshot. `GetAsyncKeyState` reads the real-time
        //    physical key state regardless of which thread calls it, which
        //    is what we need from a worker thread with no message loop.
        // 2. `GetAsyncKeyState`'s return value has the "currently down" bit
        //    at bit 15 (0x8000), but the `lpKeyState` array `ToUnicodeEx`
        //    expects encodes "down" in bit 7 (0x80) of *each byte* — they are
        //    different bit positions in different-sized values.
        let mut key_state = [0u8; 256];
        for vk in [
            winapi::um::winuser::VK_SHIFT,
            winapi::um::winuser::VK_CONTROL,
            winapi::um::winuser::VK_MENU,
            winapi::um::winuser::VK_LSHIFT,
            winapi::um::winuser::VK_RSHIFT,
            winapi::um::winuser::VK_LCONTROL,
            winapi::um::winuser::VK_RCONTROL,
            winapi::um::winuser::VK_LMENU,
            winapi::um::winuser::VK_RMENU,
        ] {
            let state = GetAsyncKeyState(vk) as u16;
            key_state[vk as usize] = if state & 0x8000 != 0 { 0x80 } else { 0 };
        }
        // CapsLock is a toggle key: its global lock state (not "is it
        // currently held down") is what affects letter case, and `ToUnicodeEx`
        // expects toggle state in bit 0 of the array byte, not bit 7. Unlike
        // the modifier-down state above, the toggle indicator is global OS
        // state rather than calling-thread-queue state, so plain
        // `GetKeyState` is correct here.
        let caps_state = GetKeyState(winapi::um::winuser::VK_CAPITAL) as u16;
        key_state[winapi::um::winuser::VK_CAPITAL as usize] = (caps_state & 0x01) as BYTE;

        let mut buf = [0u16; 8];
        let result = ToUnicodeEx(
            event.vk_code as UINT,
            event.scan_code as UINT,
            key_state.as_ptr(),
            buf.as_mut_ptr(),
            buf.len() as i32,
            0,
            hkl,
        );

        if result <= 0 {
            // 0 = no translation, -1 = dead key (first stage already
            // consumed by Windows internally); neither produces a char we
            // should push now.
            return Vec::new();
        }

        let len = result as usize;
        String::from_utf16_lossy(&buf[..len]).chars().collect()
    }
}
