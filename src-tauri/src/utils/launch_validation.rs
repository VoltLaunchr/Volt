//! Launch path validation utilities.
//!
//! Shared validation for `launch_application` / `launch_app` to ensure only
//! legitimate application paths can be executed.

use std::path::Path;
use tracing::warn;

#[cfg(target_os = "windows")]
use regex::Regex;
#[cfg(target_os = "windows")]
use std::sync::LazyLock;

/// Strict regex for UWP AppsFolder identifiers.
///
/// Format: `<PackageFamilyName>!<AppId>` where the PackageFamilyName is
/// `<PackageName>_<PublisherHash>`. Example:
/// `Microsoft.WindowsCalculator_8wekyb3d8bbwe!App`.
///
/// Anchored on both ends to prevent injection of arbitrary characters.
#[cfg(target_os = "windows")]
static UWP_APP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9.\-]+_[A-Za-z0-9]{8,}![A-Za-z0-9.\-]+$").unwrap());

/// Executable file names (case-insensitive) that should never be launched
/// directly because they are commonly abused as LOLBIN (Living Off The Land
/// Binaries).  Launching them through .lnk shortcuts is fine because the
/// user explicitly chose the shortcut from Start Menu / Desktop.
const BLOCKED_EXECUTABLES: &[&str] = &[
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "wscript.exe",
    "cscript.exe",
    "mshta.exe",
    "regsvr32.exe",
    "rundll32.exe",
    "certutil.exe",
    "bitsadmin.exe",
    // Additional LOLBINs (M12). All from the LOLBAS project's known-abuse
    // list — none are useful as user-launched applications.
    "installutil.exe",
    "msbuild.exe",
    "cmstp.exe",
    "wmic.exe",
    "ngen.exe",
    "presentationhost.exe",
    "msxsl.exe",
    "forfiles.exe",
    "expand.exe",
    "extexport.exe",
];

/// File extensions considered valid application launch targets on Windows.
#[cfg(target_os = "windows")]
const VALID_APP_EXTENSIONS: &[&str] = &["exe", "lnk", "appref-ms", "msc", "url"];

/// Validate that `path` is a legitimate application path suitable for launch.
///
/// Returns `Ok(())` on success, or an error message string on failure.
pub fn validate_launch_path(path: &str) -> Result<(), String> {
    // Reject empty paths
    if path.trim().is_empty() {
        return Err("Application path is empty".into());
    }

    let p = Path::new(path);

    // --- Block dangerous executables launched directly ---
    //
    // We compare against `trim()`ed lowercase because on NTFS a trailing
    // space (e.g. `cmd.exe `) still resolves to the real binary, and
    // alternate-data-stream suffixes (`cmd.exe:Zone.Identifier`) need the
    // stream portion stripped before the denylist check. Canonical filename
    // checks that only compare the raw OS-reported name would miss both.
    if let Some(file_name) = p.file_name().and_then(|n| n.to_str()) {
        let name_lower = file_name.to_lowercase();
        // `cmd.exe ` → `cmd.exe`; `cmd.exe:Zone.Identifier` → `cmd.exe`
        let name_normalized = name_lower.split(':').next().unwrap_or(&name_lower).trim();
        if BLOCKED_EXECUTABLES.contains(&name_normalized) {
            warn!("Blocked direct launch of dangerous executable: {}", path);
            return Err(format!(
                "Direct execution of '{}' is not allowed for security reasons. \
                 If you need this program, launch it through a shortcut.",
                file_name
            ));
        }
    }

    // --- Platform-specific validation ---
    #[cfg(target_os = "windows")]
    {
        validate_windows_path(path, p)?;
    }

    // macOS: .app bundles are directories - the launch() function handles them.
    // Linux: Exec strings from .desktop files may contain args - also handled downstream.
    // On non-Windows we do minimal blocking (the LOLBIN list above) and trust
    // that apps were discovered by the scanner.

    Ok(())
}

