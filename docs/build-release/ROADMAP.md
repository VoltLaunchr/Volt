# Volt — Roadmap

**Version actuelle :** `0.0.4` &nbsp;•&nbsp; **Derniere mise a jour :** 2026-04-14 &nbsp;•&nbsp; **Statut :** P1 finalisation (M1.1 ✅ · M1.2 ✅ · M1.3 🟡 blocage certs · M1.4 ✅) | Phase 2-4 ✅ completes

> Document vivant. Les milestones sont groupes en 4 phases. Chaque milestone liste un **but**, des **taches concretes** (avec fichiers), des **criteres d'acceptation** et une **estimation**.
>
> L'ancien plan (`IMPLEMENTATION_PLAN.md`) reste le journal historique (M0 → M5 completes). Cette roadmap couvre ce qui reste pour atteindre 1.0 et au-dela.

---

## Etat actuel (audit 2026-04-14)

### Ce qui marche ✅

**Phase 1 (fondation):**
- ✅ Core flow : scan apps → recherche fuzzy → launch, multi-plateforme (Windows/macOS/Linux)
- ✅ Indexation fichiers : **SQLite persistent + file watcher incremental** (database.rs, watcher.rs)
- ✅ Plugins builtin (11 frontend + 3 backend) : calculator, emoji-picker, timer, websearch, systemcommands, systemmonitor, games, steam, clipboard, snippets, preview
- ✅ Settings : 8 categories + panneau Integrations, hotkey configurable, autostart, 9 positions fenetre
- ✅ Auto-updater : signature minisign, GitHub Releases, end-to-end
- ✅ CI/CD : matrice W/macOS(Intel+ARM)/Linux, release pipeline, bundles
- ✅ Logging : tracing + rolling daily logs, 91+ sites `println!` → `tracing`, logger.ts frontend

**Phase 2 (qualite):**
- ✅ Tests : 166 frontend (vitest), 143 backend (cargo test)
- ✅ App.tsx refactor : 1090 → 197 lignes, hooks extraits
- ✅ VoltError type : discriminated union, error handling
- ✅ CI gates : `cargo fmt --check`, `cargo clippy -D warnings`
- ✅ Accessibilite : skip link, ARIA listbox, focus trap Modal, live region SearchBar, aria-describedby

**Phase 3 (extensibilite) — ✅ FAIT:**
- ✅ **Extension system complet** : loader + worker sandbox + permission model + consent UI
  - 14 Tauri commands (install, uninstall, toggle, update, registry fetch, dev mode, etc.)
  - Web Worker 500ms timeout + Sucrase transpilation
  - Keywords + prefix matching (canHandle declaratif)
  - Permission enforcement (clipboard, network, notifications)
- ✅ **Index persistant** : SQLite database.rs + watcher.rs incremental
- ✅ **Registry marketplace UI** : fetch_extension_registry wired, UI fonctionnelle

**Phase 4 (power features) — ✅ FAIT:**
- ✅ Snippets : 6 commands + builtin plugin + variables dynamiques + JSON import/export
- ✅ Preview panel : `get_file_preview` (text/image/folder), Ctrl+P toggle, window resize 800→1100px
- ✅ Frecency scoring : launch_count × recency_decay, predictive suggestions, `search_applications_frecency`
- ✅ Power operators : ext:, in:, size:, modified: parses par queryParser.ts
- ✅ Results grouping : Applications, Commands, Games, Files sections
- ✅ Clipboard history : 9 commands, core fonctionnel
- ✅ Games & Steam : 7 platforms (Steam, Epic, GOG, Xbox, EA, Ubisoft, Riot)
- ✅ **Integrations tierces** : OAuth GitHub/Notion, credentials chiffres, panneau Settings
- ✅ **i18n** : 2 langues (en/fr), 9 namespaces, plugins localises, detection locale OS
- ✅ **Performance** : batch IPC (search_all), scoring nucleo unifie, O(1) file clone, sync watcher cache
- ✅ **Qualite code** : type guards, safe invoke, constantes scoring centralisees, 3 TODOs resolus
- ✅ **Query-result binding** : record_search_selection pour apprentissage

### Ce qu'il NE reste que 🟧

- **M1.3 Code signing** : Windows Authenticode + macOS Developer ID certs (bloque par achat externe ~340 €/an)
- **M1.3 Test CSP en prod** : `bun tauri build` + verifier DevTools console
- **M1.3 Test fresh install** : Windows + macOS vierges → SmartScreen/Gatekeeper absent

