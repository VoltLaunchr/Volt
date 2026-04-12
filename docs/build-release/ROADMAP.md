# Volt — Roadmap

**Version actuelle :** `0.0.2` &nbsp;•&nbsp; **Dernière mise à jour :** 2026-04-12 &nbsp;•&nbsp; **Statut :** P1 en cours (M1.1 ✅ · M1.2 ✅ · M1.3 🟡 partiel · M1.4 🔄 en cours)

> Document vivant. Les milestones sont groupés en 4 phases. Chaque milestone liste un **but**, des **tâches concrètes** (avec fichiers), des **critères d'acceptation** et une **estimation**.
>
> L'ancien plan (`IMPLEMENTATION_PLAN.md`) reste le journal historique (M0 → M5 complétés). Cette roadmap couvre ce qui reste pour atteindre 1.0 et au-delà.

---

## 📸 État actuel (audit 2026-04-12)

### Ce qui marche déjà ✅

- **Core flow** : scan apps → recherche fuzzy → launch, multi-plateforme (Windows/macOS/Linux).
- **Indexation fichiers** : scanner + recherche nucleo-matcher (en mémoire, non persistante).
- **Plugins builtin (9 frontend + 3 backend Rust)** : calculator, emoji-picker, timer, websearch, systemcommands, systemmonitor, games, steam, clipboard.
- **Settings** : 8 catégories, hotkey configurable (live rebind), autostart, 9 positions fenêtre prédéfinies.
- **Auto-updater** : signature minisign OK, endpoint GitHub Releases, wired end-to-end.
- **CI/CD** : matrice Windows/macOS (Intel+ARM)/Linux, release pipeline sur tag `v*`, bundles MSI/NSIS/DMG/deb/AppImage/rpm.
- **Plugin dev docs** : complètes (DEVELOPMENT, API_REFERENCE, EXAMPLES, TEMPLATE, QUICK_REFERENCE).

### Gaps critiques identifiés 🚧

| Zone | Problème | Impact |
|------|----------|--------|
| **Tests** | 0 test frontend, ~40 tests Rust (happy path) | Pas de filet de sécurité pour refactor/release |
| **Code signing** | Windows Authenticode `null`, macOS non notarisé | SmartScreen/Gatekeeper warnings utilisateurs |
| **CSP** | `csp: null` dans tauri.conf.json | Surface XSS ouverte |
| **Version sync** | 3 sources manuelles (package.json, Cargo.toml, tauri.conf.json) | Risque de dérive à chaque release |
| **Index fichiers** | In-memory only, rescan complet à chaque démarrage | Lent sur gros dossiers, pas d'incrémental |
| **External plugin loader** | Stub (`plugins/loader.rs` retourne "not yet implemented") | Les docs promettent une API qui n'existe pas encore |
| **Rust CI gates** | `cargo fmt --check` et `clippy` absents | Dette de qualité invisible |
| **App.tsx** | 1090 lignes, état monolithique | Refactor nécessaire avant d'ajouter des features |
| **Dead code** | `fileexplorer/` vide, `SnowEffect.tsx` 0 octets, `onboarding/` stub, `core/` vide | Confusion + bruit dans la codebase |
| **Logging Rust** | `log` crate importé jamais initialisé, `println!`/`eprintln!` partout (~97 occurrences) | Diagnostic impossible en prod |

---

## 🎯 Phase 1 — Path to 1.0 (ship-ready) — ~3 semaines

**Objectif :** rendre Volt installable et utilisable par des non-développeurs sans avertissements système ni crashes non diagnostiqués.

### ✅ Milestone 1.1 — Cleanup & dette immédiate (terminé 2026-04-12)

**But :** Supprimer les stubs morts et unifier les sources de vérité avant d'ajouter quoi que ce soit.

