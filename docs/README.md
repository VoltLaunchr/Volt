# Volt Documentation

Welcome to Volt's documentation. This directory is the source of truth for understanding the project, contributing code, building plugins, and shipping releases.

> **Current version**: v0.2.0 (2026-05-18) — Notes, AI Chat / Quick Actions / Profile, Custom Emojis, Developer portal, extension sandbox hardening. See [`changelog/CHANGELOG.md`](./changelog/CHANGELOG.md) and [`public/changelog.json`](../public/changelog.json).

## 📂 Structure

```
docs/
├── architecture/      Technical architecture · features reference · OAuth design
├── user-guide/        End-user shortcuts and guides
├── plugins/           Plugin / extension development & publishing
├── build-release/     CI/CD · distribution · signing · release roadmap
├── release/           Cross-platform QA · bug bash and launch gates
├── benchmarks/        Reproducible performance measurement plans
├── marketing/         Product readiness · claims · scorecard · issue backlog
├── changelog/         Version history
├── security/          Audits, privacy, accepted risks, key custody
├── roadmap/           Product roadmap, competitive analysis, ecosystem plan
└── superpowers/       Internal specs & plans (work-in-progress)
```

---

## ⭐ Start here

| Document | What it covers |
|---|---|
| [Features](./architecture/FEATURES.md) | Every user-visible capability of Volt v0.2.0 — search, plugins, AI, notes, extensions, security |
| [Architecture](./architecture/ARCHITECTURE.md) | Backend modules, Tauri commands, frontend layout, search pipeline, embeddings, security model |
| [Keyboard Shortcuts](./user-guide/SHORTCUTS.md) | Global + view + plugin hotkeys |
| [Plugin Development](./plugins/DEVELOPMENT.md) | Build your own plugin or extension |
| [Roadmap](./roadmap/PRODUCT_ROADMAP.md) | Where we're heading next |

---

## 🏗️ Architecture

- [**Architecture overview**](./architecture/ARCHITECTURE.md) — entry points, ~30 Tauri command modules, frontend feature folders, search & indexing pipeline, embeddings, extension sandbox, auth security model.
- [**Features reference**](./architecture/FEATURES.md) — every user-facing capability, built-in plugin, settings panel.
- [**OAuth implementation**](./architecture/OAUTH_IMPLEMENTATION.md) — provider integration details (GitHub, Notion).

Additional backend reference:
- [`src-tauri/README.md`](../src-tauri/README.md) · [`src-tauri/ARCHITECTURE.md`](../src-tauri/ARCHITECTURE.md) · [`src-tauri/MODULES.md`](../src-tauri/MODULES.md)
- [`src-tauri/src/plugins/README.md`](../src-tauri/src/plugins/README.md) — backend plugin trait & API

---

## 🔌 Plugins & Extensions

| Document | When to read it |
|---|---|
| [Plugin Development Guide](./plugins/DEVELOPMENT.md) ⭐ | Start here for any plugin or extension work |
| [API Reference](./plugins/API_REFERENCE.md) | `Plugin` / `PluginContext` / `PluginResult`, backend trait, events |
| [Examples](./plugins/EXAMPLES.md) | Cache, external API, dedicated React view, hybrid plugins |
| [Template](./plugins/TEMPLATE.md) | Boilerplate to copy |
| [Quick Reference](./plugins/QUICK_REFERENCE.md) | Cheat sheet |
| [Publishing Guide](./plugins/PUBLISHING_GUIDE.md) | Docs site (Docusaurus / VitePress / Next.js) |
| [Next.js Secure API](./plugins/NEXTJS_SECURE_API.md) | Backing API for a private extension registry |
| [Extension Registry Template](./plugins/EXTENSION_REGISTRY_TEMPLATE.json) | JSON template for the registry |
| [Summary](./plugins/SUMMARY.md) | Index of plugin docs |

**Plugin vs Extension**
- **Plugin** = in-repo (`src/features/plugins/builtin/`). Registered in `useAppLifecycle.ts`. Communicates via `volt:*` DOM events and Tauri commands.
- **Extension** = third-party, dynamic. Dual-source registry (GitHub legacy + Supabase via the **voltlaunchr.com/developer** portal). Loaded with Sucrase, isolated in a Web Worker when supported, network proxied through Rust.