### Gaps critiques restants 🟧

| Zone | Statut | Detail |
|------|--------|--------|
| **Code signing** | ❌ BLOQUANT | Windows Authenticode + macOS notarization necessaires (~340 €/an) |
| **CSP en prod** | ⚠️ A tester | Policy stricte ajoutee, a verifier `bun tauri build` + DevTools |
| **1 test Rust en echec** | ⚠️ A fixer | `test_calculate_match_score_nucleo_word_boundary_bonus` — assertion de scoring |

**Problemes RESOLUS depuis l'audit precedent :**
- ✅ Tests : 166 frontend, 143 backend (vs 130+/113+ avant)
- ✅ CSP : policy stricte dans tauri.conf.json
- ✅ Version sync : script `bun run sync-version` + `bun run check-version`
- ✅ Index fichiers : SQLite persistent + watcher incremental
- ✅ Extension loader : completement implemente avec worker sandbox
- ✅ CI gates : `cargo fmt --check` + `cargo clippy -D warnings`
- ✅ App.tsx : refactorise 1090 → 197 lignes
- ✅ Logging : tracing + 91+ sites migres
- ✅ Accessibilite : ResultsList listbox + aria-selected, focus trap Modal, skip link, live region
- ✅ i18n : systeme complet 2 langues
- ✅ Integrations : OAuth + credentials chiffres
- ✅ Performance : batch IPC, nucleo unifie, query-result binding

---

## Phase 1 — Path to 1.0 (ship-ready) — ~3 semaines

**Objectif :** rendre Volt installable et utilisable par des non-developpeurs sans avertissements systeme ni crashes non diagnostiques.

### ✅ Milestone 1.1 — Cleanup & dette immediate (termine 2026-04-12)

**But :** Supprimer les stubs morts et unifier les sources de verite avant d'ajouter quoi que ce soit.

**Realise :**
- [x] `src/shared/components/ui/SnowEffect.tsx` (0 octet) supprime
- [x] `src/features/onboarding/` (dossiers vides) supprime
- [x] **Bonus :** `src/features/settings/components/SettingsWindow.tsx` (1200+ lignes) supprime — doublon mort de `SettingsApp.tsx`, decouvert pendant l'audit. `SettingsWindow.css` renomme en `SettingsApp.css` et deplace au bon endroit. Barrel exports nettoyes.
- [x] Setting `showPreview` retire cote TypeScript et cote Rust
- [x] Script `scripts/sync-version.mjs` + `bun run sync-version` / `bun run check-version`
- [x] Pre-commit hook opt-in : `scripts/hooks/pre-commit` + `scripts/setup-hooks.mjs`

**Criteres valides :**
- ✅ `bunx tsc --noEmit` vert
- ✅ `cargo check` vert
- ✅ Plus aucun fichier a 0 octet dans `src/`
- ✅ `bun run sync-version` operationnel

---

### ✅ Milestone 1.2 — Fondation de tests (termine)

**But :** Poser le minimum viable de tests pour securiser les refactors a venir.

**Resultats :**
- **166 tests frontend** (cible : ≥ 20) ✓
- **143 tests Rust** (cible : ≥ 60) ✓
- CI execute `bun run test` + `cargo test` sur chaque PR ✓
- Coverage : plugin registry 100%, calculator > 80%, indexer search couvert

---

### 🟡 Milestone 1.3 — Code signing & securite release (partiel — pret a activer)

**But :** Eliminer les avertissements OS a l'installation et fermer les trous de securite evidents.

**Realise (sans dependance externe) :**
- [x] **CSP** : policy stricte dans `tauri.conf.json`
- [x] **Capabilities** : `desktop.json` supprime (doublon), `default.json` audite
- [x] **Scaffolding CI** : env vars Apple/Windows ajoutees dans `.github/workflows/release.yml`
- [x] **Doc complete** : [SIGNING_SETUP.md](./SIGNING_SETUP.md)

**Bloque par achat externe (hors scope dev) :**
- [ ] **Windows Authenticode** : cert a acheter (~250 €/an OV ou 25 €/an Certum Open Source)
- [ ] **macOS Developer ID + notarization** : inscription Apple Developer (~99 $/an)
- [ ] **Release de test signee** : v1.0-rc
- [ ] **Test fresh install** Windows 11 + macOS
- [ ] **Test CSP en prod** : `bun tauri build` + DevTools console

---

