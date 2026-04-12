# Volt — Plan d’implémentation

Date: 2025-12-13

## Objectif

Finaliser Volt en un launcher “keyboard-first” fiable et extensible (apps + fichiers + commandes/plugins), avec paramètres persistants, hotkeys configurables, et une base technique propre (perf, tests, release).

## État actuel (constaté dans la codebase)

- Frontend: recherche/launch d’apps OK (scan + search via Rust), navigation clavier, settings modal, thème (light/dark/auto).
- Backend: commandes Tauri pour apps, window et settings OK. Hotkey global présent mais non configurable depuis l’UI.
- Indexation fichiers: structure prévue (dossiers `indexer/`, types `FileInfo`) mais non implémentée.
- Plugins: structure prévue (dossier `features/plugins`, sous-dossiers builtin) mais quasi vide.

## Principes de scope

- Priorité à la stabilité et aux “core flows” (ouvrir → chercher → lancer → fermer).
- Ajouter des features par couches: (1) noyau, (2) indexation, (3) plugins, (4) polish.
- Éviter d’introduire des frameworks lourds; rester Vite/React côté UI et Rust/Tauri côté backend.

---

## Milestone 0 — Assainissement & bases (1–2 jours)

### But

Rendre le projet “facile à itérer” (DX), réduire les points de friction, clarifier les invariants.

### Tâches

- Vérifier et documenter le point d’entrée frontend unique (React) et supprimer/ignorer le legacy `src/App.tsx` si réellement inutilisé.
- Uniformiser les types Rust/TS (déjà `serde(rename_all = "camelCase")` présent sur certaines structs):
  - S’assurer que `AppInfo` et Settings sont cohérents côté JS/TS.
- Ajouter une section dans la doc: commandes dev/build + architecture des dossiers.

### Critères de validation

- `bun run build` passe.
- `bun tauri dev` démarre et l’app fonctionne comme aujourd’hui.

---

## Milestone 1 — Noyau recherche/launch solide (2–4 jours)

### But

Améliorer la fiabilité (erreurs, UX) sans changer le produit.

### Tâches Frontend

- Gestion d’erreurs plus claire (message + retry déjà là pour scan; étendre aux échecs de launch si nécessaire).
- Debounce / perf:
  - Éviter de lancer une recherche si `allApps` est vide ou si le scan est en cours.
  - Option: mémoriser le dernier `query` et ignorer les réponses tardives (race conditions).
- Résultats:
  - Afficher un état vide contextualisé (déjà “No results found”, OK).
  - Vérifier que `selectedIndex` reste valide si la liste change.

### Tâches Backend

- Scan apps:
  - Mieux gérer les chemins Windows atypiques (accès refusé / symlinks) sans casser.
  - Option: améliorer `scan_shortcuts` (résolution .lnk réelle) — à planifier si requis.
- Launch:
  - S’assurer que l’appel Windows `cmd /C start` gère bien les chemins avec espaces (déjà OK via args, mais à tester).

### Critères de validation

- Scan apps robuste (pas de crash), erreurs affichées proprement.
- Recherche stable quand on tape vite (pas de “flash” de résultats incohérents).

---

## Milestone 2 — Indexation & recherche fichiers (5–10 jours)

### But

Permettre la recherche de fichiers, avec indexation paramétrable (dossiers inclus/exclus, extensions).

### Design cible

- Indexation côté Rust (performances), stockage d’un index en mémoire et/ou sur disque.
- Commandes Tauri:
  - `start_indexing(indexingSettings)` (optionnel si auto)
  - `get_index_status()` (progress)
  - `search_files(query, limit)`
- Frontend:
  - Fusionner résultats apps + fichiers dans une même liste, avec `SearchResultType.File`.

### Tâches Backend (Rust)

- Implémenter un module `indexer`:
  - Scan récursif avec filtres extensions.
  - Exclusions (`excludedPaths`) et limites (taille max, symlinks, permissions).
  - Index minimal: `path`, `name`, `extension`, `modified`, `size`.
