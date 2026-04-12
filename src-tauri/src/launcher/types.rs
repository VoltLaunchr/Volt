//! Types for the launcher module

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Options for launching an application
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    /// Working directory for the launched process
    pub working_dir: Option<String>,

    /// Command line arguments to pass to the application
    pub args: Option<Vec<String>>,

    /// Environment variables to set for the process
    pub env: Option<Vec<(String, String)>>,

    /// Whether to run the application elevated (admin mode on Windows)
    pub elevated: bool,

    /// Whether to hide the window (for console applications)
    pub hidden: bool,

    /// Whether to wait for the process to exit
    pub wait: bool,

    /// Track this launch in history
    pub track_history: bool,

    /// Allow PowerShell execution policy bypass (disabled by default for security)
    /// Only set to true if you explicitly trust the script and understand the security implications.
    pub allow_powershell_bypass: bool,
}

impl LaunchOptions {
    /// Create new launch options with defaults
    pub fn new() -> Self {
        Self {
            working_dir: None,
            args: None,
            env: None,
            elevated: false,
            hidden: false,
            wait: false,
            track_history: true,
            allow_powershell_bypass: false,
        }
    }

    /// Set the working directory
    pub fn with_working_dir(mut self, dir: impl Into<String>) -> Self {
        self.working_dir = Some(dir.into());
        self
    }

    /// Add command line arguments
    pub fn with_args(mut self, args: Vec<String>) -> Self {
        self.args = Some(args);
        self
    }

    /// Add environment variables
    pub fn with_env(mut self, env: Vec<(String, String)>) -> Self {
        self.env = Some(env);
        self
    }

    /// Run elevated (admin mode)
    pub fn elevated(mut self) -> Self {
        self.elevated = true;
        self
    }

    /// Hide the window
    pub fn hidden(mut self) -> Self {
        self.hidden = true;
        self
    }

    /// Wait for process to exit
    pub fn wait_for_exit(mut self) -> Self {
        self.wait = true;
        self
    }

    /// Disable history tracking
    pub fn no_history(mut self) -> Self {
        self.track_history = false;
        self
    }

    /// Allow PowerShell execution policy bypass (only use if you trust the script)
    pub fn allow_powershell_bypass(mut self) -> Self {
        self.allow_powershell_bypass = true;
        self
    }
}

/// Result of a successful launch
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    /// Path of the launched application
    pub path: String,

    /// Process ID (if available)
    pub pid: Option<u32>,

    /// Timestamp when the application was launched
    pub launched_at: i64,

    /// Exit code (only if wait was true)
    pub exit_code: Option<i32>,

    /// Elapsed time in milliseconds (only if wait was true)
    pub elapsed_ms: Option<u64>,
}

impl LaunchResult {
    /// Create a new launch result
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            pid: None,
            launched_at: Utc::now().timestamp_millis(),
            exit_code: None,
            elapsed_ms: None,
        }
    }

    /// Set the process ID
    pub fn with_pid(mut self, pid: u32) -> Self {
        self.pid = Some(pid);
        self
    }

    /// Set the exit code
    pub fn with_exit_code(mut self, code: i32) -> Self {
        self.exit_code = Some(code);
        self
    }

    /// Set the elapsed time
    pub fn with_elapsed(mut self, ms: u64) -> Self {
        self.elapsed_ms = Some(ms);
        self
    }
}

/// Errors that can occur during launch
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum LaunchError {
    /// The specified path does not exist
    NotFound { path: String },

    /// Permission denied to launch the application
    PermissionDenied { path: String, message: String },

    /// The file type is not supported for launching
    UnsupportedFileType { path: String, extension: String },

    /// Failed to spawn the process
    SpawnFailed { path: String, message: String },

    /// Process exited with non-zero status
    ProcessFailed { path: String, exit_code: i32 },

    /// Generic I/O error
    IoError { message: String },

    /// Platform-specific error
    PlatformError { message: String },

    /// Invalid URL format or disallowed scheme
    InvalidUrl { url: String, message: String },
}

