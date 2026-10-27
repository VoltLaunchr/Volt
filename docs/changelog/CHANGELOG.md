# Changelog

> Note: `public/changelog.json` is the source of truth for the in-app "What's new" view. This file mirrors its releases (version + ISO date + summary); see `public/changelog.json` for the full item lists.

---

## v0.4.0 (2026-07-19) — Expand search and extension runtime & more

Volt v0.4.0 brings 18 new features, 56 bug fixes, security improvements, performance optimizations.

### Added

- Expand search and extension runtime
- Native notifications for indexing, app dedup, shortcut icons in settings
- Ship pnpm toolchain, AI chat, snippets and indexer follow-ups (#123)
- Add quick-action shortcuts
- AI chat overhaul — multi-turn, tools, structured outputs, reasoning, local models
- Global snippet expansion engine (Pilier E1)
- Native window materials — Mica/Acrylic transparency
- Developer portal, extension storage/OAuth/system APIs
- AI chat, profile, quick actions, custom emojis, local embeddings
- Tiptap-based notes app with SQLite/FTS5 backend

### Security

- Security hardening and improvements

### Fixed

- Full list in `public/changelog.json` (56 items), including: Keep generated bindings reproducible; Preserve Linux launcher error contracts; Restore Mica/Acrylic CSS dropped during commit split; Gate UWP regex behind target_os = "windows"; Rate-limit + log forensic trail on single-instance forwards (H9); HMAC integrity tag on keyring entries (M10); Fail-closed on signature mismatch + permission allowlist; Block redirect SSRF in worker fetch proxy.

### Performance

- Hot-path scanner, matcher buf reuse, top-K BinaryHeap, regex Lazy
- Eliminate hot-path allocations (P1, P3, P4, P9)

### Internal

- Manifest-driven single-source-of-truth activation
- Sprint 1 quick-wins + refonte vague 1 (frecency, clipboard, IPC codegen, typed events) (#117)
- Lint compliance + extension i18n bridge + typed IPC
- Bump Node to 22 for pnpm 11.7 toolchain
- Make page navigation assertion result-aware; Align search e2e fixtures with current settings; Add Rust↔TS contract tests for FileInfo/FileSearchResult/PluginResultData

---

## v0.3.0 (2026-06-13) — Refine search and built-in workflows & more

Volt v0.3.0 brings 9 new features, 38 bug fixes, security improvements, performance optimizations.

### Added

- Refine search and built-in workflows
- Harden encrypted and persistent indexes
- Add IPC codegen+timings (F1/F2) + blueprints & scaffolds for Piliers C/D (#118)
- Redesign extension icons + fix SignInRequired layout
- Developer portal, extension storage/OAuth/system APIs
- AI chat, profile, quick actions, custom emojis, local embeddings
- Tiptap-based notes app with SQLite/FTS5 backend
- Shell execution, system monitor v2, extension hardening, CI tooling (#63)

### Security

- Security hardening and improvements

### Fixed

- Full list in `public/changelog.json` (38 items), including: MacOS clippy + Windows vitest CRLF regressions; Icon GDI guards, steam W-API, system_monitor sleep, paste race; Move legacy --spacing-\* tokens out of @theme to restore Tailwind max-w-\* scale; FTS5 triggers skip 'delete' for already-trashed rows; RAII IndexingGuard prevents is_indexing stuck on abort; Align Tauri npm/Rust versions + fix release workflow trigger (#90); Show window + actionable UI on any boot failure (#88); Eliminate transparent-window flash on fresh install (#87).

### Performance

- Hot-path scanner, matcher buf reuse, top-K BinaryHeap, regex Lazy
- Eliminate hot-path allocations (P1, P3, P4, P9)

### Internal

- Organize IPC handlers by domain
- Sprint 1 quick-wins + refonte vague 1 (frecency, clipboard, IPC codegen, typed events) (#117)
- Refresh release readiness and project guides; Refresh top-level docs to reflect v0.2.0 codebase
- Add Rust↔TS contract tests for FileInfo/FileSearchResult/PluginResultData

---

## v0.2.1 (2026-05-21) — Polish, install cleanup, more AI providers

Volt v0.2.1 is a quality-of-life follow-up to the v0.2.0 flagship release. Hugging Face joins OpenAI / Anthropic / Groq as a first-class AI provider, the v0.2.0 features (AI Chat, AI Quick Actions, Custom Emojis) are now surfaced as suggestions in the launcher, and a sweep of Windows console-flash regressions plus the WebView2 bootstrapper are removed for a clean install and a clean runtime.

### Added

- Hugging Face AI provider: chat with any Hugging Face Inference API model alongside OpenAI, Anthropic, and Groq
- AI Chat and AI Quick Actions promoted to top-level Suggestions in the launcher — searchable by name, no prefix needed
- Custom Emojis exposed as a dedicated Command that opens the Emoji Picker directly on the Custom tab
- Deep-link to specific Settings sections: opening Settings from the launcher can now land on the right tab (AI, Notes, Extensions…) via URL hash and a Tauri event
- Emoji Picker accepts an `initialCategory` prop so callers can open it on any tab, not just All
- shadcn-ui-aligned component library expanded: badge, button-group, carousel, collapsible, command, dialog, dropdown-menu, hover-card, input-group, scroll-area, select, textarea, tooltip

### Changed — UI Polish

- OpenAI and Groq provider logos now render in white via a CSS invert filter — readable on the dark AI Settings canvas and the AI Chat / Quick AI dropdowns
- AI provider logo handling unified across AiSettingsView, AiChatView, and QuickAiView with a shared monochrome regex

### Fixed

- Windows: PowerShell / cmd console window no longer flashes during normal app usage. New `utils::process::no_window` helper applies `CREATE_NO_WINDOW` to every shell-class child process: app scan (Get-AppxPackage), Windows Search Index queries, Xbox PFN lookup, and game-URI launchers (Steam, Epic, Battle.net, Amazon, Ubisoft, Xbox, generic plugin)
- Windows installer: removed the embedded WebView2 bootstrapper (`webviewInstallMode: skip`). No more PowerShell flash at install time, ~2 MB smaller installer. WebView2 has been pre-installed on Windows 11 since 22H2 and was pushed to supported Windows 10 builds long before EOL, so the bootstrapper is no longer needed
- Settings: deep-link via URL hash falls back to a Tauri event for already-open windows, avoiding a flash of the General tab when the user wanted AI

---

## v0.2.0 (2026-05-18) — Notes, AI, and developer portal

Volt v0.2.0 is the biggest release since the public launch. Three flagship features land at once: a full Tiptap-based Notes app with FTS5 search, AI chat with quick actions and a developer profile, and a developer portal that lets third-party authors submit extensions through voltlaunchr.com. Bundled with extensive security hardening of the extension sandbox and OAuth token isolation.

### Added

- Notes app: rich-text editor (Tiptap) with markdown, slash commands, task lists, code blocks, FTS5 search, soft-delete trash, and JSON import/export
- AI chat: in-launcher conversation with OpenAI, Anthropic, and Groq; per-provider API keys stored in the OS keyring
- AI quick actions: assign global hotkeys to one-shot prompts that operate on the clipboard or selection
- AI profile: tailor responses with persistent context (role, tone, language) that ships with every prompt
- Custom emojis: generate sticker-style emojis from a free-text prompt via Replicate (Volt Pro path stubbed for launch)
- Developer portal: third-party authors can submit extensions through voltlaunchr.com with a draft → pending → approved workflow
- Extension storage and OAuth APIs: extensions can persist preferences/secrets and request GitHub/Notion OAuth tokens via a fully Rust-side flow (the token never enters the renderer)
- Per-core CPU view, network and temperature metrics, and process kill in the System Monitor

### Security

- Extension sandbox hardening: eval, Function, WebSocket, XMLHttpRequest, and importScripts are all locked down inside the Worker
- Prototype freeze (M1) and getter-only Worker global protection blocking known sandbox-escape patterns
- OAuth token isolation (H2): tokens are stored and replayed entirely from Rust; the renderer only sees an opaque handle
- Parsed Ipv4/Ipv6 SSRF check replaces the prior string-prefix scan, blocking redirect-based SSRF and numeric IPv4/IPv6-mapped hosts
- Launch validation: LOLBIN denylist, NTFS normalisation, and executable-extension check applied to every launch path
- Extension state tampering detection with HMAC-SHA256 signatures and UI alerts on mismatch (fail-closed: granted permissions reset to empty)

### Fixed

- Notes FTS5 sync triggers now skip the 'delete' command for already-trashed rows — restoring or emptying trash no longer corrupts the FTS5 index
- Indexer: RAII IndexingGuard prevents is_indexing from staying stuck on abort
- System monitor: blocking sysinfo calls moved to spawn_blocking — no more frozen UI on slow disks
- Auth: stale legacy-implicit deep-link branch removed; refresh now verifies user_id consistency
- Extension tarballs: parent directories are created before unpacking entries; HTTP redirects are followed
- Worker sandbox: match() timeout raised to 8s so network extensions finish cleanly

### Performance

- History recording moved off the IPC thread (spawn_blocking)
- Dead hooks/utilities removed (safeInvoke shim, console→logger sweep)

---

## v0.1.9 (2026-05-08) — Critical boot fix

Volt v0.1.9 fixes a vendor-chunk circular import that prevented v0.1.8 from booting. v0.1.8's bundle threw `Cannot read properties of undefined (reading 'createContext')` before any UI rendered, leaving users stuck on the splash screen indefinitely. v0.1.9 reworks the Vite chunking strategy to keep React-consuming libraries on the dependency-graph default path, which is cycle-free by construction.

### Fixed

- Fix vendor chunk cycle that left v0.1.8 stuck on splash screen at startup

---

## v0.1.8 (2026-05-07) — Security hardening, performance, and stability fixes

Volt v0.1.8 ships the full follow-up to the v0.1.7 security audit: hardened auth, credentials, and extension state surfaces, plus hot-path performance improvements and several stability fixes.

### Security

- Security hardening and improvements

### Performance

- Eliminate hot-path allocations in search, indexing, and matching code paths

### Fixed

- Eliminate transparent-window flash on hot-toggle and cold-start
- Fix blocking I/O on async paths and a polling loop in the indexer
- Restore first-session Rust fallback in the review surface

---

## v0.1.7 (2026-05-06) — First release with working CI pipeline

Volt v0.1.7 is the first version that actually ships through automated CI: Tauri version mismatch and tag-trigger bugs fixed. Includes the full startup error-visibility improvements from v0.1.5/v0.1.6.

### Fixed

- Show window + actionable UI on any boot failure (React crash, IPC hang, watchdog timeout)
- Eliminate transparent-window flash on fresh install
- Release pipeline: align Tauri npm/Rust versions and trigger release.yml via workflow_dispatch

---

## v0.1.6 (2026-05-06) — Robust startup error handling

Volt v0.1.6 ships the complete startup error-visibility fix: any crash or IPC hang at boot now shows an actionable error screen instead of a silent transparent window.

### Fixed

- Show window + actionable UI on any boot failure (React crash, IPC hang, watchdog timeout)
- ErrorBoundary now forces window visible and displays error details with copy-to-clipboard
- 10-second startup watchdog prevents silent hang on IPC unavailability

---

## v0.1.5 (2026-05-06) — Show window + actionable UI on any boot failure & more

Volt v0.1.5 brings 1 bug fix.

### Fixed

- Show window + actionable UI on any boot failure

---

## v0.1.4 (2026-05-05) — Stability and security hardening

Volt v0.1.4 improves startup reliability, release readiness, cross-platform checks, and security hardening.

### Security

- Security hardening and improvements

### Fixed

- Drop unreachable File branch in ResultItem icon fallback
- Hide main window at cold start until ready
- Grant settings window index/scan permissions
- Gate UWP regex behind target_os = "windows"
- Rustfmt + clippy compliance + e2e tests aligned to v0.1.2 UI
- Vitest @ alias + drop runtime-version targets from sync-version

### Internal

- Lint compliance + extension i18n bridge + typed IPC
- Lint guardrails in CLAUDE.md, README polish, updater key custody, audit notes

---

## v0.0.8 (2026-04-16) — Auth Deep-Link, Extension Hardening & Watcher Stability

Volt 0.0.8 secures the OAuth sign-in flow with deep-link handoff, hardens the extension sandbox, fixes the file-indexer watcher, and ships a fleet of enterprise-grade release tooling upgrades.

### Added

- Deep-link OAuth handoff (volt://) for a safer, friction-free sign-in
- Extension sandbox hardening with stricter permission checks
- More reliable file indexer (watcher reconnect fix)

### Changed — Quality & Stability

- Refreshed CI pipeline (cross-platform builds, ad-hoc macOS signing fallback)
- Updated Tauri npm packages aligned with Rust crate versions
- Version sync tooling covers every hard-coded version reference

---

## v0.0.5.2 (2026-04-15) — Auth, Search Overhaul, Extensions Sandbox & Window Management

Volt v0.0.5.1 is a major update with user authentication (OAuth), a completely revamped search engine with unified scoring and streaming results, a secure Web Worker sandbox for extensions, two new plugins, Zustand state management, and full French translations.

### Added

- User authentication with OAuth (GitHub, Google) and account management
- Quick Links plugin — instant access to bookmarks and favorite URLs
- Window Management plugin — snap, resize and move windows from the launcher
- Integrations panel in Settings for connected services
- Onboarding modal for first-time users
- Toast notification system with indexing progress

### Changed — Search & Performance

- Unified scoring engine with nucleo fuzzy matcher for apps and files
- Streaming search via Tauri Channels for incremental results
- Batch IPC calls and O(1) file clone for faster responses
- Match highlighting in search results
- Web search fallback when no local results found
- Adaptive debounce and deferred rendering for smoother UX
- Query-result binding for learned search preferences

### Security — Security & Extensions

- Web Worker sandbox for extensions with permission enforcement
- Permission consent dialog on first extension load
- Network proxy for sandboxed extensions (permission-gated)
- Global ErrorBoundary to gracefully catch rendering crashes
- Safe invoke wrapper (safeInvoke) for resilient Tauri IPC calls
- Runtime type guards for stricter data validation
- Feature flags system for controlled rollouts
- Secure credential storage via OS keyring

### Internal — Architecture & CI/CD

- Migrated state management to Zustand stores (search, UI, app)
- End-to-end test suite: accessibility, keyboard navigation, search, smoke tests
- Automated release workflow with platform builds and signing
- SignPath code signing integration for Windows
- Changelog generation workflow (git-cliff)
- Dependabot configuration for dependency updates
- Full internationalization system with English and French
- Comprehensive French translations for all plugins and settings
- Localized Quick Links and Window Management plugins (EN + FR)

---

## v0.0.4 (2026-01-01) — Initial Public Release

We're excited to introduce Volt - a modern, lightning-fast application launcher for Windows, macOS, and Linux. Built with Tauri v2 and React, Volt combines native performance with a beautiful, customizable interface.

### Added — Core Features

- Lightning-fast application launcher with intelligent fuzzy search
- Beautiful glass-morphism UI with smooth animations
- Multi-theme support (Dark, Light, Auto)
- Smart file indexing with advanced search capabilities
- Customizable keyboard shortcuts and global hotkey (Ctrl+Space)
- Cross-platform support (Windows, macOS, Linux)

### Added — Built-in Plugins

- Calculator - Instant math evaluations, unit conversions, date calculations
- Clipboard Manager - Track, search, and pin clipboard history
- Emoji Picker - Quick emoji search with :emoji syntax
- Web Search - Search the web directly (?query)
- Timer - Countdown and pomodoro timers
- System Monitor - Real-time CPU, RAM, and disk monitoring
- Game Scanner - Launch games from Steam, Epic, GOG, EA, and more

### Performance

- Debounced search with sub-150ms response time
- Background file indexing for instant file access
- Smart result scoring and prioritization
- Plugin keyword boosting for relevant results
- Efficient memory usage with intelligent caching

### Internal — System Integration & Customization

- Global hotkey support (Ctrl+Space by default)
- Auto-start with system option
- Window positioning presets (Top, Center, Custom)
- Extension system with hot-reload support
- Native performance with Tauri v2 + Rust backend
- Comprehensive settings panel for all preferences
- Configure file indexing folders and exclusions
- Customize search result limits and behavior
- Plugin management and configuration
- Extensive keyboard shortcuts (15+ shortcuts)

---

## v0.1.2 (2026-05-03) — Cloud Sync preview & UI polish

### Added

- **Cloud Sync settings panel**: new Sync section in Settings to push/pull snippets and quicklinks to the cloud (Premium-gated). Marked **Coming soon** — backend wiring lands in a follow-up.
- **System Monitor app window**: dedicated window with live CPU/RAM/disk/network charts (visx-based live line charts).
- **Onboarding wizard**: first-run setup window walks new users through hotkey, theme, and integrations.
- **Settings: Restart Onboarding** action under General.
- **Shell settings panel**: configure default shell, working directory, timeout, and history size; clear shell history.
- **Premium-gated Account UI**: new Account panel with login/upgrade hints.
- **Extension icons**: GitHub and Notion integration icons.
- **Build script**: `pnpm run tauri:build` wraps the PowerShell build pipeline (`scripts/build.ps1`).

### Changed

- Settings window now loads `index.html` (single-page bundle) — `settings.html` removed.
- UI components migrated to Tailwind v4 + shadcn-style primitives (Card, Field, Switch, Input, Label, Separator, Badge); per-component CSS files removed.
- Theme system consolidated into `src/styles/theme.css`.
- App lifecycle and search pipeline hooks refactored for clarity.

### Internal

- `keyring` v3 platform features made explicit (`apple-native`, `windows-native`) — silent mock fallback was breaking auth/credential storage on platforms with no backend feature enabled.
- Tauri config: `onboarding` and `system-monitor` window labels added.
- Bumped to `0.1.2` across `package.json`, `Cargo.toml`, and `tauri.conf.json`.

---

## v0.1.1 (2026-05-03) — Security hardening v2

### Security fixes

- **Auth CSRF (H9)**: `auth_start_login` generates a UUID state nonce (5 min TTL) bound to `volt://auth/callback` deep links. Callbacks without a matching pending nonce are rejected — prevents drive-by session injection via forged deep links.
- **JWT validation**: access token claims (`exp`, `iss`, `sub`) now verified against the configured Supabase URL. `user_id` and `expires_at` are taken from verified JWT claims, never from URL query params.
- **Token refresh guard**: refresh response `user_id` mismatch is rejected outright; `expires_in` is capped at 24 h to prevent upstream abuse.
- **HMAC keyring integrity (M10)**: `store_signed`/`retrieve_signed` attach a domain-tagged HMAC-SHA256 to OS keyring entries. A tampered entry causes silent logout rather than accepting a forged session.
- **Extensions fail-closed (H4)**: `installed.json` HMAC mismatch now resets `granted_permissions` to empty for every extension (forensic log per extension). Users must re-grant deliberately.
- **Extension permission allowlist (M1)**: `update_extension_permissions` validates each permission string against a server-side `ALLOWED_PERMISSIONS` list. The entire batch is rejected on a single unknown entry — no silent filtering.
- **Extension SSRF — redirect & numeric hosts**: the Worker fetch proxy now blocks HTTP redirects and rejects numeric IPv4/IPv6-mapped hostnames in addition to the existing private-range blocklist.
- **Deep-link rate-limit (H9)**: `single-instance` forwards are rate-limited and leave a forensic log trail.
- **Shell blocklist extended (H6, H7, M5)**: 9+ new blocked patterns: `Stop-Computer`, `Restart-Computer`, `Format-Volume`, `Clear-Disk`, `diskpart`, `Remove-Item -Recurse -Force <drive>:\`, `init 0/6`, `telinit 0/6`, `logoff`, PowerShell `-EncodedCommand`, `reg.exe delete`, `find -delete`.
- **Shell NFKC normalization**: blocklist matching now runs on both the raw command and an NFKC + lowercase + quote-stripped variant. Stops bypasses like `"rm" -rf /` and fullwidth homoglyphs.
- **Shell redactors extended (M6, M7)**: GitHub tokens (`ghp_`/`gho_`/…), AWS AKIA access key IDs, Stripe `sk_live_`/`sk_test_`, Slack `xox*` tokens, JSON Web Tokens, and `curl -u user:pass` are now redacted from shell history and logs.
- **UNC path rejection**: `working_dir` (shell), `open_file_with_dialog`, and `open_path` now reject UNC paths (`\\server\share`, `//server/share`) to prevent NTLM credential leaks to attacker-controlled SMB hosts.
- **`open_file_with_dialog` hardened**: `.lnk` shortcuts rejected (prevents silent re-resolution by ShellExecute); path canonicalized before invoking the OS dialog.
- **`open_path` hardened**: refuses executable file extensions so callers cannot bypass `launch_app`'s LOLBIN/extension validation.
- **Windows Search query cap**: query strings sent to the Windows Search index are now length-capped.
- **Snippets import cap**: JSON import payload size and total snippet count are now bounded.
- **`test_credential` command**: new Tauri command to verify stored credentials; token value never crosses the IPC bridge into the renderer.
- **Worker pending-map cleanup**: the extension Worker's in-flight request map is cleared on timeout, preventing memory leaks from stalled requests.

### Internal

- Clippy `-D warnings` clean on `launcher`, `windows_search`, and `lib` (all targets).
- `extension_state_sig`: new `read_state_with_outcome` API exposes `VerifyOutcome` to callers; `hmac_sign_domain`/`hmac_verify_domain` helpers for credential HMAC (constant-time comparison).
- `keyring_store`: `migrate_from_json_if_needed` now called in `save_auth_session`/`load_auth_session`/`delete_auth_session`.

---

## Version 1.0.0 (1 Janvier 2026) — Plugin documentation initial release

**Date :** 1 janvier 2026
**Auteur :** Volt Team
**Type :** Initial release

### 📚 Nouveaux documents

#### Documentation principale

1. **PLUGIN_DEVELOPMENT.md** (25.83 KB)
   - Guide complet de développement de plugins
   - Architecture du système
   - Guides Frontend et Backend
   - 3 exemples détaillés
   - Meilleures pratiques
   - FAQ

2. **PLUGIN_API_REFERENCE.md** (20.43 KB)
   - Documentation exhaustive de l'interface `Plugin`
   - Types `PluginContext`, `PluginResult`, `PluginResultType`
   - API Backend Rust (`VoltPluginAPI`)
   - Commandes Tauri
   - Helper functions
   - Système d'événements
   - Performance guidelines

3. **PLUGIN_EXAMPLES.md** (36.04 KB)
   - 7 exemples de plugins avancés :
     - Plugin avec cache
     - Plugin avec API externe (Weather)
     - Plugin avec interface dédiée (Color Picker)
     - Plugin hybride Frontend + Backend (Duplicate Finder)
     - Plugin avec paramètres utilisateur (Translator)
     - Plugin avec historique (Snippets)
     - Plugin multi-sources (Unified Search)

4. **PLUGIN_TEMPLATE.md** (13.35 KB)
   - Template prêt à l'emploi
   - Structure complète
   - Code commenté
   - Helper functions
   - Checklist

#### Documentation secondaire

5. **README.md** (6 KB)
   - Index de la documentation
   - Navigation rapide
   - Quick start

6. **PUBLISHING_GUIDE.md** (10 KB)
   - Guide de publication web
   - Conversion Markdown → Web
   - Plateformes (Docusaurus, VitePress, Next.js)
   - SEO et déploiement

7. **SUMMARY.md** (8 KB)
   - Récapitulatif pour publication
   - Structure recommandée du site
   - Contenu de chaque document
   - Checklist

8. **QUICK_REFERENCE.md** (6 KB)
   - Référence rapide
   - Snippets essentiels
   - Patterns communs

### 📊 Statistiques

- **Total :** 8 documents
- **Taille totale :** ~125 KB
- **Exemples de code :** 50+
- **Patterns avancés :** 7
- **Langues :** Français

### 🎯 Couverture

- ✅ Développement Frontend (TypeScript)
- ✅ Développement Backend (Rust)
- ✅ Architecture et design patterns
- ✅ Performance et sécurité
- ✅ Testing et debugging
- ✅ Publication et déploiement

### 🚀 Fonctionnalités documentées

#### Plugin System

- [x] Interface Plugin complète
- [x] PluginRegistry
- [x] PluginContext
- [x] PluginResult
- [x] PluginResultType
- [x] Timeout automatique (500ms)
- [x] Error handling

#### Frontend API

- [x] canHandle()
- [x] match() (sync et async)
- [x] execute()
- [x] Helper functions
- [x] Événements personnalisés
- [x] Cache patterns

#### Backend API (Rust)

- [x] VoltPluginAPI
- [x] Tauri commands
- [x] File system access
- [x] Cache management
- [x] Configuration

#### Examples

- [x] Simple plugins (7 exemples basiques)
- [x] Advanced plugins (7 exemples avancés)
- [x] Hybrid plugins (Frontend + Backend)
- [x] UI components (React views)

### 📝 Notes de release

Cette première version de la documentation couvre tous les aspects du développement de plugins pour Volt, du niveau débutant au niveau avancé. Elle a été conçue pour être :

1. **Accessible** : Guide pas-à-pas pour les débutants
2. **Complète** : Référence exhaustive pour les développeurs expérimentés
3. **Pratique** : Nombreux exemples et templates prêts à l'emploi
4. **Maintenable** : Structure claire et organisation logique

### 🔗 Liens utiles

- Repository : https://github.com/VoltLaunchr/Volt
- Documentation en ligne : (à venir)
- Issues : https://github.com/VoltLaunchr/Volt/issues

---

## Roadmap (Versions futures)

### Version 1.1.0 (Q1 2025) - Prévu

#### Améliorations prévues

- [ ] **Traduction anglaise** de toute la documentation
- [ ] **Vidéos tutorielles** (YouTube)
- [ ] **Plugin Marketplace** (documentation)
- [ ] **Playground interactif** en ligne
- [ ] **Générateur de plugins** (outil web)

#### Nouveaux exemples

- [ ] Plugin de recherche de fichiers avancée
- [ ] Plugin d'intégration Notion
- [ ] Plugin de gestion de bookmarks
- [ ] Plugin de screenshots avec OCR
- [ ] Plugin de traduction en temps réel

#### Nouvelles sections

- [ ] Debugging avancé
- [ ] Testing automatisé
- [ ] CI/CD pour plugins
- [ ] Distribution de plugins externes
- [ ] Signature et sécurité

### Version 1.2.0 (Q2 2025) - Prévu

#### Extensions

- [ ] **Plugin SDK** (CLI pour créer des plugins)
- [ ] **Plugin Boilerplate Generator**
- [ ] **Documentation des plugins natifs** (Windows/macOS/Linux spécifiques)
- [ ] **Performance profiling** (outils et guides)

#### Community

- [ ] **Showcase gallery** (plugins communautaires)
- [ ] **Plugin contests** (concours mensuels)
- [ ] **Contributors guide** (comment contribuer)

---

## Contributions

### Comment contribuer à la documentation

1. **Fork** le repository
2. **Créer une branche** : `git checkout -b docs/improve-plugin-guide`
3. **Modifier** les fichiers dans `docs/`
4. **Commit** : `git commit -m "docs: improve plugin examples"`
5. **Push** : `git push origin docs/improve-plugin-guide`
6. **Pull Request** avec une description claire

### Standards de contribution

#### Format

- **Markdown** : Respecter la syntaxe Markdown standard
- **Code blocks** : Spécifier le langage (typescript, rust, etc.)
- **Liens** : Utiliser des liens relatifs pour la navigation interne
- **Images** : Optimiser (< 200KB), nommer clairement

#### Style

- **Ton** : Pédagogique et accessible
- **Exemples** : Concrets et testés
- **Code** : Commenté et formaté
- **Longueur** : Sections de < 500 mots si possible

#### Checklist avant PR

- [ ] Pas de typos (relecture)
- [ ] Code testé et fonctionnel
- [ ] Liens vérifiés
- [ ] Images optimisées
- [ ] Cohérence avec le reste de la doc

---

## Maintenance

### Responsables

- **Lead maintainer** : @VoltTeam
- **Contributors** : Community

### Processus de review

1. **Automated checks** : Markdown lint, liens cassés
2. **Human review** : Vérification du contenu
3. **Testing** : Exemples de code testés
4. **Merge** : Après approbation

### Fréquence de mise à jour

- **Correctifs** : Au besoin (typos, liens cassés)
- **Mises à jour mineures** : Mensuelles (nouveaux exemples)
- **Mises à jour majeures** : Trimestrielles (nouvelles sections)

---

## Feedback

### Comment donner votre avis

1. **GitHub Issues** : Pour bugs/erreurs/suggestions
2. **Discussions** : Pour questions/idées
3. **Email** : contact@volt.dev (si disponible)

### Ce que nous recherchons

- 📝 **Clarté** : Y a-t-il des sections confuses ?
- 🐛 **Erreurs** : Avez-vous trouvé des bugs dans les exemples ?
- 💡 **Suggestions** : Quelles sections manquent ?
- ⭐ **Popularité** : Quels patterns utilisez-vous le plus ?

---

## Licence

Cette documentation est sous licence **MIT**, comme le projet Volt.

Vous êtes libre de :

- Utiliser la documentation à des fins personnelles ou commerciales
- Modifier et adapter le contenu
- Distribuer le contenu original ou modifié

Sous conditions de :

- Mentionner l'auteur original
- Inclure la licence MIT

---

## Remerciements

Merci à tous les contributeurs qui ont aidé à créer cette documentation ! 🙏

- **Core team** : Pour la review et les feedbacks
- **Early adopters** : Pour avoir testé les exemples
- **Community** : Pour les suggestions et corrections

---

**Version actuelle :** 1.0.0
**Dernière mise à jour :** 1 janvier 2026
**Status :** ✅ Production ready

---

_Documentation maintenue par l'équipe Volt avec ❤️_
