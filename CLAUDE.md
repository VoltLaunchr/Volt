# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Volt is a keyboard-driven application launcher (Tauri v2 + React + TypeScript). Fast, minimal interface similar to Spotlight/Alfred, toggled with `Ctrl+Space`.

## Key Commands

**Frontend**: `pnpm run dev` | **Full stack**: `pnpm run tauri -- dev` | **Build**: `pnpm run tauri -- build`
**Format**: `pnpm exec prettier --write .` | **Lint**: `pnpm run lint` | **Test**: `pnpm run test`
**Rust check**: `cd src-tauri && cargo check` | **Rust lint**: `cd src-tauri && cargo clippy`

## Architecture Quick Reference

### Entry Points
- **Frontend**: `src/main.tsx` → `src/app/App.tsx`
- **Backend**: `src-tauri/src/main.rs` → `volt_lib::run()` in `src-tauri/src/lib.rs`

### Backend Modules (`src-tauri/src/`)
```
core/          # Foundation (types, traits, constants, errors)
plugins/       # Plugin system with builtin plugins
  builtin/     # clipboard_manager, game_scanner (10 platforms), system_monitor (v2)
  api.rs       # VoltPluginAPI (path validation, state)
  registry.rs  # Thread-safe PluginRegistry (Arc<RwLock<HashMap>>)
utils/         # Reusable utilities
  icon.rs              # Icon extraction (Windows/macOS/Linux)
  matching.rs          # Fuzzy matching helpers
  path.rs              # Path utilities
  extension_state_sig.rs # HMAC-SHA256 state signatures for extension tampering detection
  launch_validation.rs # LOLBIN denylist, NTFS normalization, executable validation
  shell_apps.rs        # Win Shell AppsFolder enumeration (Windows only)
search/        # Search algorithms with scoring
window/        # Window management commands
commands/      # Tauri command handlers
  apps.rs      # App scanning (Windows/macOS/Linux)
  settings.rs  # Settings management (incl. shell settings, export/import)
  files.rs     # File indexing
  launcher.rs  # Launch history & pins
  clipboard.rs # Clipboard history
  extensions.rs# Extension management (14 cmds + security hardening + tamper alerts + fail-closed + permission allowlist)
  games.rs     # Game scanning
  steam.rs     # Steam integration
  system_monitor.rs # CPU/RAM/disk metrics + v2 (per-core, network, temps, processes)
  preview.rs   # File preview for preview panel
  snippets.rs  # Snippet CRUD + variable expansion
  plugins.rs   # Plugin commands
  quicklinks.rs# Quicklinks CRUD with URL/folder/command validation
  shell.rs     # Shell command execution (streaming, NFKC blocklist + 9+ patterns, extended redactors, UNC working_dir rejected)
  shell_history.rs # Shell history with frecency scoring (500 entries)
  auth.rs      # Supabase auth + deep link; CSRF state nonce (5 min TTL); JWT claim validation; refresh user_id check
  oauth.rs     # OAuth flow (GitHub, Notion) + deep link callbacks (host check, state log demoted)
  credentials.rs # Encrypted credential storage (OS keyring); test_credential (token never in renderer)
  keyring_store.rs # OS keyring abstraction; store_signed/retrieve_signed (domain-tagged HMAC-SHA256)
  hotkey.rs    # Hotkey commands
  autostart.rs # Autostart management
  logging.rs   # Log management
  window_management.rs # Window snap commands
hotkey/        # Global hotkey management
expansion/     # Global snippet expansion (Pilier E1): WH_KEYBOARD_LL hook, no uiAccess.
               #   Windows + `snippet-global-expansion` feature only (OFF by default); no-op elsewhere.
indexer/       # File indexing system (scanner, watcher, search_engine, SQLite, windows_search.rs)
launcher/      # Cross-platform app launching (history, process, launch_validation)
```