### ✅ Milestone 1.4 — Logging & observabilite de base (TERMINE)

**But :** Savoir ce qui se passe en production sans attacher un debugger.

**Complete ✓**
- [x] `tracing` + `tracing-subscriber` + `tracing-appender` initialises
- [x] 91+ sites `println!` → `tracing` migres
- [x] Fichier log rotatif quotidien
- [x] `get_log_file_path()` expose + Settings > About : "Open logs" + "Copy diagnostics"

---

### Release 1.0.0 — READY (bloque par certs)

**Checklist :**
- [x] M1.1 cleanup ✓
- [x] M1.2 tests ✓
- 🟡 M1.3 code signing (bloque par achat certs)
- [x] M1.4 logging ✓
- [x] M2.1 refactor ✓
- [x] M2.2 robustesse ✓
- [x] M2.3 accessibilite ✓
- [x] M3.1 index persistant ✓
- [x] M3.2 extension loader ✓
- [x] M3.3 registry UI ✓
- [x] Phase 4 features ✓

**Avant tag `v1.0.0` :**
- [ ] Acquerir certs Windows + macOS (bloquant)
- [ ] Integrer certs dans CI/CD
- [ ] Test CSP en prod
- [ ] Test fresh install Windows + macOS + Ubuntu
- [ ] Test auto-update 0.0.4 → 1.0.0
- [ ] Update `public/changelog.json`
- [ ] Update README.md

---

## Phase 2 — Quality & Polish ✅ COMPLETE (2026-04-13)

### ✅ Milestone 2.1 — Refactor App.tsx (TERMINE)

- [x] Extraction hooks : `useSearchPipeline`, `useAppLifecycle`, `useGlobalHotkey`, `useResultActions`
- [x] Extraction composants : `ViewRouter`, `ResultContextMenu`
- [x] App.tsx = 197 lignes (cible < 300) ✓

### ✅ Milestone 2.2 — Robustesse backend (TERMINE)

- [x] `VoltError` discriminated union + tous commands migres
- [x] CI gates : `cargo fmt --check` + `cargo clippy -D warnings`
- [x] 166 tests frontend, 143 tests Rust
- [x] Game scanners : 7 platforms fonctionnels

### ✅ Milestone 2.3 — Accessibilite (TERMINE)

- [x] ResultsList ARIA pattern (`role="listbox"` + `aria-activedescendant` + `aria-selected`)
- [x] Focus trap dans Modal (Tab/Shift+Tab cycle)
- [x] Live region SearchBar (`role="status"` + `aria-live="polite"`)
- [x] Skip link visible au focus
- [x] `aria-describedby` sur HotkeyCapture, folder picker, extensions
- [x] Contraste WCAG AA light + dark

---

## Phase 3 — Platform & Extensibility ✅ COMPLETE (2026-04-14)

### ✅ Milestone 3.1 — Index persistant + incremental (TERMINE)

- [x] SQLite (`indexer/database.rs`) avec table files
- [x] File watcher incremental (`indexer/watcher.rs`) via notify, 100ms debounce
- [x] Commandes : `start_file_watcher`, `stop_file_watcher`, `invalidate_index`, `get_db_index_stats`
- [x] Frontend Settings > Indexing : stats DB + bouton "Rebuild"

### ✅ Milestone 3.2 — External plugin loader (TERMINE)

- [x] Backend (`commands/extensions.rs` — 14 commandes)
- [x] Frontend (`features/extensions/`) : ExtensionLoader, WorkerPlugin, PermissionDialog, ExtensionsStore
- [x] Manifest : keywords + prefix matching, permissions enforcement, entry point, version compat
- [x] Worker sandbox : 500ms timeout, Sucrase transpilation, crash recovery

### ✅ Milestone 3.3 — Extension registry + marketplace UI (TERMINE)

- [x] Backend : `fetch_extension_registry` + `check_extension_updates`
- [x] Extension metadata : icon, author, description, license, repository
- [x] Settings > Extensions > Store : recherche, install, categories, enable/disable
- 🟡 Registry JSON publication workflow (GitHub Pages) — optionnel
- 🟡 Extension reviews/ratings backend — optionnel

---

## Phase 4 — Features & Ecosystem ✅ COMPLETE (2026-04-14)

### ✅ 4.1 — Recherche avancee

- [x] Frecency scoring + resultats predictifs
- [x] Operateurs power-user : ext:, in:, size:, modified:
- [x] Groupage resultats par section
- [x] Batch IPC : `search_all` (1 appel au lieu de 3)
- [x] Scoring unifie nucleo-matcher

