//! Process launching functionality
//!
//! Cross-platform process spawning with support for various file types and launch options.

use std::path::Path;
use std::process::Command;
use std::time::Instant;

use super::types::{LaunchError, LaunchOptions, LaunchResult, LaunchableFileType};

/// Launch an application with default options
///
/// # Arguments
/// * `path` - Path to the application to launch
///
/// # Returns
/// * `Ok(LaunchResult)` - Launch succeeded
/// * `Err(LaunchError)` - Launch failed
///
/// # Example
/// ```no_run
/// use volt_lib::launcher::launch;
///
/// let result = launch("C:\\Program Files\\App\\app.exe")?;
/// println!("Launched with PID: {:?}", result.pid);
/// ```
pub fn launch(path: &str) -> Result<LaunchResult, LaunchError> {
    launch_with_options(path, LaunchOptions::default())
}

/// Launch an application with custom options
///
/// # Arguments
/// * `path` - Path to the application to launch
/// * `options` - Launch configuration options
///
/// # Returns
/// * `Ok(LaunchResult)` - Launch succeeded
/// * `Err(LaunchError)` - Launch failed
pub fn launch_with_options(
    path: &str,
    options: LaunchOptions,
) -> Result<LaunchResult, LaunchError> {
    // Validate path exists
    let path_obj = Path::new(path);
    if !path_obj.exists() {
        return Err(LaunchError::NotFound {
            path: path.to_string(),
        });
    }

    // Detect file type
    let file_type = LaunchableFileType::from_path(path);

    // Launch based on platform and file type
    #[cfg(target_os = "windows")]
    {
        launch_windows(path, &options, file_type)
    }

    #[cfg(target_os = "macos")]
    {
        launch_macos(path, &options, file_type)
    }

    #[cfg(target_os = "linux")]
    {
        launch_linux(path, &options, file_type)
    }
}

/// Launch URL in default browser
///
/// Only allows http:// and https:// URLs to prevent command injection.
pub fn launch_url(url: &str) -> Result<LaunchResult, LaunchError> {
    // Validate URL scheme to prevent command injection
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(LaunchError::SpawnFailed {
            path: url.to_string(),
            message: "Only http:// and https:// URLs are allowed".to_string(),
        });
    }

    #[cfg(target_os = "windows")]
    {
        // Use ShellExecuteW instead of cmd /C start to avoid command injection
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;
        use winapi::um::shellapi::ShellExecuteW;

        let operation: Vec<u16> = OsStr::new("open")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let url_wide: Vec<u16> = OsStr::new(url)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let result = ShellExecuteW(
                ptr::null_mut(),
                operation.as_ptr(),
                url_wide.as_ptr(),
                ptr::null(),
                ptr::null(),
                1, // SW_SHOWNORMAL
            );

            if (result as usize) <= 32 {
                return Err(LaunchError::SpawnFailed {
                    path: url.to_string(),
                    message: format!("ShellExecuteW failed with code: {}", result as usize),
                });
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| LaunchError::SpawnFailed {
                path: url.to_string(),
                message: e.to_string(),
            })?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| LaunchError::SpawnFailed {
                path: url.to_string(),
                message: e.to_string(),
            })?;
    }

    Ok(LaunchResult::new(url))
}

// Windows-specific implementation
#[cfg(target_os = "windows")]
fn launch_windows(
    path: &str,
    options: &LaunchOptions,
    file_type: LaunchableFileType,
) -> Result<LaunchResult, LaunchError> {
    let start_time = Instant::now();

    // Handle elevated launch separately
    if options.elevated {
        return launch_elevated_windows(path, options);
    }

    let mut command = match file_type {
        LaunchableFileType::Executable | LaunchableFileType::Shortcut => {
            // Use cmd /C start for better Windows integration
            let mut cmd = Command::new("cmd");
            cmd.arg("/C").arg("start");

            // Add /B flag to not open new window if hidden
            if options.hidden {
                cmd.arg("/B");
            }

            // Empty title string (required for start command)
            cmd.arg("");
            cmd.arg(path);
            cmd
        }
        LaunchableFileType::Script => {
            // Detect script type
            let path_lower = path.to_lowercase();
            if path_lower.ends_with(".ps1") {
                let mut cmd = Command::new("powershell");
                cmd.args(["-File", path]);
                cmd
            } else {
                // .bat or .cmd
                let mut cmd = Command::new("cmd");
                cmd.args(["/C", path]);
                cmd
            }
        }
        _ => {
            // Default: use shell execute via cmd start
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "start", "", path]);
            cmd
        }
    };

    // Apply options
    if let Some(ref cwd) = options.working_dir {
        command.current_dir(cwd);
    }

    if let Some(ref args) = options.args {
        command.args(args);
    }

    if let Some(ref env_vars) = options.env {
        for (key, value) in env_vars {
            command.env(key, value);
        }
    }

    // Spawn or run
    if options.wait {
        let output = command.output().map_err(|e| LaunchError::SpawnFailed {
            path: path.to_string(),
            message: e.to_string(),
        })?;

        let elapsed = start_time.elapsed().as_millis() as u64;
        let exit_code = output.status.code().unwrap_or(-1);

        if !output.status.success() && exit_code != 0 {
            return Err(LaunchError::ProcessFailed {
                path: path.to_string(),
                exit_code,
            });
        }

        Ok(LaunchResult::new(path)
            .with_exit_code(exit_code)
            .with_elapsed(elapsed))
    } else {
        let child = command.spawn().map_err(|e| LaunchError::SpawnFailed {
            path: path.to_string(),
            message: e.to_string(),
        })?;

        Ok(LaunchResult::new(path).with_pid(child.id()))
    }
}

