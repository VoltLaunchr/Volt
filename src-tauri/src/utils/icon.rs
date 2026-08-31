/// Extracts icon from an executable or shortcut file and returns it as base64 data URL
pub fn extract_icon(path: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        if is_uwp_aumid(path) {
            return extract_uwp_icon_windows(path);
        }
        extract_icon_windows(path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        None
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn file_to_data_url(path: &std::path::Path) -> Option<String> {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;

    const MAX_ICON_BYTES: u64 = 2 * 1024 * 1024;

    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_ICON_BYTES {
        return None;
    }

    let ext = path.extension()?.to_string_lossy().to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "xpm" => "image/x-xpixmap",
        _ => return None,
    };

    let bytes = std::fs::read(path).ok()?;
    Some(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

#[cfg(target_os = "windows")]
fn is_uwp_aumid(path: &str) -> bool {
    path.contains('!') && !path.contains('\\') && !path.contains('/')
}

#[cfg(target_os = "windows")]
fn extract_uwp_icon_windows(aumid: &str) -> Option<String> {
    use crate::utils::process::no_window;
    use std::process::Command;

    let (package_family, app_id) = aumid.split_once('!')?;
    if package_family.trim().is_empty() || app_id.trim().is_empty() {
        return None;
    }

    let mut cmd = Command::new("powershell");
    no_window(&mut cmd);
    let output = cmd
        .env("VOLT_AUMID_PACKAGE_FAMILY", package_family)
        .env("VOLT_AUMID_APP_ID", app_id)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"
$family = $env:VOLT_AUMID_PACKAGE_FAMILY
$appId = $env:VOLT_AUMID_APP_ID
$pkg = Get-AppxPackage -PackageTypeFilter Main -ErrorAction SilentlyContinue |
    Where-Object { $_.PackageFamilyName -eq $family } |
    Select-Object -First 1
if (-not $pkg -or -not $pkg.InstallLocation) { exit 0 }
$manifestPath = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
if (-not (Test-Path -LiteralPath $manifestPath)) { exit 0 }
[xml]$manifest = Get-Content -LiteralPath $manifestPath
$app = @($manifest.Package.Applications.Application) | Where-Object { $_.Id -eq $appId } | Select-Object -First 1
if (-not $app -or -not $app.VisualElements) { exit 0 }
$logo = $app.VisualElements.Square44x44Logo
if (-not $logo) { $logo = $app.VisualElements.Logo }
if (-not $logo) { exit 0 }
$candidate = Join-Path $pkg.InstallLocation $logo
$candidates = @()
if (Test-Path -LiteralPath $candidate) { $candidates += (Get-Item -LiteralPath $candidate) }
$dir = Split-Path -Parent $candidate
$base = [System.IO.Path]::GetFileNameWithoutExtension($candidate)
if ($dir -and (Test-Path -LiteralPath $dir)) {
    $candidates += Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.BaseName -like "$base*" -and $_.Extension -match '^\.(png|jpg|jpeg|ico)$' }
}
$best = $candidates |
    Sort-Object @{
        Expression = {
            if ($_.Name -match 'scale-200') { 0 }
            elseif ($_.Name -match 'scale-100') { 1 }
            elseif ($_.Extension -eq '.png') { 2 }
            else { 3 }
        }
    }, Length |
    Select-Object -First 1
if ($best) { Write-Output $best.FullName }
"#,
        ])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let icon_path = stdout.lines().next()?.trim();
    if icon_path.is_empty() {
        return None;
    }

    file_to_data_url(std::path::Path::new(icon_path))
}

/// Maximum icon dimension we accept before bailing out. Windows shell icons
/// top out at 256×256; anything beyond that is either a malformed `.ico` or a
/// path that resolves to a huge bitmap we have no business decoding into
/// memory. Without this guard, a forged executable can report `bmWidth = 65535`
/// and force a ~16 GB allocation that panics or OOM-kills the app.
#[cfg(target_os = "windows")]
const MAX_ICON_DIM: u32 = 1024;

/// RAII wrapper around an `HICON`. `DestroyIcon` runs unconditionally on drop,
/// including the panic path — without this, every `?`/`return None` between
/// `SHGetFileInfoW` and the explicit `DestroyIcon` would leak a GDI handle.
/// Windows caps the per-process GDI handle table at 10 000, so a tight loop
/// over icons (initial app scan) could exhaust the table system-wide.
#[cfg(target_os = "windows")]
struct HiconGuard(winapi::shared::windef::HICON);

