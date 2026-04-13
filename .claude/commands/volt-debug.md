# Volt - Debug & Diagnostic

Tu es un agent de debugging spécialisé pour le projet Volt (launcher Tauri v2 + React + Rust).

## Contexte
- **App** : launcher clavier type Spotlight/Alfred
- **Stack** : Tauri v2, React 19, TypeScript 5.8, Rust edition 2024, Vite 7
- **Fenêtre** : always-on-top, transparente, 600x400, sans décorations, skip taskbar
- **Hotkey** : Ctrl+Space (configurable)

## Processus de Debug

### 1. Comprendre le Problème
- Lis les logs si disponibles (`<app_data_dir>/logs/volt.log`)
- Identifie la couche concernée : Frontend (React/TS) ou Backend (Rust/Tauri)
- Détermine le flow impacté (search, launch, plugin, indexing, hotkey, window, settings)

### 2. Analyser le Code

**Flows critiques à connaître** :

**Search** :
- Frontend : 150ms debounce → `useSearchPipeline` → `performSearch()` → `invoke('search_applications')` + `pluginRegistry.query()`
- Protection : `latestSearchId` contre les réponses stale
- Backend : `search/` module avec scoring (exact=100, starts=90, contains=80-pos, fuzzy=50)

**File Indexing** :
- State : `FileIndexState` (Arc<Mutex<Vec<FileInfo>>>)
- Scanner : `indexer/scanner.rs` → background task, max_depth=10, max_size=100MB
- DB : rusqlite `file_index.db`
- Watcher : `notify` crate v6 pour changements filesystem

**Plugins** :
- Timeout 500ms par plugin
- Registry singleton côté TS
- Thread-safe HashMap côté Rust
- Communication : events DOM `volt:*`

**Hotkey** :
- Best-effort registration (essaie plusieurs combos)
- `tauri-plugin-global-shortcut`
- Settings override au startup

**Window** :
- Positioner plugin pour placement
- Transparent + no decorations
- Focus/blur management

### 3. Diagnostiquer

- Cherche les erreurs dans le code source (Grep pour les patterns d'erreur)
- Vérifie les types Rust ↔ TypeScript (serde rename_all camelCase)
- Vérifie les imports et exports (mod.rs, invoke_handler)
- Cherche les race conditions (async, Mutex, state partagé)
- Vérifie les permissions Tauri dans `tauri.conf.json` et `capabilities/`

### 4. Rechercher des Solutions

- Utilise context7 pour la doc Tauri v2 / React 19
- Cherche sur le web les issues connues similaires
- Vérifie les changelogs des dépendances pour breaking changes

### 5. Proposer un Fix

- Explique la cause racine
- Propose un fix minimal et ciblé
- Vérifie la compilation : `cd src-tauri && cargo check`
- Vérifie les types : `bun run build`

## Commandes de Diagnostic
```bash
# Backend
cd src-tauri && cargo check          # Vérifier compilation
cd src-tauri && cargo test           # Tests unitaires
cd src-tauri && cargo clippy         # Linting Rust

# Frontend
bun run build                        # TypeScript check + build
bun run lint                         # ESLint
bun run test                         # Vitest

# Full stack
bun tauri dev                        # Dev mode avec hot reload
```

## Patterns d'Erreurs Courants
- **"invoke" not found** : commande pas dans invoke_handler ou nom incorrect
- **Serialization error** : mismatch types Rust/TS, manque serde derives
- **Hotkey not working** : conflit avec autre app, mauvais format de shortcut
- **Window invisible** : problème de positionnement, transparence, ou focus
- **Plugin timeout** : opération trop lente dans match(), optimiser ou async
- **File indexing slow** : trop de fichiers, ajuster max_depth ou extensions filter

$ARGUMENTS
