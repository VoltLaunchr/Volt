use std::path::PathBuf;

/// Drive type enumeration
#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveType {
    Fixed,
    Removable,
    Network,
    CDRom,
    RamDisk,
    Unknown,
}

/// Gets the drive type for a Windows drive
#[cfg(target_os = "windows")]
pub fn get_drive_type(drive: char) -> DriveType {
    use winapi::um::fileapi::GetDriveTypeW;

    let drive_path = format!("{}:\\", drive);
    let wide: Vec<u16> = drive_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        match GetDriveTypeW(wide.as_ptr()) {
            2 => DriveType::Removable,
            3 => DriveType::Fixed,
            4 => DriveType::Network,
            5 => DriveType::CDRom,
            6 => DriveType::RamDisk,
            _ => DriveType::Unknown,
        }
    }
}

/// Gets all available drive letters on Windows
#[cfg(target_os = "windows")]
pub fn get_all_drives() -> Vec<char> {
    let mut drives = Vec::new();

    // Check drives A-Z
    for letter in b'A'..=b'Z' {
        let drive = letter as char;
        let drive_path = format!(r"{}:\", drive);

        // Check if drive exists by trying to get metadata
        if std::path::Path::new(&drive_path).exists() {
            drives.push(drive);
        }
    }

    drives
}

/// Gets all local fixed drives (excludes network, removable, CD-ROM)
#[cfg(target_os = "windows")]
pub fn get_local_drives() -> Vec<char> {
    get_all_drives()
        .into_iter()
        .filter(|&drive| matches!(get_drive_type(drive), DriveType::Fixed))
        .collect()
}

/// Checks if a file is executable (Unix only - checks execute permission)
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// Finds the main executable in a directory
///
/// Looks for:
/// 1. An exe with the same name as the directory
/// 2. An exe in common subdirectories (bin, Binaries, etc.)
/// 3. Any exe that's not an installer/updater
pub fn find_main_executable(dir_path: &PathBuf) -> Option<PathBuf> {
    // Skip if directory is a symlink or has restricted access
    if let Ok(metadata) = std::fs::symlink_metadata(dir_path)
        && metadata.is_symlink()
    {
        return None;
    }

    // Skip common system and cache directories that slow down scanning
    let dir_name_lower = dir_path.file_name()?.to_string_lossy().to_lowercase();

    let skip_dirs = [
        "windows",
        "system32",
        "syswow64",
        "$recycle.bin",
        "windowsapps",
        "common files",
        "internet explorer",
        "windows defender",
        "windows mail",
        "windows media player",
        "windows nt",
        "windows photo viewer",
        "windows portable devices",
        "windows sidebar",
        "windowspowershell",
        "cache",
        "temp",
        "tmp",
        "logs",
        "backup",
        "installer",
    ];

    for skip in &skip_dirs {
        if dir_name_lower.contains(skip) {
            return None;
        }
    }

    // First, try to find exe in the current directory
    if let Some(exe) = find_exe_in_directory(dir_path) {
        return Some(exe);
    }

    // If not found, look in common subdirectories for games
    let common_exe_subdirs = ["bin", "Binaries", "Bin64", "x64", "Win64"];

    for subdir in &common_exe_subdirs {
        let subdir_path = dir_path.join(subdir);
        if subdir_path.exists()
            && let Some(exe) = find_exe_in_directory(&subdir_path)
        {
            return Some(exe);
        }
    }

    None
}

/// Finds an executable in a specific directory (non-recursive)
pub fn find_exe_in_directory(dir_path: &PathBuf) -> Option<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir_path) else {
        return None;
    };

    let mut all_exes = Vec::new();
    let dir_name = dir_path.file_name();

    for entry in entries.flatten() {
        let path = entry.path();

        // Skip if not a file
        if !path.is_file() {
            continue;
        }

        // Check if file is executable using cross-platform logic
        #[cfg(target_os = "windows")]
        let is_exe = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false);

        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let is_exe = is_executable(&path);

        if is_exe {
            all_exes.push(path.clone());

            // Prefer executables with the same name as the parent directory
            if let (Some(file_stem), Some(dir_name)) = (path.file_stem(), dir_name)
                && file_stem == dir_name
            {
                return Some(path);
            }
        }
    }

    // If no matching exe found, filter out installers and launchers
    for exe in &all_exes {
        if let Some(file_stem) = exe.file_stem() {
            let name_lower = file_stem.to_string_lossy().to_lowercase();

            // Skip common installer/updater/helper names
            let skip_keywords = [
                "uninstall",
                "installer",
                "setup",
                "updater",
                "crash",
                "easyanticheat",
                "battleye",
                "launcher",
                "patcher",
                "repair",
                "config",
                "helper",
                "service",
            ];

            if skip_keywords.iter().any(|kw| name_lower.contains(kw)) {
                continue;
            }

            // Verify it's actually executable (double-check on Unix)
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            if !is_executable(exe) {
                continue;
            }

            // Return the first non-installer exe
            return Some(exe.clone());
        }
    }

    // If all exes are filtered out, return the first executable one
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        all_exes.into_iter().find(|exe| is_executable(exe))
    }
    #[cfg(target_os = "windows")]
    {
        all_exes.into_iter().next()
    }
}
