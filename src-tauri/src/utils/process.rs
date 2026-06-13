//! Process spawn helpers.
//!
//! Tauri apps have no parent console, so every Windows child process inherits
//! a fresh `conhost.exe` window unless we set `CREATE_NO_WINDOW`. This shows up
//! as a brief PowerShell/cmd flash whenever the app calls out to `powershell`,
//! `cmd /c start`, or any `.ps1`/`.bat` from Rust. Every `Command::new` site
//! that targets a Windows shell-class binary must funnel through here.

/// `CREATE_NO_WINDOW` from `winbase.h`. Set on every child process so the
/// Windows launcher doesn't conjure a console window for headless commands.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply `CREATE_NO_WINDOW` to a `std::process::Command` in-place. No-op on
/// non-Windows platforms so callers can use it unconditionally.
#[cfg(windows)]
pub fn no_window(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
pub fn no_window(cmd: &mut std::process::Command) -> &mut std::process::Command {
    cmd
}

/// Same as `no_window` but for `tokio::process::Command`. Kept separate so we
/// don't pull tokio into modules that only use the std spawn API.
#[cfg(windows)]
pub fn no_window_tokio(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
pub fn no_window_tokio(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    cmd
}
