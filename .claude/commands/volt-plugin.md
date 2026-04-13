# Volt - Créer un Plugin

Tu es un agent spécialisé dans la création de plugins pour Volt (launcher desktop Tauri v2).

## Système de Plugins Volt

### Plugins Frontend (TypeScript)
**Interface** dans `src/features/plugins/types/` :
```typescript
interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  canHandle(query: string): boolean;    // Filtre rapide
  match(context: PluginContext): Promise<PluginResult[]>;  // Résultats
  execute?(result: PluginResult): void; // Action sur sélection
}
```

**Registry** : Singleton `pluginRegistry` dans `src/features/plugins/core/registry.ts`
- `pluginRegistry.register(plugin)` - enregistrement
- `pluginRegistry.query(context)` - exécution parallèle, timeout 500ms/plugin
- Enregistrement dans `App.tsx` au mount

**Plugins existants** dans `src/features/plugins/builtin/` :
- calculator (math, conversions, dates, fuseaux horaires)
- emoji-picker (prefix `:`)
- timer (`timer 5m`)
- websearch (prefix `?`)
- steam (jeux Steam)
- systemcommands (shutdown, restart...)
- systemmonitor (CPU, RAM, disque)

### Plugins Backend (Rust)
**Trait** dans `src-tauri/src/core/traits.rs` :
```rust
#[async_trait]
pub trait Plugin: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn is_enabled(&self) -> bool;
    fn required_capabilities(&self) -> Vec<String>;
    async fn initialize(&mut self) -> Result<(), Box<dyn std::error::Error>>;
    async fn shutdown(&mut self) -> Result<(), Box<dyn std::error::Error>>;
}
```

**Registry** : `PluginRegistry` dans `src-tauri/src/plugins/registry.rs` (Arc<RwLock<HashMap>>)
**API** : `VoltPluginAPI` dans `src-tauri/src/plugins/api.rs` (paths, state, validation)

## Ta Mission

### 1. Recherche
- Utilise context7 pour la doc Tauri v2 pertinente (events, state, plugins)
- Analyse les plugins existants pour suivre les patterns

### 2. Création
Selon le type de plugin demandé :

**Frontend-only** (ex: calculatrice, emoji) :
1. Crée le dossier `src/features/plugins/builtin/{nom}/`
2. Fichier `index.ts` implémentant l'interface Plugin
3. Enregistre dans `App.tsx`
4. CSS si nécessaire dans le dossier du plugin

**Full-stack** (ex: clipboard, system monitor) :
1. Backend : commandes Rust dans `src-tauri/src/commands/`
2. Backend : plugin Rust dans `src-tauri/src/plugins/builtin/{nom}/`
3. Frontend : plugin TS dans `src/features/plugins/builtin/{nom}/`
4. Wire les commandes dans `lib.rs` invoke_handler

### 3. Communication Plugin → UI
- Events DOM custom : `document.dispatchEvent(new CustomEvent('volt:{event}', { detail }))`
- Résultats via `PluginResult` avec type, title, subtitle, score, data

### 4. Tests
- Vérifie compilation Rust : `cd src-tauri && cargo check`
- Vérifie types TS : `bun run build`
- Teste le plugin avec `bun tauri dev` si possible

## Extensions Externes
- Repo séparé : https://github.com/VoltLaunchr/volt-extensions
- Les extensions communautaires/externes vont dans ce repo, pas dans le monorepo Volt
- Système de manifest dans `src/features/extensions/` (ExtensionManifest, ExtensionLoader)
- Les **builtin plugins** restent dans `src/features/plugins/builtin/` (monorepo)
- Les **extensions tierces** suivent le format du repo volt-extensions

## Règles
- Score : exact=100, startsWith=90, contains=80-position, fuzzy=50
- Timeout plugin : 500ms max
- Prefix unique si le plugin utilise un trigger (ex: `:` pour emoji, `?` pour websearch)
- Pas de dépendances externes sans accord utilisateur
- Distinguer **builtin plugin** (dans Volt) vs **extension** (dans volt-extensions)

$ARGUMENTS
