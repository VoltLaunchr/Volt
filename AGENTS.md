# Instructions agents (Volt)

Ce fichier complète `.github/copilot-instructions.md` avec des règles plus détaillées (niveau senior), basées sur le code existant.

## Frontend vs Backend (où mettre la logique)

- UI/UX, orchestration, debounce, agrégation des résultats: TypeScript/React. `App.tsx` (~197 lignes) est un shell mince; la logique est extraite dans des hooks dédiés:
  - `src/app/hooks/useSearchPipeline.ts` — search + debounce 150ms + `latestSearchId`
  - `src/app/hooks/useAppLifecycle.ts` — scan init, auto-indexing, updater, extensions
  - `src/app/hooks/useGlobalHotkey.ts` — keyboard shortcuts
  - `src/app/hooks/useResultActions.ts` — launch + suggestion handling
  - `src/app/components/ViewRouter.tsx` — view switching
  - `src/app/components/ResultContextMenu.tsx` — context menu actions
- Accès OS (scan apps, hotkeys globales, fichiers, window management): Rust/Tauri via `#[tauri::command]` dans [src-tauri/src/commands](src-tauri/src/commands).
- Les commandes Tauri retournent `VoltResult<T>` (alias de `Result<T, VoltError>`). Le type `VoltError` est défini dans `core/error.rs` et sérialisé en discriminated union pour le frontend.
- Les commandes Tauri sont appelées depuis le frontend via `invoke('snake_case_command', {...})` (`@tauri-apps/api/core`).

## Indexation fichiers (comment ça marche vraiment)

- État en mémoire ET persistance SQLite: `FileIndexState` conserve un snapshot `Arc<Vec<FileInfo>>`, un lookup `HashMap<path, index>` cohérent avec ce snapshot, et la base SQLite `file_history.db` (rusqlite) pour la persistance entre sessions.
- `start_indexing(...)` lance un scan en tâche de fond (`tauri::async_runtime::spawn`) et met à jour `IndexStatus`.
- Scan filesystem: [src-tauri/src/indexer/scanner.rs](src-tauri/src/indexer/scanner.rs)
  - Filtrage exclusions: `excluded_paths` est un simple `contains` sur le chemin (attention aux faux positifs).
  - Limites: `max_depth = 10`, `max_file_size = 100MB` (hardcodés dans `start_indexing`).
  - Extensions: si `file_extensions` est vide → indexe tout; sinon ne garde que les extensions listées (et ignore les fichiers sans extension).
  - Dossiers: les répertoires sont aussi indexés aux profondeurs 0–1 (permet de trouver des “dossiers jeux”, etc.).
- Base de données: [src-tauri/src/indexer/database.rs](src-tauri/src/indexer/database.rs) — CRUD SQLite et remplacement transactionnel du snapshot après un scan réussi. Ne pas vider l'ancien index avant la fin du scan.
- Watcher filesystem: [src-tauri/src/indexer/watcher.rs](src-tauri/src/indexer/watcher.rs) — surveillance temps réel, debounce 100ms, synchronisation SQLite/cache/Tantivy. `stop()` rejoint le worker et constitue une barrière avant rebuild.
- Recherche index: [src-tauri/src/indexer/search.rs](src-tauri/src/indexer/search.rs) et [src-tauri/src/indexer/search_engine.rs](src-tauri/src/indexer/search_engine.rs)
  - Build par défaut: nucleo (exact/startsWith/contains/fuzzy), avec exclusion des fichiers cachés.
  - Feature `tantivy-search`: index persistant dans `file_history.tantivy`, scoring exact + BM25 + préfixe + fuzzy Levenshtein avec transpositions.
  - L'index Tantivy est réutilisé au démarrage uniquement si le marqueur SQLite `tantivy_dirty` est propre et si le nombre de documents concorde; sinon il est reconstruit depuis SQLite.
  - Tantivy est un index dérivé: SQLite reste la source de vérité et le fallback nucleo reste disponible.

## Plugins (conventions importantes)

- Registry unique: [src/features/plugins/core/registry.ts](src/features/plugins/core/registry.ts) (`pluginRegistry`).
- `pluginRegistry.query()`:
  - interroge uniquement les plugins `enabled`.
  - applique un timeout de 500ms par plugin.
  - ajoute `pluginId` sur chaque résultat (utilisé ensuite pour `execute`).
- Les built-ins sont enregistrés au démarrage dans `App.tsx` (via `useAppLifecycle`).
- Pour communiquer plugin → UI, privilégier des événements DOM `volt:*` (ex: `volt:open-settings`).

## Extensions (externe, distinct des plugins)

- Les extensions sont séparées des plugins built-in. Plugins built-in = dans ce repo (`src/features/plugins/builtin/`). Extensions = chargées dynamiquement.
- **Deux sources de registry** fusionnées dans `/api/extensions` sur voltlaunchr.com :
  1. **GitHub legacy** — `VoltLaunchr/volt-extensions/registry.json` : extensions existantes (github, notion, password-generator). Ne pas modifier sans raison.
  2. **Supabase** — table `developer_extensions` (status = `approved`) : nouvelles extensions soumises via le portail developer.
- **Portail developer** (voltlaunchr.com/developer) : workflow complet draft → pending → approved/rejected. API keys (`sk_live_*`) SHA-256 hashées en DB (`api_keys.developer_id`, `.key_prefix`, `.scopes`, `.is_active`).
- Système d'extensions frontend: `src/features/extensions/`
- Le lifecycle des extensions est géré par `useAppLifecycle` hook.

## Settings + thème

- Le thème est piloté via `data-theme` et `applyTheme()` exporté par [src/features/settings/index.ts](src/features/settings/index.ts) (implémentation dans `services/settingsService`).
- Si `theme === 'auto'`, le frontend installe un listener système (voir `useAppLifecycle`).

## Hotkey globale (Rust)

- L’enregistrement est best-effort: plusieurs combinaisons sont tentées (ex: `alt+space`, `ctrl+shift+space`, etc.) dans [src-tauri/src/hotkey/mod.rs](src-tauri/src/hotkey/mod.rs).
- Au démarrage, la hotkey peut ensuite être remplacée par celle des settings (voir [src-tauri/src/lib.rs](src-tauri/src/lib.rs)).

## Logging

- Backend: `tracing` + `tracing-subscriber` + `tracing-appender`. Log rotatif quotidien dans `app_data_dir/logs/volt.log`.
- Frontend: logger centralisé dans `src/shared/utils/logger.ts`.

## Règles de changement (pratiques)

- Éviter de casser la recherche: conserver le debounce 150ms + protection anti-réponses obsolètes (`latestSearchId`) dans `useSearchPipeline.ts`.
- Si vous ajoutez une commande Tauri: ajouter `#[tauri::command]` → exporter dans [src-tauri/src/commands/mod.rs](src-tauri/src/commands/mod.rs) → enregistrer dans [src-tauri/src/lib.rs](src-tauri/src/lib.rs) → appeler via `invoke()`.
- Synchronisation types Rust/TS: TS est en `camelCase`, Rust en `snake_case`; utiliser `serde(rename_all = "camelCase")` quand une structure traverse la frontière.
- Tests: vérifier avant de merger. État validé le 12 juin 2026: 345 tests Vitest, 303 tests Rust par défaut, 321 avec `tantivy-search`, 15 tests ciblés SQLCipher. Exécuter aussi les deux matrices Clippy strictes documentées dans le README.
