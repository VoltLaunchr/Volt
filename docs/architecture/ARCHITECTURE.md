# Architecture & Technical Documentation

## Architecture Overview

### Dual Entry Points

The application has two main entry files:

- **Frontend**: [src/main.tsx](../src/main.tsx) - React app entry point, imports from [src/app/App.tsx](../src/app/App.tsx)
- **Backend**: [src-tauri/src/main.rs](../src-tauri/src/main.rs) - Calls `volt_lib::run()` from [src-tauri/src/lib.rs](../src-tauri/src/lib.rs)

### Rust Backend Structure

The Tauri backend is organized into modules:

**Core Setup** ([src-tauri/src/lib.rs](../src-tauri/src/lib.rs)):

- Initializes Tauri plugins (opener, global-shortcut, shell, fs)
- Registers invoke handlers for Tauri commands
- Sets up global hotkey on startup

**Commands** ([src-tauri/src/commands/](../src-tauri/src/commands/)) — 24+ command files:

- `apps.rs` - Application discovery and search logic
  - `scan_applications()` - Scans Windows Program Files, AppData, and Start Menu for .exe files and .lnk shortcuts
  - `search_applications()` - Fuzzy search with scoring (exact match > starts with > contains > fuzzy)
  - `launch_application()` - Cross-platform app launching (Windows/macOS/Linux)
- `window.rs` - Window management commands
- `settings.rs` - Settings management (8 categories, shell settings, export/import)
- `files.rs` - File indexing and search commands
- `launcher.rs` - Launch history and pinned apps; `open_file_with_dialog` (OS "Open With", UNC/.lnk blocked); `open_path` (rejects executable types)
- `clipboard.rs` - Clipboard manager (9 commands)
- `extensions.rs` - Extension system (14 commands); permission allowlist enforced server-side; fail-closed on HMAC mismatch
- `games.rs` - Game scanner (10 platforms: Steam, Epic, GOG, Xbox, EA, Ubisoft, Riot, Amazon, Battle.net, Rockstar)
- `system_monitor.rs` - CPU/RAM/disk + v2 (per-core, network, temps, processes)
- `snippets.rs` - Snippet CRUD + variable expansion; JSON import size capped
- `quicklinks.rs` - Quicklinks CRUD with URL/folder/command validation
- `shell.rs` - Shell command execution (streaming, extended blocklist with NFKC normalization, redactors for GitHub/AWS/Stripe/Slack/JWT tokens, UNC working_dir rejected)
- `shell_history.rs` - Shell history with frecency scoring (500 entries)
- `preview.rs` - File preview for preview panel
- `plugins.rs` - Plugin commands
- `auth.rs` - Supabase auth + deep link; CSRF state nonce binding; JWT claim validation; refresh user_id check; HMAC-signed keyring storage
- `oauth.rs` - OAuth flow (GitHub, Notion) + deep link callbacks
- `credentials.rs` - Encrypted credential storage (OS keyring); `test_credential` command (token never in renderer)
- `keyring_store.rs` - OS keyring abstraction with `store_signed`/`retrieve_signed` (domain-tagged HMAC-SHA256)
- `hotkey.rs` - Hotkey commands
- `autostart.rs` - Autostart management
- `logging.rs` - Log management
- `window_management.rs` - Window snap commands
- `mod.rs` - Module exports

**Hotkey Module** ([src-tauri/src/hotkey/mod.rs](../src-tauri/src/hotkey/mod.rs)):

- Registers `Ctrl+Space` (default) to toggle window visibility
- No fallback hotkeys - user can configure a different hotkey in settings if default conflicts
- Uses `tauri-plugin-global-shortcut` for system-wide hotkey handling
- Provides clear error messages directing users to settings when registration fails
- Smart conflict detection - warns if hotkey is already registered by another application
- Best-effort registration - app runs successfully even if hotkey registration fails

### Frontend Structure

**Feature-Based Organization**:

- `src/app/` - Main application component and styles
- `src/features/search/components/` - SearchBar component with auto-focus and keyboard handling
- `src/features/results/components/` - ResultsList and ResultItem components for displaying search results
- `src/shared/types/` - TypeScript interfaces shared across features
- `src/shared/constants/` - Configuration and keyboard key constants
- `src/styles/` - Global styles, CSS variables, themes, and animations

**State Management**:
The main App component ([src/app/App.tsx](../src/app/App.tsx)) is refactored to ~197 lines with extracted hooks and components:

