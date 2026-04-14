# Volt — Roadmap

**Version actuelle :** `0.0.2` &nbsp;•&nbsp; **Dernière mise à jour :** 2026-04-14 &nbsp;•&nbsp; **Statut :** P1 finalisation (M1.1 ✅ · M1.2 ✅ · M1.3 🟡 blocage certs · M1.4 ✅) | **ALERTE :** Audit 2026-04-14 révèle Phase 3 & 4 déjà 90%+ implémentées

> Document vivant. Les milestones sont groupés en 4 phases. Chaque milestone liste un **but**, des **tâches concrètes** (avec fichiers), des **critères d'acceptation** et une **estimation**.
>
> L'ancien plan (`IMPLEMENTATION_PLAN.md`) reste le journal historique (M0 → M5 complétés). Cette roadmap couvre ce qui reste pour atteindre 1.0 et au-delà.

---

## 📸 État actuel (audit 2026-04-14)

### Ce qui marche déjà ✅

**Phase 1 (fondation):**
- ✅ Core flow : scan apps → recherche fuzzy → launch, multi-plateforme (Windows/macOS/Linux)
- ✅ Indexation fichiers : **SQLite persistent + file watcher incrémental** (database.rs, watcher.rs)
- ✅ Plugins builtin (11 frontend + 3 backend) : calculator, emoji-picker, timer, websearch, systemcommands, systemmonitor, games, steam, clipboard, **snippets**, **preview**
- ✅ Settings : 8 catégories, hotkey configurable, autostart, 9 positions fenêtre
- ✅ Auto-updater : signature minisign, GitHub Releases, end-to-end
- ✅ CI/CD : matrice W/macOS(Intel+ARM)/Linux, release pipeline, bundles
- ✅ Logging : tracing + rolling daily logs, 91+ sites `println!` → `tracing`, logger.ts frontend

**Phase 2 (qualité):**
- ✅ Tests : 130+ frontend (vitest), 113+ backend (cargo test)
- ✅ App.tsx refactor : 1090 → 197 lignes, hooks extraits
- ✅ VoltError type : discriminated union, error handling
- ✅ CI gates : `cargo fmt --check`, `cargo clippy -D warnings`

**Phase 3 (extensibilité) — 95% FAIT:**
- ✅ **Extension system complet** : loader + worker sandbox + permission model + consent UI
  - 14 Tauri commands (install, uninstall, toggle, update, registry fetch, dev mode, etc.)
  - Web Worker 500ms timeout + Sucrase transpilation
  - Keywords + prefix matching (canHandle déclaratif)
  - Permission enforcement (clipboard, network, notifications)
- ✅ **Index persistant** : SQLite database.rs + watcher.rs incrémental
  - `start_file_watcher`, `stop_file_watcher`, `invalidate_index`, `get_db_index_stats`
  - Auto-migration, 100ms debounce, incremental updates
- 🟡 **Registry marketplace UI** : fetch_extension_registry wired, UI à polish

**Phase 4 (power features) — 80% FAIT:**
- ✅ Snippets : 6 commands + builtin plugin + `{date}`, `{time}`, `{datetime}`, `{clipboard}`, `{random}` + JSON import/export
- ✅ Preview panel : `get_file_preview` (text/image/folder), Ctrl+P toggle, window resize 800→1100px
- ✅ Frecency scoring : launch_count × recency_decay, predictive suggestions, `search_applications_frecency`
- ✅ Power operators : ext:, in:, size:, modified: parsed by queryParser.ts
- ✅ Results grouping : Applications, Commands, Games, Files sections
- ✅ Clipboard history : 9 commands, core fonctionnel
- ✅ Games & Steam : 7 platforms (Steam, Epic, GOG, Xbox, EA, Ubisoft, Riot)

### Ce qu'il NE reste que 🚧

