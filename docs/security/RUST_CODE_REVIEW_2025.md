# Rust Code Review — May 2025

Full expert review of the `main` branch Rust codebase (75 files). Issues are classified by category and severity.

---

## CRITICAL — Fix immediately

### C1 · `std::thread::sleep` in async context blocks Tokio worker thread
**File:** `src-tauri/src/plugins/builtin/system_monitor/plugin.rs` ~l.232
**Status:** Fixed in commit d9c80a9

`refresh_cpu_dual_sample` calls `std::thread::sleep(200ms)`. This method is invoked through `refresh_cache()`, which is called inside a `tauri::async_runtime::spawn(async move { … })` block in `lib.rs`. A Tokio worker thread is blocked for 200ms on every monitor tick (every 5 seconds), degrading IPC latency across the whole app.

```rust
// plugin.rs ~232 — called from an async spawn
std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL); // blocks Tokio worker thread
```

**Fix:** Wrap the `refresh_cache()` call in `tokio::task::spawn_blocking` inside the ticker in `lib.rs`.

---

### C2 · JSON injection via `format!()` in Supabase RPC body
**File:** `src-tauri/src/commands/extensions.rs` ~l.1555
**Status:** Fixed in commit 792b1c3

The POST body for the download-count RPC is built with raw string interpolation instead of `serde_json`. If `validate_extension_id`'s charset is ever relaxed, an ID like `","injected":true,"x":"` breaks out of the JSON object.

```rust
// BAD — raw string format
.body(format!(r#"{{"p_extension_id":"{}"}}"#, extension_id))

// GOOD — already used everywhere else in this file
.json(&serde_json::json!({ "p_extension_id": extension_id }))
```

---

### C3 · Silent data loss in `database.rs` — three related bugs
**File:** `src-tauri/src/indexer/database.rs` l.114–117, 180–196, 261, 327
**Status:** Fixed in commit 792b1c3

**(a)** `upsert_files`: row-level failures are `warn!`-logged but the transaction is committed anyway. `Ok(())` is returned even when an arbitrary number of rows were dropped.

**(b)** `get_all_files` and `search_files` use `.filter_map(|r| r.ok())` — corrupted rows are silently excluded from results, meaning the in-memory index is smaller than reality.

**(c)** Failed category serialization falls back to `"other"` with `unwrap_or_else(|_| ...)`, losing the actual error.

```rust
// (a) transaction committed despite row failures
if let Err(e) = stmt.execute(params![...]) {
    warn!("Failed to upsert '{}': {}", file.path, e);
    // no return — transaction continues
}

// (b) search results silently drop corrupted rows
.filter_map(|r| r.ok())
```

**Fix (a):** Use `?` to propagate row errors and abort the transaction.
**Fix (b):** Log the error and use a proper `collect::<Result<Vec<_>, _>>()` or at minimum `.filter_map(|r| r.map_err(|e| warn!(...)).ok())`.

---

### C4 · Path containment bypass in `read_cache` when `canonicalize` fails
**File:** `src-tauri/src/plugins/api.rs` l.462–471
**Status:** Fixed in commit 792b1c3

The containment check is only enforced when both `canonicalize` calls succeed. If either fails (race condition, long path on Windows, broken symlink), the entire `if` block is skipped and `fs::read(&cache_path)` executes without verification. The guard must be fail-closed.

```rust
// CURRENT — bypass when canonicalize fails
if let Ok(canonical_cache_path) = cache_path.canonicalize()
    && let Ok(canonical_cache_dir) = cache_dir.canonicalize()
    && !canonical_cache_path.starts_with(&canonical_cache_dir)
{
    return Err("...");
}
// ← falls through to fs::read if canonicalize fails

// FIX — fail-closed
let canonical_cache_dir = cache_dir.canonicalize().map_err(|e| format!("..."))?;
let canonical_cache_path = cache_path.canonicalize().map_err(|_| "Cache entry not found")?;
if !canonical_cache_path.starts_with(&canonical_cache_dir) {
    return Err("Cache path is outside plugin cache directory");
}
```

---

## HIGH PRIORITY

### H1 · No abort handle on `start_indexing` — goroutine leak on shutdown
**File:** `src-tauri/src/commands/files.rs` l.196, 833
**Status:** Fixed in commit d9c80a9

