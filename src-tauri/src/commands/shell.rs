use crate::core::error::VoltError;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::task::{AbortHandle, JoinHandle};
use tracing::{info, warn};

use crate::commands::settings::{load_settings, ShellSettings};
use crate::commands::shell_history::{self, ShellHistoryState};

/// Maximum output size per stream (stdout/stderr) in bytes.
const MAX_OUTPUT_BYTES: usize = 50_000;

/// Default command timeout in milliseconds when no setting is available.
const DEFAULT_TIMEOUT_MS: u64 = 30_000;

/// Slack applied to the outer IPC-level timeout so the inner per-command timeout
/// has a chance to emit a TimedOut event before the outer one trips.
const OUTER_TIMEOUT_SLACK_MS: u64 = 2_000;

/// Max length of a command logged at `info!` level. Prevents secrets typed in
/// long commands from landing in rotating log files.
const LOG_COMMAND_MAX_LEN: usize = 80;

/// Max number of completed execution_ids kept for record_shell_command token
/// verification. FIFO-pruned.
const COMPLETED_TOKENS_MAX: usize = 100;

/// Server-side blocklist of dangerous command patterns.
///
/// The frontend in `shell/index.ts` has its own `BLOCKED_PATTERNS` list, but
/// client-side enforcement is bypassed by any caller that can reach `invoke()`
/// (extensions escaping the Worker sandbox, XSS in dev tools, …). This
/// Rust-side mirror is the actual trust boundary.
static BLOCKED_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    // Compile once at startup. Any invalid pattern panics early rather than
    // silently disabling the block.
    [
        // rm -rf / (any path starting with /) — use case-insensitive whole words
        r"(?i)\brm\s+(-\w*)?r\w*\s+(-\w*\s+)*/",
        // rm -rf C:\ style (Windows root)
        r"(?i)\brm\s+(-\w*)?r\w*\s+(-\w*\s+)*[a-z]:\\",
        r"(?i)\bformat\s+[a-z]:",
        r"(?i)\bmkfs\b",
        r"(?i)\bdd\s+.*\bof=/",
        r"(?i)\bshutdown\b",
        r"(?i)\breboot\b",
        r"(?i)\binit\s+0\b",
        r"(?i)\bhalt\b",
        r"(?i)\bpoweroff\b",
        // fork bomb :(){ :|:& };:
        r":\(\)\{.*\}.*;",
        r"(?i)\bwhile\s+true.*do.*done",
        // Windows registry / event log wipe
        r"(?i)\breg\s+delete\s+hk",
        r"(?i)\bwevtutil\s+cl\b",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("valid regex"))
    .collect()
});

/// Regex patterns used to redact likely secrets from a command string before
/// it is logged or persisted. Best-effort — not a replacement for never
/// typing credentials on the CLI.
static REDACTORS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    [
        // URL userinfo: scheme://user:password@host -> scheme://***@host
        (r"([a-z][a-z0-9+\-.]*)://[^/\s:@]+:[^/\s@]+@", "$1://***@"),
        // Authorization headers: "Authorization: Bearer …" / "Basic …"
        (
            r#"(?i)(authorization:\s*(?:bearer|basic|token)\s+)[^\s"']+"#,
            "${1}***",
        ),
        // --token, --password, --api-key, --apikey, --auth, --secret followed by value
        (
            r#"(?i)(--(?:token|password|passwd|api[-_]?key|auth|secret|pwd)(?:\s+|=))(?:"[^"]*"|'[^']*'|[^\s]+)"#,
            "${1}***",
        ),
        // ENVVAR=value for *_TOKEN / _KEY / _SECRET / _PASSWORD / _PWD vars
        (
            r"(?i)(\b[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|PWD|APIKEY)\s*=)\S+",
            "${1}***",
        ),
    ]
    .iter()
    .map(|(p, r)| (Regex::new(p).expect("valid redactor"), *r))
    .collect()
});

/// Apply the redactors in sequence and return a sanitized copy of the command.
pub fn redact_command(command: &str) -> String {
    let mut out = command.to_string();
    for (re, repl) in REDACTORS.iter() {
        out = re.replace_all(&out, *repl).into_owned();
    }
    out
}