- **M1.3 Code signing** : Windows Authenticode + macOS Developer ID certs (bloqué par achat externe ~340 €/an)
- **M1.3 Test CSP en prod** : `bun tauri build` + vérifier DevTools console
- **M1.3 Test fresh install** : Windows + macOS vierges → SmartScreen/Gatekeeper absent
- **M2.3 Accessibilité** : ARIA patterns, focus trap, live regions (2-4 jours, ne bloque pas 1.0)
- **M3.3 Registry marketplace UI** : polish + ratings/reviews (1-2 semaines, post-1.0 OK)

### Gaps critiques restants 🚧

| Zone | Statut | Détail |
|------|--------|--------|
| **Code signing** | ❌ BLOQUANT | Windows Authenticode + macOS notarization nécessaires (~340 €/an) |
| **CSP en prod** | ⚠️ À tester | Policy stricte ajoutée, à vérifier `bun tauri build` + DevTools |
| **Accessibilité** | 🟡 Optionnel | ARIA patterns + focus trap (2-4 jours, post-1.0 OK) |
| **Marketplace UI** | 🟡 Optionnel | Registry fetch wired, UI à polish (1-2 semaines, post-1.0 OK) |

**Problèmes RÉSOLUS depuis l'audit précédent :**
- ✅ Tests : 130+ frontend, 113+ backend
- ✅ CSP : policy stricte dans tauri.conf.json
- ✅ Version sync : script `bun run sync-version` + `bun run check-version`
- ✅ Index fichiers : SQLite persistent + watcher incrémental (database.rs, watcher.rs)
- ✅ Extension loader : **complètement implémenté** (pas un stub!)
- ✅ CI gates : `cargo fmt --check` + `cargo clippy -D warnings` ajoutés
- ✅ App.tsx : refactorisé 1090 → 197 lignes
- ✅ Logging : tracing + 91+ sites migrés de println! vers tracing

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

### ✅ Milestone 1.4 — Logging & observabilité de base (TERMINÉ)

**But :** Savoir ce qui se passe en production sans attacher un debugger.

**Tâches Rust (COMPLÉTÉES) :**
- [x] Initialiser `tracing` + `tracing-subscriber` + `tracing-appender` dans `lib.rs::run()`
- [x] Remplacer `println!`/`eprintln!` par `tracing::{info, warn, error, debug}` (91 sites migrés)
- [x] Fichier log rotatif quotidien `app_data_dir/logs/volt.log`
- [x] Commande Tauri `get_log_file_path()` exposée + wired

**Tâches Frontend (COMPLÉTÉES) :**
- [x] `src/shared/utils/logger.ts` — niveaux info/warn/error/debug, relai backend
- [x] **153 sites `console.error` → `logger.error`**
- [x] Settings → About : boutons "Open logs folder" + "Copy diagnostics"

**Critères validés ✓**
- En dev : logs structurés console (configurable via `RUST_LOG`)
- En prod : fichier log rotatif accessible depuis Settings
- Support bug report : "Copy diagnostics" exporte version + OS + log path

---

### 🚀 Release 1.0.0 — READY (bloqué par certs)

**Checklist de release :**
- [x] M1.1 cleanup ✓
- [x] M1.2 tests ✓
- 🟡 M1.3 code signing (bloqué par achat certs)
- [x] M1.4 logging ✓
- [x] M2.1 refactor ✓
- [x] M2.2 robustesse ✓
- 🟡 M2.3 accessibilité (optionnel pour 1.0, peut être 1.0.1)
- [x] M3.1 index persistant ✓
- [x] M3.2 extension loader ✓
- 🟡 M3.3 registry UI (optionnel pour 1.0, peut être 1.0.1)
- [x] Phase 4 features ✓

**Avant tag `v1.0.0` :**
- [ ] Acquérir certs Windows + macOS (bloquant)
- [ ] Intégrer certs dans CI/CD `.github/workflows/release.yml`
- [ ] Test CSP en prod : `bun tauri build` + vérifier console DevTools
- [ ] Test fresh install Windows 11 vierge → aucun SmartScreen
- [ ] Test fresh install macOS → passe Gatekeeper
- [ ] Test fresh install Ubuntu → lance sans erreurs
- [ ] Test auto-update 0.0.2 → 1.0.0
- [ ] Update `public/changelog.json`
- [ ] Update README.md avec v1.0.0 announcement

