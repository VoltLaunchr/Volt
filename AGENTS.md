# Instructions agents (Volt)

Ce fichier complète `.github/copilot-instructions.md` avec des règles plus détaillées (niveau senior), basées sur le code existant.

## Frontend vs Backend (où mettre la logique)

- UI/UX, orchestration, debounce, agrégation des résultats: TypeScript/React dans [src/app/App.tsx](src/app/App.tsx).
- Accès OS (scan apps, hotkeys globales, fichiers, window management): Rust/Tauri via `#[tauri::command]` dans [src-tauri/src/commands](src-tauri/src/commands).
- Les commandes Tauri sont appelées depuis le frontend via `invoke('snake_case_command', {...})` (`@tauri-apps/api/core`).

## Indexation fichiers (comment ça marche vraiment)

- État global en mémoire (pas de DB): `FileIndexState` (Arc<Mutex<Vec<FileInfo>>>) dans [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs).
- `start_indexing(...)` lance un scan en tâche de fond (`tauri::async_runtime::spawn`) et met à jour `IndexStatus`.
- Scan filesystem: [src-tauri/src/indexer/scanner.rs](src-tauri/src/indexer/scanner.rs)
  - Filtrage exclusions: `excluded_paths` est un simple `contains` sur le chemin (attention aux faux positifs).
  - Limites: `max_depth = 10`, `max_file_size = 100MB` (hardcodés dans `start_indexing`).
  - Extensions: si `file_extensions` est vide → indexe tout; sinon ne garde que les extensions listées (et ignore les fichiers sans extension).
  - Dossiers: les répertoires sont aussi indexés aux profondeurs 0–1 (permet de trouver des “dossiers jeux”, etc.).
- Recherche index: [src-tauri/src/indexer/search.rs](src-tauri/src/indexer/search.rs)
  - Scoring simple (exact/startsWith/contains/fuzzy), tri par score, puis `limit` côté commande.

## Plugins (conventions importantes)

- Registry unique: [src/features/plugins/core/registry.ts](src/features/plugins/core/registry.ts) (`pluginRegistry`).
- `pluginRegistry.query()`:
  - interroge uniquement les plugins `enabled`.
  - applique un timeout de 500ms par plugin.
  - ajoute `pluginId` sur chaque résultat (utilisé ensuite pour `execute`).
- Les built-ins sont enregistrés au démarrage dans [src/app/App.tsx](src/app/App.tsx).
- Pour communiquer plugin → UI, privilégier des événements DOM `volt:*` (ex: `volt:open-settings` géré dans [src/app/App.tsx](src/app/App.tsx)).

## Settings + thème

- Le thème est piloté via `data-theme` et `applyTheme()` exporté par [src/features/settings/index.ts](src/features/settings/index.ts) (implémentation dans `services/settingsService`).
- Si `theme === 'auto'`, le frontend installe un listener système (voir [src/app/App.tsx](src/app/App.tsx)).

## Hotkey globale (Rust)

- L’enregistrement est best-effort: plusieurs combinaisons sont tentées (ex: `alt+space`, `ctrl+shift+space`, etc.) dans [src-tauri/src/hotkey/mod.rs](src-tauri/src/hotkey/mod.rs).
- Au démarrage, la hotkey peut ensuite être remplacée par celle des settings (voir [src-tauri/src/lib.rs](src-tauri/src/lib.rs)).

## Règles de changement (pratiques)

- Éviter de casser la recherche: conserver le debounce 150ms + protection anti-réponses obsolètes (`latestSearchId`) dans [src/app/App.tsx](src/app/App.tsx).
- Si vous ajoutez une commande Tauri: ajouter `#[tauri::command]` → exporter dans [src-tauri/src/commands/mod.rs](src-tauri/src/commands/mod.rs) → enregistrer dans [src-tauri/src/lib.rs](src-tauri/src/lib.rs) → appeler via `invoke()`.
- Synchronisation types Rust/TS: TS est en `camelCase`, Rust en `snake_case`; utiliser `serde(rename_all = "camelCase")` quand une structure traverse la frontière.