### Frontend Structure
```
src/
  app/                           # Main app component
    hooks/                       # useAppLifecycle, useGlobalHotkey, useSearchPipeline, useResultActions
    components/                  # ResultContextMenu, ViewRouter
  features/
    search/components/           # SearchBar with 150ms debounce
    results/components/          # ResultsList, ResultItem
    applications/                # App scanning + launching (hooks, services, utils, types)
    clipboard/                   # Clipboard history plugin
    extensions/                  # Extension store (api, loader, services, types)
    files/                       # File search components
    plugins/                     # Plugin system
      builtin/                   # calculator, emoji-picker, timer, websearch, steam, systemcommands, systemmonitor, snippets, quicklinks, shell, window-management, games
      core/registry.ts           # Plugin registry singleton (500ms timeout)
      types/                     # Plugin, PluginResult, PluginContext interfaces
    settings/                    # Settings management
    suggestions/                 # Default suggestions
    window/                      # Window state management
  shared/
    types/common.types.ts        # SearchResult, AppInfo, etc.
    constants/                   # Configuration
    hooks/                       # Reusable React hooks
    components/ui/               # HotkeyCapture, ContextMenu, Modal, HelpDialog, PropertiesDialog, PreviewPanel
    components/layout/           # Footer, Header
    utils/                       # logger, clipboard helpers, queryParser.ts (power-user operators)
  styles/                        # Global styles, themes
```

## Adding a Tauri Command

1. Define function with `#[tauri::command]` in appropriate `commands/*.rs`
2. Export from `commands/mod.rs`
3. Add to `invoke_handler![]` in `lib.rs`
4. Call from frontend: `invoke('command_name', { params })`

**Type sync**: Use `#[serde(rename_all = "camelCase")]` for Rust structs (TS is camelCase, Rust is snake_case)

**Feature shortcuts**:
- Preview panel: `Ctrl+P` toggle, window resizes 800->1100px
- Snippets: `;` prefix in search bar triggers snippet plugin
- Shell commands: `>` prefix executes shell commands with streaming output
- Quicklinks: `ql:` prefix for quicklink management commands

## Important Implementation Details

### Search Flow
1. Frontend: 150ms debounce + `latestSearchId` for stale response protection
2. Backend: `search_applications()` uses scoring (exact=100, startsWith=90, contains=80-position, fuzzy=50)
3. Frecency scoring: apps ranked by match_score + frecency_bonus (launch_count x recency_decay)
4. Predictive suggestions: empty query shows top frecency apps
5. Power-user operators: `ext:pdf`, `in:dir`, `size:>10mb`, `modified:<7d` parsed by `queryParser.ts`
6. Results grouped by section (Applications, Commands, Games, Files) and sorted by score descending

### File Indexing
- In-memory state: `FileIndexState` (Arc<Mutex<Vec<FileInfo>>>)
- Background scan via `start_indexing()` with `max_depth=10`, `max_file_size=100MB`
- Extensions filter: empty = all files; specified = only those extensions
- Search: `indexer/search.rs` with same scoring as apps

### Plugins vs Extensions
**Builtin plugins** (in-repo, `src/features/plugins/builtin/`):
- Registry: `pluginRegistry.query()` calls enabled plugins with 500ms timeout
- Events: Use `volt:*` DOM events for plugin→UI communication
- Builtin plugins registered in `App.tsx` on mount
- Backend plugins: trait-based in `src-tauri/src/plugins/` (async_trait, Send+Sync)

**Plugin activation (single source of truth)** — how a built-in decides to surface
results. Declare a `activation: PluginActivation` on the plugin (`{ prefixes?, keywords?, mode? }`):
- `prefixes`: symbolic triggers (`:`, `>`, `;`, `ql:`). `keywords`: natural-language
  names — the plugin's `name` is auto-added so **every built-in is discoverable by
  typing its name**.
