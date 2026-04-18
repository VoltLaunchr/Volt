# Volt — Roadmap Produit

> Document vivant. Les estimations sont des fourchettes, pas des engagements. Pour les details techniques (fichiers modifies, criteres d'acceptation), voir la [roadmap technique](../build-release/ROADMAP.md).

---

## Etat actuel du produit (v0.0.8)

### Ce qui est livre et fonctionnel

**Core**
- Recherche fuzzy multi-source (apps, fichiers, plugins) avec scoring intelligent (nucleo-matcher unifie)
- Lancement d'applications cross-platform (Windows, macOS, Linux)
- Debounce 150ms + protection contre les reponses perimees
- Navigation 100% clavier (fleches, Enter, Esc, Tab, raccourcis Alt+1-9)
- Menu contextuel (clic droit ou Ctrl+K) : lancer, ouvrir dossier, copier chemin, proprietes
- Batch IPC : commande `search_all` unifiee (apps + fichiers + frecency en un seul appel)
- Query-result binding : enregistrement des selections utilisateur pour apprentissage

**Plugins builtin (13 frontend)**
- Calculator : expressions math, conversions d'unites, dates, fuseaux horaires
- Emoji Picker : recherche par nom, navigation par categorie, copie instantanee
- Web Search : multi-moteurs (Google, DuckDuckGo, Bing) via prefixe `?`
- Focus Timer : Pomodoro complet (focus/break/custom), auto-cycle, gestion taches, notifications desktop + audio
- System Monitor : CPU par coeur, RAM, disques (SSD/HDD), reseau par interface, top processes, temperatures, sparklines 60s, export CSV
- System Commands : reload, settings, quit avec matching fuzzy
- Game Scanner : detection 10 plateformes (Steam, Epic, GOG, EA, Ubisoft, Riot, Xbox, Amazon, Battle.net, Rockstar), scan parallele, deduplication
- Steam : integration dediee
- Quicklinks : raccourcis URL/dossier/commande avec validation securisee, commandes `ql:add`/`ql:list`/`ql:remove`
- Shell Commands : prefixe `>`, streaming temps reel, ANSI colors, historique frecency, `!!`/`!prefix`, blocklist securite
- Window Management : snap windows dans 6 zones predefinies
- Snippets : prefixe `;`, variables dynamiques, import/export
- Clipboard : historique, pin, recherche

**Plugins backend (3 Rust)**
- Clipboard Manager : historique, pin, recherche, persistance
- Game Scanner : scan 10 plateformes parallele avec cache 5 min, deduplication, filtrage 60+ non-jeux
- System Monitor v2 : metriques detaillees (per-core CPU, per-disk, reseau, top processes, temperatures, uptime), cache 5s avec ticker background

**Recherche avancee**
- Frecency scoring : apps classees par (match_score + launch_count * recency_decay)
- Resultats predictifs : query vide → top frecency apps (pinned first, puis frecency desc)
- Operateurs power-user : `ext:pdf`, `in:~/Documents`, `size:>10mb`, `modified:<7d`
- Resultats groupes par section (Applications, Commands, Games, Files) style Raycast
- Constantes de scoring centralisees (`searchScoring.ts`)

**Preview panel**
- Panneau lateral 350px (toggle Ctrl+P) avec resize dynamique (800→1100px)
- Apercu texte (2KB, monospace), images (asset protocol), dossiers (liste enfants)
- Metadata : taille, date modification, chemin, nb lignes, extension

**Parametres**
- 8 categories + panneau Integrations (general, apparence, hotkeys, indexation, plugins, extensions, integrations, about)
- Hotkey globale configurable en live (defaut : Ctrl+Space)
- 9 positions de fenetre predefinies + coordonnees custom
- Themes : Dark, Light, Auto (suit le systeme)
- Demarrage automatique avec le systeme (autostart)

**Integrations (nouveau)**
- Panneau Integrations dans Settings : GitHub, Notion
- OAuth flow (browser → token → stockage chiffre Tauri)
- Saisie manuelle de token, validation, stockage securise
- Backend OAuth : generation URL, tracking d'etat (`commands/oauth.rs`)
- Backend credentials : chiffrement/dechiffrement tokens (`commands/credentials.rs`)

**Internationalisation (nouveau)**
- Systeme i18n complet (i18next + react-i18next)
- 2 langues : Anglais (en), Francais (fr)
- 9 namespaces : common, settings, help, onboarding, results, clipboard, fileSearch, extensions, changelog
- Localisation par plugin (calculator, websearch, systemcommands, systemmonitor, timer, steam, games, emoji-picker)
- Detection automatique de la locale OS + fallback anglais

**Indexation de fichiers**
- SQLite persistant (WAL mode, transactions, indices) avec watcher incremental
- Scan en arriere-plan avec filtres (extensions, exclusions, profondeur max)
- Recherche fuzzy sur les fichiers indexes
- Configuration des dossiers a indexer depuis les parametres
- Evenements Tauri temps reel pour la progression d'indexation

**Extensions (securite renforcee)**
- Chargement dynamique TypeScript (Sucrase transpilation)
- Web Worker sandbox avec timeout 500ms + crash recovery
- Permission enforcement (clipboard, network, notifications)
- Consent dialog au premier chargement
- Marketplace UI dans Settings > Extensions > Store
- Dev mode : link de dossiers locaux avec hot-reload
- **HMAC-SHA256 state signatures** : tampering detection sur `installed.json`/`dev-extensions.json`, cle OS keyring
- **Worker sandbox renforce** : eval/Function/WebSocket/XMLHttpRequest/importScripts desactives, constructors bloques
- **SSRF prevention** : blocage IP privees, credentials omit, headers Cookie/Auth strippes, body cap 10MB
- **Launch validation** : LOLBIN denylist, normalisation NTFS, validation extensions executables
- **Manifest validation** : permissions fictives droppees, dev paths restreints (.ssh, .aws, .config bloques)
- **Tamper alerts** : UI surfacing des mismatches de signature avec acknowledge

**State management**
- Zustand stores (searchStore, appStore, uiStore) — zero prop drilling
- ViewRouter decouple avec 2 props (vs 13 avant)

**Accessibilite**
- Skip link visible au focus
- Contraste WCAG AA sur themes light + dark
- `aria-describedby` sur les champs cles des parametres
- Focus trap dans Modal (Tab/Shift+Tab cycle)
- ARIA live region dans SearchBar (annonce resultats)
- ResultsList avec `role="listbox"` + `aria-activedescendant` + `aria-selected`

**UX**
- Systeme de toast (info, success, error) avec auto-dismiss configurable
- Toast persistant pour les erreurs d'indexation
- Onboarding modal premier lancement (3 etapes : hotkey, indexation, plugins)
- Help dialog (F1) avec raccourcis clavier

**Qualite du code (nouveau)**
- Type guards centralises (`typeGuards.ts` : 6 guards)
- Safe invoke wrapper (`safeInvoke.ts` : invoke Tauri avec logging automatique)
- Scoring unifie nucleo-matcher (fast path exact/starts-with + fuzzy normalise)
- Constantes de scoring centralisees (searchScoring.ts)

**Infrastructure**
- Auto-updater fonctionnel (signature minisign, endpoint GitHub Releases)
- CI/CD multi-plateforme : Windows (MSI/NSIS), macOS Intel+ARM (DMG), Linux (deb/AppImage/rpm)
- 166 tests frontend + 143 tests Rust
- Logging structure (tracing) avec rotation quotidienne, accessible depuis Settings
- CSP securise

**Plateformes**
- Windows 10/11
- macOS (Intel + Apple Silicon)
- Linux (X11, deb/AppImage/rpm)

---

## Phase 1 — v1.0 "Stable Release" (en cours)

**Valeur utilisateur :** Installer Volt sans avertissements systeme ni etapes manuelles. Avoir confiance que l'app est stable et diagnosticable.

### Ce qui est deja fait

| Element | Statut |
|---------|--------|
| Nettoyage dead code et stubs | ✅ M1.1 |
| Script de synchronisation de version | ✅ M1.1 |
| Suite de tests (166 frontend + 143 Rust) | ✅ M1.2 |
| CSP securise dans tauri.conf.json | ✅ M1.3 |
| Capabilities auditees | ✅ M1.3 |
| Scaffolding CI pour code signing | ✅ M1.3 |
| Documentation code signing (SIGNING_SETUP.md) | ✅ M1.3 |
| Logging structure (tracing + rotation) | ✅ M1.4 |
| Migration console → logger (frontend + backend) | ✅ M1.4 |
| Diagnostics exportables depuis Settings | ✅ M1.4 |
| Refactor App.tsx (1090 → 197 lignes) | ✅ M2.1 |
| VoltError type + migration 73 commandes | ✅ M2.2 |
| CI gates clippy + rustfmt | ✅ M2.2 |

### Ce qui reste

| Element | Bloqueur |
|---------|----------|
| **Code signing Windows** (Authenticode) | Achat certificat (~250€/an OV ou ~25€/an Certum Open Source) |
| **Code signing macOS** (Developer ID + notarization) | Inscription Apple Developer (~99$/an) |
| Release de test signee (v1.0-rc) | Certificats ci-dessus |
| Test fresh install Windows 11 + macOS | Release signee |

### Checklist release 1.0

- [ ] Certificats achetes et secrets GitHub configures
- [ ] Installation MSI sur Windows 11 vierge → aucun SmartScreen
- [ ] Installation DMG sur macOS recent → passe Gatekeeper
- [ ] Test auto-update depuis v0.0.4 → v1.0.0
- [ ] Changelog et annonce README mis a jour

---

## Phase 2 — v1.x "Quality & Polish" ✅ Complete (2026-04-13)

**Valeur utilisateur :** Une experience soignee, accessible, et agreable au quotidien.

### WS1 — Accessibilite (WCAG AA) ✅

- ✅ Skip link invisible, visible au focus, saute vers le champ de recherche
- ✅ Contraste WCAG AA corrige sur themes light + dark (opacites augmentees)
- ✅ Focus trap dans Modal (Tab/Shift+Tab cycle)
- ✅ ARIA live region dans SearchBar (annonce uniquement quand les resultats changent)
- ✅ `aria-describedby` sur HotkeyCapture, folder picker, file extensions
- ✅ ResultsList avec `role="listbox"` + `aria-selected` + `aria-activedescendant`

### WS2 — Store Zustand ✅

- ✅ 3 stores : `searchStore`, `appStore`, `uiStore`
- ✅ App.tsx : 0 useState
- ✅ ViewRouter : 2 props (vs 13 avant) — zero prop drilling
- ✅ Hooks (`useSearchPipeline`, `useResultActions`, `useGlobalHotkey`) lisent les stores directement
- ✅ 166 tests frontend passent sans regression

### WS3 — Indicateur d'indexation ✅

- ✅ Systeme de toast (info, success, error) avec max 3 visibles, auto-dismiss 5s
- ✅ Tauri Events temps reel (`indexing-progress`) au lieu de polling
- ✅ Toast "Indexing N folder(s)..." au demarrage + "Indexing complete — N files" a la fin
- ✅ Toast erreur persistant (duration=0) pour ne pas rater les erreurs
- ✅ Hook `useToast()` exporte pour usage simplifie

### WS4 — Onboarding premier lancement ✅

- ✅ Modal 3 etapes : hotkey globale, indexation, plugins
- ✅ Navigation dots + Skip + Next/Get Started
- ✅ `hasSeenOnboarding` persiste dans settings (Rust + TS)
- ✅ Focus trap herite de Modal
- ✅ Jamais reaffiche apres completion

### Autres ameliorations UX ✅

- ✅ Help dialog (F1) listant les raccourcis
- ✅ Indicateur d'indexation anime dans le footer

---

## Phase 3 — v1.5 "Platform & Extensibility" ✅ Complete (2026-04-14)

**Valeur utilisateur :** Demarrage instantane meme avec des dossiers enormes. Possibilite d'installer des plugins communautaires sans recompiler Volt.

### Index persistant SQLite + watcher incremental ✅

- ✅ Base SQLite pour l'index fichiers (WAL mode, transactions, indices)
- ✅ File watcher incremental via `notify` : creation/modification/suppression avec debounce 100ms
- ✅ Fast path : chargement depuis DB au demarrage (< 500ms pour 50k fichiers)
- ✅ Settings > Indexing : taille DB, derniere mise a jour, statut watcher, bouton "Rebuild"
- ✅ Commands : `invalidate_index`, `get_db_index_stats`, `start_file_watcher`, `stop_file_watcher`

### Plugin loader externe ✅

- ✅ Extensions TypeScript chargees dynamiquement (Sucrase transpilation + module bundling)
- ✅ Format : dossier avec `manifest.json` + `index.ts` + fichiers source
- ✅ Installation/desinstallation via Settings > Extensions > Store
- ✅ Dev mode : link de dossiers locaux (npm-link style) avec hot-reload

### Web Worker Sandbox ✅ (2026-04-13)

- ✅ Extensions avec `keywords`/`prefix` dans le manifest → executees dans un Worker dedie
- ✅ `canHandle` declaratif (main thread, < 0.1ms, pas de code extension execute)
- ✅ `match`/`execute` via postMessage avec timeout 500ms
- ✅ Crash recovery : Worker termine automatiquement recree au prochain appel
- ✅ Fallback inline pour extensions legacy (sans keywords/prefix)
- ✅ Mock VoltAPI dans le Worker (capture d'actions au lieu d'execution directe)

### Permission Enforcement ✅ (2026-04-13)

- ✅ Permission consent dialog au premier chargement (Grant/Deny)
- ✅ Permissions persistees dans `installed.json` (`grantedPermissions`)
- ✅ Verification avant chaque action : clipboard, network, notifications
- ✅ Actions bloquees avec warning si permission non accordee
- ✅ Network proxy : `fetch` dans le Worker → execute cote main thread si permission `network` accordee
- ✅ Command Tauri `update_extension_permissions` pour persister

### Extension marketplace & registry ✅

- ✅ Registry JSON statique (GitHub)
- ✅ UI dans Settings > Extensions > Store : recherche, install, categories, enable/disable
- ✅ Check updates + update extensions
- ✅ Download count, stars, verified badges

### Plugin SDK / CLI ✅ (2026-04-14)

- ✅ CLI `volt-plugin` avec 3 commandes : `init`, `test`, `publish`
- ✅ `init` : scaffolding interactif (prompts nom, categorie, permissions, prefix, keywords)
- ✅ `test` : validation manifest + type-check TypeScript + verification interface Plugin
- ✅ `publish` : packaging ZIP cross-platform (archiver) + generation entree registry
- ✅ 19 tests unitaires (manifest validation, template generation, registry entry)
- ✅ Documentation complete (README CLI)

---

## Phase 4 — v2.0 "Power Features" ✅ Complete (2026-04-14)

**Valeur utilisateur :** Volt devient un hub de productivite, pas juste un lanceur.

### Recherche avancee (style Raycast) ✅ (2026-04-14)

- ✅ **Frecency scoring** : apps classees par (match_score + launch_count * recency_decay), plus de score fixe
- ✅ **Resultats predictifs** : query vide → top frecency apps (pinned first, puis frecency desc)
- ✅ **Operateurs power-user** : `ext:pdf`, `in:~/Documents`, `size:>10mb`, `size:<1gb`, `modified:<7d`, `modified:>30d`
- ✅ **Query parser** : extraction automatique des operateurs, filtrage backend via SearchEngine
- ✅ Commandes Tauri : `search_all` (batch), `search_applications_frecency`, `get_frecency_suggestions`
- ✅ Scoring unifie via nucleo-matcher (fast paths exact/starts-with + fuzzy normalise log)
- ✅ Constantes centralisees dans `searchScoring.ts`
- ✅ 166 tests frontend + 143 tests Rust

### Snippets & text expansion ✅ (2026-04-14)

- ✅ Backend CRUD complet : create, update, delete, get, import, export (snippets.json)
- ✅ Variables dynamiques : `{date}`, `{time}`, `{datetime}`, `{clipboard}`, `{random}`
- ✅ Plugin builtin : prefixe `;` pour rechercher et executer des snippets
- ✅ Categories et descriptions optionnelles
- ✅ Import/export JSON pour portabilite

### Preview panel ✅ (2026-04-14)

- ✅ Panneau lateral 350px (toggle Ctrl+P) avec resize dynamique (800→1100px)
- ✅ Apercu texte (2KB, monospace), images (asset protocol), dossiers (liste enfants)
- ✅ Metadata : taille, date modification, chemin, nb lignes, extension
- ✅ Backend `get_file_preview` avec detection auto du type (text/image/folder/app/binary)
- ✅ Debounce 200ms + cache pour navigation clavier fluide

### Clipboard manager avance ✅

- ✅ 9 commandes backend : historique, pin, recherche, toggle, delete, clear, copy
- ✅ Plugin frontend avec matching fuzzy
- 🟡 Redaction automatique des mots de passe detectes (a faire)

### Integrations OS natives (Windows) ✅ (2026-04-14)

- ✅ **Registry Uninstall** : scan `HKLM\...\Uninstall` + `WOW6432Node` pour noms propres d'apps (DisplayName, Publisher)
- ✅ **Shell AppsFolder** : enumeration des apps Store/UWP via PowerShell Get-AppxPackage
- ✅ **Windows Search Index** : query OLE DB du SystemIndex comme source supplementaire pour les fichiers
- ✅ Nettoyage noms : `Microsoft.WindowsCalculator` → `Windows Calculator`
- ✅ Filtrage apps systeme (VCLibs, .NET, DirectX, etc.)
- ✅ Fallback gracieux : si une source echoue, les autres continuent
- ✅ Resultats groupes par section (Applications, Commands, Games, Files) style Raycast
- ✅ Badges de type sur chaque resultat
- ✅ Chemins raccourcis (~\Documents au lieu de C:\Users\...)

### Integrations tierces ✅ (2026-04-14) — NOUVEAU

- ✅ **Panneau Integrations** dans Settings : GitHub, Notion
- ✅ **OAuth flow** : ouverture navigateur → token → stockage chiffre Tauri
- ✅ **Saisie manuelle** de token avec validation
- ✅ **Backend OAuth** : `commands/oauth.rs` (generation URL, tracking etat)
- ✅ **Backend credentials** : `commands/credentials.rs` (chiffrement/dechiffrement)
- ✅ **Frontend** : `credentialsService.ts` + `IntegrationsPanel.tsx`
- 🟡 Deep links pour retour OAuth automatique (Phase 2)
- 🟡 Token rotation automatique (Phase 2)
- 🟡 Services supplementaires (Phase 2)

### Internationalisation ✅ (2026-04-14) — NOUVEAU

- ✅ **Systeme i18n** : i18next + react-i18next
- ✅ **2 langues** : Anglais (en), Francais (fr)
- ✅ **9 namespaces** : common, settings, help, onboarding, results, clipboard, fileSearch, extensions, changelog
- ✅ **Plugins localises** : calculator, websearch, systemcommands, systemmonitor, timer, steam, games, emoji-picker
- ✅ Detection automatique locale OS + fallback anglais
- ✅ Traduction suggestions (titres, sous-titres, badges)

### Performance (nouveau) ✅ (2026-04-14)

- ✅ **Batch IPC** : commande `search_all` unifiee (1 appel au lieu de 3)
- ✅ **O(1) file clone** : optimisation du clonage des resultats fichiers
- ✅ **Sync watcher cache** : cache 5 min pour les jeux avec rescan manuel
- ✅ **Scoring unifie nucleo-matcher** : fast paths + normalisation logarithmique
- ✅ **Query-result binding** : `record_search_selection` pour apprentissage des preferences

### Qualite du code (nouveau) ✅ (2026-04-14)

- ✅ **Type guards** : `typeGuards.ts` (6 guards : isPluginResultData, isClipboardItem, isLaunchRecord, isSearchResult, isAppInfo, isFileInfo)
- ✅ **Safe invoke** : `safeInvoke.ts` (wrapper Tauri invoke avec logging automatique, retourne T | null)
- ✅ 3 TODOs en suspens resolus dans la codebase

### Shell commands inline ✅ (2026-04-17)

- ✅ Prefixe `>` pour executer une commande shell
- ✅ Streaming output temps reel via Tauri Channels
- ✅ Kill propre des processus sur cancel/timeout (plus de process zombie)
- ✅ Ctrl+C pour annuler une commande en cours
- ✅ Historique de commandes avec frecency scoring (500 entries max)
- ✅ Auto-suggestions basees sur l'historique quand `>` tape
- ✅ `!!` pour relancer la derniere commande, `!prefix` pour chercher dans l'historique
- ✅ Preview panel pour l'output complet (Ctrl+P)
- ✅ Menu contextuel : Run, Copy Command, Copy Output, Re-run, Pin
- ✅ Rendu des couleurs ANSI en CSS (bold, dim, italic, underline, 16 couleurs + bright)
- ✅ Panneau Shell dans Settings (shell par defaut, timeout, working dir, history size, enable/disable)
- ✅ i18n (en/fr)
- ✅ Securite : blocklist 14 patterns destructeurs, redaction secrets, execution tokens, output cap 50KB

### Extension hardening ✅ (2026-04-18)

- ✅ **State signatures HMAC-SHA256** : tampering detection sur fichiers etat extensions, cle OS keyring
- ✅ **Worker sandbox renforce** : eval/Function/WebSocket/XMLHttpRequest/importScripts desactives
- ✅ **SSRF prevention** : blocage IP privees, credentials omit, headers sensibles strippes, body cap 10MB
- ✅ **Launch validation** : LOLBIN denylist (cmd.exe, powershell.exe...), normalisation NTFS
- ✅ **Manifest validation** : permissions fictives droppees, dev paths restreints
- ✅ **Tamper alerts UI** : detection mismatch signature avec acknowledge

### System Monitor v2 ✅ (2026-04-18)

- ✅ Per-core CPU usage + frequences
- ✅ Per-disk details (mount, filesystem, SSD/HDD, espace)
- ✅ Reseau par interface (RX/TX bytes/s) + totaux agreges
- ✅ Top 5 processus CPU + top 5 RAM avec kill (`kill_process_by_pid`)
- ✅ Temperatures (CPU, GPU, capteurs) avec seuils critiques
- ✅ Uptime systeme
- ✅ Frontend : modal detail avec sparklines 60s, indicateurs couleur, export CSV
- ✅ Polling intelligent : 1Hz modal ouvert, 60s arriere-plan

### Game Scanner etendu — 10 plateformes ✅ (2026-04-18)

- ✅ +Amazon Games : lecture metadata.json, lancement `amazon-games://play/<id>`
- ✅ +Battle.net : mapping 80+ product codes Blizzard, lancement `battlenet://<code>`
- ✅ +Rockstar Games : scan registre HKLM, Launcher.exe
- ✅ Scan parallele (`std::thread::scope`), deduplication case-insensitive, filtrage 60+ non-jeux

### Focus Timer (Pomodoro) ✅ (2026-04-18)

- ✅ Modes : focus 25min, short break 5min, long break 15min, custom
- ✅ Parsing duree flexible : `5m`, `1h30m`, `90`, `1:30`
- ✅ Interface : anneau de progression, tracking sessions, gestion taches
- ✅ Auto-cycle focus → break → focus
- ✅ Notifications desktop + audio, persistence across hide/show

### Quicklinks ✅ (2026-04-18)

- ✅ Types : URL (http/https/mailto), dossier (path check), commande (chemin absolu + blocage metacaracteres)
- ✅ Commandes : `ql:add`, `ql:list`, `ql:remove`
- ✅ Cache intelligent, recherche fuzzy, icones par type

### Deep links & Auth ✅ (2026-04-18)

- ✅ `volt://auth/callback` + `volt://oauth-callback` pour OAuth automatique
- ✅ Single instance (tauri-plugin-single-instance)
- ✅ Enregistrement runtime schemes dev mode
- ✅ Redaction query params dans logs

### CI/Release automation ✅ (2026-04-18)

- ✅ auto-tag.yml : tag auto sur merge release PR, validation semver
- ✅ pr-title.yml : enforcement Conventional Commits
- ✅ generate-changelog.mjs : generation depuis commits, security commits collapses
- ✅ commitlint.config.mjs : types standardises → sections changelog
- ✅ commit-msg hook local

### UI & Settings ✅ (2026-04-18)

- ✅ ResultItem enrichi : progress bars, calculator card, shell output, badges type
- ✅ Update manager : check/download/install avec progress
- ✅ Index stats dans Settings
- ✅ App shortcuts management
- ✅ Export diagnostics
- ✅ Tests i18n parity en/fr

---

## Phase 5 — v2.x "Ecosystem" (a venir)

**Valeur utilisateur :** Personnalisation complete et integration profonde avec l'OS.

### Themes custom

- Export/import de theme via JSON (tokens CSS variables)
- Editeur de theme UI dans Settings
- Theme marketplace (suit l'extension marketplace)

### Integrations tierces Phase 2

- ~~Deep links OAuth pour retour automatique~~ ✅ fait
- Token rotation automatique
- Services supplementaires (Slack, Linear, etc.)

### Integrations OS natives (restant)

- **Linux** : support Wayland propre (aujourd'hui X11 implicite)
- **macOS** : option pour piggyback sur l'index Spotlight

### Internationalisation Phase 2

- Langues supplementaires (Espagnol, Allemand, etc.)
- Contribution communautaire pour les traductions
- Pluralisation avancee

### Protocoles custom

- `volt://search?q=chrome` pour integrations externes
- Deep linking depuis d'autres applications

### Sync settings cloud (optionnel)

- Synchronisation des parametres, snippets et themes entre machines
- Opt-in, aucune donnee envoyee par defaut

---

## Backlog ouvert

Idees non priorisees, a evaluer selon les retours utilisateurs :

- Profils de scoring configurables (exact priority, fuzzy priority, frecency)
- Recherche semantique via tags/descriptions personnalises
- Bookmarks / favoris epingles en tete de liste
- Mode debug avec telemetrie locale (temps de scan, perf recherche)
- Hot reload des plugins en mode dev
- Documentation auto-generee des commandes Tauri
- Support WASM pour plugins haute performance
- Accessibilite avancee (lecteur d'ecran complet, mode haut contraste)
- Redaction automatique clipboard (detection mots de passe)
- Apprentissage des preferences recherche (exploitation du query-result binding)

---

## Timeline estimee

| Phase | Version cible | Duree estimee | Statut |
|-------|---------------|---------------|--------|
| Phase 1 | v1.0 | ~3 semaines | En cours (bloque certificats) |
| Phase 2 | v1.x | ~3-4 semaines | ✅ Complete (2026-04-13) |
| Phase 3 | v1.5 | ~5-8 semaines | ✅ Complete (2026-04-14) |
| Phase 4 | v2.0 | ~6-8 semaines | ✅ Complete (2026-04-18) |
| Phase 5 | v2.x | Continu | Backlog |

> Estimations basees sur un developpeur solo a temps partiel (~3h/jour). Les phases 1-4 sont completes. La Phase 1 reste bloquee uniquement par l'achat des certificats de code signing. La phase 5 marque le passage a l'ecosystem.

---

_Document vivant — mettre a jour a chaque fin de phase. Derniere revision : 2026-04-18._