### ✅ 4.2 — Power user features

- [x] Snippets : 6 commands + plugin + variables + import/export
- [x] Preview panel : Ctrl+P, text/image/folder, metadata
- [x] Clipboard history : 9 commands, pin, search
- [x] Games & Steam : 7 platforms, cache 5 min
- [x] Query-result binding : `record_search_selection`

### ✅ 4.3 — Integrations tierces (NOUVEAU)

- [x] Panneau Integrations Settings : GitHub, Notion
- [x] OAuth flow : browser → token → stockage chiffre
- [x] Backend : `commands/oauth.rs` + `commands/credentials.rs`
- [x] Frontend : `credentialsService.ts` + `IntegrationsPanel.tsx`
- [x] Token validation, visibility toggle, delete avec confirmation

### ✅ 4.4 — Internationalisation (NOUVEAU)

- [x] Systeme i18n : i18next + react-i18next
- [x] 2 langues : Anglais (en), Francais (fr)
- [x] 9 namespaces + plugins localises
- [x] Detection locale OS + fallback anglais

### ✅ 4.5 — Performance & qualite (NOUVEAU)

- [x] Batch IPC : commande `search_all` unifiee
- [x] O(1) file clone + sync watcher cache
- [x] Scoring nucleo unifie (fast paths + normalisation log)
- [x] Type guards centralises (`typeGuards.ts`)
- [x] Safe invoke wrapper (`safeInvoke.ts`)
- [x] Constantes scoring centralisees (`searchScoring.ts`)
- [x] 3 TODOs en suspens resolus

### A faire (post-2.0)

- Shell commands inline (prefixe `>`)
- Redaction automatique clipboard
- Deep links OAuth
- Token rotation
- Apprentissage des preferences (exploitation query-result binding)

---

## Phase 5 — Ecosystem (a venir)

### Themes custom
- Export/import JSON + editeur UI + marketplace

### Integrations OS natives (restant)
- Linux : support Wayland
- macOS : integration Spotlight

### i18n Phase 2
- Langues supplementaires (ES, DE, etc.)
- Contribution communautaire

### Protocoles custom
- `volt://search?q=...` + deep linking

### Sync settings cloud
- Opt-in, zero donnee par defaut

---

## Timeline revisee (2026-04-14)

| Jalon | Contenu | Bloquants | Estimation |
|-------|---------|-----------|-----------|
| **v1.0.0** | Phase 1-4 feature-complete | Code signing cert (~340 €) + CSP test | **Fin avril 2026** |
| **v1.0.1** | Bug fixes + polish | Retours utilisateurs | **Mai 2026** |
| **v2.0.0** | Phase 5 ecosystem | User feedback | **Juin 2026+** |

**Actions immediatement necessaires :**
1. Fixer le test Rust en echec (`test_calculate_match_score_nucleo_word_boundary_bonus`)
2. Acquerir Windows Authenticode + macOS Developer ID certs (~340 €/an)
3. Integrer certs dans CI/CD + tester code signing
4. Test CSP en prod : `bun tauri build` + verifier DevTools console
5. Test fresh install Windows + macOS vierges

---

## Principes de priorisation

1. **Stabilite avant features** : si un bug bloque le flow principal (search → launch), il passe avant tout milestone.
2. **Pas de feature sans test** : tout nouveau code vient avec au moins un test.
3. **Pas de refactor speculatif** : les refactors servent une feature concrete.
4. **Les docs suivent le code** : a chaque milestone termine, mettre a jour docs + changelog.
5. **Release early** : une petite release (patch) toutes les 2-3 semaines.

---

## Liens utiles

- Architecture technique : [../architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md)
- Plan historique (M0-M5) : [./IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
- CI/CD : [./CICD.md](./CICD.md)
- Distribution : [./DISTRIBUTION.md](./DISTRIBUTION.md)
- Plugin development : [../plugins/DEVELOPMENT.md](../plugins/DEVELOPMENT.md)
- Code signing setup : [./SIGNING_SETUP.md](./SIGNING_SETUP.md)
- Product roadmap : [../roadmap/PRODUCT_ROADMAP.md](../roadmap/PRODUCT_ROADMAP.md)

---

_Document vivant — mettre a jour a chaque fin de milestone. **Derniere revision :** 2026-04-14 (Phase 2-4 completes, Phase 1 bloquee certs)._