- The registry pre-computes `matchActivation()` (`core/activation.ts`), injects the
  result into `PluginContext.activation`, and annotates each `PluginResult.matchKind`.
  `canHandle`/`match` read it via `resolveActivation(this, ctx)` (recomputes on the
  direct unit-test path where no context is injected).
- `mode: 'declarative'` (default) → `canHandle` is fully driven by the manifest, and
  `match` uses `ctx.activation.stripped` as its search term. `mode: 'custom'` → keep a
  hand-written `canHandle` (e.g. type-ahead, math detection); the keywords drive only
  the scoring boost. `mode: 'always'` → activates for any query ≥ `minLength`.
- Scoring: a `prefix`/`keyword` matchKind earns `PLUGIN_KEYWORD_BOOST` in
  `useSearchPipeline.ts`. **Do not** reintroduce a parallel keyword map there — the
  manifest is the only source.

**Managed plugins & Settings** — `src/features/plugins/builtin/manifest.ts` is the
canonical list (`MANAGED_PLUGINS`) of user-toggleable built-ins. The `id` is the
runtime `Plugin.id` and is shared by the registry, `DEFAULT_SETTINGS.enabledPlugins`
(+ the Rust default in `settings.rs`), and the Settings UI. `settingsService.loadSettings`
runs `normalizeEnabledPlugins()` to migrate legacy display ids (`web-search` →
`websearch`, …) and surface newly-managed plugins on upgrade. `useAppLifecycle` calls
`pluginRegistry.applyEnabledSet(enabledPlugins, MANAGED_PLUGIN_IDS)` on every load so
the toggles actually gate the query path; unmanaged plugins (ai-chat, developer) are
always-on. Adding a toggleable built-in = register it + add one `MANAGED_PLUGINS` entry
+ a `settings:plugins.names.*` i18n key.

**Extensions** (dual-source registry):
- **Source 1 — GitHub legacy** (`VoltLaunchr/volt-extensions/registry.json`): extensions historiques (github, notion, password-generator). Toujours servis, pas de migration prévue.
- **Source 2 — Supabase** (`developer_extensions` table, `status = 'approved'`): nouvelles extensions soumises via le portail developer sur voltlaunchr.com. Workflow: draft → pending → approved/rejected.
- Les deux sources sont fusionnées dans `/api/extensions` (voltlaunchr.com) avec déduplication par slug. Built-ins toujours prioritaires.
- **Portail developer** (voltlaunchr.com/developer): les devs créent un compte `developer` tier, gèrent leurs extensions, et génèrent des API keys (`sk_live_*`) pour automatisation future CLI.
- **API keys** stockées en DB (`api_keys` table) avec SHA-256 hash, jamais en clair. Colonnes: `developer_id`, `key_prefix`, `scopes`, `is_active`.
- Manifest-based: `ExtensionManifest` with id, name, version, permissions
- Dynamic loading via ExtensionLoader + Sucrase transpilation
- Management: `src/features/extensions/` (install, uninstall, toggle)
- Web Worker sandbox: extensions with `keywords`/`prefix` in manifest run in dedicated Worker
- Permission enforcement: consent dialog on first load, `grantedPermissions` persisted
- Network proxy: Worker fetch requests proxied via postMessage if network permission granted
- **Security hardening**:
  - HMAC-SHA256 state signatures on `installed.json`/`dev-extensions.json` (key in OS keyring)
  - Signature mismatch → fail-closed: `granted_permissions` reset to empty for every extension (H4)
  - Backend permission allowlist: `ALLOWED_PERMISSIONS` in `extensions.rs` — entire batch rejected on unknown entry (M1)
  - Worker sandbox: eval/Function/WebSocket/XMLHttpRequest/importScripts disabled; pending map cleared on timeout
  - SSRF prevention: private IP blocking, redirect SSRF blocked, numeric IPv4/IPv6-mapped hosts rejected, credentials omit, Cookie/Auth headers stripped, 10MB body cap
  - Launch validation: LOLBIN denylist, NTFS normalization, executable extension validation
  - Tamper detection: `.sig` files, UI alerts on mismatch, `get_extension_tamper_alert` command