`tauri::async_runtime::spawn(...)` is called and the `JoinHandle` is immediately dropped. No mechanism exists to cancel the background scan when the app shuts down or when `stop_file_watcher` is called. The internal `spawn_blocking` (filesystem walk) continues running past runtime teardown.

**Fix:** Store the `JoinHandle` in `FileIndexState` (`Mutex<Option<JoinHandle<()>>>`), abort it in `invalidate_index` / `stop_file_watcher`. Pattern already used in `shell.rs` with `AbortHandle`.

---

### H2 · Redirect SSRF on extension download
**File:** `src-tauri/src/commands/extensions.rs` l.571–580
**Status:** Fixed in commit 792b1c3

The `reqwest::Client` follows up to 10 redirects by default. `validate_download_url` validates the original URL against a private-IP denylist, but a `302 → http://169.254.169.254/...` redirect is followed without re-validation. CLAUDE.md states "redirect SSRF blocked" — that protection exists only in the Worker sandbox, not on this Rust download path.

**Fix:** Build the download client with `.redirect(reqwest::redirect::Policy::none())`.

---

### H3 · No size cap on extension archive download — memory exhaustion
**File:** `src-tauri/src/commands/extensions.rs` l.591
**Status:** Fixed in commit 792b1c3

```rust
let bytes = response.bytes().await // loads entire response into RAM, no limit
```

A URL from `raw.githubusercontent.com` (in the allowlist) returning a 2GB payload exhausts RAM. The 10MB cap described in CLAUDE.md only applies to the Worker sandbox fetch proxy.

**Fix:** Stream the response with a byte counter and bail at 20MB.

---

### H4 · `pin`/`unpin`/`add_tag`/`remove_tag` silently return `Ok(())` when path not found
**File:** `src-tauri/src/launcher/history.rs` l.220–277
**Status:** Fixed in commit 792b1c3

```rust
pub fn pin(&self, path: &str) -> Result<(), String> {
    if let Some(record) = records.get_mut(path) {
        // mutation
    }
    Ok(()) // reached even when path not in history — frontend sees false success
}
```

**Fix:** Return `Err(format!("App '{}' not found in history", path))` when the `if let` does not match.

---

### H5 · Legacy implicit-grant auth tokens in deep link URL (live code)
**File:** `src-tauri/src/commands/auth.rs` l.524–531
**Status:** Fixed in commit 792b1c3

The `volt://auth/callback?access_token=...&refresh_token=...` path is deprecated but fully active. On Windows, any app that registers a `volt://` handler can intercept this deep link and steal tokens. Tokens also appear in browser history.

**Fix:** Remove the implicit-grant branch now. Do not wait for v0.2.0.

---

### H6 · `test_credential` accepts a renderer-supplied token — Volt as auth proxy
**File:** `src-tauri/src/commands/credentials.rs` l.126
**Status:** Fixed in commit 792b1c3

```rust
pub async fn test_credential(service: String, token: String) -> Result<bool, String>
```

The token crosses the IPC boundary from the renderer. A malicious extension can call `invoke("test_credential", { service, token })` with any token to test its validity against GitHub/Notion APIs using Volt as a proxy.

**Fix:**
```rust
pub async fn test_credential(service: String) -> Result<bool, String> {
    let token = load_credential(service.clone())?.ok_or("No credential stored")?;
    // use token internally
}
```

---

## MEDIUM PRIORITY

### M1 · `std::fs::metadata` + synchronous SQLite in `async fn` without `spawn_blocking`
**File:** `src-tauri/src/indexer/database.rs` l.401, called from `src-tauri/src/commands/files.rs` l.893
**Status:** Fixed in commit 13819bf

`get_db_index_stats` is an `async fn` Tauri command that calls `std::fs::metadata` (blocking syscall) and a synchronous SQLite `COUNT(*)` without `spawn_blocking`. On Windows with antivirus or network shares, `GetFileAttributesEx` can block.

---

### M2 · `auth_state_lock()` always returns `Ok(...)` despite `Result<_, String>` return type
**File:** `src-tauri/src/commands/auth.rs` l.86–92
**Status:** Fixed in commit 792b1c3

The function signature implies fallibility but the body always returns `Ok(...)`. The poison recovery is unconditional and silent. Callers use `?` expecting a possible `Err` that never occurs. Make it infallible (`-> MutexGuard<'_>`) or log and return `Err` on poison.

---

