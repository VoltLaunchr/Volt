<div align="center">

# Volt

**Lightning-fast, keyboard-driven launcher for Windows, macOS, and Linux**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange)](https://tauri.app)
[![CI](https://github.com/VoltLaunchr/Volt/actions/workflows/check.yml/badge.svg)](https://github.com/VoltLaunchr/Volt/actions/workflows/check.yml)
[![Latest Release](https://img.shields.io/github/v/release/VoltLaunchr/Volt)](https://github.com/VoltLaunchr/Volt/releases/latest)

Search apps, files, do math, convert units, set timers, and run commands — without ever leaving your keyboard.

[Download](#-download) | [Features](#-features) | [Quick Start](#-quick-start) | [Contributing](CONTRIBUTING.md) | [Roadmap](docs/build-release/ROADMAP.md)

</div>

---

## Features

- **Instant fuzzy search** — finds your apps and files as you type
- **Keyboard-first** — global hotkey + arrow keys + Enter, no mouse needed
- **Built-in calculator** — math expressions, unit conversions, date math, timezone conversions, all inline
- **Game launcher** — auto-detects Steam, Epic, GOG, Xbox, EA, Ubisoft, Riot games
- **Clipboard history** — search and paste anything you copied recently
- **Emoji picker** — type `:` to start, fuzzy search, recently used, skin tones
- **Timers** — `timer 5m` and forget
- **Web search** — `?` prefix to query Google/Bing/DuckDuckGo
- **Plugin system** — extend Volt with TypeScript plugins (built-in plugins use the same API)
- **Frecency-based ranking** — most used apps appear first, with exponential time decay
- **Preview panel** — press `Ctrl+P` to preview files, images, folders, and app metadata
- **Text snippets** — reusable text blocks with variable expansion (`{date}`, `{time}`, etc.)
- **Power-user search operators** — filter by `ext:`, `size:`, `modified:` in file search
- **Windows Store/UWP app support** — discovers apps via Shell AppsFolder and Registry
- **Results grouped by type** — Applications, Commands, Games, Files shown in distinct sections
- **Glassmorphism UI** — minimal, transparent, always on top, themable
- **Native performance** — Rust backend, ~15 MB binary, instant startup

## Download

Grab the latest release for your platform from the [Releases page](https://github.com/VoltLaunchr/Volt/releases/latest).

| Platform | File |
|----------|------|
| **Windows** | `volt_x.x.x_x64-setup.exe` (NSIS) or `volt_x.x.x_x64_en-US.msi` |
| **macOS (Intel)** | `volt_x.x.x_x64.dmg` |
| **macOS (Apple Silicon)** | `volt_x.x.x_aarch64.dmg` |
| **Linux (Debian/Ubuntu)** | `volt_x.x.x_amd64.deb` |
| **Linux (Fedora/RHEL)** | `volt-x.x.x-1.x86_64.rpm` |
| **Linux (any)** | `volt_x.x.x_amd64.AppImage` |

> **Windows users**: until we obtain code signing (tracked in [ROADMAP M1.3](docs/build-release/ROADMAP.md)), SmartScreen will warn on first install. Click **More info > Run anyway**. The binary is reproducible from the source in this repo.

After install, press **`Ctrl+Space`** (configurable) to open Volt.

## Quick Start (development)

You will need:
- [**Bun**](https://bun.sh) (latest)
- [**Rust**](https://rustup.rs/) (stable)
- Tauri prerequisites for your OS — see [Tauri docs](https://tauri.app/start/prerequisites/)

```bash
git clone https://github.com/VoltLaunchr/Volt.git
cd Volt
bun install
bun tauri dev
```

For frontend-only iteration (without rebuilding the Rust backend):
```bash
bun run dev
```

Run tests:
```bash
bun run test                                                  # frontend (vitest, 166 tests)
cd src-tauri && cargo test --lib                              # backend (cargo, 138 tests)
cd src-tauri && cargo clippy --all-features --all-targets -- -D warnings   # lint
```

## Architecture

Volt is a [Tauri 2](https://tauri.app) application:
- **Frontend**: React 19 + Vite + TypeScript, lives in `src/`
- **Backend**: Rust, lives in `src-tauri/src/`
- **Communication**: Tauri's typed `invoke` IPC bridge

See [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) for the full picture, [`docs/plugins/DEVELOPMENT.md`](docs/plugins/DEVELOPMENT.md) for the plugin API, and [`docs/build-release/ROADMAP.md`](docs/build-release/ROADMAP.md) for what is planned.

## Contributing

Contributions are very welcome! Check out [`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev workflow, branch conventions, and PR process.

For bug reports and feature requests: open an [issue](https://github.com/VoltLaunchr/Volt/issues). For questions and discussion: [Discussions](https://github.com/VoltLaunchr/Volt/discussions).

Found a security vulnerability? See [`SECURITY.md`](SECURITY.md).

## License

Volt is open source under the [Apache License 2.0](LICENSE).

```
Copyright 2026 VoltLaunchr Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

## Acknowledgments

Built with [Tauri](https://tauri.app), [React](https://react.dev), [Vite](https://vitejs.dev), and [Rust](https://www.rust-lang.org). Inspired by [Spotlight](https://support.apple.com/guide/mac-help/spotlight-mchlp1008/mac), [Alfred](https://www.alfredapp.com), and [Raycast](https://raycast.com).