#[cfg(target_os = "windows")]
/// Escape a single argument for Windows command line according to Windows quoting rules
///
/// Rules:
/// - If the argument contains no spaces, tabs, or quotes, use as-is
/// - Otherwise:
///   - Wrap in double quotes
///   - Backslashes before quotes must be doubled
///   - Quotes must be escaped with backslash
///   - Trailing backslashes must be doubled (before closing quote)
fn escape_windows_arg(arg: &str) -> String {
    // If no special characters, no escaping needed
    if !arg.contains(' ') && !arg.contains('\t') && !arg.contains('"') {
        return arg.to_string();
    }

    let mut escaped = String::with_capacity(arg.len() + 2);
    escaped.push('"');

    let mut backslash_count = 0;
    for ch in arg.chars() {
        match ch {
            '\\' => {
                backslash_count += 1;
            }
            '"' => {
                // Per CRT rules: N backslashes followed by " → 2N backslashes + \"
                for _ in 0..backslash_count {
                    escaped.push('\\');
                    escaped.push('\\');
                }
                escaped.push('\\');
                escaped.push('"');
                backslash_count = 0;
            }
            _ => {
                // Backslashes not followed by " stay as-is
                for _ in 0..backslash_count {
                    escaped.push('\\');
                }
                backslash_count = 0;
                escaped.push(ch);
            }
        }
    }

    // Trailing backslashes must be doubled so they don't escape the closing "
    for _ in 0..backslash_count {
        escaped.push('\\');
        escaped.push('\\');
    }

    escaped.push('"');
    escaped
}

#[cfg(target_os = "windows")]
fn launch_elevated_windows(
    path: &str,
    options: &LaunchOptions,
) -> Result<LaunchResult, LaunchError> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use winapi::um::shellapi::ShellExecuteW;

    let operation: Vec<u16> = OsStr::new("runas")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let file: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // Build properly escaped command-line arguments
    let params_str = options
        .args
        .as_ref()
        .map(|args| {
            args.iter()
                .map(|arg| escape_windows_arg(arg))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();

    let params: Vec<u16> = params_str
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let dir: Vec<u16> = options
        .working_dir
        .as_deref()
        .unwrap_or("")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let result = ShellExecuteW(
            ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            params.as_ptr(),
            dir.as_ptr(),
            if options.hidden { 0 } else { 1 }, // SW_HIDE or SW_SHOWNORMAL
        );

        // ShellExecuteW returns > 32 on success
        if (result as usize) <= 32 {
            return Err(LaunchError::SpawnFailed {
                path: path.to_string(),
                message: format!("ShellExecuteW failed with code: {}", result as usize),
            });
        }

        Ok(LaunchResult::new(path))
    }
}

