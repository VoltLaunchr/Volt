# Volt Features Documentation

Comprehensive guide to all features available in Volt.

## Core Features

### 🔍 Smart Search

- **Fuzzy Matching**: Find apps even with typos
- **Smart Scoring**: Results ranked by relevance and usage frequency
- **Multi-Source Search**: Apps, files, and plugins searched in parallel
- **Debounced Search**: Sub-150ms response time
- **Keyword Boosting**: Plugin results prioritized when query matches keywords

### ⌨️ Keyboard-First Navigation

Complete keyboard control with extensive shortcuts:

- Navigation: Arrow keys, Home/End, Page Up/Down
- Actions: Enter, Ctrl+Enter, Shift+Enter
- Quick Launch: Alt+1 through Alt+9
- Result Actions: Ctrl+O, Ctrl+I, Ctrl+C, Ctrl+Delete
- View Control: Ctrl+, (Settings), Ctrl+R (Reload), Ctrl+Q (Quit)

See [SHORTCUTS.md](../user-guide/SHORTCUTS.md) for complete reference.

### 🎨 Modern UI

- **Glass Morphism Design**: Semi-transparent, blurred backgrounds
- **Multi-Theme Support**: Dark, Light, Auto (follows system)
- **Smooth Animations**: Polished transitions throughout
- **Responsive Layout**: Adapts to different screen sizes
- **Customizable Positioning**: Top, Center, or Custom coordinates

### 📁 File Indexing

- **Background Scanning**: Indexes files without blocking UI
- **Configurable Folders**: Choose which directories to index
- **Smart Exclusions**: Filter by paths and file extensions
- **Category Detection**: Automatic categorization (Apps, Games, Documents, etc.)
- **Recent Files**: Track and quick-access recently opened files
- **Index Statistics**: View counts and categories

### 🔥 Global Hotkey

- **System-Wide Trigger**: Access Volt from anywhere
- **Default**: `Ctrl+Space` (configurable)
- **Smart Registration**: Clear error messages if hotkey conflicts
- **User-Configurable**: Change hotkey in Settings
- **Conflict Detection**: Warns when hotkey is already in use

## Built-in Plugins

### 🧮 Calculator

**Activation**: Type `calc` or start with `=`

**Features**:
- Basic arithmetic: `= 2 + 2`
- Scientific functions: `= sqrt(144)`, `= sin(45)`
- Constants: `pi`, `e`
- Unit conversions: `50 kg in lbs`
- Date calculations: `days until Christmas`
- Timezone conversions: `5pm london in tokyo`
- Dedicated calculator view with history

**Supported Units**:
- Length: m, km, mi, ft, in, cm, mm
- Weight: kg, lb, oz, g, mg, ton
- Temperature: °C, °F, K
- Time: s, min, h, day, week, month, year

### 📋 Clipboard Manager

**Activation**: Type `clipboard`

**Features**:
- Automatic history tracking
- Search through clipboard entries
- Pin important items
- Delete unwanted entries
- Copy items back to clipboard
- Persistent storage across sessions

### 😀 Emoji Picker

**Activation**: Type `:` followed by emoji name

**Features**:
- Search by name: `:smile`, `:heart`, `:rocket`
- Category browsing (Smileys, Animals, Food, etc.)
- Visual grid display
- Keyboard navigation
- Copy to clipboard instantly
- Recent emojis tracking

### 🌐 Web Search

**Activation**: Type `?` followed by query

**Features**:
- Default search engine (configurable)
- Multiple engines: `?g` (Google), `?ddg` (DuckDuckGo), `?b` (Bing)
- Direct URL opening
- Query auto-encoding

### ⏱️ Timer

**Activation**: Type `timer` followed by duration

**Features**:
- Multiple formats: `5m`, `25 minutes`, `1h30m`, `90s`
- Pomodoro support: `timer 25m pomodoro`
- Visual countdown display
- Desktop notifications
- Pause/Resume/Cancel controls

### 📊 System Monitor

**Activation**: Type `system`, `cpu`, `ram`, or `disk`

**Features**:
- Real-time CPU usage
- Memory (RAM) statistics
- Disk space monitoring
- Per-drive breakdown
- Auto-refresh updates

### 🎮 Game Scanner

**Activation**: Type game name or `games`

**Features**:
- Multi-platform detection: Steam, Epic Games, GOG, EA, Ubisoft, Riot
- Automatic game discovery
- Platform icons and metadata
- Direct game launching
- Cache for fast access
- Dedicated games view