#[cfg(target_os = "windows")]
impl Drop for HiconGuard {
    fn drop(&mut self) {
        unsafe {
            winapi::um::winuser::DestroyIcon(self.0);
        }
    }
}

/// RAII wrapper around an `HDC` created via `CreateCompatibleDC` — released
/// via `DeleteDC` on drop.
#[cfg(target_os = "windows")]
struct CompatDcGuard(winapi::shared::windef::HDC);

#[cfg(target_os = "windows")]
impl Drop for CompatDcGuard {
    fn drop(&mut self) {
        unsafe {
            winapi::um::wingdi::DeleteDC(self.0);
        }
    }
}

/// RAII wrapper around a screen `HDC` acquired via `GetDC(NULL)` — released
/// via `ReleaseDC(NULL, _)`.
#[cfg(target_os = "windows")]
struct ScreenDcGuard(winapi::shared::windef::HDC);

#[cfg(target_os = "windows")]
impl Drop for ScreenDcGuard {
    fn drop(&mut self) {
        unsafe {
            winapi::um::winuser::ReleaseDC(std::ptr::null_mut(), self.0);
        }
    }
}

/// RAII wrapper for `HBITMAP` handles owned by an `ICONINFO`. `GetIconInfo`
/// returns two bitmaps the caller must release via `DeleteObject`.
#[cfg(target_os = "windows")]
struct HBitmapGuard(winapi::shared::windef::HBITMAP);

#[cfg(target_os = "windows")]
impl Drop for HBitmapGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                winapi::um::wingdi::DeleteObject(self.0 as *mut _);
            }
        }
    }
}

/// Windows-specific icon extraction
#[cfg(target_os = "windows")]
fn extract_icon_windows(path: &str) -> Option<String> {
    use std::ffi::OsStr;
    use std::mem;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::shellapi::{SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGetFileInfoW};

    // SHGetFileInfoW rejects paths that mix '/' and '\\' even when they
    // reference the same file on disk (Path::exists returns true either way).
    // Epic manifests store LaunchExecutable with forward slashes — joining
    // them onto an InstallLocation produces exactly such a mixed path.
    let normalized = path.replace('/', "\\");

    // Convert path to wide string (UTF-16)
    let wide_path: Vec<u16> = OsStr::new(&normalized)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let file_info: SHFILEINFOW = unsafe {
        let mut info: SHFILEINFOW = mem::zeroed();
        let result = SHGetFileInfoW(
            wide_path.as_ptr(),
            0,
            &mut info,
            mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if result == 0 || info.hIcon.is_null() {
            return None;
        }
        info
    };

    // Take ownership of the HICON immediately so any early return from the
    // PNG-encoding path still triggers DestroyIcon via Drop.
    let _hicon_guard = HiconGuard(file_info.hIcon);
    let png_data = hicon_to_png_base64(file_info.hIcon)?;
    Some(format!("data:image/png;base64,{}", png_data))
}

/// Convert HICON to base64-encoded PNG
#[cfg(target_os = "windows")]
fn hicon_to_png_base64(hicon: winapi::shared::windef::HICON) -> Option<String> {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;
    use std::mem;
    use std::ptr;
    use winapi::um::wingdi::{
        BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS,
        GetDIBits, GetObjectW,
    };
    use winapi::um::winuser::ICONINFO;
    use winapi::um::winuser::{GetDC, GetIconInfo};

    // 1. Get icon info — wrap the returned HBITMAPs in RAII guards so they
    //    are released even if any later step bails out.
    let (hbm_color_guard, _hbm_mask_guard, bitmap) = unsafe {
        let mut icon_info: ICONINFO = mem::zeroed();
        if GetIconInfo(hicon, &mut icon_info) == 0 {
            return None;
        }
        let hbm_color = HBitmapGuard(icon_info.hbmColor);
        let hbm_mask = HBitmapGuard(icon_info.hbmMask);

        let mut bitmap: BITMAP = mem::zeroed();
        if GetObjectW(
            icon_info.hbmColor as *mut _,
            mem::size_of::<BITMAP>() as i32,
            &mut bitmap as *mut _ as *mut _,
        ) == 0
        {
            return None;
        }
        (hbm_color, hbm_mask, bitmap)
    };

    // 2. Validate dimensions. `bmWidth` is a signed LONG on the WinAPI side —
    //    casting straight to `u32` on a malformed bitmap wraps to a huge value
    //    and `(w*h*4) as usize` then either overflows in debug or allocates
    //    several GB before panicking. We bound to MAX_ICON_DIM and use
    //    checked_mul on the buffer size.
    if bitmap.bmWidth <= 0
        || bitmap.bmHeight <= 0
        || bitmap.bmWidth as u32 > MAX_ICON_DIM
        || bitmap.bmHeight as u32 > MAX_ICON_DIM
    {
        return None;
    }
    let width = bitmap.bmWidth as u32;
    let height = bitmap.bmHeight as u32;
    let buf_size = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4))?;

    // 3. Create device contexts behind RAII guards.
    let screen_dc = unsafe { GetDC(ptr::null_mut()) };
    if screen_dc.is_null() {
        return None;
    }
    let screen_guard = ScreenDcGuard(screen_dc);
    let compat_dc = unsafe { CreateCompatibleDC(screen_guard.0) };
    if compat_dc.is_null() {
        return None;
    }
    let compat_guard = CompatDcGuard(compat_dc);

    // 4. Pull bitmap bits via GetDIBits.
    let mut bmi: BITMAPINFO = unsafe { mem::zeroed() };
    bmi.bmiHeader.biSize = mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = width as i32;
    bmi.bmiHeader.biHeight = -(height as i32); // Top-down DIB
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    let mut buffer = vec![0u8; buf_size];
    let result = unsafe {
        GetDIBits(
            compat_guard.0,
            hbm_color_guard.0,
            0,
            height,
            buffer.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };
    if result == 0 {
        return None;
    }

    // 5. BGRA → RGBA in place. `chunks_exact_mut(4)` enforces the 4-byte
    //    stride invariant and never panics; the previous `step_by(4) + swap`
    //    pattern silently assumed `buffer.len() % 4 == 0`.
    for px in buffer.chunks_exact_mut(4) {
        px.swap(0, 2);
    }

    // 6. Encode as PNG into an in-memory buffer.
    let mut png_data = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_data, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);

        let mut writer = encoder.write_header().ok()?;
        if writer.write_image_data(&buffer).is_err() {
            return None;
        }
    }

    // 7. Base64. The `base64` crate is already a workspace dependency (used
    //    elsewhere); the previous handwritten encoder used a per-byte `push`
    //    loop that was ~10× slower on the icon scan hot path.
    Some(STANDARD.encode(&png_data))
}