- `useSearchPipeline` - Search orchestration with 150ms debounce
- `useAppLifecycle` - Application loading and lifecycle management
- `useGlobalHotkey` - Hotkey registration and handling
- `useResultActions` - Result execution and context menu actions
- `ViewRouter` - Routes between main view and plugin-specific views
- `ResultContextMenu` - Context menu component for result actions

**Data Flow**:

1. Frontend calls `scan_applications()` on mount to load all apps
2. User types → debounced search → `search_applications()` with query and app list
3. Rust performs fuzzy matching and scoring, returns sorted results
4. Frontend renders results, handles keyboard selection
5. Enter key → `launch_application()` → window hides

### Type System

Rust and TypeScript share similar data structures:

**Rust** ([src-tauri/src/commands/apps.rs](../src-tauri/src/commands/apps.rs)):

```rust
pub struct AppInfo {
    pub id: String,        // MD5 hash of path
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub keywords: Option<Vec<String>>,
    pub last_used: Option<i64>,
    pub usage_count: u32,
    pub category: Option<String>,
}
```

**TypeScript** ([src/shared/types/common.types.ts](../src/shared/types/common.types.ts)):

```typescript
interface AppInfo {
  id: string;
  name: string;
  path: string;
  icon?: string;
  description?: string;
  keywords?: string[];
  lastUsed?: number; // Camel case vs snake_case
  usageCount: number;
  category?: AppCategory;
}
```

> **Note**: TypeScript uses `camelCase` while Rust uses `snake_case`. Ensure `serde` attributes are used in Rust structs if exact matching is required. Error handling uses `VoltResult<T>` with the `VoltError` discriminated union rather than `Result<T, String>`.

### Extension System

Volt supports community extensions via the [volt-extensions](https://github.com/VoltLaunchr/volt-extensions) repository. Extensions can be browsed, installed, and managed through Settings.

**Security model:**
- HMAC-SHA256 state signatures on `installed.json`/`dev-extensions.json` (key in OS keyring)
- Signature mismatch → fail-closed: `granted_permissions` reset to empty for every extension (H4)
- Server-side `ALLOWED_PERMISSIONS` allowlist: entire batch rejected on any unknown permission (M1)
- Worker sandbox: `eval`/`Function`/`WebSocket`/`XMLHttpRequest`/`importScripts` disabled
- SSRF prevention: private IP blocking, numeric IPv4/IPv6-mapped hosts rejected, redirect SSRF blocked, Cookie/Auth headers stripped, 10MB body cap
- Launch validation: LOLBIN denylist, NTFS normalization, executable extension validation

### Auth & Credentials Security Model

- **Auth CSRF**: `auth_start_login` generates a UUID state nonce (5 min TTL). `handle_auth_deep_link` verifies and consumes the nonce — drive-by deep links rejected
- **JWT validation**: `exp`, `iss`, `sub` claims verified against `SUPABASE_URL`; `user_id` and `expires_at` taken from verified claims, never from URL query params
- **Refresh guard**: user_id mismatch in refresh response rejected; `expires_in` capped at 24h
- **Keyring HMAC**: `store_signed`/`retrieve_signed` attach a domain-tagged HMAC-SHA256 (length-prefixed domain prefix prevents cross-domain replay); tamper → silent logout (M10)
- **Deep-link rate-limit**: `single-instance` forward path rate-limited with forensic logging (H9)

### Window Configuration

The Tauri window ([src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json)) is configured as:

- Always on top, no decorations, transparent background
- 800x550px (expands to 1100px with preview panel), skips taskbar
- Auto-focused when shown
- Uses `beforeDevCommand` and `beforeBuildCommand` with bun

## Known Patterns & Strategies

### Application Scanning Strategy

The app scanner ([src-tauri/src/commands/apps.rs](../src-tauri/src/commands/apps.rs)):

1. Searches Program Files directories for .exe files
2. Prefers executables matching their parent directory name
3. Recursively scans Start Menu for .lnk shortcuts
4. Deduplicates by path before returning

### Search Scoring Algorithm

Search scoring ([src-tauri/src/commands/apps.rs](../src-tauri/src/commands/apps.rs)):

- Exact match: 100 points
- Starts with query: 90 points
- Contains query: 80 points minus position penalty
- Fuzzy match (all chars in order): 50 points
- No match: filtered out

### Keyboard Navigation

- Search input captures Arrow keys, Enter, and Escape in [src/app/App.tsx](../src/app/App.tsx)
- Global hotkey (`Ctrl+Space`) handled by Rust in [src-tauri/src/hotkey/mod.rs](../src-tauri/src/hotkey/mod.rs)
- Constants defined in [src/shared/constants/keys.ts](../src/shared/constants/keys.ts)