### M3 · 50ms polling loop for child process wait — should use `child.wait().await`
**File:** `src-tauri/src/commands/shell.rs` l.509–532, 800–819
**Status:** Fixed in commit 13819bf

```rust
loop {
    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut guard = child_for_task.lock().await; // Mutex acquired per tick
    // try_wait()...
}
```

Tokio provides `child.wait().await` which yields correctly without polling. The current approach adds ~50ms latency to process exit detection.

---

### M4 · Unbounded user-controlled `timeout_ms` in shell command execution
**File:** `src-tauri/src/commands/shell.rs` l.436–439, 688–690
**Status:** Fixed in commit 792b1c3

A renderer-supplied `timeout_ms: u64::MAX` converts to a near-infinite `Duration`, defeating the kill mechanism and pinning a Tokio worker thread.

**Fix:** Clamp: `let timeout_ms = timeout_ms.min(300_000);` (5-minute hard cap).

---

### M5 · HMAC key shared between sig-file and credential paths without domain separation
**File:** `src-tauri/src/utils/extension_state_sig.rs` l.207, 232
**Status:** Fixed in commit 13819bf

`compute_signature` (used for `.sig` files) MACs raw JSON bytes without a domain tag. `hmac_sign_domain` (used for credentials) uses a length-prefixed domain construction. Both use the same underlying key. The sig-file signer should use `hmac_sign_domain` with a dedicated domain constant (`"volt-state-file-v1"`).

---

### M6 · `validate_extension_id` not called in `unlink_dev_extension`
**File:** `src-tauri/src/commands/extensions.rs` l.1377
**Status:** Fixed in commit 792b1c3

All other commands that take `extension_id` call `validate_extension_id` first. `unlink_dev_extension` does not. If the implementation is ever changed to reconstruct the directory path from the ID (as `uninstall_extension` does), the missing validation becomes exploitable.

---

### M7 · Swallowed errors losing observability (multiple locations)
**Status:** Fixed in commit 792b1c3

Several locations discard errors without logging, making production failures invisible:

| File | Lines | Issue |
|------|-------|-------|
| `commands/extensions.rs` | ~380 | `let _ = fs::remove_dir(&inner)` — silently ignores failure |
| `commands/credentials.rs` | ~186 | `serde_json::from_str(...).unwrap_or(...)` — no log on deserialization failure |
| `commands/files.rs` | ~896 | `state.files.lock().map(...).unwrap_or(0)` — poison recovery not logged |
| `lib.rs` | ~59–62 | `DEEPLINK_TIMES.lock()` poison recovery not logged |
| `indexer/database.rs` | ~432 | `parse_category` corrupted input silently maps to `default()` |

**Fix in all cases:** Add `warn!()` on the error/poison branch.

---

## PERFORMANCE

### P1 · `Matcher::new` + `Pattern::parse` allocated per app per search keystroke
**File:** `src-tauri/src/utils/matching.rs` l.59
**Status:** Fixed in commit 39fc26e

`calculate_match_score` creates a new `Matcher` on every call. This is called for every app on every keystroke. `SearchEngine` in `search_engine.rs` correctly holds a persistent `Matcher`.

**Fix:** Accept `&mut Matcher` as a parameter; create one instance outside the search loop.

---

### P2 · `Vec<char>` heap allocation per file per search in `search_engine.rs`
**File:** `src-tauri/src/indexer/search_engine.rs` l.171, 271
**Status:** Fixed in commit 792b1c3

```rust
let haystack_utf32: Vec<char> = haystack.chars().collect(); // 50k allocs per search
```

`shell_history.rs` already uses the buffer-reuse pattern:
```rust
let mut buf = Vec::new();
let haystack = Utf32Str::new(&record.command, &mut buf);
```

**Fix:** Declare `buf` before the loop, `buf.clear()` each iteration.

---

### P3 · Full `HashMap` deep-cloned on every shell history write
**File:** `src-tauri/src/commands/shell_history.rs` l.232, 381, 398, 423
**Status:** Fixed in commit 39fc26e

Up to 500 `ShellHistoryRecord` entries are deep-cloned to pass to `spawn_persist` on every command execution.

**Fix:** Serialize to JSON inside the lock guard, pass the `String` to `spawn_blocking`:
```rust
let json = serde_json::to_string_pretty(&*history).unwrap_or_default();
drop(history);
tokio::task::spawn_blocking(move || fs::write(&path, json));
```

