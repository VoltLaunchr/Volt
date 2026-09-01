//! Tauri-managed state for the global snippet-expansion hook.
//!
//! On Windows with the `snippet-global-expansion` feature enabled, this owns
//! the `WH_KEYBOARD_LL` hook thread and a "processor" thread that turns raw
//! key events into trigger matches and, on a match, injects the expanded
//! snippet text. On every other target (other OS, or the feature disabled),
//! `start`/`stop`/`is_running` are no-ops so call sites never need a
//! `#[cfg]` of their own.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::commands::content::snippets::Snippet;

/// Shared, Tauri-managed handle to the global snippet-expansion subsystem.
pub struct SnippetExpansionState {
    running: Arc<AtomicBool>,
    #[cfg(all(windows, feature = "snippet-global-expansion"))]
    hook_handle: Mutex<Option<crate::expansion::hook::HookHandle>>,
    #[cfg(all(windows, feature = "snippet-global-expansion"))]
    processor_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl SnippetExpansionState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            #[cfg(all(windows, feature = "snippet-global-expansion"))]
            hook_handle: Mutex::new(None),
            #[cfg(all(windows, feature = "snippet-global-expansion"))]
            processor_thread: Mutex::new(None),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Start the hook + processor pipeline. Idempotent: a no-op if already
    /// running. No-op everywhere except Windows with the
    /// `snippet-global-expansion` feature enabled.
    #[cfg(all(windows, feature = "snippet-global-expansion"))]
    pub fn start(
        &self,
        snippet_map: Arc<Mutex<HashMap<String, Snippet>>>,
        excluded_apps: Arc<Mutex<Vec<String>>>,
        max_trigger_len: usize,
    ) -> Result<(), String> {
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }

        let (tx, rx) = std::sync::mpsc::channel();

        let hook = match crate::expansion::hook::HookHandle::spawn(tx) {
            Ok(h) => h,
            Err(e) => {
                self.running.store(false, Ordering::SeqCst);
                return Err(e);
            }
        };

        let running_for_processor = self.running.clone();
        let processor = std::thread::Builder::new()
            .name("volt-snippet-processor".into())
            .spawn(move || {
                run_processor_loop(
                    rx,
                    snippet_map,
                    excluded_apps,
                    max_trigger_len,
                    running_for_processor,
                );
            })
            .map_err(|e| {
                self.running.store(false, Ordering::SeqCst);
                format!("failed to spawn snippet processor thread: {e}")
            })?;

        *self
            .hook_handle
            .lock()
            .map_err(|e| format!("hook_handle lock poisoned: {e}"))? = Some(hook);
        *self
            .processor_thread
            .lock()
            .map_err(|e| format!("processor_thread lock poisoned: {e}"))? = Some(processor);

        Ok(())
    }

    #[cfg(not(all(windows, feature = "snippet-global-expansion")))]
    pub fn start(
        &self,
        _snippet_map: Arc<Mutex<HashMap<String, Snippet>>>,
        _excluded_apps: Arc<Mutex<Vec<String>>>,
        _max_trigger_len: usize,
    ) -> Result<(), String> {
        Ok(())
    }

    /// Stop the hook + processor pipeline. No-op if not running.
    #[cfg(all(windows, feature = "snippet-global-expansion"))]
    pub fn stop(&self) -> Result<(), String> {
        if self
            .running
            .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }

        if let Some(hook) = self
            .hook_handle
            .lock()
            .map_err(|e| format!("hook_handle lock poisoned: {e}"))?
            .take()
        {
            hook.stop();
        }

        // The processor thread blocks on `rx.recv()`; once the hook thread
        // has been joined (above) no more events will ever arrive, but
        // `recv()` only wakes when the sender is dropped — which happens
        // when `hook.stop()` joins the hook thread that owned it via
        // thread-local storage. We still join here to avoid leaking the
        // thread handle.
        if let Some(processor) = self
            .processor_thread
            .lock()
            .map_err(|e| format!("processor_thread lock poisoned: {e}"))?
            .take()
        {
            let _ = processor.join();
        }

        Ok(())
    }

    #[cfg(not(all(windows, feature = "snippet-global-expansion")))]
    pub fn stop(&self) -> Result<(), String> {
        Ok(())
    }
}