See the [Extensions](./architecture/FEATURES.md#-extension-ecosystem) section in FEATURES.md for the full security model.

---

## 🚀 Build & Release

| Document | Purpose |
|---|---|
| [CI/CD Pipeline](./build-release/CICD.md) | GitHub Actions workflows (`check`, `release`, `auto-tag`, `changelog`, `e2e`, `pr-title`, `version-bump`) |
| [Distribution](./build-release/DISTRIBUTION.md) | Multi-platform packaging, installers, code signing, auto-updates |
| [Signing Setup](./build-release/SIGNING_SETUP.md) | Windows Authenticode + macOS notarization — certs, `.pfx`/`.p12` export, GitHub secrets |
| [Roadmap](./build-release/ROADMAP.md) | Release phases & milestones |
| [Implementation Plan (history)](./build-release/IMPLEMENTATION_PLAN.md) | Journal of past milestones |

> The **mandatory release checklist** (branch naming, cycle scan, smoke test, post-merge verification) lives in [`CLAUDE.md`](../CLAUDE.md) at the repo root — don't skip it.

### Pre-marketing release readiness

| Document | Purpose |
|---|---|
| [Product Readiness Review](./marketing/PRODUCT_READINESS_REVIEW.md) | Master Developer Preview / Public v1 go-no-go audit |
| [Claims Evidence](./marketing/CLAIMS_EVIDENCE.md) | Evidence and confidence for every public product claim |
| [Marketing Readiness Scorecard](./marketing/MARKETING_READINESS_SCORECARD.md) | 0–40 launch-readiness score |
| [Pre-Marketing Issues](./marketing/PRE_MARKETING_ISSUES.md) | Prioritized GitHub issue backlog |
| [QA Matrix](./release/QA_MATRIX.md) | Windows, macOS and Linux release validation |
| [Bug Bash Plan](./release/BUG_BASH_PLAN.md) | Platform, feature, security and accessibility sessions |
| [Performance Baseline](./benchmarks/PERFORMANCE_BASELINE.md) | Benchmark protocol; no invented results |
| [Privacy & Telemetry Review](./security/PRIVACY_AND_TELEMETRY_REVIEW.md) | Local data, opt-in network features and user-facing privacy copy |

---

## 🔐 Security

- [Accepted Risks](./security/ACCEPTED_RISKS.md)
- [Rust Code Review 2025](./security/RUST_CODE_REVIEW_2025.md)
- [Updater Key Custody](./security/updater-key-custody.md)

Operational security details (auth CSRF, JWT validation, keyring HMAC, extension sandbox, SSRF prevention, LOLBIN denylist, deep-link rate-limit) are described in [`ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) §7–§8.

---

## 📋 Changelog

- [Changelog](./changelog/CHANGELOG.md) — full version history
- [Updates 2025-01](./changelog/UPDATES_2025-01.md)
- [In-app changelog feed](../public/changelog.json) — source for the "See what's new" suggestion (see [`src/features/changelog/README.md`](../src/features/changelog/README.md))

---

## 🗺️ Roadmap

- [Product Roadmap](./roadmap/PRODUCT_ROADMAP.md)
- [Competitive Analysis](./roadmap/COMPETITIVE_ANALYSIS.md)
- [Extension Ecosystem Plan](./roadmap/EXTENSION_ECOSYSTEM_PLAN.md)
- [Roadmap README](./roadmap/README.md)

---

## 🚀 Quick start — create a plugin

### 1. Minimal frontend plugin

```typescript
// src/features/plugins/builtin/my-plugin/index.ts
import type { Plugin, PluginContext, PluginResult } from '../../types';
import { PluginResultType } from '../../types';

export class MyPlugin implements Plugin {
  id = 'my-plugin';
  name = 'My Plugin';
  description = 'Description of my plugin';
  enabled = true;

  canHandle(context: PluginContext): boolean {
    return context.query.startsWith('mp ');
  }

  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.substring(3);
    return [
      {
        id: 'result-1',
        type: PluginResultType.Info,
        title: `Result: ${query}`,
        score: 90,
        data: { query },
      },
    ];
  }

  async execute(result: PluginResult): Promise<void> {
    console.log('Executed!', result);
  }
}
```

### 2. Register the plugin

```typescript
// src/app/hooks/useAppLifecycle.ts (inside the registration block)
import { MyPlugin } from '../../features/plugins/builtin/my-plugin';
pluginRegistry.register(new MyPlugin());
```

### 3. Inspiration — read existing plugins

- Calculator: [`src/features/plugins/builtin/calculator/`](../src/features/plugins/builtin/calculator/)
- Web Search: [`src/features/plugins/builtin/websearch/`](../src/features/plugins/builtin/websearch/)
- System Commands: [`src/features/plugins/builtin/systemcommands/`](../src/features/plugins/builtin/systemcommands/)
- AI Chat: [`src/features/plugins/builtin/ai-chat/`](../src/features/plugins/builtin/ai-chat/)
- Notes: [`src/features/plugins/builtin/notes/`](../src/features/plugins/builtin/notes/)

---

## 🛠️ Project layout

```
Volt/
├── src/                                 Frontend (React 19, TS 5.8, Vite 7)
│   ├── app/                             App component + hooks (useAppLifecycle, useSearchPipeline, …)
│   ├── features/
│   │   ├── plugins/builtin/             16 built-in plugins (ai-chat, calculator, …)
│   │   ├── applications/                App discovery & launching
│   │   ├── search/                      SearchBar (150 ms debounce)
│   │   ├── results/                     ResultsList, grouping
│   │   ├── settings/                    Settings window
│   │   ├── extensions/                  Loader (Sucrase + Web Worker)
│   │   ├── notes/                       Tiptap-based notes
│   │   ├── ai-profile/ ai-quick-actions/ Personalization & hotkey-bound AI
│   │   ├── custom-emojis/               SDXL Emoji generator (Pro)
│   │   ├── auth/ changelog/ developer/ window/ files/ clipboard/ suggestions/
│   │   └── …
│   ├── shared/                          Types, hooks, UI primitives, utils
│   ├── stores/                          Zustand: appStore · searchStore · uiStore
│   ├── pages/                           Multi-page entries (settings · onboarding · system-monitor · notes)
│   ├── i18n/                            i18next (en · fr)
│   └── styles/                          Tailwind v4 + theme.css
│
├── src-tauri/                           Backend (Rust, edition 2024)
│   ├── src/
│   │   ├── commands/                    ~30 Tauri command modules
│   │   ├── plugins/                     Backend plugin system + builtin (clipboard, games, system_monitor)
│   │   ├── indexer/                     SQLite-backed file index + notify watcher + windows_search
│   │   ├── launcher/                    History, process, launch_validation
│   │   ├── search/                      Aggregation
│   │   ├── embeddings/                  fastembed + multilingual-e5-small (lazy ONNX)
│   │   ├── core/                        VoltError, VoltResult, traits, types, constants
│   │   ├── hotkey/ window/ utils/
│   │   └── lib.rs / main.rs
│   └── Cargo.toml
│
├── public/                              changelog.json, icons, onboarding assets
├── scripts/                             bump-version, sync-version, generate-changelog, build.ps1
├── .github/workflows/                   CI/CD (check, release, auto-tag, changelog, e2e, pr-title, version-bump)
└── docs/                                📚 You are here
```

---

## 🤝 Contributing

### Add a plugin
1. Read the [Plugin Development Guide](./plugins/DEVELOPMENT.md).
2. Create `src/features/plugins/builtin/<your-plugin>/index.ts`.
3. Register it in [`src/app/hooks/useAppLifecycle.ts`](../src/app/hooks/useAppLifecycle.ts).
4. Test locally: `bun tauri dev`.
5. Open a PR. Community extensions go in [`volt-extensions`](https://github.com/VoltLaunchr/volt-extensions) or through the **developer portal**.

### Validate before committing
```bash
bun run lint               # 0 errors, 0 disabled rules
bun run build              # tsc + Vite bundle
cd src-tauri && cargo check && cargo clippy -- -D warnings
bun run test
```

See the **Lint & Code Quality** section of [`CLAUDE.md`](../CLAUDE.md) — no `eslint-disable`, no `@ts-ignore`, no `as any`. Fix the code, not the rule.

### Editing docs
1. Keep paths relative and verify links.
2. Date updates with `_Last updated: YYYY-MM-DD_` when the file is feature-current.
3. Run `bun prettier --write docs/` before submitting.

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/VoltLaunchr/Volt/issues)
- **Discussions**: [GitHub Discussions](https://github.com/VoltLaunchr/Volt/discussions)
- **Website**: [voltlaunchr.com](https://voltlaunchr.com)

---

## 📝 License

Volt is open-source under Apache-2.0 — see [LICENSE](../LICENSE).

_Last updated: 2026-05-18 (v0.2.0)_
