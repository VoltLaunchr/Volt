//! Wayland clipboard/paste fallback. Tool input and exit share one deadline;
//! dropping the future kills the child. Tests use synthetic child processes,
//! never the real clipboard or virtual keyboard.

use std::ffi::OsString;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[cfg(target_os = "linux")]
const TOOL_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(target_os = "linux")]
pub(crate) fn is_wayland_session() -> bool {
    is_wayland_session_with_value(std::env::var_os("WAYLAND_DISPLAY"))
}

fn is_wayland_session_with_value(value: Option<OsString>) -> bool {
    value.is_some_and(|value| !value.is_empty())
}

/// Feed text over stdin, so clipboard content is never interpreted as argv.
#[cfg(target_os = "linux")]
pub(crate) async fn wl_copy_text(text: &str) -> Result<(), String> {
    run_tool(
        Command::new("wl-copy"),
        Some(text.as_bytes()),
        TOOL_TIMEOUT,
        "wl-copy",
        "wl-clipboard",
    )
    .await
}

#[cfg(target_os = "linux")]
pub(crate) async fn wtype_ctrl_v() -> Result<(), String> {
    let mut command = Command::new("wtype");
    command.args(["-M", "ctrl", "-k", "v", "-m", "ctrl"]);
    run_tool(command, None, TOOL_TIMEOUT, "wtype", "wtype").await
}

async fn run_tool(
    mut command: Command,
    input: Option<&[u8]>,
    timeout: Duration,
    binary: &str,
    package: &str,
) -> Result<(), String> {
    // Unused output goes to /dev/null rather than a pipe that could fill while
    // stdin is being written. kill_on_drop also covers task cancellation.
    let mut child = command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| map_spawn_error(binary, package, error))?;

    let operation = async {
        if let Some(input) = input {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| format!("{binary}: stdin unavailable"))?;
            stdin
                .write_all(input)
                .await
                .map_err(|error| format!("{binary}: stdin failed: {error}"))?;
            drop(stdin);
        }
        let status = child
            .wait()
            .await
            .map_err(|error| format!("{binary}: wait failed: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "{binary} failed with exit status {status} (check compositor support)"
            ))
        }
    };
    match tokio::time::timeout(timeout, operation).await {
        Ok(Ok(())) => Ok(()),
        result => {
            // Reap failed/timed-out children; kill_on_drop remains the guard
            // when the caller cancels this future before cleanup completes.
            let _ = child.kill().await;
            match result {
                Ok(error) => error,
                Err(_) => Err(format!(
                    "{binary} timed out after {}ms",
                    timeout.as_millis()
                )),
            }
        }
    }
}

fn map_spawn_error(binary: &str, package: &str, error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        format!(
            "{binary} not found (install package `{package}`); Wayland clipboard/paste fallback unavailable: {error}"
        )
    } else {
        format!("failed to spawn {binary}: {error}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_wayland_display() {
        assert!(is_wayland_session_with_value(Some("wayland-1".into())));
        assert!(!is_wayland_session_with_value(None));
        assert!(!is_wayland_session_with_value(Some("".into())));
    }

    #[test]
    fn spawn_errors_are_actionable() {
        let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert!(
            map_spawn_error("wl-copy", "wl-clipboard", missing)
                .contains("install package `wl-clipboard`")
        );
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(map_spawn_error("wtype", "wtype", denied).contains("failed to spawn wtype"));
    }

    // The test binary acts as a synthetic tool; no session input is touched.
    #[test]
    #[ignore = "synthetic child invoked only by the process tests"]
    fn synthetic_tool() {
        use std::io::{Read, Write};
        match std::env::var("VOLT_WAYLAND_TEST_MODE").as_deref() {
            Ok("blocked") => std::thread::sleep(Duration::from_secs(30)),
            Ok("copy") => {
                // A full diagnostic pipe used to deadlock the parent.
                std::io::stderr()
                    .write_all(&vec![b'x'; 1024 * 1024])
                    .unwrap();
                let mut input = Vec::new();
                std::io::stdin().read_to_end(&mut input).unwrap();
                assert_eq!(input, vec![b'-'; 1024 * 1024]);
            }
            _ => panic!("synthetic tool requires a test mode"),
        }
    }

    fn synthetic_command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.args([
            "--ignored",
            "--exact",
            "utils::wayland::tests::synthetic_tool",
        ]);
        command.env("VOLT_WAYLAND_TEST_MODE", mode);
        command
    }

    #[tokio::test]
    async fn deadline_includes_blocked_stdin() {
        let input = vec![b'-'; 1024 * 1024];
        let result = run_tool(
            synthetic_command("blocked"),
            Some(&input),
            Duration::from_millis(100),
            "synthetic",
            "test",
        )
        .await;
        assert!(result.unwrap_err().contains("timed out"));
    }

    #[tokio::test]
    async fn large_input_and_diagnostics_do_not_deadlock() {
        let input = vec![b'-'; 1024 * 1024];
        run_tool(
            synthetic_command("copy"),
            Some(&input),
            Duration::from_secs(10),
            "synthetic",
            "test",
        )
        .await
        .unwrap();
    }
}