/// Truncate a string for logging so that even a non-redacted fragment stays
/// bounded. Combined with `redact_command` when the input is a shell command.
fn truncate_for_log(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        return s.to_string();
    }
    let cutoff = s
        .char_indices()
        .nth(max_len)
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    format!("{}… [truncated]", &s[..cutoff])
}

/// Check whether `command` matches any of the hard-blocked patterns.
pub fn is_command_blocked(command: &str) -> bool {
    let normalized = command.trim();
    BLOCKED_PATTERNS.iter().any(|re| re.is_match(normalized))
}

/// Result of a shell command execution.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub execution_time_ms: u64,
    pub timed_out: bool,
}

/// Options for running a shell command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandOptions {
    pub command: String,
    pub timeout_ms: Option<u64>,
    pub working_dir: Option<String>,
}

/// Events streamed to the frontend during shell command execution.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ShellOutputEvent {
    Stdout { line: String },
    Stderr { line: String },
    Exit { code: i32, execution_time_ms: u64 },
    Error { message: String },
    TimedOut { execution_time_ms: u64 },
}

/// Handle stored for each running process. The `Child` is shared so that
/// the outer IPC-level timeout can kill it directly instead of relying on
/// the already-cancelled inner task to observe a kill flag.
struct RunningProcess {
    abort_handle: AbortHandle,
    kill_flag: Arc<AtomicBool>,
    child: Arc<tokio::sync::Mutex<Option<Child>>>,
    reader_aborts: Vec<AbortHandle>,
}

/// Managed state for tracking running and recently-completed shell commands.
///
/// - `running`: execution_id → handle, for cancellation.
/// - `completed`: bounded FIFO of execution_ids that completed naturally.
///   Used to validate `record_shell_command` callers (IPC token): a caller
///   cannot fabricate a record for a command they did not actually run.
pub struct ShellExecutionState {
    running: Mutex<HashMap<String, RunningProcess>>,
    completed: Mutex<(HashSet<String>, VecDeque<String>)>,
}

impl Default for ShellExecutionState {
    fn default() -> Self {
        Self {
            running: Mutex::new(HashMap::new()),
            completed: Mutex::new((HashSet::new(), VecDeque::new())),
        }
    }
}

impl ShellExecutionState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mark an execution as completed. FIFO-prune when over cap.
    fn mark_completed(&self, execution_id: &str) {
        if let Ok(mut guard) = self.completed.lock() {
            let (set, queue) = &mut *guard;
            if set.insert(execution_id.to_string()) {
                queue.push_back(execution_id.to_string());
                while queue.len() > COMPLETED_TOKENS_MAX {
                    if let Some(oldest) = queue.pop_front() {
                        set.remove(&oldest);
                    }
                }
            }
        }
    }

    /// Consume a completion token. Returns true if present.
    pub fn consume_completion(&self, execution_id: &str) -> bool {
        if let Ok(mut guard) = self.completed.lock() {
            let (set, queue) = &mut *guard;
            if set.remove(execution_id) {
                queue.retain(|id| id != execution_id);
                return true;
            }
        }
        false
    }
}

/// Truncate a string to at most `max_bytes` bytes at a valid UTF-8 boundary.
fn truncate_output(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    let mut truncated = s[..end].to_string();
    truncated.push_str("\n[... output truncated at 50KB ...]");
    truncated
}

/// Build a `tokio::process::Command` for the platform shell, optionally using
/// the user-configured shell override from settings.
fn build_shell_command(
    command: &str,
    working_dir: Option<&str>,
    default_shell: Option<&str>,
) -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    let (shell_default, flag_default): (&str, &str) = ("cmd", "/C");

    #[cfg(not(target_os = "windows"))]
    let (shell_default, flag_default): (&str, &str) = ("sh", "-c");

    // Map user-configured shell names to a (binary, exec-flag) pair. Unknown
    // names fall back to the platform default so a typo can't break shell
    // execution entirely.
    let (shell, flag): (&str, &str) = match default_shell.map(|s| s.to_lowercase()) {
        Some(s) if s == "powershell" => ("powershell", "-Command"),
        Some(s) if s == "pwsh" => ("pwsh", "-Command"),
        Some(s) if s == "bash" => ("bash", "-c"),
        Some(s) if s == "zsh" => ("zsh", "-c"),
        Some(s) if s == "sh" => ("sh", "-c"),
        Some(s) if s == "cmd" => ("cmd", "/C"),
        _ => (shell_default, flag_default),
    };

    let mut process = tokio::process::Command::new(shell);
    process.arg(flag).arg(command);

    if let Some(dir) = working_dir {
        process.current_dir(dir);
    }

    // Prevent the child from opening a visible console window on Windows.
    // `tokio::process::Command` exposes `creation_flags` directly on Windows,
    // so no `CommandExt` trait import is needed.
    #[cfg(target_os = "windows")]
    {
        process.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    process
}

