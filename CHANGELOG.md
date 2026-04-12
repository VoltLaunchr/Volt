# Changelog

All notable changes to Volt will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.2] - 2026-01-01

### 🎉 Initial Release

We're excited to introduce **Volt** - a modern, lightning-fast application launcher for Windows, macOS, and Linux. Built with Tauri v2 and React, Volt combines native performance with a beautiful, customizable interface.

### ✨ Core Features

#### Search & Launch
- **Intelligent Search Engine** - Find applications, files, and commands instantly with fuzzy matching
- **Smart Scoring** - Results are prioritized based on relevance, usage frequency, and match quality
- **Keyboard-First Navigation** - Full keyboard support with arrow keys, Home/End, Page Up/Down
- **Quick Actions** - Use `Alt+1-9` to launch the first 9 results directly
- **Debounced Search** - Sub-150ms response time for smooth, responsive searches

#### User Interface
- **Glass Morphism Design** - Modern, semi-transparent interface that blends beautifully with your desktop
- **Multi-Theme Support** - Choose between Dark, Light, or Auto (follows system theme)
- **Smooth Animations** - Polished transitions and micro-interactions throughout
- **Responsive Layout** - Optimized for different screen sizes and resolutions
- **Customizable Window Position** - Top, Center, or Custom positioning with pixel-perfect control

#### File Indexing
- **Background Indexing** - Automatically indexes your files on startup for instant search
- **Configurable Folders** - Choose which directories to index
- **Smart Exclusions** - Exclude specific paths and file extensions
- **Recent Files Tracking** - Access your recently opened files quickly
- **Index Statistics** - View detailed stats about your indexed content

### 🔌 Built-in Plugins

- **Calculator** (`=` or `calc`)
  - Instant mathematical evaluations
  - Support for basic operations and common functions
  - Result copying with one click

- **Clipboard Manager** (`clipboard`)
  - Automatic clipboard history tracking
  - Search through past clipboard entries
  - Pin important items for quick access
  - Delete unwanted entries

- **Emoji Picker** (`:emoji`)
  - Search and copy emojis instantly
  - Type `:` followed by emoji name
  - Copy to clipboard with Enter or click

- **Web Search** (`?query`)
  - Quick web searches from Volt
  - Support for Google, Bing, DuckDuckGo
  - Opens in your default browser

- **Timer** (`timer 5m`)
  - Countdown timer with multiple formats
  - Visual countdown display
  - Notification when timer completes

- **System Monitor** (`system`)
  - Real-time CPU usage monitoring
  - Memory (RAM) statistics
  - Disk space information
  - System performance overview

- **Game Scanner**
  - Automatic detection of installed games
  - Support for Steam, Epic Games, GOG, EA, Ubisoft
  - Quick game launching
  - Platform icons and metadata

### ⚙️ Settings & Customization

#### General Settings
- **Max Results** - Control how many search results to display
- **Close on Launch** - Auto-hide window after launching an app
- **Start with Windows** - Launch Volt on system startup
- **Language** - Interface language selection

#### Appearance
- **Theme Selection** - Dark, Light, or Auto
- **Window Position** - Top, Center, or Custom coordinates
- **Transparency Effects** - Adjust blur and transparency
- **Font Size** - Customize text size

#### Hotkeys
- **Global Hotkey** - Register a system-wide shortcut (default: `Ctrl+Space`)
- **Custom Shortcuts** - Assign keyboard shortcuts to specific apps
- **Conflict Detection** - Alerts when hotkeys conflict with other apps

#### Indexing
- **Folder Selection** - Choose which folders to index
- **Excluded Paths** - Blacklist specific directories
- **File Extensions** - Filter by file types
- **Index on Startup** - Auto-index when Volt starts
- **Manual Re-indexing** - Force a fresh index scan

#### Plugin Management
- **Enable/Disable Plugins** - Turn plugins on or off
- **Plugin Configuration** - Customize plugin behavior
- **External Extensions** - Load community-created extensions

### 🚀 Performance