/// Builds the ordered, deduplicated list of XDG data directories to search
/// for icons, mirroring `scan_applications_linux`'s `.desktop` search roots
/// (`$XDG_DATA_HOME`, `$XDG_DATA_DIRS`, Flatpak exports). Takes its inputs
/// explicitly rather than reading the environment so it can be unit tested
/// without touching process-global env vars (which `cargo test` runs share
/// across threads).
#[cfg(target_os = "linux")]
fn linux_icon_search_dirs(
    home: &str,
    xdg_data_home: Option<&str>,
    xdg_data_dirs: Option<&str>,
) -> Vec<String> {
    let xdg_data_home = xdg_data_home
        .map(str::to_string)
        .unwrap_or_else(|| format!("{home}/.local/share"));
    let xdg_data_dirs = xdg_data_dirs
        .map(str::to_string)
        .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());

    let mut base_dirs: Vec<String> = vec![xdg_data_home];
    base_dirs.extend(
        xdg_data_dirs
            .split(':')
            .filter(|d| !d.is_empty())
            .map(|d| d.to_string()),
    );
    base_dirs.push("/var/lib/flatpak/exports/share".to_string());
    base_dirs.push(format!("{home}/.local/share/flatpak/exports/share"));

    let mut seen = std::collections::HashSet::new();
    base_dirs.retain(|d| seen.insert(d.clone()));
    base_dirs
}