/// Validate access to shell execution: load settings, reject if disabled,
/// reject blocked patterns, return a normalised command + effective settings.
async fn validate_shell_access(
    app_handle: &AppHandle,
    raw_command: &str,
) -> Result<(String, ShellSettings), VoltError> {
    let command = raw_command.trim().to_string();
    if command.is_empty() {
        return Err(VoltError::InvalidConfig("Empty command".to_string()));
    }

    // Load settings and gate on the user-facing toggle.
    let settings = load_settings(app_handle.clone()).await?;
    if !settings.shell.enabled {
        return Err(VoltError::PermissionDenied(
            "Shell commands are disabled in settings".to_string(),
        ));
    }

    if is_command_blocked(&command) {
        warn!(
            "Blocked dangerous shell command: {}",
            truncate_for_log(&redact_command(&command), LOG_COMMAND_MAX_LEN)
        );
        return Err(VoltError::PermissionDenied(
            "This command is blocked for safety. It could cause irreversible damage.".to_string(),
        ));
    }

    Ok((command, settings.shell))
}

/// Execute a shell command and return its output (non-streaming).
#[tauri::command]
pub async fn execute_shell_command(
    app_handle: AppHandle,
    options: ShellCommandOptions,
    execution_id: String,
    state: tauri::State<'_, ShellExecutionState>,
    history_state: tauri::State<'_, ShellHistoryState>,
) -> Result<ShellCommandOutput, VoltError> {
    let (command, shell_settings) = validate_shell_access(&app_handle, &options.command).await?;

    let timeout_ms = options
        .timeout_ms
        .or(Some(shell_settings.timeout_ms))
        .unwrap_or(DEFAULT_TIMEOUT_MS);
    let working_dir = options
        .working_dir
        .clone()
        .or_else(|| shell_settings.working_dir.clone());

    info!(
        "Executing shell command: {} (timeout={}ms, id={})",
        truncate_for_log(&redact_command(&command), LOG_COMMAND_MAX_LEN),
        timeout_ms,
        execution_id
    );

    // Spawn the child first so spawn errors surface directly to the caller.
    let mut process = build_shell_command(
        &command,
        working_dir.as_deref(),
        shell_settings.default_shell.as_deref(),
    );
    process.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = process
        .spawn()
        .map_err(|e| VoltError::Launch(format!("Failed to spawn command: {}", e)))?;

    let child_stdout = child.stdout.take();
    let child_stderr = child.stderr.take();

    let child_shared: Arc<tokio::sync::Mutex<Option<Child>>> =
        Arc::new(tokio::sync::Mutex::new(Some(child)));
    let kill_flag = Arc::new(AtomicBool::new(false));

    // Register BEFORE spawning the driving task so an early drop of this
    // future always has a kill path.
    let child_for_state = Arc::clone(&child_shared);
    let kill_flag_for_state = Arc::clone(&kill_flag);

    let (stdout_handle, stderr_handle): (JoinHandle<Vec<u8>>, JoinHandle<Vec<u8>>) = (
        tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(stdout) = child_stdout {
                let mut reader = BufReader::new(stdout);
                let _ = tokio::io::AsyncReadExt::read_to_end(&mut reader, &mut buf).await;
            }
            buf
        }),
        tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(stderr) = child_stderr {
                let mut reader = BufReader::new(stderr);
                let _ = tokio::io::AsyncReadExt::read_to_end(&mut reader, &mut buf).await;
            }
            buf
        }),
    );

    let reader_aborts = vec![stdout_handle.abort_handle(), stderr_handle.abort_handle()];

    let child_for_task = Arc::clone(&child_shared);
    let kill_flag_for_task = Arc::clone(&kill_flag);

    let task: JoinHandle<Result<ShellCommandOutput, VoltError>> = tokio::task::spawn(async move {
        let start = std::time::Instant::now();

        // Poll the child inside a select! so the kill flag can interrupt.
        let wait_result = async {
            // Hold the child lock just long enough to poll; release between polls.
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                if kill_flag_for_task.load(Ordering::Relaxed) {
                    let mut guard = child_for_task.lock().await;
                    if let Some(c) = guard.as_mut() {
                        let _ = c.kill().await;
                    }
                    return Err::<std::process::ExitStatus, std::io::Error>(
                        std::io::Error::other("killed"),
                    );
                }
                let mut guard = child_for_task.lock().await;
                if let Some(c) = guard.as_mut() {
                    match c.try_wait() {
                        Ok(Some(status)) => return Ok(status),
                        Ok(None) => {}
                        Err(e) => return Err(e),
                    }
                } else {
                    return Err(std::io::Error::other("child taken"));
                }
            }
        }
        .await;

        let elapsed = start.elapsed().as_millis() as u64;

        match wait_result {
            Ok(exit_status) => {
                let stdout_bytes = stdout_handle.await.unwrap_or_default();
                let stderr_bytes = stderr_handle.await.unwrap_or_default();
                let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
                let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();
                let exit_code = exit_status.code().unwrap_or(-1);

                Ok(ShellCommandOutput {
                    stdout: truncate_output(&stdout, MAX_OUTPUT_BYTES),
                    stderr: truncate_output(&stderr, MAX_OUTPUT_BYTES),
                    exit_code,
                    execution_time_ms: elapsed,
                    timed_out: false,
                })
            }
            Err(e) => {
                // Abort the readers — nobody will consume their output.
                stdout_handle.abort();
                stderr_handle.abort();
                if kill_flag_for_task.load(Ordering::Relaxed) {
                    Ok(ShellCommandOutput {
                        stdout: String::new(),
                        stderr: "Command cancelled".to_string(),
                        exit_code: -1,
                        execution_time_ms: elapsed,
                        timed_out: false,
                    })
                } else {
                    Err(VoltError::Launch(format!(
                        "Failed to execute command: {}",
                        e
                    )))
                }
            }
        }
    });

    // Track the running process for cancellation.
    {
        if let Ok(mut running) = state.running.lock() {
            running.insert(
                execution_id.clone(),
                RunningProcess {
                    abort_handle: task.abort_handle(),
                    kill_flag: Arc::clone(&kill_flag),
                    child: Arc::clone(&child_for_state),
                    reader_aborts: reader_aborts.clone(),
                },
            );
        }
    }

    // Apply an outer timeout. If it fires we kill the child directly via the
    // shared handle, because the task's inner kill-flag poll may already be
    // dropped at this point.
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        task,
    )
    .await;

    // Always remove from running map.
    {
        if let Ok(mut running) = state.running.lock() {
            running.remove(&execution_id);
        }
    }

    match result {
        Ok(Ok(Ok(output))) => {
            state.mark_completed(&execution_id);
            // Backend-driven history recording — the frontend can no longer
            // fabricate a record for a command that was never run.
            shell_history::record_internal(
                history_state.inner(),
                command.clone(),
                output.exit_code,
                working_dir.clone(),
            );
            Ok(output)
        }
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(join_err)) => {
            // Abort readers to ensure no orphan tasks.
            for handle in &reader_aborts {
                handle.abort();
            }
            // Best-effort kill in case the task was cancelled mid-flight.
            {
                let mut guard = child_for_state.lock().await;
                if let Some(c) = guard.as_mut() {
                    let _ = c.kill().await;
                }
            }
            if join_err.is_cancelled() {
                warn!("Shell command cancelled: {}", execution_id);
                Ok(ShellCommandOutput {
                    stdout: String::new(),
                    stderr: "Command cancelled".to_string(),
                    exit_code: -1,
                    execution_time_ms: 0,
                    timed_out: false,
                })
            } else {
                Err(VoltError::Launch(format!(
                    "Command task panicked: {}",
                    join_err
                )))
            }
        }
        Err(_) => {
            // Outer timeout fired. Kill child directly via shared handle and
            // abort reader tasks so nothing leaks.
            kill_flag_for_state.store(true, Ordering::Relaxed);
            {
                let mut guard = child_for_state.lock().await;
                if let Some(c) = guard.as_mut() {
                    let _ = c.kill().await;
                }
            }
            for handle in &reader_aborts {
                handle.abort();
            }
            warn!(
                "Shell command timed out after {}ms: {}",
                timeout_ms,
                truncate_for_log(&redact_command(&command), LOG_COMMAND_MAX_LEN)
            );
            Ok(ShellCommandOutput {
                stdout: String::new(),
                stderr: format!("Command timed out after {}ms", timeout_ms),
                exit_code: -1,
                execution_time_ms: timeout_ms,
                timed_out: true,
            })
        }
    }
}

