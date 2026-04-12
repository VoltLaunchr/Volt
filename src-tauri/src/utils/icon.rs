/// Extracts icon from an executable or shortcut file and returns it as base64 data URL
pub fn extract_icon(path: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        extract_icon_windows(path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        None
    }
}

/// Windows-specific icon extraction
#[cfg(target_os = "windows")]
fn extract_icon_windows(path: &str) -> Option<String> {
    use std::ffi::OsStr;
    use std::mem;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::shellapi::{SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGetFileInfoW};
    use winapi::um::winuser::DestroyIcon;

    // Convert path to wide string (UTF-16)
    let wide_path: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut file_info: SHFILEINFOW = mem::zeroed();

        // Get file icon using SHGetFileInfoW
        let result = SHGetFileInfoW(
            wide_path.as_ptr(),
            0,
            &mut file_info,
            mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );

        // Check if we got an icon
        if result == 0 || file_info.hIcon.is_null() {
            return None;
        }

        // Convert HICON to base64 PNG
        let png_data = match hicon_to_png_base64(file_info.hIcon) {
            Some(data) => data,
            None => {
                DestroyIcon(file_info.hIcon);
                return None;
            }
        };

        // Clean up the icon handle
        DestroyIcon(file_info.hIcon);

        Some(format!("data:image/png;base64,{}", png_data))
    }
}

/// Convert HICON to base64-encoded PNG
#[cfg(target_os = "windows")]
fn hicon_to_png_base64(hicon: winapi::shared::windef::HICON) -> Option<String> {
    use std::mem;
    use std::ptr;
    use winapi::um::wingdi::{
        BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
        DeleteObject, GetDIBits, GetObjectW,
    };
    use winapi::um::winuser::ICONINFO;
    use winapi::um::winuser::{GetDC, GetIconInfo, ReleaseDC};

    unsafe {
        // Get icon info
        let mut icon_info: ICONINFO = mem::zeroed();
        if GetIconInfo(hicon, &mut icon_info) == 0 {
            return None;
        }

        // Get bitmap info
        let mut bitmap: BITMAP = mem::zeroed();
        if GetObjectW(
            icon_info.hbmColor as *mut _,
            mem::size_of::<BITMAP>() as i32,
            &mut bitmap as *mut _ as *mut _,
        ) == 0
        {
            DeleteObject(icon_info.hbmColor as *mut _);
            DeleteObject(icon_info.hbmMask as *mut _);
            return None;
        }

        let width = bitmap.bmWidth as u32;
        let height = bitmap.bmHeight as u32;

        // Create device context
        let hdc_screen = GetDC(ptr::null_mut());
        let hdc = CreateCompatibleDC(hdc_screen);

        // Setup BITMAPINFO
        let mut bmi: BITMAPINFO = mem::zeroed();
        bmi.bmiHeader.biSize = mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width as i32;
        bmi.bmiHeader.biHeight = -(height as i32); // Top-down DIB
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        // Get bitmap bits
        let mut buffer = vec![0u8; (width * height * 4) as usize];
        let result = GetDIBits(
            hdc,
            icon_info.hbmColor,
            0,
            height,
            buffer.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Clean up
        DeleteDC(hdc);
        ReleaseDC(ptr::null_mut(), hdc_screen);
        DeleteObject(icon_info.hbmColor as *mut _);
        DeleteObject(icon_info.hbmMask as *mut _);

        if result == 0 {
            return None;
        }

        // Convert BGRA to RGBA
        for i in (0..buffer.len()).step_by(4) {
            buffer.swap(i, i + 2); // Swap B and R channels
        }

        // Encode as PNG
        let mut png_data = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_data, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);

            let mut writer = match encoder.write_header() {
                Ok(w) => w,
                Err(_) => return None,
            };

            if writer.write_image_data(&buffer).is_err() {
                return None;
            }
        }

        // Convert to base64
        Some(base64_encode(&png_data))
    }
}

/// Simple base64 encoding
#[cfg(target_os = "windows")]
fn base64_encode(data: &[u8]) -> String {
    const BASE64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();

    for chunk in data.chunks(3) {
        let mut buf = [0u8; 3];
        for (i, &byte) in chunk.iter().enumerate() {
            buf[i] = byte;
        }

        result.push(BASE64_CHARS[(buf[0] >> 2) as usize] as char);
        result.push(BASE64_CHARS[(((buf[0] & 0x03) << 4) | (buf[1] >> 4)) as usize] as char);

        if chunk.len() > 1 {
            result.push(BASE64_CHARS[(((buf[1] & 0x0F) << 2) | (buf[2] >> 6)) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(BASE64_CHARS[(buf[2] & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

/// Try to resolve icon name to a full path on Linux
#[cfg(target_os = "linux")]
pub fn resolve_linux_icon(icon_name: &str) -> Option<String> {
    // If it's already a full path
    if icon_name.starts_with('/') {
        if std::path::Path::new(icon_name).exists() {
            // Could load and convert to base64 here
            // For now, return None to avoid large data
            return None;
        }
    }

    // Common icon theme locations
    let icon_paths = vec![
        "/usr/share/icons/hicolor/48x48/apps",
        "/usr/share/icons/hicolor/64x64/apps",
        "/usr/share/icons/hicolor/128x128/apps",
        "/usr/share/icons/hicolor/scalable/apps",
        "/usr/share/pixmaps",
    ];

    let extensions = ["png", "svg", "xpm"];

    for base_path in icon_paths {
        for ext in &extensions {
            let icon_path = format!("{}/{}.{}", base_path, icon_name, ext);
            if std::path::Path::new(&icon_path).exists() {
                // Found the icon - could load as base64 here
                // For now, return None to keep response size small
                return None;
            }
        }
    }

    None
}
