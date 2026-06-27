//! Small Win32 helpers shared across modules (clipboard manager, global
//! snippet expansion). Kept separate from `utils::process` (which deals with
//! generic process lookups) because these are foreground-window-specific and
//! Windows-only.

/// Return the lowercase executable basename of the current foreground window's
/// process, or `None` if it cannot be determined.
#[cfg(windows)]
pub(crate) fn get_foreground_app_name() -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::psapi::GetModuleFileNameExW;
    use winapi::um::winnt::{PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
    use winapi::um::winuser::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid as *mut u32);
        if pid == 0 {
            return None;
        }

        let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
        if handle.is_null() {
            return None;
        }

        let mut buf = vec![0u16; 512];
        let len = GetModuleFileNameExW(
            handle,
            std::ptr::null_mut(),
            buf.as_mut_ptr(),
            buf.len() as u32,
        );
        CloseHandle(handle);

        if len == 0 {
            return None;
        }

        let path = OsString::from_wide(&buf[..len as usize]);
        let path_str = path.to_string_lossy().to_lowercase();
        // Extract just the filename without extension
        std::path::Path::new(&path_str)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
    }
}

#[cfg(not(windows))]
pub(crate) fn get_foreground_app_name() -> Option<String> {
    None
}