**Réalisé :**
- [x] `src/shared/components/ui/SnowEffect.tsx` (0 octet) supprimé
- [x] `src/features/onboarding/` (dossiers vides) supprimé
- [x] **Bonus :** `src/features/settings/components/SettingsWindow.tsx` (1200+ lignes) supprimé — doublon mort de `SettingsApp.tsx`, découvert pendant l'audit. `SettingsWindow.css` renommé en `SettingsApp.css` et déplacé au bon endroit. Barrel exports (`features/settings/index.ts`, `components/index.ts`) nettoyés.
- [x] Setting `showPreview` retiré côté TypeScript (`settings.types.ts`, `common.types.ts`, `SettingsApp.tsx` bloc "Window Mode") et côté Rust (`commands/settings.rs` : `GeneralSettings` + `Default`)
- [x] Script `scripts/sync-version.mjs` + `bun run sync-version` / `bun run check-version` — lit `package.json` et patche `src-tauri/Cargo.toml` (première section `[package]` uniquement, pas les deps) + `tauri.conf.json`, vérifie l'entrée latest de `public/changelog.json`
- [x] Pre-commit hook opt-in : `scripts/hooks/pre-commit` (bash) + `scripts/setup-hooks.mjs` + `bun run setup-hooks`. Lance `tsc --noEmit` + `cargo fmt --check`. Activation via `core.hooksPath` repo-local (aucune modif de la config git globale).

**Annulé (audit inexact) :**
- ~~`src/features/plugins/builtin/fileexplorer/`~~ : le dossier n'existait déjà plus
- ~~Tabs Settings `advanced`/`applications`~~ : ont de la vraie UI (position fenêtre, max results, transparency, theme / scan applications)
- ~~Consolider plugin toggles~~ : le hardcoding était dans `SettingsWindow.tsx`, qui a été supprimé en bloc

**Critères validés :**
- ✅ `bunx tsc --noEmit` vert
- ✅ `cargo check` vert
- ✅ Plus aucun fichier à 0 octet dans `src/`
- ✅ `bun run sync-version` opérationnel (testé sur 0.0.2)

---

### Milestone 1.2 — Fondation de tests (4-6 jours) ✅

**But :** Poser le minimum viable de tests pour sécuriser les refactors à venir.

**Tâches Frontend :**
- [x] Installer `vitest` + `@testing-library/react` + `jsdom`
- [x] Tests unitaires critiques :
  - [x] `features/plugins/core/registry.ts` : register, query, timeout, error isolation (19 tests)
  - [x] `features/plugins/builtin/calculator/` : parser math + dates + timezones (60 tests)
  - [x] `features/plugins/builtin/websearch/` : triggers, engines (17 tests)
  - [x] `features/plugins/builtin/systemcommands/` : fuzzy matching (13 tests)
  - [x] `shared/components/ui/HotkeyCapture.tsx` : capture + normalisation (10 tests)
- [x] Test d'intégration léger du pipeline `performSearch` (mock Tauri invoke) (6 tests)

**Tâches Backend :**
- [x] Étendre `cargo test` :
  - [x] `indexer/search_engine.rs` : cas limites (query vide, caractères spéciaux, large dataset, unicode)
  - [x] `commands/apps.rs` : `detect_app_category`, `should_skip_directory`, `scan_directory_recursive`, cache
  - [x] `utils/matching.rs` : scoring (unicode, case, position decay, empty query)
- [x] Ajouter un job `test` dans `.github/workflows/check.yml` :
  - [x] `bun run test` (vitest run)
  - [x] `cargo test --workspace --lib`

**Résultats :**
- CI exécute `bun run test` + `cargo test` sur chaque PR ✓
- **125 tests frontend** (cible : ≥ 20) ✓
- **88 tests Rust** (cible : ≥ 60, départ : ~40) ✓
- Coverage : plugin registry register/query/timeout/error isolation 100 %, calculator > 80 %, indexer search couvert
- **Bugs révélés et corrigés** pendant la mise au vert :
  - `launcher::process::escape_windows_arg` : oubliait de doubler les backslashes précédant une quote (règle CRT `2N backslashes + \"`), et les backslashes vraiment trailing avant la closing quote n'étaient pas doublés non plus. Un test avait aussi une expectation fausse (`\ ` ne doit pas être doublé quand il n'est pas suivi de `"`). Fix + test réécrit pour vraiment tester les trailing backslashes.
  - `plugins::loader::test_metadata_compatibility` : stale, utilisait `min_volt_version: "0.1.0"` alors que l'app est à 0.0.2. Remplacé par `"0.0.1"` pour rester valide au fil des bumps.