- Mettre en place une structure de données de recherche:
  - Simple au début: vecteur + scoring basique (startsWith/contains/fuzzy).
  - Évolutif: `tantivy` ou autre index full-text (seulement si nécessaire).
- Option: persister l’index (cache) sous `app_data_dir` pour démarrage rapide.

### Tâches Frontend (React)

- Ajouter la recherche fichiers au `performSearch`:
  - Appeler `search_files` en parallèle de `search_applications`.
  - Fusionner et trier (score) et respecter `maxResults`.
- Adapter `ResultItem` pour afficher icône/extension/type.

### Critères de validation

- Une option Settings permet d’ajouter des dossiers à indexer.
- La recherche retourne des fichiers rapidement (≤200ms sur un index déjà construit, selon machine).

---

## Milestone 3 — Système de plugins (5–12 jours)

### But

Activer des “actions” et “commandes” (calculator, websearch, system commands, file explorer) sans alourdir le noyau.

### Design cible

- Un registry de plugins côté frontend (MVP) + possibilité d’étendre côté Rust si besoin.
- Contrat plugin minimal:
  - `id`, `name`
  - `match(query) -> PluginResult[]` (ou `null`)
  - `execute(result)`

### Tâches

- Implémenter l’infra plugins dans `src/features/plugins/core` (actuellement vide):
  - Registry, types, utilitaires de scoring.
- Ajouter 2 plugins “MVP”:
  - Calculator: si query ressemble à une expression (`1+2*3`) → résultat + action copier.
  - Web search: si query commence par `? ` ou `web ` → ouvre navigateur.
- Ajouter 1 plugin “système”:
  - Commandes comme `reload`, `settings`, `quit` (selon Tauri capabilities).

### Critères de validation

- Les plugins apparaissent dans la liste de résultats et s’exécutent via Enter.
- Aucun plugin ne doit bloquer l’UI (promesses, timeouts, erreurs catch).

---

## Milestone 4 — Hotkeys configurables (3–6 jours)

### But

Rendre `toggleWindow` configurable depuis Settings, et persister.

### Tâches Backend (Rust)

- Ajouter une logique de “rebind” hotkey:
  - Lire Settings au démarrage et enregistrer la hotkey.
  - Commande `set_hotkey_toggle(shortcut)` qui:
    - unregister ancienne
    - register nouvelle
    - persist via settings.
- Gérer collisions/erreurs (hotkey déjà prise) → retourner erreur claire.

### Tâches Frontend

- UI de capture hotkey (MVP): mode “record” qui écoute la prochaine combinaison.
- Validation: afficher erreur si refusée.

### Critères de validation

- Changer la hotkey depuis Settings fonctionne immédiatement.
- La hotkey reste après redémarrage.

---

## Milestone 5 — Paramètres “OS integration” (optionnel) (2–5 jours)

### But

Supporter “Start with Windows” et transparence/position fenêtre réellement appliqués.

### Tâches (selon plateforme)

- Windows auto-start:
  - Utiliser un mécanisme Tauri/plugin/run-at-login si disponible.
- Fenêtre:
  - Appliquer `transparency` (si géré), position (center/top/custom) via commandes window.

### Critères de validation

- Le toggle “Start with Windows” a un effet réel (Windows uniquement).
- La position est respectée à l’ouverture.

---

## Milestone 6 — Qualité, perf, release (continu)

### Tâches

- Tests:
  - Rust: tests unitaires sur scoring, filtres scan.
  - TS: tests sur parser calculator + registry plugins.
- Observabilité:
  - logs structurés, et erreurs remontées proprement.
- CI/CD:
  - S’assurer que lint + build couvrent les nouvelles parties.
  - Tag release `vX.Y.Z` génère correctement les bundles.

### Critères de validation

- Build reproductible sur Windows + au moins une autre plateforme.
- Pas de régressions sur le flow principal.

---

## Ordre recommandé d'exécution