/// Try to resolve icon name to a full path on Linux
///
/// Mirrors the search roots used by `scan_applications_linux` for `.desktop`
/// discovery ($XDG_DATA_HOME, $XDG_DATA_DIRS, Flatpak exports) instead of the
/// hardcoded `/usr/share/...` this used to be limited to. Without this, any
/// app discovered from a non-default prefix — most commonly Flatpak, whose
/// icons live under `~/.local/share/flatpak/exports/share/icons/...` or
/// `/var/lib/flatpak/exports/share/icons/...`, neither of which is under
/// `/usr/share` — showed up in results with no icon at all.
#[cfg(target_os = "linux")]
pub fn resolve_linux_icon(icon_name: &str) -> Option<String> {
    // If it's already a full path
    if icon_name.starts_with('/') {
        return file_to_data_url(std::path::Path::new(icon_name));
    }

    let home = std::env::var("HOME").unwrap_or_default();
    let xdg_data_home = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|v| !v.is_empty());
    let xdg_data_dirs = std::env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|v| !v.is_empty());
    let base_dirs =
        linux_icon_search_dirs(&home, xdg_data_home.as_deref(), xdg_data_dirs.as_deref());

    let icon_sizes = ["128x128", "64x64", "48x48", "32x32", "scalable"];
    let extensions = ["png", "svg", "xpm"];

    for base in &base_dirs {
        for size in &icon_sizes {
            for ext in &extensions {
                let icon_path = format!("{base}/icons/hicolor/{size}/apps/{icon_name}.{ext}");
                let path = std::path::Path::new(&icon_path);
                if path.exists()
                    && let Some(data_url) = file_to_data_url(path)
                {
                    return Some(data_url);
                }
            }
        }
        for ext in &extensions {
            let icon_path = format!("{base}/pixmaps/{icon_name}.{ext}");
            let path = std::path::Path::new(&icon_path);
            if path.exists()
                && let Some(data_url) = file_to_data_url(path)
            {
                return Some(data_url);
            }
        }
    }

    None
}

#[cfg(all(test, target_os = "linux"))]
mod linux_icon_tests {
    use super::*;

    #[test]
    fn search_dirs_defaults_when_xdg_vars_unset() {
        let dirs = linux_icon_search_dirs("/home/alice", None, None);
        assert_eq!(
            dirs,
            vec![
                "/home/alice/.local/share".to_string(),
                "/usr/local/share".to_string(),
                "/usr/share".to_string(),
                "/var/lib/flatpak/exports/share".to_string(),
                "/home/alice/.local/share/flatpak/exports/share".to_string(),
            ]
        );
    }

    #[test]
    fn search_dirs_honors_custom_xdg_data_home_and_dirs() {
        let dirs = linux_icon_search_dirs(
            "/home/alice",
            Some("/custom/data"),
            Some("/opt/share:/nix/var/nix/profiles/default/share"),
        );
        assert_eq!(
            dirs,
            vec![
                "/custom/data".to_string(),
                "/opt/share".to_string(),
                "/nix/var/nix/profiles/default/share".to_string(),
                "/var/lib/flatpak/exports/share".to_string(),
                "/home/alice/.local/share/flatpak/exports/share".to_string(),
            ]
        );
    }

    #[test]
    fn search_dirs_ignores_empty_xdg_data_dirs_entries() {
        // A stray leading/trailing/doubled colon must not produce an empty
        // base dir that every icon lookup would then stat against "".
        let dirs = linux_icon_search_dirs("/home/alice", None, Some(":/usr/share::"));
        assert_eq!(
            dirs,
            vec![
                "/home/alice/.local/share".to_string(),
                "/usr/share".to_string(),
                "/var/lib/flatpak/exports/share".to_string(),
                "/home/alice/.local/share/flatpak/exports/share".to_string(),
            ]
        );
    }

    #[test]
    fn search_dirs_deduplicates() {
        // XDG_DATA_HOME pointing at the same place as the Flatpak user export
        // dir (a real layout: some distros set XDG_DATA_HOME to include the
        // Flatpak overlay) must not be searched twice.
        let dirs = linux_icon_search_dirs(
            "/home/alice",
            Some("/home/alice/.local/share/flatpak/exports/share"),
            Some("/usr/share"),
        );
        assert_eq!(
            dirs,
            vec![
                "/home/alice/.local/share/flatpak/exports/share".to_string(),
                "/usr/share".to_string(),
                "/var/lib/flatpak/exports/share".to_string(),
            ]
        );
    }

    #[test]
    fn resolve_absolute_icon_path_reads_file_directly() {
        let dir = tempfile::tempdir().expect("tempdir");
        let icon_path = dir.path().join("app-icon.png");
        // Smallest possible valid-looking payload — resolve_linux_icon only
        // cares that the file exists and has a recognized extension; the
        // actual PNG decoding happens client-side.
        std::fs::write(&icon_path, [0x89, b'P', b'N', b'G']).expect("write icon");

        let resolved = resolve_linux_icon(icon_path.to_str().expect("utf8 path"));
        assert!(resolved.is_some());
        assert!(resolved.unwrap().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn resolve_absolute_icon_path_missing_file_returns_none() {
        assert!(resolve_linux_icon("/definitely/not/a/real/icon-xyz.png").is_none());
    }
}