---

### 🟡 Milestone 1.3 — Code signing & sécurité release (partiel — prêt à activer)

**But :** Éliminer les avertissements OS à l'installation et fermer les trous de sécurité évidents.

**Réalisé (sans dépendance externe) :**
- [x] **CSP** : `"csp": null` remplacé par une policy stricte dans `tauri.conf.json` :
  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: asset: http://asset.localhost https://asset.localhost;
  font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost
    https://github.com https://*.githubusercontent.com https://objects.githubusercontent.com;
  frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
  ```
  `devCsp: null` pour laisser Vite HMR fonctionner en dev. `connect-src` ouvre uniquement ce que l'updater a besoin (github.com + githubusercontent pour fetch `latest.json` et download des bundles).
- [x] **Capabilities** : `desktop.json` supprimé (doublon 100 % de `default.json`). `default.json` audité — chaque permission a un usage concret (création webview settings, autostart, positioner, updater, opener, dialog).
- [x] **Scaffolding CI** : env vars `APPLE_CERTIFICATE`/`APPLE_ID`/`APPLE_TEAM_ID`/... et `WINDOWS_CERTIFICATE`/... ajoutés dans `.github/workflows/release.yml`. Bloc `apple-actions/import-codesign-certs` commenté, prêt à être décommenté dès que les secrets sont présents.
- [x] **Doc complète** : [SIGNING_SETUP.md](./SIGNING_SETUP.md) détaille les options de certs (OV/EV Sectigo, Certum Open Source, Apple Developer), les étapes d'export `.pfx`/`.p12`, les secrets GitHub à créer, les commandes de test (`spctl -a -vvv`), et les coûts estimatifs (~340 €/an).

**Bloqué par achat externe (hors scope dev) :**
- [ ] **Windows Authenticode** : cert à acheter (~250 €/an OV ou 25 €/an Certum Open Source)
- [ ] **macOS Developer ID + notarization** : inscription Apple Developer (~99 $/an)
- [ ] **Release de test signée** : v0.0.3-rc à émettre une fois les certs configurés
- [ ] **Test fresh install** Windows 11 + macOS → vérifier absence de SmartScreen/Gatekeeper
- [ ] **Test CSP en prod** : `bun tauri build` puis inspecter la console DevTools pour violations (à faire dès que possible, indépendant des certs)

**Critères ship-1.0 :**
- Installation MSI sur Windows 11 vierge → aucun SmartScreen
- Installation DMG sur macOS récent → passe Gatekeeper sans `xattr -d`
- DevTools console : aucune violation CSP

---

### Milestone 1.4 — Logging & observabilité de base (2-3 jours) ✅

**But :** Savoir ce qui se passe en production sans attacher un debugger.

**Tâches Rust :**
- [x] Initialiser `tracing` + `tracing-subscriber` + `tracing-appender` dans `lib.rs::run()` (setup hook après app_data_dir resolu, `RUST_LOG` honoré, `WorkerGuard` géré via `app.manage(LogGuard(...))`)
- [x] Remplacer `println!`/`eprintln!` par `tracing::{info, warn, error, debug}` :
  - Phase 1 : `commands/extensions.rs` (26), `commands/apps.rs` (18), `hotkey/mod.rs` (14)
  - Phase 2 : `lib.rs` (11), `plugins/{api,registry,loader}.rs` (14), `commands/{files,autostart,launcher}.rs` (5), `indexer/{file_history,scanner}.rs` (3)
  - **Total : ~91 sites migrés.** Restent 2 sites légitimes (1 doc-comment, 1 dans `#[cfg(test)]`).
- [x] Fichier log rotatif quotidien `app_data_dir/logs/volt.log` (via `tracing_appender::rolling::daily`)
- [x] Commande Tauri `get_log_file_path()` exposée + wired dans `invoke_handler!`

