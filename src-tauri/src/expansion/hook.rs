//! Low-level keyboard hook (`WH_KEYBOARD_LL`) that observes every keystroke
//! system-wide, without requiring `uiAccess` or administrator privileges.
//!
//! The hook callback is intentionally minimal: it filters out anything that
//! is not a genuine, non-injected key-down event, packages the raw VK/scan
//! code into a `RawKeyEvent`, and forwards it through an mpsc channel to the
//! processor thread in `expansion::state`. All actual logic (trigger
//! matching, layout resolution, injection) happens off this callback so the
//! global keyboard pipeline is never blocked by our own work.
//!
//! Windows + `snippet-global-expansion` only. Not unit-tested — installing a
//! real global hook from an automated test would intercept the test
//! runner's own keyboard input on the host machine, which is exactly what
//! this project's safety rules for this feature forbid.

use crate::expansion::keyboard_layout::RawKeyEvent;
use std::cell::RefCell;
use std::ptr;
use std::sync::mpsc::Sender;
use std::thread::JoinHandle;
use winapi::shared::minwindef::{LPARAM, LRESULT, WPARAM};
use winapi::shared::windef::HHOOK;
use winapi::um::winuser::{
    CallNextHookEx, DispatchMessageW, GetMessageW, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG,
    PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL,
    WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN,
};

// A raw C function pointer (the hook callback) cannot capture a closure, so
// the sender is stashed in thread-local storage on the dedicated hook
// thread before the hook is installed, and read back inside the callback.
thread_local! {
    static EVENT_SENDER: RefCell<Option<Sender<RawKeyEvent>>> = const { RefCell::new(None) };
}

/// Handle to a running low-level keyboard hook. Dropping/forgetting this
/// without calling `stop()` would leak the OS hook and the background
/// thread — always pair `spawn()` with `stop()`.
pub struct HookHandle {
    thread_id: u32,
    join_handle: Option<JoinHandle<()>>,
}

/// Result of starting the hook thread, sent back from the worker thread to
/// the caller of `spawn` so it can report install failures synchronously.
enum StartupResult {
    Installed { thread_id: u32 },
    Failed(String),
}

impl HookHandle {
    /// Install the global low-level keyboard hook on a dedicated thread and
    /// start its message loop. Returns once the hook is confirmed installed
    /// (or confirmed failed) on that thread.
    pub fn spawn(tx: Sender<RawKeyEvent>) -> Result<Self, String> {
        let (startup_tx, startup_rx) = std::sync::mpsc::channel::<StartupResult>();

        let join_handle = std::thread::Builder::new()
            .name("volt-snippet-hook".into())
            .spawn(move || {
                run_hook_thread(tx, startup_tx);
            })
            .map_err(|e| format!("failed to spawn keyboard hook thread: {e}"))?;

        match startup_rx.recv() {
            Ok(StartupResult::Installed { thread_id }) => Ok(Self {
                thread_id,
                join_handle: Some(join_handle),
            }),
            Ok(StartupResult::Failed(msg)) => Err(msg),
            Err(_) => Err("keyboard hook thread exited before reporting status".to_string()),
        }
    }

    /// Stop the hook and join its thread. Posts `WM_QUIT` to the hook
    /// thread's message queue, which unblocks `GetMessageW`, runs the
    /// `UnhookWindowsHookEx` cleanup, and lets the thread exit naturally.
    pub fn stop(mut self) {
        // SAFETY: `thread_id` is a live thread id owned by this handle for
        // as long as the handle exists; posting WM_QUIT is the documented
        // way to unblock another thread's GetMessage loop.
        unsafe {
            PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
        }
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

fn run_hook_thread(tx: Sender<RawKeyEvent>, startup_tx: Sender<StartupResult>) {
    EVENT_SENDER.with(|slot| {
        *slot.borrow_mut() = Some(tx);
    });

    // SAFETY: `SetWindowsHookExW` with a null `hmod`/`0` thread id installs a
    // process-wide low-level hook for the *current* thread's message queue,
    // which is exactly the dedicated thread we are running on. The callback
    // pointer is a `'static` `extern "system" fn`, valid for the hook's
    // entire lifetime.
    let hook: HHOOK = unsafe {
        SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(low_level_keyboard_proc),
            ptr::null_mut(),
            0,
        )
    };

    if hook.is_null() {
        let _ = startup_tx.send(StartupResult::Failed(
            "SetWindowsHookExW(WH_KEYBOARD_LL) failed".to_string(),
        ));
        return;
    }

    let thread_id = unsafe { winapi::um::processthreadsapi::GetCurrentThreadId() };
    if startup_tx
        .send(StartupResult::Installed { thread_id })
        .is_err()
    {
        // Caller already gave up (e.g. spawn() timed out elsewhere); clean
        // up the hook and exit.
        unsafe {
            UnhookWindowsHookEx(hook);
        }
        return;
    }

    // SAFETY: standard Win32 message loop. `msg` is a stack-local buffer
    // fully owned by this thread; `GetMessageW`/`DispatchMessageW` are the
    // documented pump required to keep a `WH_KEYBOARD_LL` hook alive.
    unsafe {
        let mut msg: MSG = std::mem::zeroed();
        loop {
            let ret = GetMessageW(&mut msg, ptr::null_mut(), 0, 0);
            if ret <= 0 {
                // 0 = WM_QUIT, -1 = error; either way, stop pumping.
                break;
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        UnhookWindowsHookEx(hook);
    }
}

/// The actual `HOOKPROC`. Kept deliberately small: filter, build the event,
/// `try_send`, and always defer to `CallNextHookEx` so we never break the
/// rest of the system's keyboard hook chain (including, critically, the
/// user's own input into whatever app is foreground).
unsafe extern "system" fn low_level_keyboard_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code != HC_ACTION {
        return unsafe { CallNextHookEx(ptr::null_mut(), code, wparam, lparam) };
    }

    let is_keydown = wparam as u32 == WM_KEYDOWN || wparam as u32 == WM_SYSKEYDOWN;
    if is_keydown {
        // SAFETY: per the WH_KEYBOARD_LL contract, when `code == HC_ACTION`,
        // `lparam` points to a valid `KBDLLHOOKSTRUCT` for the duration of
        // this callback.
        let info = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };

        // CRITICAL anti-loop guard: never react to keystrokes that we (or
        // any other injector) generated via SendInput, or we could recurse
        // into our own injected backspaces/text.
        if info.flags & LLKHF_INJECTED == 0 {
            let event = RawKeyEvent {
                vk_code: info.vkCode,
                scan_code: info.scanCode,
                flags: info.flags,
                time: info.time,
            };
            EVENT_SENDER.with(|slot| {
                if let Some(sender) = slot.borrow().as_ref() {
                    // `std::sync::mpsc::Sender` is unbounded — `send` never
                    // blocks here; it only errors if the processor thread's
                    // receiver has been dropped (e.g. during shutdown), in
                    // which case dropping the event is correct.
                    let _ = sender.send(event);
                }
            });
        }
    }

    unsafe { CallNextHookEx(ptr::null_mut(), code, wparam, lparam) }
}