impl Default for SnippetExpansionState {
    fn default() -> Self {
        Self::new()
    }
}

/// Processor thread body: turns raw key events into trigger matches and
/// performs the expansion. Runs on a plain OS thread (not tokio) because it
/// does blocking `recv()` plus synchronous Win32 calls throughout.
#[cfg(all(windows, feature = "snippet-global-expansion"))]
fn run_processor_loop(
    rx: std::sync::mpsc::Receiver<crate::expansion::keyboard_layout::RawKeyEvent>,
    snippet_map: Arc<Mutex<HashMap<String, Snippet>>>,
    excluded_apps: Arc<Mutex<Vec<String>>>,
    max_trigger_len: usize,
    running: Arc<AtomicBool>,
) {
    use crate::expansion::keyboard_layout::resolve_to_chars;
    use crate::expansion::trigger_buffer::TriggerBuffer;
    use winapi::um::winuser::VK_BACK;

    let mut buffer = TriggerBuffer::new(max_trigger_len.max(1));
    let own_exe_stem = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_lowercase()));

    while running.load(Ordering::SeqCst) {
        let event = match rx.recv() {
            Ok(e) => e,
            Err(_) => break, // sender dropped (hook thread gone): stop.
        };

        tracing::trace!(
            vk_code = event.vk_code,
            scan_code = event.scan_code,
            flags = event.flags,
            time = event.time,
            "snippet expansion: raw key event"
        );

        if event.vk_code == VK_BACK as u32 {
            buffer.push_backspace();
            continue;
        }

        let chars = resolve_to_chars(&event);
        if chars.is_empty() {
            continue;
        }
        for c in chars {
            buffer.push_char(c);
        }

        let snippets_snapshot: Vec<(String, bool, Snippet)> = {
            let map = match snippet_map.lock() {
                Ok(g) => g,
                Err(e) => {
                    tracing::warn!("snippet expansion: snippet map lock poisoned: {e}");
                    continue;
                }
            };
            map.values()
                .map(|s| (s.trigger.clone(), s.enabled, s.clone()))
                .collect()
        };

        let trigger_refs: Vec<(&str, bool)> = snippets_snapshot
            .iter()
            .map(|(t, enabled, _)| (t.as_str(), *enabled))
            .collect();

        let Some(matched) = buffer.try_match(&trigger_refs) else {
            continue;
        };

        // Foreground-app exclusion check (sensitive apps + Volt itself).
        // Fail closed: when the foreground app cannot be identified and the
        // exclusion list is non-empty, treat as excluded to avoid expanding
        // in a protected app. When no exclusions are configured, preserve
        // the prior permissive behaviour.
        let foreground = crate::utils::win32::get_foreground_app_name();
        let is_excluded = match &foreground {
            None => match excluded_apps.lock() {
                Ok(list) => !list.is_empty(),
                Err(e) => {
                    tracing::warn!("snippet expansion: excluded_apps lock poisoned: {e}");
                    true
                }
            },
            Some(app) => {
                let is_self = own_exe_stem.as_deref() == Some(app.as_str());
                let is_user_excluded = match excluded_apps.lock() {
                    Ok(list) => list.iter().any(|e| e.to_lowercase() == *app),
                    Err(e) => {
                        tracing::warn!("snippet expansion: excluded_apps lock poisoned: {e}");
                        true
                    }
                };
                is_self || is_user_excluded
            }
        };

        if is_excluded {
            continue;
        }

        let snippet = snippets_snapshot
            .iter()
            .find(|(t, _, _)| *t == matched.trigger)
            .map(|(_, _, s)| s.clone());

        let Some(snippet) = snippet else {
            continue;
        };

        let resolved = crate::expansion::injector::resolve_snippet_content(&snippet.content);
        let backspaces = crate::expansion::injector::count_backspaces_for_trigger(&matched.trigger);

        if let Err(e) = crate::expansion::injector::send_input_sequence(backspaces, &resolved) {
            tracing::warn!("snippet expansion: failed to inject expansion: {e}");
        }

        buffer.clear();
    }
}