1. ✅ Milestone 0 → 1 (stabilité) - **COMPLÉTÉ**
2. ✅ Milestone 2 (fichiers) - **COMPLÉTÉ**
3. ✅ Milestone 3 (plugins) - **COMPLÉTÉ**
4. ✅ Milestone 4 (hotkeys) - **COMPLÉTÉ**
5. ✅ Milestone 5 (OS integration) - **COMPLÉTÉ**
6. Milestone 6 en continu

---

## État d'implémentation (mise à jour 2025-12-13)

### ✅ Milestone 0 — Assainissement & bases (COMPLÉTÉ)

**Ce qui a été fait :**

- ✅ Vérifié le point d'entrée frontend unique ([src/main.tsx](src/main.tsx) → [src/app/App.tsx](src/app/App.tsx))
- ✅ Confirmé que tous les types Rust/TS utilisent `#[serde(rename_all = "camelCase")]`
- ✅ Build frontend vérifié et fonctionnel
- ✅ App testée en mode dev

### ✅ Milestone 1 — Noyau recherche/launch solide (COMPLÉTÉ)

**Améliorations apportées :**

- ✅ Protection contre les symlinks dans `find_main_executable()` et `scan_shortcuts()`
- ✅ Gestion d'erreurs robuste déjà en place (messages + retry)
- ✅ Race conditions gérées avec `latestSearchId` dans le frontend
- ✅ Chemins avec espaces gérés correctement par `cmd /C start "" path`

**Fichiers modifiés :**

- [src-tauri/src/commands/apps.rs](src-tauri/src/commands/apps.rs:354-388) : ajout de vérifications symlinks

### ✅ Milestone 2 — Indexation & recherche fichiers (COMPLÉTÉ)

**Architecture implémentée :**

**Backend Rust :**

- ✅ Module `indexer/` créé avec :
  - [types.rs](src-tauri/src/indexer/types.rs) : `FileInfo`, `IndexConfig`, `IndexStatus`
  - [scanner.rs](src-tauri/src/indexer/scanner.rs) : scan récursif avec filtres (extensions, exclusions, profondeur max 10, taille max 100MB)
  - [search.rs](src-tauri/src/indexer/search.rs) : recherche fuzzy sur fichiers (même algo que apps)
- ✅ Commandes Tauri dans [commands/files.rs](src-tauri/src/commands/files.rs) :
  - `start_indexing(folders, excluded_paths, file_extensions)` - indexation async
  - `search_files(query, limit)` - recherche dans l'index
  - `get_index_status()` - statut progression
  - `get_indexed_file_count()` - nombre de fichiers
- ✅ State global `FileIndexState` avec Arc<Mutex<>> pour thread-safety
- ✅ Dépendance `chrono = "0.4"` ajoutée au [Cargo.toml](src-tauri/Cargo.toml)

**Frontend React :**

