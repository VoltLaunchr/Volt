<div align="center">

<img src="public/logo.png" alt="Volt — open source keyboard launcher" width="160" />

# Volt — Open Source Keyboard Launcher for Windows, macOS & Linux

**A free, native Alfred / Raycast / Spotlight alternative built with Rust and Tauri.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg "Apache 2.0 license")](./LICENSE)
[![CI status](https://github.com/VoltLaunchr/Volt/actions/workflows/check.yml/badge.svg "Continuous integration status")](https://github.com/VoltLaunchr/Volt/actions/workflows/check.yml)
[![Latest release](https://img.shields.io/github/v/release/VoltLaunchr/Volt?label=release "Latest release version")](https://github.com/VoltLaunchr/Volt/releases/latest)
[![Platform: Windows · macOS · Linux](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey "Cross-platform: Windows, macOS, Linux")](https://github.com/VoltLaunchr/Volt/releases/latest)
[![Built with Tauri 2](https://img.shields.io/badge/built%20with-Tauri%202-orange "Built with Tauri 2")](https://tauri.app)
[![Stars](https://img.shields.io/github/stars/VoltLaunchr/Volt?style=social "GitHub stars")](https://github.com/VoltLaunchr/Volt/stargazers)

<img src="docs/assets/demo.gif" alt="Volt keyboard launcher demo — fuzzy search, calculator, clipboard history" width="720" />

### [🌐 voltlaunchr.com](https://voltlaunchr.com) · [⬇ Download](#-download) · [✨ Features](#-features) · [🚀 Quick Start](#-quick-start) · [📚 Docs](https://voltlaunchr.com/en/docs) · [🤝 Contributing](./CONTRIBUTING.md)

</div>

---

## Why Volt?

Volt is a **free, open-source keyboard launcher** built with **Rust** and **Tauri** for **Windows, macOS, and Linux** — search apps, files, and run commands at the speed of thought. The binary is **~15 MB**, starts instantly, and ships **zero Electron**. Alfred is paid and macOS-only. Raycast is free but closed source and macOS-first. Spotlight ships nothing on Linux. Volt is the answer to all three: **Apache 2.0**, native, identical UX on every desktop OS.

## 📊 Volt vs Alfred vs Raycast vs Spotlight

| Feature                       | **Volt**                              | Alfred                  | Raycast               | Spotlight        |
| ----------------------------- | ------------------------------------- | ----------------------- | --------------------- | ---------------- |
| Price                         | **Free**                              | Free + £34 Powerpack    | Free + paid Pro/Teams | Free (built-in)  |
| Platforms                     | **Windows, macOS, Linux**             | macOS only              | macOS, Windows (beta) | macOS only       |
| Open source                   | ✅ **Apache 2.0**                     | ❌                      | ❌                    | ❌               |
| Binary size                   | **~15 MB**                            | ~30 MB                  | ~250 MB+              | OS bundled       |
| Plugin API                    | ✅ **TypeScript, sandboxed**          | ⚠️ AppleScript / shell  | ✅ TypeScript          | ❌               |
| Game launcher (10 platforms)  | ✅ **Steam, Epic, GOG, Xbox, +6**     | ❌                      | ⚠️ Steam only          | ❌               |
| Clipboard history             | ✅                                    | 💷 Powerpack            | ✅                     | ❌               |
| Snippets with variables       | ✅ `{date}`, `{time}`, `{cursor}`, …  | 💷 Powerpack            | ✅                     | ❌               |
| Sandboxed extensions          | ✅ **Web Worker + permission consent**| ❌                      | ⚠️ Node, less strict   | ❌               |
| Telemetry / cloud-required    | **None**                              | None                    | Account + telemetry   | None             |
| Built with                    | Rust + Tauri 2 + React 19             | Objective-C / Swift     | Swift / TypeScript    | Apple internal   |

> Comparison reflects publicly available info as of 2026-05. Corrections welcome via [issue](https://github.com/VoltLaunchr/Volt/issues).

---

## ✨ Features

### 🔍 Search & Launch

- **Fuzzy search across apps, files, and commands** — `nucleo-matcher` powered, scored exact / startsWith / contains / fuzzy.
- **Frecency ranking** — `launch_count × exponential time decay`, your most-used apps surface first; empty query shows top picks.
- **Power-user file operators** — `ext:pdf`, `in:downloads`, `size:>10mb`, `modified:<7d` parsed inline by `queryParser.ts`.
- **Cross-platform app discovery** — Windows Shell `AppsFolder` + Registry + Start Menu, macOS `.app` bundles + Spotlight metadata, Linux `.desktop` files.
- **Background file indexer** — SQLite-backed, `notify` filesystem watcher, incremental updates, `max_depth=10`, 100 MB cap per file.
- **Results grouped by section** — Applications · Commands · Games · Files, sorted by score.

### 🧩 Built-in Plugins

- **Calculator** — math, units, dates, timezones inline (`5km in mi`, `10:00 NYC in Tokyo`).
- **Game launcher** — 10 platforms detected: Steam, Epic, GOG, Xbox/Microsoft Store, EA, Ubisoft Connect, Riot, Amazon Games, Battle.net, Rockstar.
- **Clipboard history** — last N entries, fuzzy searchable, paste with one keystroke.
- **Snippets** — reusable text blocks, `{date}` / `{time}` / `{cursor}` / `{clipboard}` variables, JSON import/export.
- **Quicklinks** — `ql:` prefix for URL / folder / command shortcuts.
- **Shell** — `>` prefix runs commands with streaming output, ANSI colors, frecency-ranked history (500 entries).
- **Web search** — `?` prefix queries Google / Bing / DuckDuckGo / Kagi.
- **Emoji picker** — `:` prefix, fuzzy search, recently used, skin tones, 1800+ emoji.
- **Timers & Pomodoro** — `timer 5m`, focus mode, auto-cycle, desktop notifications.
- **System monitor** — per-core CPU, per-disk, network throughput, top processes, temperatures.
- **Window management** — snap, center, half-screens, multi-monitor.

### 🔒 Security

- **Sandboxed extensions** — Web Worker isolation; `eval`, `Function`, `WebSocket`, `XMLHttpRequest`, `importScripts` all disabled.
- **Permission consent** — first-load consent dialog; `clipboard`, `network`, `notifications` granted explicitly per extension.
- **Tamper detection** — HMAC-SHA256 signatures (`.sig`) on `installed.json` and `dev-extensions.json`; key in OS keyring; mismatch → fail-closed (all permissions reset).
- **SSRF prevention in extension proxy** — private IPs blocked, IPv4-mapped IPv6 rejected, redirect SSRF blocked, `Cookie` / `Authorization` stripped, 10 MB body cap.
- **Hardened auth** — Supabase JWT verified against project JWKS (ES256); CSRF state nonce with 5 min TTL; refresh token user_id check.
- **Encrypted credential storage** — OS keyring-backed (Keychain / Credential Manager / Secret Service); domain-tagged HMAC.
- **Launch validation** — LOLBIN denylist, NTFS path normalization, executable extension validation, UNC working_dir rejected.
- **Hardened shell** — NFKC normalization + 9+ blocklist patterns + extended secret redactors in logs.

### ⚙️ Developer

- **Tests** — 166 frontend (Vitest) + 143 backend (`cargo test`), CI on every PR.
- **CI gates** — `cargo fmt --check`, `cargo clippy -D warnings`, `eslint`, `tsc --noEmit`, full Vitest suite.
- **Plugin API in TypeScript** — same API for builtins and extensions; `keywords` / `prefix` declarative matching; 500 ms timeout.
- **Tauri 2 IPC** — typed `invoke` bridge, capability scopes per-window (`main`, `settings`, `onboarding`, `system-monitor`).
- **Search pipeline** — 150 ms debounce + `latestSearchId` stale-response protection.
- **i18n** — English + French, 9 namespaces, OS-locale auto-detect via i18next.
- **Auto-updater** — minisign-signed manifest, GitHub Releases backed, end-to-end.
- **Structured logging** — `tracing` + rotating daily files; frontend `logger.ts` mirrors levels.

---

## ⬇ Download

Grab the latest signed build from the [Releases page](https://github.com/VoltLaunchr/Volt/releases/latest#assets).

| Platform                        | Asset                                   | Checksum / Signature                            |
| ------------------------------- | --------------------------------------- | ----------------------------------------------- |
| **Windows 10/11** (NSIS)        | `volt_x.x.x_x64-setup.exe`              | `.sig` minisign + SHA256 in release notes       |
| **Windows 10/11** (MSI)         | `volt_x.x.x_x64_en-US.msi`              | `.sig` minisign + SHA256                        |
| **macOS Intel**                 | `volt_x.x.x_x64.dmg`                    | `.sig` minisign + SHA256                        |
| **macOS Apple Silicon**         | `volt_x.x.x_aarch64.dmg`                | `.sig` minisign + SHA256                        |
| **Debian / Ubuntu**             | `volt_x.x.x_amd64.deb`                  | `.sig` minisign + SHA256                        |
| **Fedora / RHEL**               | `volt-x.x.x-1.x86_64.rpm`               | `.sig` minisign + SHA256                        |
| **Linux (any)**                 | `volt_x.x.x_amd64.AppImage`             | `.sig` minisign + SHA256                        |

**Windows package manager:**

```powershell
winget install VoltLaunchr.Volt
```

> ⚠️ **Windows SmartScreen warning** — until we obtain a code-signing certificate (tracked in [ROADMAP M1.3](./docs/build-release/ROADMAP.md)), Windows will warn on first install. Click **More info → Run anyway**. Builds are reproducible from the source in this repo and verifiable against the published SHA256.

After install, press **`Ctrl+Space`** (configurable) to open Volt.

---

## 🚀 Quick Start

### Prerequisites

| Tool                                          | Minimum version | Why                              |
| --------------------------------------------- | --------------- | -------------------------------- |
| [Bun](https://bun.sh)                         | 1.1+            | Frontend package manager + tests |
| [Rust toolchain](https://rustup.rs/)          | stable (1.80+)  | Tauri backend                    |
| [Tauri prerequisites](https://tauri.app/start/prerequisites/) | per-OS | WebView2 / WebKit / system libs |
| [Git](https://git-scm.com/)                   | any             | Cloning + hooks                  |

### Clone, install, run

```bash
git clone https://github.com/VoltLaunchr/Volt.git
cd Volt
bun install
bun tauri dev
```

### Frontend-only iteration (no Rust rebuild)

```bash
bun run dev
```

### Validate before committing

```bash
bun run lint       # ESLint, no warnings tolerated
bun run test       # 166 Vitest tests
cd src-tauri && cargo check && cargo clippy --all-features --all-targets -- -D warnings
cd src-tauri && cargo test --lib   # 143 backend tests
```

### Production build

```bash
bun tauri build   # platform installer in src-tauri/target/release/bundle/
```

---

## 🏗 Architecture

```
┌────────────────────────────────────────────────────────┐
│                  Frontend  (src/)                       │
│  React 19 · Vite 7 · TypeScript 5.8 · Zustand           │
│  ┌────────────────────────────────────────────────┐    │
│  │ SearchBar  →  useSearchPipeline  →  ResultsList │    │
│  │            ↑      150 ms debounce              │    │
│  │            ↑      latestSearchId guard          │    │
│  └────────────────────────────────────────────────┘    │
│  Plugin Registry (500 ms timeout)                      │
│  Extension Loader (Sucrase) → Web Worker sandbox        │
└──────────────────────────┬─────────────────────────────┘
                           │  Tauri IPC (typed invoke)
┌──────────────────────────▼─────────────────────────────┐
│                 Backend  (src-tauri/src/)               │
│  Rust 2024 · Tauri 2 · Tokio · rusqlite · nucleo        │
│  core/        → types, traits, errors                   │
│  indexer/     → SQLite + notify file watcher            │
│  launcher/    → cross-platform launch + LOLBIN denylist │
│  plugins/     → registry, builtin (clipboard, monitor…) │
│  commands/    → 14+ Tauri command modules               │
│  hotkey/      → global shortcut manager                 │
│  utils/       → icon extraction, HMAC sigs, NFKC        │
└────────────────────────────────────────────────────────┘
```

Full diagrams and module breakdown: [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md) · [`src-tauri/MODULES.md`](./src-tauri/MODULES.md).

---

## 📚 Documentation

The full user-facing documentation lives at **[voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs)** (français disponible via le sélecteur de langue). Source files live in [`./docs/`](./docs/) for contributors who want to edit them.

| Topic                  | Online (recommended)                                                            | In-repo source                                                                  |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Documentation home     | [voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs)                      | [`docs/README.md`](./docs/README.md)                                            |
| Architecture overview  | [voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs)                      | [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md)      |
| Feature catalog        | [voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs)                      | [`docs/architecture/FEATURES.md`](./docs/architecture/FEATURES.md)              |
| Plugin development     | [voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs)                      | [`docs/plugins/DEVELOPMENT.md`](./docs/plugins/DEVELOPMENT.md)                  |
| Plugin API reference   | [voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs)                      | [`docs/plugins/API_REFERENCE.md`](./docs/plugins/API_REFERENCE.md)              |
| Extension publishing   | [voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs)                      | [`docs/plugins/PUBLISHING_GUIDE.md`](./docs/plugins/PUBLISHING_GUIDE.md)        |
| Keyboard shortcuts     | [voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs)                      | [`docs/user-guide/SHORTCUTS.md`](./docs/user-guide/SHORTCUTS.md)                |
| Roadmap                | —                                                                               | [`docs/build-release/ROADMAP.md`](./docs/build-release/ROADMAP.md)              |
| Distribution & signing | —                                                                               | [`docs/build-release/DISTRIBUTION.md`](./docs/build-release/DISTRIBUTION.md)    |
| Changelog              | —                                                                               | [`docs/changelog/CHANGELOG.md`](./docs/changelog/CHANGELOG.md)                  |
| Contributor agent docs | —                                                                               | [`AGENTS.md`](./AGENTS.md)                                                      |

---

## 🧩 Plugin & Extension Development

Volt has **two extensibility surfaces**:

| Surface              | Lives in                                                                                       | When to use                                     |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Built-in plugins** | This repo — `src/features/plugins/builtin/`                                                    | Core functionality shipped with every install.  |
| **Extensions**       | Separate repo — [VoltLaunchr/volt-extensions](https://github.com/VoltLaunchr/volt-extensions)  | Community-contributed, sandboxed, install-time. |

### Minimal plugin example

```typescript
// src/features/plugins/builtin/myplugin/index.ts
import type { Plugin, PluginContext } from '@/features/plugins/types';

export const myPlugin: Plugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  prefix: '!',                                  // user types "!hello"
  async query({ query }: PluginContext) {
    return [{
      id: `my-plugin:${query}`,
      title: `Echo: ${query}`,
      subtitle: 'Press Enter to copy',
      icon: '✨',
      action: { type: 'clipboard', text: query },
    }];
  },
};
```

Register it in `src/app/App.tsx` via `pluginRegistry.register(myPlugin)`. Full guide and API reference: **[voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs)** (source: [`docs/plugins/`](./docs/plugins/)).

For sandboxed community extensions, see the publishing guide on [voltlaunchr.com/en/docs](https://voltlaunchr.com/en/docs) and the [volt-extensions](https://github.com/VoltLaunchr/volt-extensions) repo.

---

## 🤝 Contributing

Volt is community-driven. PRs of any size are welcome — typo fixes, bug reports, new plugins, full features.

1. **Fork** the repo and create a feature branch:
   ```bash
   git checkout -b feat/my-feature
   ```
2. **Install** deps and set up hooks:
   ```bash
   bun install && bun run setup-hooks
   ```
3. **Code** following the existing patterns. Read [`AGENTS.md`](./AGENTS.md) and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for conventions.
4. **Validate** before pushing — this is mandatory:
   ```bash
   bun run lint && bun run test && \
   (cd src-tauri && cargo clippy --all-features --all-targets -- -D warnings && cargo test --lib)
   ```
5. **Commit** with [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) and **open a PR**.

Bug reports and feature requests: [Issues](https://github.com/VoltLaunchr/Volt/issues). Questions and discussion: [Discussions](https://github.com/VoltLaunchr/Volt/discussions). Security vulnerabilities: see [`SECURITY.md`](./SECURITY.md) — please **do not** open public issues for security reports.

---

## 🗺 Roadmap

| Milestone | Focus                                                  | Status                  |
| --------- | ------------------------------------------------------ | ----------------------- |
| **M1**    | 1.0 stabilization · Windows Authenticode · macOS notarization | 🟡 in progress (cert blocker) |
| **M2**    | Public Extension Store with curation + autoupdate        | 🟢 planned              |
| **M3**    | Cloud Sync (settings, snippets, quicklinks) — preview shipped | 🟢 in preview           |

Full roadmap with tasks, files, and acceptance criteria: [`docs/build-release/ROADMAP.md`](./docs/build-release/ROADMAP.md).

---

## 📜 License

Volt is open source under the [Apache License 2.0](./LICENSE).

```
Copyright 2026 VoltLaunchr Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

## 🙏 Acknowledgments

**Inspirations** — [Spotlight](https://support.apple.com/guide/mac-help/spotlight-mchlp1008/mac), [Alfred](https://www.alfredapp.com), [Raycast](https://raycast.com). Volt would not exist without the trail they blazed.

**Stack** — [Tauri 2](https://tauri.app) · [React 19](https://react.dev) · [Vite 7](https://vitejs.dev) · [Rust](https://www.rust-lang.org) · [nucleo-matcher](https://github.com/helix-editor/nucleo) · [rusqlite](https://github.com/rusqlite/rusqlite) · [Zustand](https://zustand-demo.pmnd.rs/) · [shadcn/ui](https://ui.shadcn.com/) primitives.

---

<div align="center">

**If Volt saves you time, [give it a ⭐ on GitHub](https://github.com/VoltLaunchr/Volt) — it actually helps.**

[Website](https://voltlaunchr.com) · [Releases](https://github.com/VoltLaunchr/Volt/releases) · [Issues](https://github.com/VoltLaunchr/Volt/issues) · [Discussions](https://github.com/VoltLaunchr/Volt/discussions)

</div>