/// Windows-specific launch path validation.
#[cfg(target_os = "windows")]
fn validate_windows_path(path: &str, p: &Path) -> Result<(), String> {
    // Shell:AppsFolder identifiers (UWP/Store apps) are not file paths.
    // They look like "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App".
    //
    // Previous behaviour permitted ANY string containing '!' and no path
    // separators, which let attackers slip past the LOLBIN denylist with
    // identifiers like `cmd.exe!whatever`. Tighten by:
    //   1. Running the LOLBIN denylist on the leftmost `!`-split token.
    //   2. Requiring the full identifier match the strict UWP regex.
    if !path.contains('\\') && !path.contains('/') && path.contains('!') {
        // The portion before the first '!' must not be a denylisted base name.
        if let Some(first_token) = path.split('!').next() {
            let token_lower = first_token.to_lowercase();
            // Compare against denylist names with .exe stripped to catch both
            // `cmd!x` and `cmd.exe!x` shapes.
            let token_stripped = token_lower
                .strip_suffix(".exe")
                .unwrap_or(&token_lower)
                .trim();
            if BLOCKED_EXECUTABLES.iter().any(|b| {
                let b_lower = b.to_lowercase();
                let b_stripped = b_lower.strip_suffix(".exe").unwrap_or(&b_lower);
                b_stripped == token_stripped
            }) {
                warn!(
                    "Blocked UWP-style identifier with denylisted prefix: {}",
                    path
                );
                return Err(format!(
                    "Direct execution of '{}' is not allowed for security reasons.",
                    first_token
                ));
            }
        }

        if UWP_APP_RE.is_match(path) {
            return Ok(());
        }
        return Err(format!("Invalid UWP identifier format: {}", path));
    }

    // The path must exist on disk
    if !p.exists() {
        return Err(format!("Application path does not exist: {}", path));
    }

    // Must be a file, not a directory (macOS .app bundles are dirs, but this
    // is the Windows branch)
    if p.is_dir() {
        return Err(format!("Path is a directory, not an executable: {}", path));
    }

    // Must have a recognised application extension
    match p.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext_lower = ext.to_lowercase();
            if !VALID_APP_EXTENSIONS.iter().any(|&v| v == ext_lower) {
                return Err(format!(
                    "File extension '.{}' is not a recognized application type. \
                     Allowed extensions: {}",
                    ext,
                    VALID_APP_EXTENSIONS.join(", ")
                ));
            }
        }
        None => {
            return Err(format!("Application path has no file extension: {}", path));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_path_rejected() {
        assert!(validate_launch_path("").is_err());
        assert!(validate_launch_path("   ").is_err());
    }

    // The LOLBIN denylist tests below rely on Windows-style paths. On Unix
    // targets, `Path::new(r"C:\Windows\System32\cmd.exe").file_name()` returns
    // the whole string (backslash is a regular filename character) and the
    // `split(':')` drive-letter stripping produces "c" rather than "cmd.exe".
    // The denylist is only meaningful on Windows, so gate the tests there.
    #[cfg(target_os = "windows")]
    #[test]
    fn test_blocked_executables() {
        assert!(validate_launch_path(r"C:\Windows\System32\cmd.exe").is_err());
        assert!(validate_launch_path(r"C:\Windows\System32\powershell.exe").is_err());
        assert!(validate_launch_path(r"C:\whatever\mshta.exe").is_err());
        // Case-insensitive
        assert!(validate_launch_path(r"C:\Windows\System32\CMD.EXE").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_blocked_executables_with_trailing_space() {
        // NTFS accepts a trailing space on filenames and still resolves to
        // the same binary — the LOLBIN denylist must strip it.
        assert!(validate_launch_path("C:\\Windows\\System32\\cmd.exe ").is_err());
        assert!(validate_launch_path("C:\\Windows\\System32\\powershell.exe  ").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_blocked_executables_with_alternate_data_stream() {
        // `file.exe:Zone.Identifier` should map to the base executable for
        // the denylist check (even though the ADS form doesn't launch).
        assert!(validate_launch_path(r"C:\Windows\System32\cmd.exe:Zone.Identifier").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_uwp_shell_identifier_allowed() {
        // UWP apps use shell:AppsFolder identifiers, not file paths
        assert!(validate_launch_path("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App").is_ok());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_uwp_lolbin_prefix_blocked() {
        // `cmd.exe!x` previously slipped past validation because the early-
        // return granted any string with '!' and no slashes. The denylist
        // now runs on the first split token before the regex check.
        assert!(validate_launch_path("cmd.exe!x").is_err());
        assert!(validate_launch_path("cmd!whatever").is_err());
        assert!(validate_launch_path("PowerShell.exe!Run").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_uwp_invalid_format_rejected() {
        // Strings with '!' but not matching the strict UWP shape are rejected.
        assert!(validate_launch_path("Foo!Bar").is_err());
        assert!(validate_launch_path("App_short!Foo").is_err()); // hash too short
        assert!(validate_launch_path("!App").is_err());
        assert!(validate_launch_path("App!").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_uwp_valid_identifiers_accepted() {
        // Real Microsoft Store package family names always have an
        // 8+ character publisher hash and a '.'/alphanumeric package name.
        assert!(validate_launch_path("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App").is_ok());
        assert!(validate_launch_path("Microsoft.Paint_8wekyb3d8bbwe!App").is_ok());
        assert!(validate_launch_path("Spotify.Music_zpdnekdrzrea0!Spotify").is_ok());
    }
}
