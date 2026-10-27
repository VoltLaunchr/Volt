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

/// Capture small helper output with a deadline covering BOTH output and exit. Kill and reap
/// on timeout/overflow; kill_on_drop also covers cancellation of the caller.
#[cfg(any(target_os = "windows", test))]
pub(crate) async fn bounded_output(
    mut command: tokio::process::Command,
    deadline: std::time::Duration,
    limit: usize,
) -> std::io::Result<Vec<u8>> {
    use std::io::{Error, ErrorKind};
    use std::process::Stdio;
    use tokio::io::AsyncReadExt;

    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Error::other("helper stdout unavailable"))?;
    let operation = async {
        let read = async {
            let mut bytes = Vec::new();
            stdout
                .take(limit as u64 + 1)
                .read_to_end(&mut bytes)
                .await?;
            if bytes.len() > limit {
                return Err(Error::other("helper output limit exceeded"));
            }
            Ok(bytes)
        };
        let (bytes, status) = tokio::try_join!(read, child.wait())?;
        if !status.success() {
            return Err(Error::other(format!("helper exited with {status}")));
        }
        Ok(bytes)
    };
    let result = tokio::time::timeout(deadline, operation)
        .await
        .unwrap_or_else(|_| Err(Error::new(ErrorKind::TimedOut, "helper timed out")));
    if result.is_err() {
        let _ = child.kill().await;
    }
    result
}

/// Reaps a fire-and-forget child in the background so it doesn't linger as a
/// zombie for the app's lifetime.
///
/// `Command::spawn` never reaps on its own — on Unix, an exited child stays
/// in the process table as `<defunct>` until something calls `wait()` on it.
/// Volt is a long-running background app (it stays alive for the whole
/// session to serve the hotkey), so any fire-and-forget spawn that skips this
/// leaves a permanent zombie entry — one per app/command launched, none of
/// them cleaned up until Volt itself quits. No-op on Windows, which has no
/// equivalent concept, so callers can use it unconditionally.
#[cfg(unix)]
pub fn reap_in_background(mut child: std::process::Child) {
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

#[cfg(not(unix))]
pub fn reap_in_background(_child: std::process::Child) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    #[ignore = "invoked as a synthetic subprocess"]
    fn synthetic_process() {
        match std::env::var("VOLT_OUTPUT_TEST").as_deref() {
            Ok("slow") => std::thread::sleep(Duration::from_secs(30)),
            Ok("large") => {
                use std::io::Write;
                let _ = std::io::stdout().write_all(&vec![b'x'; 1024 * 1024]);
            }
            Ok("ok") => println!("helper-ready"),
            _ => panic!("synthetic mode required"),
        }
    }

    fn synthetic(mode: &str) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--ignored",
                "--exact",
                "utils::process::tests::synthetic_process",
                "--nocapture",
            ])
            .env("VOLT_OUTPUT_TEST", mode);
        no_window_tokio(&mut command);
        command
    }

    #[tokio::test]
    async fn captures_small_output() {
        let bytes = bounded_output(synthetic("ok"), Duration::from_secs(5), 4096)
            .await
            .unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("helper-ready"));
    }

    #[tokio::test]
    async fn stops_slow_or_verbose_helpers() {
        let error = bounded_output(synthetic("slow"), Duration::from_millis(200), 4096)
            .await
            .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        let error = bounded_output(synthetic("large"), Duration::from_secs(5), 4096)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("output limit"));
    }
}
