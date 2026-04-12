# Volt Backend - Complete Structure

Quick reference for the entire backend architecture.

## 📁 Complete Directory Tree

```
src-tauri/
├── src/
│   ├── core/                          ⭐ CORE FOUNDATION
│   │   ├── mod.rs                     # Module exports
│   │   ├── types.rs                   # AppCategory, Platform, SearchResultType, LaunchMode
│   │   ├── traits.rs                  # Searchable, Launchable, Plugin, Cacheable, Persistable
│   │   ├── constants.rs               # App constants (MAX_SEARCH_RESULTS, SCORES, etc.)
│   │   └── error.rs                   # VoltError, VoltResult
│   │
│   ├── plugins/                       🔌 PLUGIN SYSTEM
│   │   ├── mod.rs                     # Module exports
│   │   ├── registry.rs                # PluginRegistry (thread-safe)
│   │   ├── loader.rs                  # PluginLoader (future: dynamic loading)
│   │   ├── builtin/
│   │   │   ├── mod.rs                 # get_builtin_plugins()
│   │   │   └── system_monitor.rs     # SystemMonitorPlugin
│   │   └── README.md                  # Plugin development guide
│   │
│   ├── utils/                         🛠️ UTILITIES
│   │   ├── mod.rs                     # Module exports
│   │   ├── icon.rs                    # extract_icon(), hicon_to_png_base64(), base64_encode()
│   │   ├── matching.rs                # fuzzy_match(), calculate_match_score()
│   │   └── path.rs                    # get_all_drives(), find_main_executable(), is_executable()
│   │
│   ├── search/                        🔍 SEARCH
│   │   └── mod.rs                     # search_applications() with scoring
│   │
│   ├── window/                        🪟 WINDOW MANAGEMENT
│   │   └── mod.rs                     # show/hide/toggle/center_window()
│   │
│   ├── commands/                      📡 TAURI COMMANDS
│   │   ├── mod.rs                     # Module exports
│   │   ├── apps.rs                    # scan/search/launch applications
│   │   ├── settings.rs                # load/save settings
│   │   ├── files.rs                   # file indexing
│   │   ├── launcher.rs                # launch history, pins, tags
│   │   └── autostart.rs               # autostart management
│   │
│   ├── hotkey/                        ⌨️  GLOBAL HOTKEYS
│   │   └── mod.rs                     # Global shortcut management
│   │
│   ├── indexer/                       📂 FILE INDEXING
│   │   ├── mod.rs
│   │   └── scanner.rs                 # File system scanner
│   │
│   ├── launcher/                      🚀 PROCESS LAUNCHER
│   │   ├── mod.rs
│   │   ├── process.rs                 # Cross-platform launching
│   │   └── history.rs                 # Launch history tracking
│   │
│   ├── icons/                         🎨 ICONS
│   │   └── ...                        # Icon assets
│   │
│   ├── lib.rs                         📚 MAIN LIBRARY
│   └── main.rs                        🎯 BINARY ENTRY
│
├── Cargo.toml                         📦 DEPENDENCIES
├── tauri.conf.json                    ⚙️  TAURI CONFIG
├── build.rs                           🔨 BUILD SCRIPT
│
└── Documentation/
    ├── README.md                      # Main backend README
    ├── ARCHITECTURE.md                # Architecture overview
    ├── MODULES.md                     # Detailed module docs
    └── STRUCTURE.md                   # This file
```

## 🎯 Module Quick Reference

| Module       | Purpose                   | Key Files                                   | Main Exports                                          |
| ------------ | ------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| **core**     | Foundation types & traits | types.rs, traits.rs, constants.rs, error.rs | AppCategory, Platform, Plugin trait, VoltError        |
| **plugins**  | Plugin system             | registry.rs, loader.rs, builtin/            | PluginRegistry, SystemMonitorPlugin                   |
| **utils**    | Reusable utilities        | icon.rs, matching.rs, path.rs               | extract_icon(), fuzzy_match(), find_main_executable() |
| **search**   | Search algorithms         | mod.rs                                      | search_applications()                                 |
| **window**   | Window management         | mod.rs                                      | show/hide/toggle/center commands                      |
| **commands** | Tauri handlers            | apps.rs, settings.rs, files.rs, launcher.rs | All #[tauri::command] functions                       |
| **hotkey**   | Global shortcuts          | mod.rs                                      | Hotkey registration                                   |
| **indexer**  | File scanning             | scanner.rs                                  | File indexing system                                  |
| **launcher** | App launching             | process.rs, history.rs                      | Cross-platform launcher                               |

## 📊 File Count by Module

```
core/         5 files
plugins/      5 files (+ 1 README)
utils/        4 files
search/       1 file
window/       1 file
commands/     6 files
hotkey/       1 file
indexer/      2 files
launcher/     3 files
icons/        N/A
──────────────────
Total:        28+ Rust files
```

## 🔗 Module Dependencies

```
lib.rs
  ├── core/          (no dependencies - foundation)
  ├── utils/         (depends on: core)
  ├── search/        (depends on: core, utils)
  ├── plugins/       (depends on: core)
  ├── window/        (depends on: tauri)
  ├── commands/      (depends on: core, utils, search, launcher)
  ├── hotkey/        (depends on: tauri)
  ├── indexer/       (depends on: core)
  └── launcher/      (depends on: core)
```

## 🎨 Type Hierarchy