**Tâches Frontend :**
- [x] `src/shared/utils/logger.ts` (~70 lignes, 5 tests) — niveaux info/warn/error/debug, relais optionnel vers backend via `invoke('log_from_frontend', ...)` (silencieux si indispo, opt-in `localStorage volt:verbose=1` en prod)
- [x] **153 sites `console.error` migrés** vers `logger.error` (152 → 0 dans le code app, le seul restant est le wrapper lui-même qui forwarde intentionnellement)
- [x] Settings → About : boutons **"Open logs folder"** (via `get_log_file_path` + `revealItemInDir`) et **"Copy diagnostics"** (version + platform + UA + log path + ISO timestamp → clipboard)

**Critères :**
- En dev : logs structurés dans la console (niveau configurable via `RUST_LOG`) ✓
- En prod : fichier log rotatif accessible depuis Settings ✓
- Support bug report : bouton "Copy diagnostics" exporte version + OS + log path ✓

---

### 🚀 Release 1.0 — Après M1.1 → M1.4

**Checklist de release :**
- [ ] Tous les milestones P1 verts
- [ ] `public/changelog.json` mis à jour
- [ ] Tag `v1.0.0` → CI génère bundles signés
- [ ] Test fresh install sur VM Windows + macOS + Ubuntu
- [ ] Test auto-update depuis 0.0.2 → 1.0.0
- [ ] Annonce README + site

---

## 🧹 Phase 2 — Quality & Polish (v1.x) — ~3-4 semaines

**Objectif :** Rendre la codebase agréable à maintenir et l'UX irréprochable.

### Milestone 2.1 — Refactor App.tsx (3-5 jours) ✅

**But :** `src/app/App.tsx` faisait 1090 lignes, ~15 `useState`, toute la logique search + lifecycle + settings + plugins mélangée. Impossible d'ajouter proprement de nouvelles features tant que ce n'est pas découpé.

**Tâches :**
- [x] Extraire `hooks/useSearchPipeline.ts` (242 l) : performSearch + debounce 150 ms + latestSearchId + merge scoring + snow effect + emoji escape
- [x] Extraire `hooks/useAppLifecycle.ts` (232 l) : scan init, auto-indexing, updater check, extension loader, theme listener
- [x] Extraire `hooks/useGlobalHotkey.ts` (336 l) : window events, keyboard shortcuts (↑↓ Enter Esc Tab modifiers)
- [x] Extraire `hooks/useResultActions.ts` (174 l) : `handleLaunch` + `handleSuggestionActivate` (dispatch par type de result + suggestions par id)
- [x] Extraire `components/ViewRouter.tsx` (111 l) : switch des vues calculator/emoji/clipboard/files/games/changelog + loading + error + suggestions + ResultsList
- [x] Extraire `components/ResultContextMenu.tsx` (82 l) : actions launch / open location / copy path / properties
- [x] Extraire `utils.ts` (36 l) : `openSettingsWindow` + `getDirectoryPath`
- [ ] Introduire un store léger (zustand) — **reporté** à une PR séparée pour ne pas mélanger ajout de dep et refactor de structure
- [x] App.tsx = composant d'orchestration **197 lignes** (cible < 300)

**Critères :**
- App.tsx < 300 lignes
- Aucune régression fonctionnelle (tests M1.2 passent)
- Nouveaux hooks testables unitairement

---

### Milestone 2.2 — Robustesse backend (3-4 jours) ✅