### Hotkey
- Default: `Ctrl+Space` (configurable in Settings)
- No fallback hotkeys - if default conflicts, user can change in Settings

### Theme
- Controlled via `data-theme` attribute + `applyTheme()` from `features/settings`
- Auto theme uses system preference listener

## Window Config

Always-on-top, transparent, 800x550px, no decorations, skips taskbar (see `tauri.conf.json`)

## Key Dependencies

### Backend (Rust)
- **Tauri v2** + plugins: global-shortcut, shell, fs, dialog, updater, positioner, autostart, opener, process, single-instance, deep-link
- **tokio** (full) — async runtime
- **rusqlite** (bundled) — SQLite for file indexing
- **notify** v6 — filesystem watcher
- **reqwest** — HTTP client
- **nucleo-matcher** — fuzzy matching
- **sysinfo** — system metrics
- **tracing** + tracing-appender — structured logging with rotating files
- **uuid** — UUID generation for snippets
- **Windows**: winapi, winreg, lnk

### Frontend (TypeScript)
- **React 19** + React DOM 19
- **Vite 7** — build tool (multi-page: main + settings windows)
- **TypeScript 5.8** — strict mode
- **lucide-react** — icons
- **date-fns** — date utilities
- **emojibase** — emoji data
- **sucrase** — TypeScript transpiler for extensions

## Documentation

- **Backend architecture**: `src-tauri/README.md`, `ARCHITECTURE.md`, `MODULES.md`
- **Plugin development**: `src-tauri/src/plugins/README.md`
- **Project-level**: `AGENTS.md` (detailed conventions), `README.md` (getting started)
- **Archive**: `archive/` for historical docs

## Code Style

**TS/React**: Prettier (single quotes, 100 char, 2 spaces), feature-based folders, functional components
**Rust**: rustfmt, commands return `Result<T, String>`, use `map_err(|e| e.to_string())`

## Custom Agents (`.claude/commands/`)

| Command | Purpose |
|---|---|
| `/volt-tauri-cmd` | Create Tauri v2 commands with full Rust→TS wiring |
| `/volt-plugin` | Create plugins (builtin) or extensions (volt-extensions repo) |
| `/volt-docs` | Fetch official docs (Tauri v2, React 19, Rust) via context7 + web |
| `/volt-debug` | Diagnose & fix bugs across the full stack |
| `/volt-feature` | Architect & implement new features end-to-end |
| `/volt-senior-dev` | Senior full-stack dev: clean code, reviews, implementation |
| `/volt-cto` | CTO/Architect: strategic decisions, trade-offs, architecture |
| `/volt-rust-expert` | Rust expert: async, perf, safety, idiomatic patterns |
| `/volt-tauri-expert` | Tauri v2 expert: IPC, plugins, capabilities, config |
| `/volt-test` | Testing expert: Vitest, cargo test, coverage, TDD |
| `/volt-perf` | Performance: profiling, bundle, memory, latency optimization |
| `/volt-security` | Security audit: capabilities, XSS, extensions, IPC |
| `/volt-ux` | UX & Accessibility: keyboard-first, WCAG 2.2, ARIA |
| `/volt-extension-dev` | Extension guide: create plugins & extensions, boilerplate |

## Best Practices

- Maintain 150ms search debounce & latestSearchId protection
- Don't duplicate code - use `utils/` modules
- Test individual modules (faster than monolithic)
- Document all public APIs
- Follow existing patterns for new features
- Builtin plugins go in-repo; community extensions go in volt-extensions repo
- Always verify compilation after changes: `cargo check` (Rust) + `pnpm run build` (TS)

---

## Lint & Code Quality — Règles absolues