---

## 🧹 Phase 2 — Quality & Polish (v1.0 & v1.0.1)

**Objectif :** Rendre la codebase agréable à maintenir et l'UX irréprochable.

### ✅ Milestone 2.1 — Refactor App.tsx (TERMINÉ)

**But :** Découper `src/app/App.tsx` de 1090 → 197 lignes.

**Complété ✓**
- [x] Extraction hooks : `useSearchPipeline`, `useAppLifecycle`, `useGlobalHotkey`, `useResultActions`
- [x] Extraction composants : `ViewRouter`, `ResultContextMenu`
- [x] App.tsx = 197 lignes (cible < 300) ✓

---

### ✅ Milestone 2.2 — Robustesse backend (TERMINÉ)

**Complété ✓**
- [x] `VoltError` discriminated union + tous commands migrés
- [x] CI gates : `cargo fmt --check` + `cargo clippy -D warnings`
- [x] **130 tests frontend**, **113 tests Rust**
- [x] Game scanners : 7 platforms fonctionnels + 22 tests

---

### 🟡 Milestone 2.3 — Accessibilité & UX polish (POST-1.0 — optionnel)

**Tâches :**
- [ ] ResultsList ARIA pattern (`role="listbox"` + `aria-activedescendant`)
- [ ] Focus trap dans Modal + SettingsModal
- [ ] Live region pour "N results found"
- [ ] Help dialog F1 intégré
- [ ] Contraste WCAG AA light + dark
- [ ] Indicateur chargement discret

**Estimation:** 2-4 jours, peut être fait en v1.0.1

**Priorité :** Peut être retardé après 1.0 sans impact utilisateur

---

## 🏗️ Phase 3 — Platform & Extensibility — ✅ **95% FAIT**

**Objectif :** Donner à Volt les fondations techniques pour scaler au-delà de l'usage personnel.

### ✅ Milestone 3.1 — Index persistant + incrémental (TERMINÉ)

**But :** Plus de rescan complet au démarrage. Support de dossiers géants (>100k fichiers) sans bloquer.

**Implémentation complète ✓**
- [x] Backend SQLite (`src-tauri/src/indexer/database.rs`) avec table `files(path, name, extension, size, modified_at, indexed_at, category)`
- [x] File watcher incrémental (`src-tauri/src/indexer/watcher.rs`) via `notify` crate : create/modify/delete detection, 100ms debounce
- [x] Commandes Tauri :
  - `start_file_watcher` / `stop_file_watcher` — contrôle watcher
  - `invalidate_index()` — rebuild manuel
  - `get_db_index_stats()` — statistiques (db_size, indexed_count, last_full_scan, is_watching)
- [x] Frontend Settings > Indexing : affiche stats DB + bouton "Rebuild"

**Critères validés ✓**
- Cold start avec 50k fichiers indexés < 500ms ✓
- Création fichier → trouvé en recherche < 2s ✓
- DB survit restart/crash ✓

---

### ✅ Milestone 3.2 — External plugin loader (TERMINÉ — 95%)

**But :** Charge extensions externes dynamiquement depuis filesystem.

**Implémentation complète ✓**
- [x] Backend (`src-tauri/src/commands/extensions.rs` — 14 commandes) :
  - `install_extension` — télécharge + installe
  - `uninstall_extension` — supprime
  - `toggle_extension` — active/désactive
  - `update_extension` — applique update
  - `update_extension_permissions` — consent flow
  - `get_enabled_extensions_sources` — sources pour loader
  - Dev extensions support : `get_dev_extensions`, `link_dev_extension`, `unlink_dev_extension`, `toggle_dev_extension`

- [x] Frontend (`src/features/extensions/`) :
  - `ExtensionLoader` (`loader/index.ts`) — charge extensions dynamiquement
  - `WorkerPlugin` (`loader/worker-sandbox.ts`) — Web Worker sandbox 500ms timeout, crashproof
  - `PermissionDialog` (`components/PermissionDialog.tsx`) — consent UI
  - `ExtensionsStore` (`components/ExtensionsStore.tsx`) — marketplace UI
  - Worker bootstrap (`loader/worker-bootstrap.ts`) — Sucrase transpilation