/// Execute a shell command with streaming output via a Tauri Channel.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn execute_shell_command_streaming(
    app_handle: AppHandle,
    command: String,
    timeout_ms: Option<u64>,
    working_dir: Option<String>,
    execution_id: String,
    on_event: Channel<ShellOutputEvent>,
    state: tauri::State<'_, ShellExecutionState>,
    history_state: tauri::State<'_, ShellHistoryState>,
) -> Result<(), VoltError> {
    let (command, shell_settings) = validate_shell_access(&app_handle, &command).await?;

    let timeout_ms = timeout_ms
        .or(Some(shell_settings.timeout_ms))
        .unwrap_or(DEFAULT_TIMEOUT_MS);
    let effective_working_dir = working_dir.or_else(|| shell_settings.working_dir.clone());

    info!(
        "Executing streaming shell command: {} (timeout={}ms, id={})",
        truncate_for_log(&redact_command(&command), LOG_COMMAND_MAX_LEN),
        timeout_ms,
        execution_id
    );

    let kill_flag = Arc::new(AtomicBool::new(false));
    let kill_flag_task = Arc::clone(&kill_flag);

    // Spawn the child outside the task so spawn errors surface directly.
    let mut process = build_shell_command(
        &command,
        effective_working_dir.as_deref(),
        shell_settings.default_shell.as_deref(),
    );
    process.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = process
        .spawn()
        .map_err(|e| VoltError::Launch(format!("Failed to spawn command: {}", e)))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let child_shared: Arc<tokio::sync::Mutex<Option<Child>>> =
        Arc::new(tokio::sync::Mutex::new(Some(child)));
    let child_for_task = Arc::clone(&child_shared);

    let on_event_clone = on_event.clone();
    let execution_id_clone = execution_id.clone();
    let command_clone = command.clone();
    let working_dir_clone = effective_working_dir.clone();

    // Reader tasks are created outside the driving task so we can register
    // their abort handles BEFORE the driving task starts.
    let stdout_event = on_event_clone.clone();
    let kill_stdout = Arc::clone(&kill_flag);
    let stdout_task: JoinHandle<()> = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if kill_stdout.load(Ordering::Relaxed) {
                    break;
                }
                let _ = stdout_event.send(ShellOutputEvent::Stdout { line });
            }
        }
    });

    let stderr_event = on_event_clone.clone();
    let kill_stderr = Arc::clone(&kill_flag);
    let stderr_task: JoinHandle<()> = tokio::spawn(async move {
        if let Some(stderr) = stderr {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if kill_stderr.load(Ordering::Relaxed) {
                    break;
                }
                let _ = stderr_event.send(ShellOutputEvent::Stderr { line });
            }
        }
    });

    let stdout_abort = stdout_task.abort_handle();
    let stderr_abort = stderr_task.abort_handle();
    let reader_aborts = vec![stdout_abort.clone(), stderr_abort.clone()];

    let history_handle = history_state.inner().clone();

    let task: JoinHandle<(i32, bool)> = tokio::task::spawn(async move {
        let start = std::time::Instant::now();
        let kill_flag = kill_flag_task;

        let wait_result = tokio::time::timeout(
            std::time::Duration::from_millis(timeout_ms),
            async {
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    if kill_flag.load(Ordering::Relaxed) {
                        let mut guard = child_for_task.lock().await;
                        if let Some(c) = guard.as_mut() {
                            let _ = c.kill().await;
                        }
                        return None;
                    }
                    let mut guard = child_for_task.lock().await;
                    if let Some(c) = guard.as_mut() {
                        match c.try_wait() {
                            Ok(Some(status)) => return Some(Ok(status)),
                            Ok(None) => {}
                            Err(e) => return Some(Err(e)),
                        }
                    } else {
                        return None;
                    }
                }
            },
        )
        .await;

        let elapsed = start.elapsed().as_millis() as u64;

        // Drain remaining reader output before emitting the final event.
        let _ = stdout_task.await;
        let _ = stderr_task.await;

        let (exit_code, timed_out) = match wait_result {
            Ok(Some(Ok(status))) => {
                let code = status.code().unwrap_or(-1);
                let _ = on_event_clone.send(ShellOutputEvent::Exit {
                    code,
                    execution_time_ms: elapsed,
                });
                (code, false)
            }
            Ok(Some(Err(e))) => {
                let _ = on_event_clone.send(ShellOutputEvent::Error {
                    message: format!("Process error: {}", e),
                });
                (-1, false)
            }
            Ok(None) => {
                let _ = on_event_clone.send(ShellOutputEvent::Error {
                    message: "Command cancelled".to_string(),
                });
                (-1, false)
            }
            Err(_) => {
                // Inner timeout fired — kill child and report TimedOut.
                kill_flag.store(true, Ordering::Relaxed);
                {
                    let mut guard = child_for_task.lock().await;
                    if let Some(c) = guard.as_mut() {
                        let _ = c.kill().await;
                    }
                }
                let _ = on_event_clone.send(ShellOutputEvent::TimedOut {
                    execution_time_ms: elapsed,
                });
                (-1, true)
            }
        };

        // Record in history from the backend — never trust frontend
        // record_shell_command for the actual command text.
        if !timed_out {
            shell_history::record_internal(
                &history_handle,
                command_clone,
                exit_code,
                working_dir_clone,
            );
        }

        (exit_code, timed_out)
    });

    // Register the process for cancellation BEFORE we start awaiting it.
    {
        if let Ok(mut running) = state.running.lock() {
            running.insert(
                execution_id.clone(),
                RunningProcess {
                    abort_handle: task.abort_handle(),
                    kill_flag: Arc::clone(&kill_flag),
                    child: Arc::clone(&child_shared),
                    reader_aborts,
                },
            );
        }
    }

    // Outer timeout: if the inner task wedges on a blocked pipe or a reader
    // task hangs, we still bail out eventually.
    let outer = tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms + OUTER_TIMEOUT_SLACK_MS),
        task,
    )
    .await;

    // Clean up running map.
    {
        if let Ok(mut running) = state.running.lock() {
            running.remove(&execution_id);
        }
    }

    match outer {
        Ok(Ok(_)) => {
            state.mark_completed(&execution_id_clone);
            Ok(())
        }
        Ok(Err(join_err)) => {
            stdout_abort.abort();
            stderr_abort.abort();
            {
                let mut guard = child_shared.lock().await;
                if let Some(c) = guard.as_mut() {
                    let _ = c.kill().await;
                }
            }
            Err(VoltError::Launch(format!(
                "Streaming task failed: {}",
                join_err
            )))
        }
        Err(_) => {
            kill_flag.store(true, Ordering::Relaxed);
            stdout_abort.abort();
            stderr_abort.abort();
            {
                let mut guard = child_shared.lock().await;
                if let Some(c) = guard.as_mut() {
                    let _ = c.kill().await;
                }
            }
            warn!(
                "Streaming shell command outer-timeout after {}ms: {}",
                timeout_ms + OUTER_TIMEOUT_SLACK_MS,
                truncate_for_log(&redact_command(&command), LOG_COMMAND_MAX_LEN)
            );
            let _ = on_event.send(ShellOutputEvent::TimedOut {
                execution_time_ms: timeout_ms,
            });
            Ok(())
        }
    }
}