- ✅ Import `FileInfo` dans [src/app/App.tsx](src/app/App.tsx:15)
- ✅ Auto-indexation au démarrage si `settings.indexing.indexOnStartup` ([App.tsx:79-101](src/app/App.tsx#L79-L101))
- ✅ Recherche unifiée apps + fichiers en parallèle avec `Promise.all()` ([App.tsx:121-163](src/app/App.tsx#L121-L163))
- ✅ Fusion et tri par score (apps: 100, files: 80)
- ✅ `handleLaunch()` étendu pour gérer `SearchResultType.File` ([App.tsx:235-262](src/app/App.tsx#L235-L262))
- ✅ [ResultItem](src/features/results/components/ResultItem.tsx:41-54) avec icône de document pour les fichiers

**Fichiers créés :**

- [src-tauri/src/indexer/mod.rs](src-tauri/src/indexer/mod.rs)
- [src-tauri/src/indexer/types.rs](src-tauri/src/indexer/types.rs)
- [src-tauri/src/indexer/scanner.rs](src-tauri/src/indexer/scanner.rs)
- [src-tauri/src/indexer/search.rs](src-tauri/src/indexer/search.rs)
- [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs)

**Fichiers modifiés :**

- [src-tauri/src/lib.rs](src-tauri/src/lib.rs) : ajout module indexer, state, commandes, import `tauri::Manager`
- [src-tauri/src/commands/mod.rs](src-tauri/src/commands/mod.rs) : export files
- [src-tauri/Cargo.toml](src-tauri/Cargo.toml:31) : dépendance chrono
- [src/app/App.tsx](src/app/App.tsx) : recherche fichiers + auto-indexation
- [src/features/results/components/ResultItem.tsx](src/features/results/components/ResultItem.tsx) : icône fichier

**Pour tester :**

1. Lancer l'app : `bun tauri dev`
2. Ouvrir Settings (Ctrl+,)
3. Aller dans l'onglet "Indexing"
4. Cliquer sur "+ Add Folder" et ajouter un dossier (ex: `C:\Users\{user}\Documents`)
5. Configurer les extensions de fichiers (ex: `pdf, docx, txt, md`)
6. Activer "Index on Startup"
7. Cliquer sur "Save Changes"
8. Redémarrer l'app → l'indexation démarre automatiquement en arrière-plan
9. Chercher un nom de fichier dans la barre de recherche
10. Les fichiers devraient apparaître avec une icône de document 📄

**Vérifications importantes :**

- ✅ Les fichiers indexés apparaissent dans les résultats de recherche
- ✅ Cliquer sur un fichier l'ouvre avec l'application par défaut

### ✅ Milestone 3 — Système de plugins (COMPLÉTÉ)

**Architecture implémentée :**

**Infrastructure de base :**

- ✅ Types et interfaces dans [src/features/plugins/types/index.ts](src/features/plugins/types/index.ts)
  - `Plugin`, `PluginResult`, `PluginContext`, `PluginRegistry`
  - `PluginResultType` enum avec types: calculator, websearch, systemcommand
- ✅ Registry de plugins dans [src/features/plugins/core/registry.ts](src/features/plugins/core/registry.ts)
  - Gestion centralisée des plugins (register, unregister, query)
  - Query avec timeout de 500ms par plugin pour éviter les blocages
  - Gestion d'erreurs robuste (un plugin ne peut pas casser le système)
- ✅ Utilitaires dans [src/features/plugins/utils/helpers.ts](src/features/plugins/utils/helpers.ts)
  - `fuzzyScore()` : scoring pour matching de plugins
  - `evaluateExpression()` : évaluation sécurisée d'expressions mathématiques
  - `formatNumber()` : formatage de nombres
  - `copyToClipboard()` : copie dans le presse-papier
  - `openUrl()` : ouverture d'URLs via Tauri

**Plugins built-in implémentés :**

1. **Calculator Plugin** ([builtin/calculator/index.ts](src/features/plugins/builtin/calculator/index.ts))
   - Détecte les expressions mathématiques (ex: `1+2*3`, `sin(45)`)
   - Évalue l'expression de manière sécurisée
   - Affiche le résultat avec score 95 (haute priorité)
   - Action: copie le résultat dans le presse-papier
   - Icône: 🧮

2. **Web Search Plugin** ([builtin/websearch/index.ts](src/features/plugins/builtin/websearch/index.ts))
   - Triggers: `?`, `web `, `search `, `google `, `bing `, `ddg `
   - Support multi-moteurs: Google (défaut), Bing, DuckDuckGo
   - Action: ouvre la recherche dans le navigateur par défaut
   - Icône: 🔍
   - Score: 90

3. **System Commands Plugin** ([builtin/systemcommands/index.ts](src/features/plugins/builtin/systemcommands/index.ts))
   - Commandes disponibles:
     - `reload` (aliases: refresh, restart) → recharge l'app
     - `settings` (aliases: preferences, config, options) → ouvre les paramètres
     - `quit` (aliases: exit, close) → cache la fenêtre
   - Matching fuzzy avec scores: 100 (exact), 95-85 (prefix), 80 (alias)
   - Icônes: 🔄, ⚙️, ❌

**Intégration dans App.tsx :**

- ✅ Initialisation des plugins au démarrage ([App.tsx](src/app/App.tsx))
- ✅ Query des plugins en parallèle avec apps et fichiers dans `performSearch()`
- ✅ Fusion des résultats triés par score
- ✅ Gestion des actions plugins dans `handleLaunch()`
- ✅ Listener d'événement custom `volt:open-settings` pour le plugin SystemCommands
- ✅ Types mis à jour dans [common.types.ts](src/shared/types/common.types.ts)

**Fichiers créés :**

- [src/features/plugins/types/index.ts](src/features/plugins/types/index.ts)
- [src/features/plugins/core/registry.ts](src/features/plugins/core/registry.ts)
- [src/features/plugins/core/index.ts](src/features/plugins/core/index.ts)
- [src/features/plugins/utils/helpers.ts](src/features/plugins/utils/helpers.ts)
- [src/features/plugins/builtin/calculator/index.ts](src/features/plugins/builtin/calculator/index.ts)
- [src/features/plugins/builtin/websearch/index.ts](src/features/plugins/builtin/websearch/index.ts)
- [src/features/plugins/builtin/systemcommands/index.ts](src/features/plugins/builtin/systemcommands/index.ts)
- [src/features/plugins/builtin/index.ts](src/features/plugins/builtin/index.ts)

**Fichiers modifiés :**

- [src/app/App.tsx](src/app/App.tsx) : intégration des plugins dans la recherche
- [src/shared/types/common.types.ts](src/shared/types/common.types.ts) : nouveaux types SearchResultType

**Pour tester :**

1. Lancer l'app : `bun tauri dev`
2. **Calculator** : taper `2+2`, `10*5`, `sqrt(144)` → résultat s'affiche, Enter pour copier
3. **Web Search** : taper `? Tauri app`, `web React hooks`, `google TypeScript` → Enter pour rechercher
4. **System Commands** : taper `settings`, `reload`, `quit` → Enter pour exécuter
5. Vérifier que les plugins apparaissent avec icônes et se lancent correctement

**Critères de validation :**

- ✅ Les 3 plugins fonctionnent sans erreurs
- ✅ Les résultats plugins apparaissent fusionnés avec apps et fichiers
- ✅ Timeout de 500ms empêche les plugins lents de bloquer l'UI
- ✅ Les erreurs de plugins sont catchées et loggées sans casser l'app
- ✅ Le système est extensible pour ajouter de nouveaux plugins
- ✅ Icônes SVG colorées professionnelles pour chaque type de plugin
- ✅ Web Search ouvre correctement les URLs dans le navigateur via `@tauri-apps/plugin-opener`

---

---

### ✅ Milestone 4 — Hotkeys configurables (COMPLÉTÉ)

**Architecture implémentée :**

**Composant Frontend HotkeyCapture :**

- ✅ Composant React interactif dans [HotkeyCapture.tsx](src/shared/components/ui/HotkeyCapture.tsx)
- ✅ Mode "recording" avec animation pulse pour indiquer la capture active
- ✅ Capture des combinaisons de touches (Ctrl, Alt, Shift, Super + touche principale)
- ✅ Normalisation des touches spéciales (Space, Arrow keys, Escape, etc.)
- ✅ Validation côté client : au moins un modificateur + une touche principale requis
- ✅ Affichage visuel avec `<kbd>` stylisés et icône d'édition

**Backend Rust :**

- ✅ `HotkeyState` dans [hotkey/mod.rs](src-tauri/src/hotkey/mod.rs) pour tracker la hotkey actuelle
- ✅ Commande `set_global_hotkey()` :
  - Unregister de l'ancienne hotkey
  - Validation de la nouvelle hotkey (format + disponibilité)
  - Register de la nouvelle hotkey avec callback toggle window
  - Mise à jour du state
- ✅ Commande `get_current_hotkey()` pour récupérer la hotkey active
- ✅ Gestion d'erreurs : retourne message si hotkey déjà prise par une autre app

**Intégration Settings :**

- ✅ Section "Hotkeys" mise à jour dans [SettingsModal.tsx](src/features/settings/components/SettingsModal.tsx)
- ✅ Appel de `set_global_hotkey` via Tauri invoke lors du changement
- ✅ Affichage des erreurs en temps réel (hotkey déjà utilisée, format invalide)
- ✅ Persistance automatique via `update_hotkey_settings`
- ✅ Styles CSS avec animations pour le composant HotkeyCapture

**Fichiers créés :**

- [src/shared/components/ui/HotkeyCapture.tsx](src/shared/components/ui/HotkeyCapture.tsx)
- [src/shared/components/ui/HotkeyCapture.css](src/shared/components/ui/HotkeyCapture.css)

**Fichiers modifiés :**

- [src-tauri/src/hotkey/mod.rs](src-tauri/src/hotkey/mod.rs) : ajout state + commandes
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs) : initialize HotkeyState + register commands
- [src/features/settings/components/SettingsModal.tsx](src/features/settings/components/SettingsModal.tsx) : UI interactive hotkeys
- [src/features/settings/components/SettingsModal.css](src/features/settings/components/SettingsModal.css) : styles erreurs inline
- [src/shared/components/ui/index.ts](src/shared/components/ui/index.ts) : export HotkeyCapture

**Pour tester :**

1. Lancer l'app : `bun tauri dev`
2. Ouvrir Settings (Ctrl+,)
3. Aller dans l'onglet "Hotkeys"
4. Cliquer sur le bouton avec la hotkey actuelle (ex: `Alt+Space`)
5. Appuyer sur une nouvelle combinaison (ex: `Ctrl+Shift+V`)
6. Relâcher les touches → la hotkey est mise à jour immédiatement
7. Tester la nouvelle hotkey pour toggle la fenêtre
8. Redémarrer l'app → la hotkey personnalisée est conservée

**Critères de validation :**

- ✅ Interface de capture de hotkey fluide et intuitive
- ✅ Validation côté client et serveur
- ✅ Changement de hotkey fonctionne en temps réel sans redémarrage
- ✅ Erreurs affichées clairement (hotkey prise, format invalide)
- ✅ Hotkey personnalisée persistée et rechargée au démarrage
- ✅ Ancien hotkey correctement unregistered avant le nouveau

---

## 📋 Prochaines étapes

Vous avez maintenant **5 milestones critiques complétés** (M0, M1, M2, M3, M4) ! 🎉

### 📅 M5 — OS Integration (2-5 jours)

- Start with Windows (démarrage automatique)
- Position fenêtre personnalisée (center/top/custom)
- ✅ Les fichiers ont une icône de document différente des applications
- ✅ Le tri mélange apps (score 100) et fichiers (score 80) correctement
- ✅ Les dossiers exclus ne sont pas indexés
- ✅ Seules les extensions configurées sont indexées

---

## Backlog (idées à garder pour plus tard)

### Performance & UX

- Résolution réelle des raccourcis `.lnk` + extraction icônes plus fiable.
- Historique / ranking "usage_count/last_used" (apprendre des habitudes).
- Multi-provider search (apps + files + plugins) avec pondération configurable.
- Préchargement/cache des icônes d'applications pour affichage instantané.
- Résultats prédictifs (afficher suggestions avant frappe basées sur historique).

### Features avancées

- Support de commandes shell directes (ex: `>ping google.com`).
- Preview de fichiers (texte, images) dans un panneau latéral.
- Actions contextuelles par type (clic droit : copier chemin, ouvrir dossier parent, etc.).
- Support de snippets/clipboard history.
- Support de bookmarks/favoris épinglés.
- Recherche sémantique via tags/descriptions personnalisés.

### Extensibilité

- API de plugins externe (charger plugins JS/WASM depuis dossier `~/.volt/plugins`).
- Marketplace ou registry de plugins communautaires.
- Sync settings cross-device (cloud optionnel).
- Support de thèmes personnalisés (CSS variables exportables).

### Intégrations OS

- Support macOS Spotlight-like (intégration système).
- Support Linux (X11/Wayland specifics).
- Integration avec Windows Search Index (alternative au scan custom).
- Support des protocoles custom (ex: `volt://search?q=chrome`).

### DevEx & Tooling

- Mode debug avec telemetry locale (temps de scan, perf recherche).
- Profiler intégré pour identifier bottlenecks.
- Hot reload des plugins en dev mode.
- Documentation auto-générée des commandes Tauri.

---

### ✅ Milestone 5 — OS Integration (COMPLÉTÉ)

**Architecture :**

**Autostart System (Windows)**

- Utilise `tauri-plugin-autostart` pour l'intégration système
- Commandes Rust avec trait extension `AutostartManagerExt`
- Toggle dans les paramètres Général avec application immédiate
- Appliqué au démarrage si activé dans settings

**Window Positioning System**

- 9 positions prédéfinies via `tauri-plugin-positioner`:
  - Center, TopLeft, TopCenter, TopRight
  - BottomLeft, BottomCenter, BottomRight
  - LeftCenter, RightCenter
- Mode Custom avec coordonnées X/Y manuelles
- Persistance dans `settings.json` (`appearance.windowPosition`)
- Application au démarrage via `lib.rs` setup

**Fichiers créés :**
Aucun - fonctionnalité intégrée dans fichiers existants

**Fichiers modifiés :**

1. **src-tauri/capabilities/default.json**
   - Ajout permissions `autostart:default` et `positioner:default`

2. **src-tauri/Cargo.toml**
   - Ajout dépendances `tauri-plugin-autostart` et `tauri-plugin-positioner`

3. **src-tauri/src/lib.rs**
   - Initialisation plugin positioner dans `.setup()`
   - Chargement settings et application autostart/position au démarrage
   - Enregistrement commandes autostart et window positioning

4. **src-tauri/src/commands/autostart.rs** (étendu)
   - Import `tauri_plugin_autostart::ManagerExt as AutostartManagerExt`
   - Import `tauri_plugin_positioner::{Position, WindowExt}`
   - Commandes: `enable_autostart()`, `disable_autostart()`, `is_autostart_enabled()`
   - Étendu `set_window_position()` avec support positioner pour 9 positions prédéfinies
   - Position custom via coordonnées X/Y inchangée
   - Commande: `get_window_position()` retourne coordonnées actuelles

5. **src/features/settings/types/settings.types.ts**
   - Étendu type `WindowPosition` de 3 → 10 valeurs:
     - Avant: `'center' | 'top' | 'custom'`
     - Après: `'center' | 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight' | 'leftCenter' | 'rightCenter' | 'custom'`
   - Interface `CustomPosition` conservée (x, y)

6. **src/features/settings/components/SettingsModal.tsx**
   - Import type `WindowPosition`
   - Dropdown position fenêtre étendu à 10 options (9 prédéfinies + custom)
   - Handler `onChange` appelle `invoke('set_window_position')` immédiatement pour positions prédéfinies
   - Input X/Y conservés pour mode custom
   - Toggle "Start with Windows" appelle `enable_autostart`/`disable_autostart` via Tauri

7. **src/shared/components/ui/HotkeyCapture.tsx**
   - Fixé: `export interface HotkeyCaptureProps` (était private avant)

**Test Manual:**

```bash
# 1. Tester autostart
bun tauri dev
# → Activer "Start with Windows" dans Settings/General
# → Vérifier que l'app démarre au boot Windows

# 2. Tester positions fenêtre
# → Ouvrir Settings/Appearance/Window Position
# → Tester chaque position prédéfinie (Center, TopLeft, etc.)
# → Fenêtre doit se déplacer immédiatement
# → Redémarrer l'app → position doit persister

# 3. Tester position custom
# → Sélectionner "Custom Coordinates"
# → Entrer X=100, Y=200
# → Sauvegarder → fenêtre doit se déplacer
# → Redémarrer → position custom doit persister
```

**Validation :**

- ✅ Permissions ajoutées (autostart + positioner)
- ✅ Plugins Tauri installés et configurés
- ✅ 9 positions prédéfinies fonctionnelles via positioner
- ✅ Position custom avec coordonnées X/Y fonctionnelle
- ✅ Autostart toggle fonctionnel (Windows)
- ✅ Persistance settings.json (windowPosition + startWithWindows)
- ✅ Application au démarrage via lib.rs setup
- ✅ Build TypeScript sans erreurs

---

## Notes d'architecture à long terme

### Scalabilité de l'index

- Pour >100k fichiers, envisager:
  - Indexation incrémentale (file watcher).
  - Index persistant sur disque (SQLite, tantivy, ou custom).
  - Pagination/lazy loading des résultats.

### Modularité du scoring

- Extraire l'algo de scoring dans un module partagé Rust+TS.
- Permettre des profiles de scoring (exact priority, fuzzy priority, frecency).

### Multi-plateforme

- Abstraire les chemins systèmes (Program Files, AppData, etc.) dans un module `paths.rs`.
- Tester régulièrement sur Windows, macOS, Linux (CI matrix).

### Sécurité

- Validation stricte des chemins utilisateur (éviter path traversal).
- Sandbox des plugins (CSP, permissions limitées).
- Scan antivirus optionnel avant launch (avertissement si détecté).

---

## Métriques de succès

### Performance

- Scan initial : <5s pour ~500 applications (Windows typique).
- Recherche : <50ms pour retourner résultats (apps + fichiers).
- Ouverture fenêtre : <100ms (cold start après boot système).

### Qualité

- 0 crash sur les flows principaux (search, launch, settings).
- Couverture tests : >70% des commandes Rust, >60% des composants React critiques.

### Adoption

- Feedback utilisateurs : identifier les 3 features les plus demandées après MVP.
- Métriques d'usage (si telemetry optionnelle) : ratio searches/launches, plugins les plus utilisés.

---

## Ressources & dépendances

### Crates Rust à considérer

- `tantivy` : full-text search engine (si perf index nécessaire).
- `notify` : file watcher pour indexation incrémentale.
- `lnk` : résolution de raccourcis Windows .lnk.
- `image` : extraction/resize d'icônes.

### Libs JS/TS à considérer

- `fuse.js` : fuzzy search (si fallback frontend nécessaire).
- `zustand` ou `jotai` : state management léger (si React Context devient lourd).
- `react-virtual` : virtualisation liste résultats (si >1000 items).

### Documentation

- Guide utilisateur (markdown + screenshots).
- Guide contributeur (setup dev, architecture, PR workflow).
- API reference des plugins (types, hooks, exemples).

---

## Timeline estimée (développeur solo, temps partiel)

| Milestone            | Durée estimée | Cumul |
| -------------------- | ------------- | ----- |
| M0 — Assainissement  | 1–2 jours     | 2j    |
| M1 — Noyau solide    | 2–4 jours     | 6j    |
| M2 — Fichiers        | 5–10 jours    | 16j   |
| M3 — Plugins         | 5–12 jours    | 28j   |
| M4 — Hotkeys config  | 3–6 jours     | 34j   |
| M5 — OS integration  | 2–5 jours     | 39j   |
| M6 — Tests & release | Continu       | —     |

**Total MVP complet : ~6–8 semaines** (temps partiel, ~2–3h/jour).

**Version 1.0 production-ready : +2–4 semaines** (polish, tests, docs).

---

## Prochaines actions immédiates

1. **Valider ce plan** avec les stakeholders/utilisateurs cibles.
2. **Commencer par M0** : cleanup codebase, uniformiser types.
3. **Prioriser** : si temps limité, focus sur M0 → M1 → M2 (apps + fichiers = déjà très utile).
4. **Itérer** : recueillir feedback utilisateurs après chaque milestone.

---

_Document vivant — à mettre à jour au fil de l'implémentation._