- [x] Manifest support :
  - Keywords + prefix matching (canHandle déclaratif)
  - Permissions enforcement (clipboard, network, notifications)
  - Entry point resolution (main field)
  - Version compatibility check

**Critères validés ✓**
- Charger extension externe sans recompiler ✓
- Plugin sandbox : crash isolé ✓
- Permissions enforcement : clipboard, network, notifications ✓
- Dev mode fonctionnel ✓

**Reste :**
- Publication CLI (`volt-plugin publish`) — optionnel pour v1.0

---

### 🟡 Milestone 3.3 — Extension registry + marketplace UI (PARTIELLEMENT — 60%)

**But :** Catalogue centralisé d'extensions.

**Implémenté ✓**
- [x] Backend : `fetch_extension_registry` command (récupère JSON registry)
- [x] Extension metadata : icon, author, description, license, repository
- [x] Check for updates : `check_extension_updates` command

**À faire 🟡**
- [ ] Registry JSON publication workflow (GitHub Pages)
- [ ] Settings > Extensions > Store : UI polish (search, ratings, auto-update toast)
- [ ] Extension reviews/ratings backend

**Estimation:** 1-2 semaines après 1.0

**Critères pour v1.0.1 ✓**
- Utilisateur peut installer extension via store sans redémarrer
- Auto-update toast quand nouvelle version disponible

---

## ✨ Phase 4 — Features & Ecosystem — ✅ **80% IMPLÉMENTÉ EN v0.0.2**

**Objectif :** Se différencier d'Alfred/Raycast/PowerToys Run.

### 4.1 — Recherche avancée — ✅ FAIT

- [x] **Frecency scoring** : `launch_count × recency_decay` (backend + `search_applications_frecency` command)
- [x] **Résultats prédictifs** : empty query affiche top suggestions basées sur frecency
- [x] **Opérateurs** : `ext:pdf`, `in:~/Documents`, `size:>10mb`, `modified:<7d`
  - Parser : `src/shared/utils/queryParser.ts`
  - Backend : `search_files_advanced` command
- [x] **Groupage résultats** : Applications, Commands, Games, Files sections + scoring

### 4.2 — Power user features — ✅ LARGEMENT FAIT

- [x] **Snippets** : 
  - Backend (`commands/snippets.rs` — 6 commands : get, create, update, delete, import, export)
  - Frontend plugin (`features/plugins/builtin/snippets/`)
  - Variables : `{date}`, `{time}`, `{datetime}`, `{clipboard}`, `{random}` ✓
  - Trigger : `;` prefix dans search ✓
  - Storage : JSON + import/export ✓

- [x] **Preview panel** :
  - Command : `get_file_preview` (text/image/folder)
  - UI: `Ctrl+P` toggle, window resize 800→1100px
  - Content : first 2KB text (monospace), image rendering, folder listing

- [x] **Clipboard history** :
  - Backend (`commands/clipboard.rs` — 9 commands)
  - Pin, search, toggle, delete, clear, copy-to-clipboard
  - Core fonctionnel, UI à améliorer

- [x] **Games & Steam** :
  - Scanners implémentés : Steam, Epic, GOG, Xbox, EA, Ubisoft, Riot (7 platforms)
  - Commands : `get_all_games`, `search_games`, `launch_game`, `rescan_all_games`, etc.

- 🟡 **Shell commands** (préfixe `>`) : parcellaire, peut être amélioré
- 🟡 **Bookmarks / favoris épinglés** : peut être ajouté via snippets
- ⏳ **Onboarding** : tour guidé (optionnel, post-1.0)

### 4.3 — Intégrations OS (priorité variable)

- 🟡 Linux : support Wayland (amélioration, post-1.0)
- 🟡 macOS : intégration Spotlight (amélioration, post-1.0)
- 🟡 Windows : Windows Search Index as alternative (improvement, post-1.0)
- 🟡 Protocoles custom : `volt://search?q=...` (future, post-1.0)