/// Cancel a running shell command by its execution ID.
#[tauri::command]
pub async fn cancel_shell_command(
    execution_id: String,
    state: tauri::State<'_, ShellExecutionState>,
) -> Result<(), VoltError> {
    let process = {
        let mut running = state
            .running
            .lock()
            .map_err(|e| VoltError::Unknown(e.to_string()))?;
        running.remove(&execution_id)
    };

    if let Some(process) = process {
        // Kill the child directly first so the OS process stops immediately.
        process.kill_flag.store(true, Ordering::Relaxed);
        {
            let mut guard = process.child.lock().await;
            if let Some(c) = guard.as_mut() {
                let _ = c.kill().await;
            }
        }
        // Abort reader tasks so their JoinHandles don't leak.
        for handle in &process.reader_aborts {
            handle.abort();
        }
        // Then abort the driving task as final cleanup.
        process.abort_handle.abort();
        info!("Cancelled shell command: {}", execution_id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_output_short() {
        let s = "hello world";
        assert_eq!(truncate_output(s, 50_000), "hello world");
    }

    #[test]
    fn test_truncate_output_long() {
        let s = "a".repeat(60_000);
        let result = truncate_output(&s, 50_000);
        assert!(result.len() < 60_000);
        assert!(result.ends_with("[... output truncated at 50KB ...]"));
    }

    #[test]
    fn test_truncate_output_utf8_boundary() {
        let s = "é".repeat(30_000);
        let result = truncate_output(&s, 50_000);
        assert!(result.len() <= 50_050);
        assert!(result.ends_with("[... output truncated at 50KB ...]"));
    }

    #[test]
    fn test_is_command_blocked_patterns() {
        assert!(is_command_blocked("rm -rf /"));
        assert!(is_command_blocked("rm  -Rf  /home"));
        assert!(is_command_blocked("shutdown -h now"));
        assert!(is_command_blocked("reboot"));
        assert!(is_command_blocked(":(){ :|:& };:"));
        assert!(is_command_blocked("reg delete HKLM\\Software\\Foo"));
        assert!(is_command_blocked("mkfs.ext4 /dev/sda1"));
    }

    #[test]
    fn test_is_command_not_blocked() {
        assert!(!is_command_blocked("ls -la"));
        assert!(!is_command_blocked("git status"));
        assert!(!is_command_blocked("echo rm-rf"));
        assert!(!is_command_blocked("rmdir emptydir"));
    }

    #[test]
    fn test_redact_userinfo_url() {
        let r = redact_command("curl https://user:secret@example.com/api");
        assert!(!r.contains("user:secret"));
        assert!(r.contains("***@example.com"));
    }

    #[test]
    fn test_redact_bearer_header() {
        let r = redact_command(r#"curl -H "Authorization: Bearer abc123" foo"#);
        assert!(!r.contains("abc123"));
        assert!(r.contains("***"));
    }

    #[test]
    fn test_redact_token_flag() {
        let r = redact_command("gh api --token=abc123xyz foo");
        assert!(!r.contains("abc123xyz"));
        assert!(r.contains("***"));
    }

    #[test]
    fn test_redact_env_secret() {
        let r = redact_command("AWS_SECRET_ACCESS_KEY=xyz789 aws s3 ls");
        assert!(!r.contains("xyz789"));
        assert!(r.contains("***"));
    }

    #[test]
    fn test_truncate_for_log() {
        let long = "a".repeat(200);
        let r = truncate_for_log(&long, 80);
        assert!(r.starts_with(&"a".repeat(80)));
        assert!(r.ends_with("[truncated]"));
    }

    #[test]
    fn test_completion_token_fifo() {
        let state = ShellExecutionState::new();
        for i in 0..(COMPLETED_TOKENS_MAX + 5) {
            state.mark_completed(&format!("id-{}", i));
        }
        // First 5 should have been evicted.
        assert!(!state.consume_completion("id-0"));
        assert!(!state.consume_completion("id-4"));
        assert!(state.consume_completion(&format!("id-{}", COMPLETED_TOKENS_MAX + 4)));
    }
}