impl fmt::Display for LaunchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LaunchError::NotFound { path } => {
                write!(f, "Application not found at path: {}", path)
            }
            LaunchError::PermissionDenied { path, message } => {
                write!(f, "Permission denied for '{}': {}", path, message)
            }
            LaunchError::UnsupportedFileType { path, extension } => {
                write!(
                    f,
                    "Unsupported file type '{}' for path: {}",
                    extension, path
                )
            }
            LaunchError::SpawnFailed { path, message } => {
                write!(f, "Failed to launch '{}': {}", path, message)
            }
            LaunchError::ProcessFailed { path, exit_code } => {
                write!(f, "Process '{}' exited with code: {}", path, exit_code)
            }
            LaunchError::IoError { message } => {
                write!(f, "I/O error: {}", message)
            }
            LaunchError::PlatformError { message } => {
                write!(f, "Platform error: {}", message)
            }
            LaunchError::InvalidUrl { url, message } => {
                write!(f, "Invalid URL '{}': {}", url, message)
            }
        }
    }
}

impl std::error::Error for LaunchError {}

impl From<std::io::Error> for LaunchError {
    fn from(err: std::io::Error) -> Self {
        LaunchError::IoError {
            message: err.to_string(),
        }
    }
}

/// Supported file types for launching
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchableFileType {
    /// Windows executable (.exe)
    Executable,
    /// Windows shortcut (.lnk)
    Shortcut,
    /// macOS application bundle (.app)
    AppBundle,
    /// Script files (.bat, .cmd, .ps1, .sh)
    Script,
    /// Documents (opened with default handler)
    Document,
    /// URL/web link
    Url,
    /// Unknown type (try system default)
    Unknown,
}

impl LaunchableFileType {
    /// Detect file type from path
    pub fn from_path(path: &str) -> Self {
        let path_lower = path.to_lowercase();

        if path_lower.ends_with(".exe") {
            LaunchableFileType::Executable
        } else if path_lower.ends_with(".lnk") {
            LaunchableFileType::Shortcut
        } else if path_lower.ends_with(".app") {
            LaunchableFileType::AppBundle
        } else if path_lower.ends_with(".bat")
            || path_lower.ends_with(".cmd")
            || path_lower.ends_with(".ps1")
            || path_lower.ends_with(".sh")
        {
            LaunchableFileType::Script
        } else if path_lower.starts_with("http://") || path_lower.starts_with("https://") {
            LaunchableFileType::Url
        } else if path_lower.ends_with(".msi")
            || path_lower.ends_with(".pdf")
            || path_lower.ends_with(".doc")
            || path_lower.ends_with(".docx")
            || path_lower.ends_with(".xls")
            || path_lower.ends_with(".xlsx")
            || path_lower.ends_with(".txt")
            || path_lower.ends_with(".html")
            || path_lower.ends_with(".htm")
        {
            LaunchableFileType::Document
        } else {
            LaunchableFileType::Unknown
        }
    }

    /// Check if this file type can be launched directly
    pub fn is_directly_launchable(&self) -> bool {
        matches!(
            self,
            LaunchableFileType::Executable
                | LaunchableFileType::Shortcut
                | LaunchableFileType::AppBundle
                | LaunchableFileType::Script
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_type_detection() {
        assert_eq!(
            LaunchableFileType::from_path("C:\\Program Files\\App.exe"),
            LaunchableFileType::Executable
        );
        assert_eq!(
            LaunchableFileType::from_path("C:\\Users\\Start Menu\\App.lnk"),
            LaunchableFileType::Shortcut
        );
        assert_eq!(
            LaunchableFileType::from_path("/Applications/App.app"),
            LaunchableFileType::AppBundle
        );
        assert_eq!(
            LaunchableFileType::from_path("https://google.com"),
            LaunchableFileType::Url
        );
    }

    #[test]
    fn test_launch_options_builder() {
        let opts = LaunchOptions::new()
            .with_working_dir("C:\\temp")
            .with_args(vec!["--help".to_string()])
            .elevated()
            .hidden();

        assert_eq!(opts.working_dir, Some("C:\\temp".to_string()));
        assert!(opts.elevated);
        assert!(opts.hidden);
        assert!(opts.track_history);
    }
}