### Interdictions strictes
Tu n'as **jamais** le droit de :
- Mettre une règle ESLint à `'off'` ou rétrograder à `'warn'` pour faire passer le lint
- Ajouter un commentaire `// eslint-disable` ou `// eslint-disable-next-line`
- Ajouter `// @ts-ignore` ou `// @ts-expect-error`
- Utiliser `as any` pour contourner une erreur TypeScript

**Si une règle ESLint fire → tu fixes le code, pas la règle.**

### Règles ESLint actives et non-négociables

Ces règles sont à `'error'` et ne doivent jamais être désactivées :

| Règle | Pourquoi c'est non-négociable |
|---|---|
| `react-hooks/purity` | `Date.now()`, `Math.random()` en render = hydration mismatch + memoization cassée avec React Compiler |
| `react-hooks/refs` | `ref.current` lu en render = comportement indéfini, React peut re-render plusieurs fois |
| `react-hooks/rules-of-hooks` | Hooks dans des conditions = crash garanti |
| `react-hooks/exhaustive-deps` | Deps manquantes = bugs de stale closure silencieux |
| `@typescript-eslint/no-unused-vars` | Code mort = dette technique et confusion |
| `@typescript-eslint/no-require-imports` | Le projet est ESM — `require()` est interdit |

### Comment corriger chaque type de violation

**`react-hooks/purity`** — fonction impure en render (`Date.now()`, `Math.random()`, `crypto.randomUUID()`) :
```ts
// ❌ Interdit
function Component() {
  const id = Date.now(); // fire en render
}

// ✅ Init unique
const [id] = useState(() => Date.now());

// ✅ Recalcul mémoïsé
const value = useMemo(() => Math.random(), []);

// ✅ Dans un effet
useEffect(() => { setTimestamp(Date.now()); }, []);

// ✅ Dans un event handler
<button onClick={() => setId(crypto.randomUUID())}>
```

**`react-hooks/refs`** — accès à `ref.current` pendant le render :
```ts
// ❌ Interdit
function Input() {
  const inputRef = useRef(null);
  const value = inputRef.current?.value; // lu en render
}

// ✅ Dans un useEffect
useEffect(() => {
  const value = inputRef.current?.value;
}, []);

// ✅ Dans un event handler
const handleClick = () => { inputRef.current?.focus(); };
```

**`@typescript-eslint/no-unused-vars`** :
```ts
// ❌ Variable morte → supprimer
const unused = 'never used';

// ✅ Intentionnellement ignorée → préfixer _
function handler(_event: MouseEvent) { ... }
const [_state, setState] = useState(0);
```

**`@typescript-eslint/no-require-imports`** :
```ts
// ❌ CommonJS interdit
const fs = require('fs');

// ✅ ESM
import fs from 'fs';
import { readFile } from 'fs/promises';
```

### Validation obligatoire avant tout commit

```bash
pnpm run lint 2>&1   # 0 errors, 0 warnings non-préexistants
bun run build       # TS compile sans erreur
cargo check         # si fichiers Rust modifiés
```

Le critère de succès est `pnpm run lint` propre **sans aucune règle désactivée** qui n'était pas déjà présente avant ta tâche.

### Convention `no-unused-vars` — configuration légitime

La seule configuration autorisée pour ignorer des variables est le préfixe `_` :
```js
'@typescript-eslint/no-unused-vars': ['error', {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
  ignoreRestSiblings: true,
}]
```
Ne jamais élargir ce pattern pour couvrir des variables qui ne sont pas intentionnellement ignorées.

### Globals navigateur légitimes

Les globals suivants sont autorisés dans `eslint.config.js` car absents de l'env ESLint par défaut mais réels dans le contexte Tauri/browser :
`atob`, `btoa`, `location`, `history`, `confirm`, `alert`, `prompt`, `requestAnimationFrame`, `cancelAnimationFrame`, `SVGGElement`, `SVGSVGElement`

Ne jamais ajouter un global pour contourner une erreur — si ESLint se plaint d'un symbole, vérifie d'abord s'il est vraiment disponible dans le contexte d'exécution.