```
Core Types:
├── AppCategory (enum)
│   ├── Development
│   ├── Productivity
│   ├── Media
│   ├── Gaming
│   └── ...
│
├── Platform (enum)
│   ├── Windows
│   ├── MacOS
│   └── Linux
│
├── SearchResultType (enum)
│   ├── Application
│   ├── File
│   ├── Plugin
│   └── ...
│
└── LaunchMode (enum)
    ├── Normal
    ├── Elevated
    ├── Minimized
    └── Maximized

Core Traits:
├── Searchable
│   ├── search_text()
│   ├── search_keywords()
│   └── match_score()
│
├── Launchable
│   ├── launch()
│   ├── can_launch()
│   └── launch_preview()
│
└── Plugin
    ├── id()
    ├── name()
    ├── description()
    ├── is_enabled()
    ├── initialize()
    └── shutdown()

Error Types:
└── VoltError (enum)
    ├── FileSystem
    ├── NotFound
    ├── PermissionDenied
    ├── Plugin
    └── ...
```

## 🚀 Command Flow

```
Frontend (React/TypeScript)
         │
         │ invoke('command_name')
         ↓
    Tauri Bridge
         │
         ↓
  commands/apps.rs
         │
         ├─→ scan_applications()
         │        │
         │        ├─→ utils::path::get_all_drives()
         │        ├─→ utils::path::find_main_executable()
         │        └─→ utils::icon::extract_icon()
         │
         ├─→ search_applications()
         │        │
         │        └─→ search::search_applications()
         │                   │
         │                   └─→ utils::matching::calculate_match_score()
         │
         └─→ launch_application()
                  │
                  └─→ launcher::launch()
```

## 🎯 Plugin Flow

```
App Startup
     │
     ↓
plugins::registry::PluginRegistry::new()
     │
     ├─→ Register built-in plugins
     │   └─→ SystemMonitorPlugin
     │
     ├─→ registry.initialize_all()
     │
     └─→ Plugins active and ready
             │
             └─→ [Plugin operations during runtime]
                     │
                     └─→ registry.shutdown_all() on exit
```

## 📈 Scoring System

```
Search Score Calculation:
┌─────────────────┬───────┐
│ Match Type      │ Score │
├─────────────────┼───────┤
│ Exact match     │  100  │
│ Starts with     │   90  │
│ Contains        │ 80-70 │ (position-weighted)
│ Fuzzy match     │   50  │
│ No match        │    0  │
└─────────────────┴───────┘

Priority Boosts:
├── Recent app:    +10
├── Frequent app:  +15
└── Pinned app:    +20
```

## 🛠️ Development Workflow

### 1. Adding a New Utility Function

```
1. Choose module: utils/icon.rs, utils/matching.rs, or utils/path.rs
2. Add function with doc comment
3. Add to mod.rs exports if needed
4. Write tests
5. Update MODULES.md
```

### 2. Adding a New Tauri Command

```
1. Add to commands/*.rs
2. Mark with #[tauri::command]
3. Add to lib.rs invoke_handler!
4. Export from commands/mod.rs
5. Test from frontend
```

### 3. Creating a New Plugin

```
1. Create file in plugins/builtin/
2. Implement Plugin trait
3. Add to builtin/mod.rs
4. Register in get_builtin_plugins()
5. Document in plugins/README.md
```

### 4. Adding a New Core Type

```
1. Add to core/types.rs
2. Derive Serialize, Deserialize, Debug, Clone
3. Add helper methods
4. Write tests
5. Document in MODULES.md
```

## 📚 Documentation Files

| File                  | Purpose                         | Audience          |
| --------------------- | ------------------------------- | ----------------- |
| **README.md**         | Quick overview, getting started | All developers    |
| **ARCHITECTURE.md**   | High-level architecture         | New contributors  |
| **MODULES.md**        | Detailed module reference       | Active developers |
| **STRUCTURE.md**      | Quick structure reference       | Everyone          |
| **plugins/README.md** | Plugin development              | Plugin authors    |

## 🧪 Testing Strategy

```
Unit Tests:
├── core/types.rs      → Platform detection, category parsing
├── core/error.rs      → Error conversion
├── utils/matching.rs  → Fuzzy match, scoring
├── utils/path.rs      → Executable finding
└── plugins/registry.rs → Plugin registration

Integration Tests:
├── Search flow (query → scoring → results)
├── Launch flow (scan → search → launch)
└── Plugin lifecycle (register → init → shutdown)
```

## 🎓 Learning Path

1. **Start**: Read [README.md](./README.md)
2. **Understand**: Read [ARCHITECTURE.md](./ARCHITECTURE.md)
3. **Deep Dive**: Read [MODULES.md](./MODULES.md)
4. **Reference**: Use this file (STRUCTURE.md)
5. **Extend**: Read [plugins/README.md](./src/plugins/README.md)

## 🔍 Quick Search

**Need to...**

- Add a type? → `core/types.rs`
- Add a trait? → `core/traits.rs`
- Add a constant? → `core/constants.rs`
- Extract an icon? → `utils/icon.rs`
- Score a match? → `utils/matching.rs`
- Find an exe? → `utils/path.rs`
- Create a plugin? → `plugins/builtin/`
- Add a command? → `commands/`
- Manage window? → `window/mod.rs`

---

**Last Updated**: December 2024
**Version**: 0.4.1