**Tâches :**
- [x] **Type d'erreur Rust custom** : `VoltError` enrichi avec `#[derive(Serialize)]` + `#[serde(tag = "kind", content = "message", rename_all = "camelCase")]` → côté TS, le frontend reçoit `{ kind: 'notFound', message: '...' }`. Ajout de `From<std::io::Error>` (route smart vers `NotFound`/`PermissionDenied`/`FileSystem`), `From<serde_json::Error>`, `From<tauri::Error>`, `From<String>`, `From<&str>`. **Tous les Tauri commands** dans `src-tauri/src/commands/*.rs` (~73 commands sur 13 fichiers) migrés de `Result<T, String>` à `VoltResult<T>`. Sites restants : 5 helpers internes plate-forme-spécifiques (`scan_applications_{windows,macos,linux}`, `scan_directory_recursive`, `scan_shortcuts`) qui ne traversent pas la frontière FFI et sont wrappés au call site. Type discriminé exposé côté TS dans `src/shared/types/common.types.ts` avec un type guard `isVoltError`.
- [x] **CI gates** : `cargo fmt --check` + `cargo clippy --all-features --all-targets -- -D warnings` ajoutés dans `.github/workflows/check.yml` (avec `components: rustfmt, clippy` sur `dtolnay/rust-toolchain@stable`).
- [x] **Fix warnings clippy** révélés : un seul (`io_other_error` dans un test → `Error::other` au lieu de `Error::new(ErrorKind::Other, ...)`). Le repo entier passe `clippy -D warnings` clean.
- [x] **Dead code cleanup** : `file_history.rs` → 3 fonctions supprimées (`get_frequent`, `remove`, `count`), 1 wired (`clear` → nouveau Tauri command `clear_file_history`). `indexer/search.rs` → suppression du `fuzzy_match` orphelin (doublon de `utils/matching.rs`). `core/error.rs` → suppression de `string_err_to_volt_result` devenu inutile après la migration. Aucun `#[allow(dead_code)]` restant sauf le `LogGuard` (drop intentionnel).
- [x] **Game scanners** : audit révèle que **les 7 scanners sont déjà fonctionnels** (la roadmap était périmée — aucun n'était stub). L'agent a refocus sur observabilité + testabilité : extraction de helpers purs pour parsing JSON / package names / publisher filters, ajout de `tracing::{debug,warn}`, fix d'un bug Xbox launch URI (`shell:AppsFolder\<folder-name>` ne marche jamais — folder names ≠ PackageFamilyNames), 22 nouveaux tests unitaires sur les helpers extraits. TODOs documentés en in-source : Xbox PFN resolution + GOG SQLite database scan.

**Critères :**
- `cargo clippy -- -D warnings` vert ✓
- `cargo fmt --check` vert ✓
- Frontend type-safe sur les erreurs Tauri (discriminated union exposé) ✓
- **113 tests Rust** (départ M2.2 : 88, gain : +25) ✓
- **130 tests frontend** (inchangé) ✓

**Note M2.1 → M2.2 :** la migration `console.error → logger.error` faite en M1.4 simplifie ce critère — les sites sont déjà centralisés, il ne reste qu'à brancher un toast UI sur `logger.error` ou un wrapper dédié.

**Reportés en follow-up :**
- Brancher un toast contextuel sur `logger.error` côté frontend (UI work, pas backend)
- Migrer les modules internes (`plugins/`, `launcher/`, `indexer/`, `utils/`) de `Result<_, String>` à `VoltError` — actuellement wrappés au call site, fonctionnellement OK mais pas DRY
- Xbox : résoudre `PackageFamilyName` via `Get-AppxPackage` ou `MicrosoftGame.config` pour les jeux trouvés via directory scan
- GOG : implémenter `scan_from_database` (lecture SQLite) — registry path déjà couvert

---

### Milestone 2.3 — Accessibilité & UX polish (2-4 jours)

**Tâches :**
- [ ] ResultsList en pattern `role="listbox"` + `role="option"` avec `aria-activedescendant`
- [ ] Focus trap dans `Modal` et `SettingsModal` (Tab ne doit pas sortir)
- [ ] ARIA live region pour annoncer "N results found" après recherche
- [ ] Help dialog intégré (F1 ou `?`) listant les raccourcis au lieu d'ouvrir doc externe
- [ ] Vérifier contraste WCAG AA sur thème light + dark
- [ ] Indicateur visuel de chargement discret pendant `start_indexing` (aujourd'hui silencieux)

**Critères :**
- Audit Lighthouse/axe : 0 erreur a11y critique
- Navigation complète au clavier testée (Tab, Shift+Tab, flèches, Enter, Escape)

---

## 🏗️ Phase 3 — Platform & Extensibility (v1.1 → v1.5) — ~5-8 semaines

**Objectif :** Donner à Volt les fondations techniques pour scaler au-delà de l'usage personnel.

### Milestone 3.1 — Index persistant + incrémental (5-8 jours)

**But :** Plus de rescan complet au démarrage. Support de dossiers géants (>100k fichiers) sans bloquer.

**Tâches Rust :**
- [ ] Backend SQLite (réutiliser `rusqlite` déjà en dep pour `file_history.db`) pour l'index fichiers : table `files(path, name, extension, size, modified_at, indexed_at, category)`
- [ ] Migration auto au démarrage si ancien format détecté
- [ ] File watcher incrémental via `notify` crate : detect create/modify/delete et patch l'index
- [ ] Commande `invalidate_index()` pour rebuild manuel depuis Settings
- [ ] Métriques : `get_index_stats()` enrichie avec `last_full_scan`, `indexed_count`, `pending_updates`

**Tâches Frontend :**
- [ ] Settings > Indexing : afficher taille DB + dernière mise à jour + bouton "Rebuild"
- [ ] Toast discret au premier démarrage après install ("Indexing in background... N files")

**Critères :**
- Démarrage app avec 50k fichiers indexés < 500 ms (cold start)
- Création d'un fichier dans un dossier surveillé → recherche le trouve en < 2 s
- DB survit à restart/crash

---

### Milestone 3.2 — External plugin loader (6-10 jours)

**But :** Fermer le gap entre les docs plugins (qui promettent `~/.volt/plugins/`) et l'implémentation (stub).

**Design :**
- Plugins TypeScript compilés en JS (`.volt-plugin` = dossier avec `manifest.json` + `index.js` + assets)
- Manifest : `id`, `name`, `version`, `entry`, `volt-api-version`, `permissions` (network, fs, clipboard), `hash` (sha256 du bundle)
- Runtime : sandbox JS via Web Worker ou iframe isolée avec postMessage API
- Pas de WASM ni de DLL dynamique (trop de surface de sécurité)

**Tâches Backend :**
- [ ] Implémenter `plugins/loader.rs::load_from_path()` : lire manifest, valider signature/hash, vérifier compatibilité version
- [ ] Permission model : au load, demander confirmation utilisateur pour les permissions non-default
- [ ] Storage : chaque plugin a son propre dossier `app_data_dir/plugins/{id}/` pour data persistante

**Tâches Frontend :**
- [ ] Worker runtime (`features/extensions/runtime/worker.ts`) qui charge le bundle JS et expose l'API `VoltPluginAPI` via postMessage
- [ ] Timeout et isolation : un plugin qui plante ne casse pas l'app (déjà le cas via registry, à tester)
- [ ] UI : Settings > Extensions liste les plugins externes avec toggle enable/disable, bouton "Open folder", "Check for updates"

**Critères :**
- Charger un plugin externe depuis un dossier sans recompiler Volt
- Plugin peut : lire query, retourner `PluginResult[]`, appeler `executeAction`, accéder à son propre storage
- Plugin ne peut pas : lire d'autres dossiers, lancer de processus (sauf permission explicite)
- Fonctionne avec un plugin exemple `hello-world-plugin/` distribué dans `examples/`

---

### Milestone 3.3 — Extension registry + marketplace UI (4-6 jours)

**Dépend de :** M3.2 (loader fonctionnel)

**Tâches Backend (hors app Volt) :**
- [ ] Registry simple : fichier JSON statique hébergé sur GitHub Pages (schema déjà défini dans `EXTENSION_REGISTRY_TEMPLATE.json`)
- [ ] Process de publication : PR sur le repo registry avec manifest + lien vers release GitHub
- [ ] Workflow de vérification : CI qui valide le manifest + teste l'install sur une VM

**Tâches Frontend :**
- [ ] `fetch_extension_registry` commande Rust (déjà présent) → lit le JSON
- [ ] Settings > Extensions > Store : liste, recherche, install/uninstall, update checker
- [ ] Affichage du compte d'étoiles, description, auteur, permissions demandées

**Critères :**
- Un utilisateur peut : chercher un plugin, cliquer install, l'utiliser sans redémarrer
- Un auteur peut : publier un plugin via PR
- Auto-update : toast quand une version plus récente d'un plugin installé est dispo

---

## ✨ Phase 4 — Features & Ecosystem (v1.5+) — backlog priorisé

**Objectif :** Se différencier d'Alfred/Raycast/PowerToys Run. Ordre négociable selon feedback utilisateurs.

### 4.1 — Recherche avancée (priorité haute)

- [ ] **Frecency scoring** : mélanger `startsWith`/`contains`/`fuzzy` avec `last_used` + `usage_count` (données déjà trackées dans `file_history.db` et `launcher/history`)
- [ ] **Préfixes de scope** : `f:` pour files, `a:` pour apps, `!` pour plugin trigger forcé
- [ ] **Opérateurs** : `ext:pdf`, `in:~/Documents`, `size:>10mb`, `modified:<7d`
- [ ] **Résultats prédictifs** : afficher top suggestions avant frappe (basé sur frecency)

### 4.2 — Power user features (priorité moyenne)

- [ ] **Clipboard history** (plugin clipboard existe mais incomplet) : pin, search, redaction des mots de passe
- [ ] **Snippets** : triggers rapides → texte/commande pré-définie
- [ ] **Bookmarks / favoris épinglés** en tête de liste
- [ ] **Shell commands** : préfixe `>` pour exécuter une commande shell (`>git status`) et voir le résultat inline
- [ ] **Preview panel** : latéral, affiche contenu fichier (texte, image, PDF)
- [ ] **Onboarding** : premier démarrage → tour guidé de 3 écrans (hotkey, indexing, plugins)

### 4.3 — Intégrations OS (priorité variable)

- [ ] Linux : support Wayland propre (aujourd'hui X11 implicite)
- [ ] macOS : intégration Spotlight (option pour piggyback sur l'index système)
- [ ] Windows : alternative au scan custom via Windows Search Index
- [ ] Protocoles custom : `volt://search?q=chrome` pour intégrations externes

### 4.4 — Thèmes custom (priorité basse)

- [ ] Export/import de thème via JSON (tokens CSS variables)
- [ ] UI d'édition de thème dans Settings
- [ ] Marketplace thèmes (suit M3.3)

---

## 📊 Timeline estimée

| Phase | Durée | Cumul (temps partiel ~3h/j) |
|-------|-------|------------------------------|
| Phase 1 (ship-ready) | 3 semaines | 3 sem |
| Phase 2 (quality) | 3-4 semaines | 6-7 sem |
| Phase 3 (platform) | 5-8 semaines | 11-15 sem |
| Phase 4 (features) | Continu | — |

**Jalon 1.0 :** fin Phase 1 (~3 semaines)
**Jalon 1.5 :** fin Phase 3 (~3-4 mois)
**Jalon 2.0 :** après un cycle complet de Phase 4 (~6-8 mois)

---

## 🧭 Principes de priorisation

1. **Stabilité avant features** : si un bug bloque le flow principal (search → launch), il passe avant tout milestone.
2. **Pas de feature sans test** : à partir de M1.2, tout nouveau code vient avec au moins un test.
3. **Pas de refactor spéculatif** : les refactors servent une feature concrète (ex : M2.1 débloque M3.x).
4. **Les docs suivent le code** : à chaque milestone terminé, mettre à jour `docs/` + `CHANGELOG.md` + `public/changelog.json`.
5. **Release early** : une petite release (patch) toutes les 2-3 semaines vaut mieux qu'une grosse tous les 3 mois.

---

## 🔗 Liens utiles

- Architecture technique : [../architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md)
- Plan historique (M0-M5) : [./IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
- CI/CD : [./CICD.md](./CICD.md)
- Distribution : [./DISTRIBUTION.md](./DISTRIBUTION.md)
- Plugin development : [../plugins/DEVELOPMENT.md](../plugins/DEVELOPMENT.md)

---

_Document vivant — mettre à jour à chaque fin de milestone. Les estimations sont des ordres de grandeur, pas des engagements._