---

## Release Process — Checklist obligatoire

**Aucune release ne part sans avoir passé tous les checks ci-dessous.** Les v0.1.7 (CI cassée) et v0.1.8 (bundle cassé, splash infini) sont parties parce que des étapes ont été sautées. Ne pas refaire l'erreur.

### Pré-requis non-négociables sur la branche

1. La branche doit s'appeler **exactement** `release/vX.Y.Z` (semver strict, ex. `release/v0.1.9`).
   - `auto-tag.yml` ne fire **que** sur ce préfixe (`startsWith(head_ref, 'release/v')`). Une PR depuis `dev` ou autre branche ne tagguera **pas** la release et les binaires ne seront jamais publiés sur la nouvelle version (le tag reste sur l'ancien commit).
2. Brancher depuis `origin/main` à jour (`git fetch origin main && git checkout -b release/vX.Y.Z origin/main`), pas depuis `dev`.

### Étape 1 — Bump version + changelog

```bash
node scripts/bump-version.mjs X.Y.Z       # met à jour package.json, Cargo.toml, tauri.conf.json
node scripts/sync-version.mjs --check     # vérifie l'alignement
```

Puis **toujours** ajouter manuellement l'entrée `public/changelog.json` (le générateur auto échoue après squash-merge — voir `scripts/generate-changelog.mjs`).

L'entrée doit contenir : `version`, `date` (ISO YYYY-MM-DD), `title`, `description`, `sections[]` (au moins une), `footer`. JSON parsable obligatoire.

### Étape 2 — Validation locale (bloquant)

Aucun commit avant que **toutes** ces commandes passent :

```bash
pnpm run lint 2>&1                # 0 error
pnpm run build 2>&1               # TS compile + Vite bundle OK
cd src-tauri && cargo check      # Rust compile OK
cd src-tauri && cargo clippy -- -D warnings  # 0 warning Rust
pnpm run test 2>&1                # Vitest vert
node scripts/sync-version.mjs --check        # versions alignées
```

### Étape 3 — Smoke test du bundle de production (BLOQUANT, sinon on revit v0.1.8)

Le frontend peut compiler sans erreur ET être complètement cassé au runtime (cycle de chunks Rollup, top-level throw qui rejette le module entry, etc.). `pnpm run build` n'attrape **pas** ces bugs. Le seul moyen fiable : **charger le bundle dans un vrai webview**.

Au choix, dans l'ordre de coût croissant :

**A. Cycle scan (rapide, 5 s)** — détecte les imports circulaires entre chunks, cause #1 des bundles morts :

```bash
pnpm run build && node -e "
const fs=require('fs'),dir='dist/assets';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js'));
const g={}; for(const f of files){const c=fs.readFileSync(dir+'/'+f,'utf8'); g[f]=(c.match(/^import[^;]+from\"\\.\\/([^\"]+)\"/gm)||[]).map(s=>s.match(/\\.\\/([^\"]+)/)[1]);}
function fc(s){const st=[[s,[s]]],seen=new Set(); while(st.length){const [n,p]=st.pop(); for(const m of g[n]||[]){if(p.includes(m))return [...p,m]; if(!seen.has(n+'->'+m)){seen.add(n+'->'+m); st.push([m,[...p,m]]);}}} return null;}
let any=false; for(const f of files){const c=fc(f); if(c){console.log('CYCLE:',c.join(' -> ')); any=true; break;}}
if(!any)console.log('OK: no chunk cycles');
"
```

Si "CYCLE:" → ne pas releaser. Cause typique : `manualChunks` qui sépare une lib React-consuming du chunk `vendor-react`.

**B. WebView2 devtools (5 min)** — avec un binaire local. `devtools` est gated en debug feature, donc en release on l'active à la volée :

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--auto-open-devtools-for-tabs"
& "C:\Users\<user>\AppData\Local\Volt\volt.exe"
```

Onglet Console — si rouge, ne pas releaser. Sinon, vérifier que l'UI atteint la barre de recherche (la fenêtre n'est pas figée sur le splash logo).

**C. Build complet local + install (15-30 min)** — le test ultime, mais lourd :

```bash
pnpm run tauri -- build
# Lance le .msi/.exe généré dans src-tauri/target/release/bundle/
```

### Étape 4 — Push + PR

```bash
git push -u origin release/vX.Y.Z
gh pr create --title "chore(release): vX.Y.Z" --body "..."
```

Body de PR doit contenir : résumé, test plan checklist, lien vers la release notes du changelog.

### Étape 5 — Wait CI

**Aucun merge tant que CI n'est pas verte.** Les jobs critiques :
- `Check & Build (windows-latest)` (clippy 1.95 strict, fmt check, build)
- `Check & Build (macos-latest)`, `Check & Build (ubuntu-latest)`
- `e2e`
- `lint-pr-title`

`auto-tag` (qui fire au merge) doit aussi passer pour que le tag soit créé.

### Étape 6 — Post-merge : vérifier la release

1. Confirmer que **`auto-tag.yml`** a tourné et créé le tag `vX.Y.Z` :
   ```bash
   gh run list --workflow=auto-tag.yml --limit 1
   git ls-remote --tags origin "vX.Y.Z"
   ```
2. Confirmer que **`release.yml`** a publié les artefacts :
   ```bash
   gh release view vX.Y.Z --json assets --jq '.assets[].name'
   # doit lister: latest.json, *.msi, *.exe, *.dmg, *.deb, *.rpm, *.AppImage + .sig
   ```
3. **Smoke test du binaire publié** : télécharger l'installeur Windows, installer, lancer. Si splash infini → c'est trop tard, mais au moins on sait. Hot-fix immédiat (cf. cycle v0.1.8 → v0.1.9).

### Erreurs déjà commises — ne pas refaire

| Bug | Symptôme | Cause | Fix |
|---|---|---|---|
| v0.1.7 | Binaires sans le contenu de la PR | PR mergée depuis `dev`, pas `release/v*`, donc `auto-tag.yml` n'a pas fire — tag pointait sur l'ancien commit | Toujours brancher depuis `main` avec `release/vX.Y.Z` |
| v0.1.8 | Splash infini, watchdog ne fire jamais | Cycle `vendor → vendor-react → vendor` (manualChunks `id.includes('react')` → `/node_modules/<pkg>/` a éjecté motion/@base-ui/@radix-ui/@visx du `vendor-react`) → `createContext` undefined au load → entry module rejette | Cycle scan (Étape 3A) avant chaque release |
| v0.1.7 | CI rouge sur fmt+clippy | Merge `main → dev` a introduit fmt drift + Rust 1.95 a renforcé `collapsible_if` | Toujours `cargo fmt && cargo clippy -- -D warnings` localement avant push |

### Checklist condensée à cocher

```
[ ] Branche release/vX.Y.Z créée depuis origin/main à jour
[ ] node scripts/bump-version.mjs X.Y.Z
[ ] Entrée changelog.json ajoutée manuellement (JSON valide)
[ ] node scripts/sync-version.mjs --check ✅
[ ] pnpm run lint ✅
[ ] pnpm run build ✅
[ ] cd src-tauri && cargo check && cargo clippy -- -D warnings ✅
[ ] pnpm run test ✅
[ ] Cycle scan chunks ✅ (Étape 3A)
[ ] Au moins UN smoke test webview (3B ou 3C)
[ ] git commit + push
[ ] gh pr create vers main
[ ] CI verte (tous les jobs)
[ ] Merge
[ ] Tag vX.Y.Z créé par auto-tag.yml
[ ] Artefacts publiés par release.yml
[ ] Install + lancement du .msi téléchargé : atteint la barre de recherche
```