---

### P4 · Full `Vec<AppInfo>` deep-cloned on every cache hit
**File:** `src-tauri/src/commands/apps.rs` l.384
**Status:** Fixed in commit 39fc26e

Every search cycle clones ~500 `AppInfo` structs (each with 5+ `String` fields) just to immediately serialize them for IPC.

**Fix:** Change `ScanCache.apps` to `Arc<Vec<AppInfo>>` so cache hits only increment a reference count.

---

### P5 · Platform scanners re-instantiated for `get_installed_platforms`
**File:** `src-tauri/src/commands/games.rs` l.120–121, `plugins/builtin/game_scanner/plugin.rs` l.294–325
**Status:** Open

`get_installed_platforms()` instantiates all 10 scanner structs and reads the registry again, duplicating work already done by `scan_all_games()`. The platform list can be derived directly from the cached game list:
```rust
let platforms: HashSet<GamePlatform> = games.iter().map(|g| g.platform.clone()).collect();
```

---

### P6 · `format!()` string allocation in directory traversal hot loop
**File:** `src-tauri/src/indexer/scanner.rs` l.30–33
**Status:** Fixed in commit 792b1c3

```rust
path_str.contains(&format!("\\{}\\", sensitive)) // allocates per entry per sensitive dir
```

**Fix:** Pre-build wrapped patterns as `static &[&str]`.

---

### P7 · `to_lowercase()` per-file per-extension in file filter
**File:** `src-tauri/src/indexer/scanner.rs` l.213–220
**Status:** Fixed in commit 792b1c3

`e.to_lowercase()` called inside `iter().any()` for every extension for every file = 1M allocs over a 100k file index with 10 extensions.

**Fix:** Store extensions pre-lowercased in `ScanConfig`, or build a `HashSet<String>` once before the scan loop.

---

### P8 · `shell_frecency()` + `SystemTime::now()` called O(N log N) times during sort
**File:** `src-tauri/src/commands/shell_history.rs` l.287–291
**Status:** Fixed in commit 792b1c3

`sort_by` calls `shell_frecency()` on both elements every comparison. With 500 entries this is ~4500 calls to `SystemTime::now()` and `exp()`.

**Fix:** Pre-compute scores into a `Vec<(Record, f64)>`, sort by pre-computed score.

---

### P9 · `CachedMetrics` deep-cloned for scalar-only queries
**File:** `src-tauri/src/plugins/builtin/system_monitor/plugin.rs` l.564–569
**Status:** Fixed in commit 39fc26e

`cached_metrics()` clones `Vec<CpuCoreInfo>`, `Vec<DiskInfo>`, `Vec<ProcessInfo>` etc. even when `get_cpu_usage` only needs a single `f32`. `get_system_metrics_v2` calls it twice.

**Fix:** Expose fine-grained read methods, or return `Arc<CachedMetrics>` to avoid deep-cloning.

---

## IDIOMATIC RUST

### I1 · `&PathBuf` instead of `&Path` in internal function signatures
**Files:** `commands/settings.rs` l.372, `commands/snippets.rs` l.44, `launcher/history.rs` l.126
**Status:** Fixed in commit 792b1c3

Clippy `ptr_arg`. Use `&Path` — `&PathBuf` derefs to `&Path`, no call sites need to change.

---

### I2 · `AppCategory::from_str` free method instead of `impl std::str::FromStr`
**File:** `src-tauri/src/core/types.rs` l.29
**Status:** Open

Makes `"development".parse::<AppCategory>()` unavailable and the method invisible to generic bounds.

---

### I3 · `get_all_tags` double-clones the tag strings
**File:** `src-tauri/src/launcher/history.rs` l.313
**Status:** Fixed in commit 792b1c3

```rust
records.iter().flat_map(|r| r.tags.clone()) // clones entire Vec per record
// Fix:
records.iter().flat_map(|r| r.tags.iter().cloned())
```

---

### I4 · `PluginRegistry::default()` implemented manually instead of `#[derive(Default)]`
**File:** `src-tauri/src/plugins/registry.rs` l.128
**Status:** Open

All constituent types implement `Default`. Clippy `new_without_default`.

---

## Fix Priority Order

