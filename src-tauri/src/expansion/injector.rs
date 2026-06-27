//! Reads the system clipboard for `{clipboard}` variable resolution and
//! injects the expanded snippet text into the foreground application via
//! `SendInput`.
//!
//! Windows + `snippet-global-expansion` only, except
//! `count_backspaces_for_trigger` which is pure and unit-tested.

/// Read the current system clipboard text, if any. Uses a dedicated
/// `arboard::Clipboard` instance (separate from the clipboard-manager
/// plugin's) so the two subsystems never contend over the same handle.
#[cfg(all(windows, feature = "snippet-global-expansion"))]
pub(crate) fn read_system_clipboard_text() -> Option<String> {
    arboard::Clipboard::new()
        .ok()
        .and_then(|mut cb| cb.get_text().ok())
}

/// Resolve `{date}`/`{time}`/`{clipboard}`/`{random}` variables in a
/// snippet's content, reusing the exact same logic as the in-app snippet
/// plugin (`crate::commands::content::snippets::resolve_variables`) so the
/// two expansion paths never drift apart.
#[cfg(all(windows, feature = "snippet-global-expansion"))]
pub(crate) fn resolve_snippet_content(content: &str) -> String {
    let clipboard = read_system_clipboard_text();
    crate::commands::content::snippets::resolve_variables(content, clipboard.as_deref())
}

/// Number of backspace keystrokes required to erase a typed trigger.
///
/// Each `VK_BACK` keystroke (as injected via `SendInput`/`KEYEVENTF_UNICODE`
/// text entry) removes exactly one UTF-16 code unit in virtually every text
/// control, so the count is the trigger's length in UTF-16 code units —
/// NOT its `chars().count()` (which would undercount surrogate-pair
/// characters such as emoji).
pub(crate) fn count_backspaces_for_trigger(trigger: &str) -> u32 {
    trigger.encode_utf16().count() as u32
}

/// Send `backspace_count` backspace keystrokes followed by `text`, via
/// `SendInput`. Backspaces use plain `VK_BACK` key events; `text` is sent
/// unit-by-unit as `KEYEVENTF_UNICODE` events so it works regardless of the
/// active keyboard layout (the same approach Windows' own on-screen keyboard
/// and IME composition use to inject arbitrary Unicode).
#[cfg(all(windows, feature = "snippet-global-expansion"))]
pub(crate) fn send_input_sequence(backspace_count: u32, text: &str) -> Result<(), String> {
    use std::mem;
    use winapi::um::winuser::{
        INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, SendInput, VK_BACK,
    };

    let make_key = |vk: u16, scan: u16, flags: u32| -> INPUT {
        // SAFETY: `INPUT` is a plain-old-data union; zeroing then filling the
        // keyboard-event member is the standard winapi pattern used
        // elsewhere in this codebase (see `commands::system::clipboard`).
        let mut input: INPUT = unsafe { mem::zeroed() };
        input.type_ = INPUT_KEYBOARD;
        *unsafe { input.u.ki_mut() } = KEYBDINPUT {
            wVk: vk,
            wScan: scan,
            dwFlags: flags,
            time: 0,
            dwExtraInfo: 0,
        };
        input
    };

    let mut inputs: Vec<INPUT> =
        Vec::with_capacity((backspace_count as usize) * 2 + text.len() * 2);

    for _ in 0..backspace_count {
        inputs.push(make_key(VK_BACK as u16, 0, 0));
        inputs.push(make_key(VK_BACK as u16, 0, KEYEVENTF_KEYUP));
    }

    for unit in text.encode_utf16() {
        inputs.push(make_key(0, unit, KEYEVENTF_UNICODE));
        inputs.push(make_key(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
    }

    if inputs.is_empty() {
        return Ok(());
    }

    // SAFETY: `inputs` is a valid, non-empty, properly-sized `Vec<INPUT>`
    // that outlives the call; `SendInput` reads exactly `inputs.len()`
    // entries.
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            mem::size_of::<INPUT>() as i32,
        )
    };

    if sent as usize != inputs.len() {
        return Err(format!(
            "SendInput injected {} of {} events",
            sent,
            inputs.len()
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_backspaces_ascii() {
        assert_eq!(count_backspaces_for_trigger(";sig"), 4);
    }

    #[test]
    fn count_backspaces_empty() {
        assert_eq!(count_backspaces_for_trigger(""), 0);
    }

    #[test]
    fn count_backspaces_precomposed_accent() {
        // "café" — 'é' here is the single precomposed codepoint U+00E9,
        // which is exactly 1 UTF-16 code unit (within the BMP).
        let trigger = "caf\u{00E9}";
        assert_eq!(trigger.chars().count(), 4);
        assert_eq!(count_backspaces_for_trigger(trigger), 4);
    }

    #[test]
    fn count_backspaces_emoji_surrogate_pair() {
        // "👍" (U+1F44D) is outside the BMP: 1 `char`, but 2 UTF-16 code
        // units (a surrogate pair), so it requires 2 backspaces.
        let trigger = ";\u{1F44D}";
        assert_eq!(trigger.chars().count(), 2);
        assert_eq!(count_backspaces_for_trigger(trigger), 3);
    }
}