**Supported Platforms**:
- Steam
- Epic Games Store
- GOG Galaxy
- EA App (Origin)
- Ubisoft Connect
- Riot Games
- Xbox Game Pass (Windows)
- Standalone games

### 🔧 System Commands

**Activation**: Type command name

**Commands**:
- `settings` / `preferences` - Open Settings
- `reload` / `refresh` - Reload Volt
- `quit` / `exit` - Close Volt
- `about` / `info` - Open Volt website
- `account` - User settings

## Extension System

### 📦 Extension Store

Access via Settings → Extensions

**Features**:
- Browse available extensions
- Install/Uninstall extensions
- Enable/Disable extensions
- Check for updates
- Auto-update support
- Extension metadata and descriptions

### 🛠️ Development Mode

For extension developers:

- Link local extension folders
- Hot-reload on code changes
- Dev extensions list
- Source code viewer
- Real-time error reporting

**Supported Extension Types**:
- Search plugins
- UI components
- Backend integrations
- Custom views

See [Plugin Development Guide](../plugins/DEVELOPMENT.md) for developer guide.

## Settings & Customization

### General Settings

- **Max Results**: Control search result limit (default: 8)
- **Close on Launch**: Auto-hide after launching (configurable)
- **Start with Windows**: Launch on system startup
- **Language**: Interface language (English, French)

### Appearance

- **Theme**: Dark, Light, Auto
- **Window Position**: Top, Center, Custom
- **Transparency Effects**: Blur intensity
- **Font Size**: UI text size
- **Custom Position**: Pixel-perfect X/Y coordinates

### Hotkeys

- **Toggle Window**: Global hotkey to show/hide (default: Ctrl+Space)
- **Open Settings**: Shortcut to open settings (default: Ctrl+,)
- **Custom App Shortcuts**: Assign keyboard shortcuts to specific apps

### Indexing

- **Folders**: Choose directories to index
- **Excluded Paths**: Blacklist specific folders
- **File Extensions**: Filter by file types
- **Index on Startup**: Auto-index when Volt starts
- **Manual Re-indexing**: Force fresh scan

### Plugin Settings

- **Enable/Disable**: Toggle individual plugins
- **Plugin Configuration**: Customize plugin behavior
- **Priority**: Order plugin results

## Advanced Features

### 🔄 Auto-Updates

- Silent update checks on startup
- Notification for available updates
- One-click install
- Release notes display
- Rollback support (coming soon)

### 📊 Usage Analytics

- Launch frequency tracking
- Recent apps history
- Most used apps
- Search pattern analysis
- Pinned apps support

### 🎯 Smart Suggestions

When search is empty, shows contextual suggestions:

- What's New (Changelog)
- Settings access
- Clipboard History
- File Search
- Calculator
- Games
- System Monitor
- Web Search
- Emoji Picker

### 🔍 Context Menu

Right-click or `Ctrl+K` on results for:

- Launch
- Open File Location
- Copy Path
- Properties/Info
- Add to Favorites
- Remove from History

### ℹ️ Properties Dialog

Press `Ctrl+I` to view:

- Full path
- File size
- Last modified date
- File type
- Icon
- Quick actions

## Performance Optimizations

### Search Optimization

- Parallel search across sources (apps, files, plugins)
- 500ms timeout per plugin to prevent blocking
- Debounced input (150ms) to reduce unnecessary searches
- Stale response protection with search IDs
- Smart result caching

### Memory Management

- Lazy loading of heavy components
- Icon caching system
- Efficient state management
- Garbage collection optimization
- ~50-100MB typical memory usage

### Startup Optimization

- Fast cold start (<1 second)
- Background file indexing
- Deferred plugin initialization
- Chunked JavaScript loading

## Cross-Platform Support

### Windows

- Full feature support
- Start Menu integration
- Registry scanning for installed apps
- Admin mode launching (Shift+Enter)
- Icon extraction from .exe files
- .lnk shortcut resolution

### macOS

- Applications folder scanning
- .app bundle support
- Spotlight-like experience
- Native icon extraction
- Launch Services integration

### Linux

- .desktop file parsing
- Multiple install locations
- Icon theme support
- Executable detection
- XDG directories support

## Accessibility

- Full keyboard navigation
- Screen reader compatible (coming soon)
- High contrast theme support
- Configurable font sizes
- Visual focus indicators
- No mouse required

---

For feature requests or bug reports, visit our [GitHub repository](https://github.com/VoltLaunchr/Volt).

Last updated: January 1, 2026
