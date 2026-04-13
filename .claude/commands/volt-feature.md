# Volt - Développement de Feature

Tu es un agent architecte/développeur pour le projet Volt (launcher desktop Tauri v2).

## Ta Mission

Concevoir et implémenter une nouvelle feature pour Volt en respectant l'architecture existante.

## Architecture du Projet

### Structure Frontend (Feature-based)
```
src/features/{feature-name}/
  ├── components/     # Composants React
  ├── hooks/          # Custom hooks
  ├── services/       # Appels Tauri invoke
  ├── types/          # Interfaces TypeScript
  ├── utils/          # Helpers
  └── index.ts        # Export public
```

### Structure Backend
```
src-tauri/src/
  ├── commands/{feature}.rs   # Commandes Tauri
  ├── core/                   # Types, traits, erreurs
  ├── utils/                  # Utilitaires partagés
  └── lib.rs                  # invoke_handler registration
```

## Processus

### 1. Analyse & Recherche
- Comprends exactement ce que l'utilisateur veut
- Lis le code existant pertinent (features similaires, shared components)
- Utilise context7 pour la doc Tauri v2 / React 19 si nécessaire
- Cherche sur le web les best practices si c'est un pattern nouveau

### 2. Architecture
- Identifie les fichiers à créer/modifier
- Détermine si c'est frontend-only, backend-only, ou full-stack
- Planifie les types/interfaces d'abord
- Identifie les composants réutilisables dans `shared/`

### 3. Implémentation (dans cet ordre)
1. **Types** : interfaces TS dans `shared/types/` ou `features/{name}/types/`
2. **Backend** (si nécessaire) :
   - Structs Rust avec `#[serde(rename_all = "camelCase")]`
   - Commandes `#[tauri::command]` dans `commands/`
   - Export dans `commands/mod.rs`
   - Register dans `lib.rs` invoke_handler
3. **Services** : fonctions d'appel `invoke()` 
4. **Hooks** : logique React custom
5. **Components** : UI React avec lucide-react pour les icônes
6. **Styles** : CSS modules ou styles inline, variables CSS du thème
7. **Integration** : wire dans `App.tsx` ou le router

### 4. Vérification
- `cd src-tauri && cargo check` (Rust)
- `bun run build` (TypeScript)
- `bun run test` (tests existants passent)
- `bun run lint` (ESLint)

## Conventions du Projet

### TypeScript/React
- Functional components uniquement
- camelCase pour variables/fonctions
- PascalCase pour composants/types
- Prettier : single quotes, 100 chars, 2 spaces
- Imports absolus depuis `src/`

### Rust
- snake_case pour fonctions/variables
- PascalCase pour types/structs
- `Result<T, String>` pour les commandes
- `.map_err(|e| e.to_string())` pour les erreurs
- rustfmt pour le formatage

### UI/UX
- Interface minimaliste, keyboard-first
- Résultats avec score de pertinence
- Raccourcis clavier pour toutes les actions
- Thème clair/sombre avec auto-detection
- Animations subtiles (pas de bloat)

## Réutilisables Existants
- **SearchBar** : `src/features/search/components/` (150ms debounce)
- **ResultsList/ResultItem** : `src/features/results/components/`
- **ContextMenu** : `src/shared/components/ui/ContextMenu.tsx`
- **HotkeyCapture** : `src/shared/components/ui/HotkeyCapture.tsx`
- **Modal** : `src/shared/components/ui/Modal.tsx`
- **Footer/Header** : `src/shared/components/layout/`
- **Plugin system** : `src/features/plugins/` (pour features type recherche)
- **Icon extraction** : `src-tauri/src/utils/icons.rs`
- **Fuzzy matching** : `src-tauri/src/utils/fuzzy.rs` + `nucleo-matcher`
- **Path utils** : `src-tauri/src/utils/path.rs`

$ARGUMENTS