### 4.4 — Thèmes custom (priorité basse)

- [ ] Export/import de thème via JSON
- [ ] UI d'édition de thème dans Settings
- [ ] Marketplace thèmes (suit M3.3, post-1.0)

---

## 📊 Timeline révisée (2026-04-14)

Basé sur audit réel : Phase 3 & 4 déjà 80-95% implémentées.

| Jalon | Contenu | Bloquants | Estimation |
|-------|---------|-----------|-----------|
| **v1.0.0** | Phase 1→4 feature-complete | Code signing cert (~340 €) + CSP test | **Fin avril 2026** |
| **v1.0.1** | M2.3 (accessibilité) + M3.3 UI polish | Aucun | **Mai 2026** |
| **v1.5.0** | Wayland, Spotlight, thèmes custom | User feedback | **Juin 2026+** |

**Actions immédiatement nécessaires :**
1. Acquérir Windows Authenticode + macOS Developer ID certs (~340 €/an)
2. Intégrer certs dans CI/CD + tester code signing
3. Test CSP en prod : `bun tauri build` + vérifier DevTools console
4. Test fresh install Windows + macOS vierges

---

## 🧭 Principes de priorisation

1. **Stabilité avant features** : si un bug bloque le flow principal (search → launch), il passe avant tout milestone.
2. **Pas de feature sans test** : à partir de M1.2, tout nouveau code vient avec au moins un test.
3. **Pas de refactor spéculatif** : les refactors servent une feature concrète (ex : M2.1 débloque M3.x).
4. **Les docs suivent le code** : à chaque milestone terminé, mettre à jour `docs/` + `CHANGELOG.md` + `public/changelog.json`.
5. **Release early** : une petite release (patch) toutes les 2-3 semaines vaut mieux qu'une grosse tous les 3 mois.

---

## 🔗 Liens utiles

- **Audit codebase** : [../../AUDIT_REPORT.md](../../AUDIT_REPORT.md) — État réel vs roadmap (2026-04-14)
- Architecture technique : [../architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md)
- Plan historique (M0-M5) : [./IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
- CI/CD : [./CICD.md](./CICD.md)
- Distribution : [./DISTRIBUTION.md](./DISTRIBUTION.md)
- Plugin development : [../plugins/DEVELOPMENT.md](../plugins/DEVELOPMENT.md)
- Code signing setup : [./SIGNING_SETUP.md](./SIGNING_SETUP.md)

---

## ⚡ Actions immédiatement nécessaires pour v1.0.0

1. **Acquérir certificats** (~340 €/an) :
   - Windows Authenticode : Sectigo OV (~250 €/an) ou Certum Open Source (~25 €/an)
   - macOS Developer ID : Apple Developer Program (~99 $/an)
   - Voir [SIGNING_SETUP.md](./SIGNING_SETUP.md) pour détails

2. **Intégrer certs dans CI/CD** :
   - Ajouter secrets GitHub : `WINDOWS_CERTIFICATE`, `APPLE_CERTIFICATE`, etc.
   - Décommenter bloc `apple-actions/import-codesign-certs` dans `.github/workflows/release.yml`
   - Tester build signé : `bun tauri build`

3. **Tester CSP en prod** :
   - Build production : `bun tauri build`
   - Ouvrir DevTools
   - Vérifier console : aucune violation CSP

4. **Test fresh install** :
   - VM Windows 11 vierge → lancer installer MSI → aucun SmartScreen
   - VM macOS récent → lancer DMG → passe Gatekeeper
   - VM Ubuntu → lancer AppImage → lance sans erreurs

5. **Tag et release** :
   - `git tag v1.0.0`
   - `git push origin v1.0.0`
   - CI auto-génère bundles signés
   - Update `public/changelog.json`
   - Announcement README.md

---

_Document vivant — mettre à jour à chaque fin de milestone. **Dernière révision :** 2026-04-14 (audit complet : Phase 3 & 4 = 90%+ fait)._