1. **C1–C4** — Critical (safety / correctness)
2. **H1–H6** — High (security / data integrity)
3. **M1–M7** — Medium (robustness)
4. **P1–P9** — Performance (hot paths first: P1, P2, P3, P8)
5. **I1–I4** — Idiomatic cleanup

---

## Second Audit — May 2025 (follow-up on `dev` branch)

Targeted review of authentication, sync, extension loading, and settings import paths.

---

### A1 · Auth tokens crossing the IPC boundary (HIGH)
**Files:** `src-tauri/src/commands/auth.rs`, `src/features/auth/types.ts`
**Status:** Fixed in commit ac98024

`auth_get_session` and `auth_refresh_token` returned `AuthSession` directly over IPC, exposing `access_token` and `refresh_token` to the renderer. A compromised extension or XSS could extract them via `invoke("auth_get_session")`.

**Fix:** Split into `SessionStatus` (renderer-safe: `user_id + expires_at` only) and `AuthSession` (backend-only, never serialized over IPC). `sync.rs::require_premium()` now uses `load_auth_session()` directly (backend path) instead of the IPC command. Frontend `AuthSession` interface purged of both token fields.

---

### A2 · Fail-open path containment in `read_source_files_recursive` (MEDIUM)
**File:** `src-tauri/src/commands/extensions.rs`
**Status:** Fixed in commit ac98024

The per-entry containment check was guarded by `if let Ok(canonical) && let Ok(canonical_base)` — if either `canonicalize` call failed (broken symlink, long path, race), the guard was bypassed and the file read proceeded without verification.

**Fix:** Fail-closed: `canonical_base` computed once upfront with `?`; per-entry `canonicalize` failures `warn! + continue` (skip the entry) instead of fall-through.

---

### A3 · `import_settings` — no size cap, free extension, error oracle (MEDIUM)
**File:** `src-tauri/src/commands/settings.rs` l.694–724
**Status:** Fixed in commit 2a21e5a

Three issues in a single function:
- Accepted any file extension (not just `.json`), allowing arbitrary files to be fed to the parser.
- No size cap: a 2 GB JSON blob would be parsed entirely in memory.
- Distinct error messages for "not JSON" vs "missing key" vs "wrong shape" allowed partial error-oracle fingerprinting of the settings schema.

**Fix:** `validate_settings_path(&path, Some("json"))` enforces `.json`; 1 MiB cap enforced on raw bytes before parsing; all parse/structure errors return a uniform `"Invalid settings file"` string.

---

### A4 · `clear_oauth_pending` accepts unvalidated service string (LOW)
**File:** `src-tauri/src/commands/oauth.rs` l.296–306
**Status:** Fixed in commit 2a21e5a

The `service` parameter was forwarded directly to `pending_requests.retain(...)` without validation. A renderer or extension could call `clear_oauth_pending("github")` to cancel a legitimate in-flight OAuth flow (self-DoS), or inject arbitrary service names into the retain predicate.

**Fix:** Early-return `Err` if `service` is not one of `"github" | "notion"`.

---

### A5 · `load_dev_state` ignores `VerifyOutcome::Mismatch` (LOW)
**File:** `src-tauri/src/commands/extensions.rs` l.1137–1149
**Status:** Fixed in commit 2a21e5a

`load_dev_state` called `read_state_with_verification` (discards `VerifyOutcome`) instead of `read_state_with_outcome`. A tampered `dev-extensions.json` (e.g. path changed to a malicious extension) would load silently without any fail-closed response, inconsistent with the H4 pattern in `load_installed_state`.

**Fix:** Use `read_state_with_outcome`; on `Mismatch`, disable all dev extensions (`enabled = false`) with per-extension `warn!` logging.

---

### A6 · Auth tokens not zeroized on drop (LOW)
**Files:** `src-tauri/src/commands/auth.rs`, `src-tauri/Cargo.toml`
**Status:** Fixed in commit 2a21e5a

`AuthSession.access_token` / `refresh_token` and `PendingAuthFlow.code_verifier` are plain `String` fields — on drop, the backing heap bytes are not zeroed, so tokens can survive in a core dump or heap inspection.

**Fix:** Added `zeroize = { version = "1", features = ["derive"] }`. `AuthSession` derives `Zeroize + ZeroizeOnDrop` (tokens zeroed on drop of every instance and every clone). `PendingAuthFlow` gets a manual `Drop` impl that calls `code_verifier.zeroize()`.