// macOS-specific implementation
#[cfg(target_os = "macos")]
fn launch_macos(
    path: &str,
    options: &LaunchOptions,
    file_type: LaunchableFileType,
) -> Result<LaunchResult, LaunchError> {
    let start_time = Instant::now();

    let mut command = match file_type {
        LaunchableFileType::AppBundle => {
            let mut cmd = Command::new("open");
            cmd.arg(path);

            // Add arguments with -a flag
            if let Some(ref args) = options.args {
                cmd.arg("--args");
                cmd.args(args);
            }

            cmd
        }
        LaunchableFileType::Script => {
            let path_lower = path.to_lowercase();
            if path_lower.ends_with(".sh") {
                let mut cmd = Command::new("bash");
                cmd.arg(path);
                cmd
            } else {
                let mut cmd = Command::new("open");
                cmd.arg(path);
                cmd
            }
        }
        _ => {
            // Default: use open command
            let mut cmd = Command::new("open");
            cmd.arg(path);
            cmd
        }
    };

    // Apply options
    if let Some(ref cwd) = options.working_dir {
        command.current_dir(cwd);
    }

    if let Some(ref env_vars) = options.env {
        for (key, value) in env_vars {
            command.env(key, value);
        }
    }

    // Spawn or run
    if options.wait {
        command.arg("-W"); // Wait for app to close
        let output = command.output().map_err(|e| LaunchError::SpawnFailed {
            path: path.to_string(),
            message: e.to_string(),
        })?;

        let elapsed = start_time.elapsed().as_millis() as u64;
        let exit_code = output.status.code().unwrap_or(-1);

        Ok(LaunchResult::new(path)
            .with_exit_code(exit_code)
            .with_elapsed(elapsed))
    } else {
        let child = command.spawn().map_err(|e| LaunchError::SpawnFailed {
            path: path.to_string(),
            message: e.to_string(),
        })?;

        Ok(LaunchResult::new(path).with_pid(child.id()))
    }
}

// Linux-specific implementation
#[cfg(target_os = "linux")]
fn launch_linux(
    path: &str,
    options: &LaunchOptions,
    file_type: LaunchableFileType,
) -> Result<LaunchResult, LaunchError> {
    let start_time = Instant::now();

    let mut command = match file_type {
        LaunchableFileType::Executable => Command::new(path),
        LaunchableFileType::Script => {
            let path_lower = path.to_lowercase();
            if path_lower.ends_with(".sh") {
                let mut cmd = Command::new("bash");
                cmd.arg(path);
                cmd
            } else {
                let mut cmd = Command::new("xdg-open");
                cmd.arg(path);
                cmd
            }
        }
        _ => {
            // Default: use xdg-open
            let mut cmd = Command::new("xdg-open");
            cmd.arg(path);
            cmd
        }
    };

    // Apply options
    if let Some(ref cwd) = options.working_dir {
        command.current_dir(cwd);
    }

    if let Some(ref args) = options.args {
        command.args(args);
    }

    if let Some(ref env_vars) = options.env {
        for (key, value) in env_vars {
            command.env(key, value);
        }
    }

    // Spawn or run
    if options.wait {
        let output = command.output().map_err(|e| LaunchError::SpawnFailed {
            path: path.to_string(),
            message: e.to_string(),
        })?;

        let elapsed = start_time.elapsed().as_millis() as u64;
        let exit_code = output.status.code().unwrap_or(-1);

        Ok(LaunchResult::new(path)
            .with_exit_code(exit_code)
            .with_elapsed(elapsed))
    } else {
        let child = command.spawn().map_err(|e| LaunchError::SpawnFailed {
            path: path.to_string(),
            message: e.to_string(),
        })?;

        Ok(LaunchResult::new(path).with_pid(child.id()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_launch_nonexistent_file() {
        let result = launch("C:\\nonexistent\\path\\app.exe");
        assert!(matches!(result, Err(LaunchError::NotFound { .. })));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_escape_windows_arg_no_special_chars() {
        assert_eq!(escape_windows_arg("simple"), "simple");
        assert_eq!(escape_windows_arg("path/to/file"), "path/to/file");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_escape_windows_arg_with_spaces() {
        assert_eq!(escape_windows_arg("hello world"), r#""hello world""#);
        assert_eq!(
            escape_windows_arg("C:\\Program Files\\App"),
            r#""C:\Program Files\App""#
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_escape_windows_arg_with_quotes() {
        assert_eq!(escape_windows_arg(r#"say "hello""#), r#""say \"hello\"""#);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_escape_windows_arg_with_backslashes_before_quote() {
        assert_eq!(
            escape_windows_arg(r#"path\to\"file""#),
            r#""path\to\\\"file\"""#
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_escape_windows_arg_trailing_backslashes() {
        // Trailing backslashes before the closing quote must be doubled,
        // otherwise they would escape the closing quote itself.
        assert_eq!(
            escape_windows_arg(r#"C:\Program Files\"#),
            r#""C:\Program Files\\""#
        );
        // Backslash followed by a non-quote (space) stays as-is (CRT rule).
        assert_eq!(
            escape_windows_arg(r#"path\to\dir\ with space"#),
            r#""path\to\dir\ with space""#
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_escape_windows_arg_complex() {
        // Argument: C:\Path\To\"My File".txt
        // Should become: "C:\Path\To\\\"My File\".txt"
        assert_eq!(
            escape_windows_arg(r#"C:\Path\To\"My File".txt"#),
            r#""C:\Path\To\\\"My File\".txt""#
        );
    }
}