- **Native Performance** - Built with Rust and Tauri for maximum speed
- **Low Memory Footprint** - Efficient memory usage (~50-100MB typical)
- **Fast Startup** - Launches in under 1 second
- **Optimized Search** - Sub-150ms search response time
- **Background Operations** - File indexing doesn't block the UI
- **Smart Caching** - Frequently accessed data is cached intelligently

### 🛠️ Technical Details

#### Architecture
- **Frontend**: React 18 with TypeScript, Vite, CSS Variables
- **Backend**: Rust with Tauri v2
- **State Management**: React hooks and context
- **Plugin System**: Extensible architecture with TypeScript/Rust APIs
- **File Indexing**: Asynchronous scanning with configurable filters

#### Platform Support
- **Windows** - Full support (Windows 10+)
- **macOS** - Full support (macOS 10.13+)
- **Linux** - Full support (major distributions)

#### System Requirements
- **OS**: Windows 10+, macOS 10.13+, or Linux with GTK3
- **RAM**: 4GB minimum (8GB recommended)
- **Disk**: 100MB for application + index space
- **Display**: 1280x720 minimum resolution

### 📦 Distribution

- **Windows**: Portable EXE, MSI Installer, NSIS Installer
- **macOS**: DMG, Universal Binary (Intel + Apple Silicon)
- **Linux**: AppImage, DEB, RPM

### 🐛 Known Issues

- Hotkey registration may fail if already in use by another application
- File indexing may be slow on large drives (10,000+ files)
- Some games from exotic launchers may not be detected

### 📝 Notes

This is the initial public release of Volt. We're committed to regular updates and improvements based on community feedback. Please report bugs and request features on our [GitHub repository](https://github.com/VoltLaunchr/Volt).

### 🙏 Acknowledgments

Special thanks to:
- The Tauri team for their amazing framework
- The Rust and React communities
- All early testers and contributors

---

## Legend

- 🎉 Major Release
- ✨ New Features
- 🔧 Improvements
- 🐛 Bug Fixes
- 🔒 Security
- 📝 Documentation
- 🚀 Performance
- ⚠️ Deprecations
- 🗑️ Removals

---

[Unreleased]: https://github.com/VoltLaunchr/Volt/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/VoltLaunchr/Volt/releases/tag/v0.0.2
- 🎯 Système de suggestions contextuelles
- 📌 Menu contextuel avec actions rapides (Ctrl+K)
- 📋 Copie de chemin et ouverture du dossier parent
- ℹ️ Dialogue de propriétés pour les résultats
- 🔄 Synchronisation des raccourcis d'applications
- 📊 Suivi de l'historique de lancement

#### Système d'Extensions
- 🔌 Support des extensions externes
- 📦 Chargement dynamique d'extensions
- 🔧 Extensions de développement (dev mode)
- 🔄 Rafraîchissement à chaud des extensions
- 📚 API complète pour les développeurs

### 🔧 Technique

#### Architecture
- ⚡ Tauri v2 (Rust + React)
- ⚛️ React 18 avec hooks modernes
- 🎨 CSS variables pour le theming
- 🔒 TypeScript pour la sécurité des types

#### Performance
- 🚀 Indexation en tâche de fond
- ⏱️ Timeout de 500ms par plugin
- 🎯 Protection anti-réponses obsolètes
- 💾 Cache intelligent pour les résultats

#### Plateforme
- 🪟 Support Windows complet
- 🍎 Support macOS
- 🐧 Support Linux

### 🐛 Corrections
- Gestion des erreurs lors de l'indexation
- Stabilité du système de hotkey globale
- Gestion des chemins multi-plateformes

### 📝 Notes
- Première version publique
- Base solide pour les futures améliorations
- Système de plugins extensible

---

## Légende

- ✨ Nouveautés
- 🔧 Améliorations
- 🐛 Corrections de bugs
- 🔒 Sécurité
- 📝 Documentation
- 🚀 Performance
- ⚠️ Dépréciations
- 🗑️ Suppressions
