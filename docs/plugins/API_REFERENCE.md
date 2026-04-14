# Plugin API Reference

Documentation complète de l'API des plugins Volt.

## Table des matières

- [Frontend Plugin API](#frontend-plugin-api)
- [Backend Plugin API (Rust)](#backend-plugin-api-rust)
- [Tauri Commands](#tauri-commands)
- [Helper Functions](#helper-functions)
- [Events System](#events-system)

---

## Frontend Plugin API

### Plugin Interface

L'interface principale que tous les plugins doivent implémenter.

```typescript
interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  canHandle(context: PluginContext): boolean;
  match(context: PluginContext): Promise<PluginResult[]> | PluginResult[] | null;
  execute(result: PluginResult): Promise<void> | void;
}
```

#### Properties

##### `id: string`

Identifiant unique du plugin. Utilisé en interne pour identifier le plugin.

**Format recommandé** : `kebab-case` (ex: `my-awesome-plugin`)

```typescript
id = 'web-search';
```

##### `name: string`

Nom affiché du plugin dans l'interface utilisateur.

```typescript
name = 'Web Search';
```

##### `description: string`

Description courte du plugin (affichée dans les paramètres).

```typescript
description = 'Search the web using your default browser';
```

##### `enabled: boolean`

État d'activation du plugin. Les plugins désactivés ne sont pas interrogés.

```typescript
enabled = true;
```

#### Methods

##### `canHandle(context: PluginContext): boolean`

Détermine si le plugin peut traiter la requête. Cette méthode doit être **ultra-rapide** (< 1ms).

**Paramètres:**

- `context: PluginContext` - Contexte contenant la requête

**Retourne:** `boolean` - `true` si le plugin peut gérer cette requête

**Exemples:**

```typescript
// Préfixe simple
canHandle(context: PluginContext): boolean {
  return context.query.startsWith('?');
}

// Regex pattern
canHandle(context: PluginContext): boolean {
  return /^\d+\s*[+\-*/]\s*\d+$/.test(context.query);
}

// Mots-clés multiples
canHandle(context: PluginContext): boolean {
  const query = context.query.toLowerCase();
  const triggers = ['search ', 'google ', 'web '];
  return triggers.some(t => query.startsWith(t));
}

// Détection intelligente
canHandle(context: PluginContext): boolean {
  const query = context.query.trim();
  // Active si contient des chiffres et opérateurs math
  return /[\d+\-*/().]/.test(query) &&
         /[+\-*/]/.test(query);
}
```

##### `match(context: PluginContext): Promise<PluginResult[]> | PluginResult[] | null`

Génère les résultats pour la requête. Timeout de **500ms** appliqué automatiquement.

**Paramètres:**

- `context: PluginContext` - Contexte de recherche

**Retourne:**

- `PluginResult[]` - Tableau de résultats (peut être vide)
- `null` - Si aucun résultat à afficher

**Exemples:**

```typescript
// Résultat simple
match(context: PluginContext): PluginResult[] | null {
  const query = context.query.substring(1); // Retire le préfixe

  if (!query.trim()) return null;

  return [{
    id: `search-${Date.now()}`,
    type: PluginResultType.WebSearch,
    title: `Search for "${query}"`,
    subtitle: 'Press Enter to open in browser',
    score: 90,
    data: { query },
  }];
}

// Résultats multiples
match(context: PluginContext): PluginResult[] {
  const results: PluginResult[] = [];

  // Recherche Google
  results.push({
    id: 'google',
    type: PluginResultType.WebSearch,
    title: `Google: ${context.query}`,
    icon: '🔍',
    score: 95,
    data: { engine: 'google', query: context.query },
  });

  // Recherche DuckDuckGo
  results.push({
    id: 'ddg',
    type: PluginResultType.WebSearch,
    title: `DuckDuckGo: ${context.query}`,
    icon: '🦆',
    score: 90,
    data: { engine: 'duckduckgo', query: context.query },
  });

  return results;
}

// Résultats asynchrones
async match(context: PluginContext): Promise<PluginResult[]> {
  const data = await this.fetchData(context.query);

  return data.map((item, index) => ({
    id: `result-${index}`,
    type: PluginResultType.Info,
    title: item.title,
    subtitle: item.description,
    score: 85 - index * 5, // Score décroissant
    data: item,
  }));
}
```

##### `execute(result: PluginResult): Promise<void> | void`

Exécute l'action quand l'utilisateur sélectionne un résultat (touche Entrée).

**Paramètres:**

- `result: PluginResult` - Le résultat sélectionné

**Retourne:** `void` ou `Promise<void>`

**Exemples:**

```typescript
// Action simple
execute(result: PluginResult): void {
  const url = result.data?.url as string;
  window.open(url, '_blank');
}

// Action asynchrone
async execute(result: PluginResult): Promise<void> {
  const text = result.data?.text as string;

  try {
    await navigator.clipboard.writeText(text);
    console.log('✓ Copied to clipboard');
  } catch (error) {
    console.error('✗ Failed to copy:', error);
  }
}

// Action avec appel Tauri
async execute(result: PluginResult): Promise<void> {
  const filePath = result.data?.path as string;

  try {
    await invoke('open_file', { path: filePath });
    console.log('✓ Opened file:', filePath);
  } catch (error) {
    console.error('✗ Failed to open file:', error);
  }
}

// Action avec événement personnalisé
execute(result: PluginResult): void {
  const action = result.data?.action as string;

  // Déclencher un événement pour l'UI
  window.dispatchEvent(new CustomEvent('volt:plugin-action', {
    detail: { action, data: result.data },
  }));
}
```

---

### PluginContext

Contexte passé aux méthodes `canHandle()` et `match()`.

```typescript
interface PluginContext {
  query: string;
  settings?: Record<string, unknown>;
}
```

#### Properties

##### `query: string`

La requête de recherche entrée par l'utilisateur.

**Note:** La requête est passée telle quelle, sans trim() automatique. Pensez à utiliser `.trim()` si nécessaire.

##### `settings?: Record<string, unknown>`

Paramètres optionnels passés au plugin. Peut contenir la configuration utilisateur.

**Exemple:**

```typescript
interface MyPluginSettings {
  maxResults: number;
  apiKey: string;
}

match(context: PluginContext): PluginResult[] | null {
  const settings = context.settings as MyPluginSettings;
  const maxResults = settings?.maxResults || 10;

  // Utiliser les paramètres...
}
```

---

### PluginResult

Objet représentant un résultat de recherche.

```typescript
interface PluginResult {
  id: string;
  type: PluginResultType;
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  score: number;
  data?: Record<string, unknown>;
  pluginId?: string;
}
```

#### Properties

##### `id: string` (requis)

Identifiant unique du résultat. Utilisé pour le tracking et les animations.

**Recommandation:** Incluez un timestamp pour garantir l'unicité.

```typescript
id: `my-plugin-${Date.now()}`;
id: `result-${Math.random().toString(36).substr(2, 9)}`;
```

##### `type: PluginResultType` (requis)

Type de résultat. Détermine l'icône et le style visuel.

```typescript
enum PluginResultType {
  Calculator = 'calculator',
  WebSearch = 'websearch',
  SystemCommand = 'systemcommand',
  FileExplorer = 'fileexplorer',
  Timer = 'timer',
  SystemMonitor = 'systemmonitor',
  Steam = 'steam',
  Game = 'game',
  Clipboard = 'clipboard',
  Emoji = 'emoji',
  Info = 'info',
}
```

##### `title: string` (requis)

Titre principal du résultat. Affiché en gros caractères.

**Recommandations:**

- Court et descriptif (< 60 caractères)
- Commence par une majuscule
- Pas de point final

```typescript
title: 'Search "hello world" on Google';
title: '42 + 58 = 100';
title: 'Open Calculator';
```

##### `subtitle?: string`

Sous-titre optionnel. Affiché sous le titre en plus petit.

**Utilisations:**

- Description de l'action
- Informations complémentaires
- Chemin de fichier
- Raccourci clavier

```typescript
subtitle: 'Press Enter to execute';
subtitle: 'C:\\Users\\John\\Documents';
subtitle: 'Alt+1 to launch';
```

##### `icon?: string`

Icône affichée à gauche du résultat.

**Formats supportés:**

- Emoji Unicode: `'🔍'`, `'📁'`, `'⚙️'`
- Chemin d'image: `'/icons/my-icon.png'`
- URL: `'https://example.com/icon.png'`

```typescript
icon: '🔍'; // Emoji (recommandé pour la simplicité)
icon: '/assets/icons/custom.svg'; // Fichier local
icon: result.appIcon; // Icône dynamique
```

##### `badge?: string`

Badge affiché à droite du résultat (étiquette).

**Utilisations:**

- Type d'élément: `'App'`, `'File'`, `'Folder'`
- Plateforme: `'Steam'`, `'Epic'`, `'GOG'`
- Statut: `'New'`, `'Beta'`

```typescript
badge: 'App';
badge: 'Steam';
badge: 'PDF';
```

##### `score: number` (requis)

Score de pertinence (0-100). Détermine l'ordre d'affichage.

**Échelle recommandée:**

- **95-100** : Correspondance exacte (titre exact, alias exact)
- **85-94** : Correspondance partielle forte (début du titre)
- **70-84** : Correspondance moyenne (contient le terme)
- **50-69** : Correspondance faible (fuzzy match)
- **0-49** : Correspondance très faible (à éviter)

```typescript
// Correspondance exacte
score: 100;

// Correspondance forte
score: 90;

// Correspondance moyenne
score: 75;

// Correspondance faible
score: 60;
```

**Exemple de calcul de score:**

```typescript
calculateScore(query: string, title: string): number {
  const q = query.toLowerCase();
  const t = title.toLowerCase();

  if (t === q) return 100;                    // Exact match
  if (t.startsWith(q)) return 90;             // Starts with
  if (t.includes(q)) return 75;               // Contains

  // Fuzzy matching
  const distance = this.levenshteinDistance(q, t);
  return Math.max(50, 100 - distance * 5);
}
```

##### `data?: Record<string, unknown>`

Données personnalisées passées à `execute()`.

Utilisez ce champ pour stocker toutes les informations nécessaires à l'exécution de l'action.

```typescript
data: {
  url: 'https://example.com',
  query: 'search term',
  customField: 'value',
}

// Dans execute()
async execute(result: PluginResult): Promise<void> {
  const url = result.data?.url as string;
  // Utiliser l'URL...
}
```

##### `pluginId?: string`

Identifiant du plugin qui a créé ce résultat. **Ajouté automatiquement** par le registry.

---

### PluginRegistry

Gestionnaire centralisé de tous les plugins.

```typescript
class PluginRegistry {
  plugins: Map<string, Plugin>;

  register(plugin: Plugin): void;
  unregister(pluginId: string): void;
  getPlugin(pluginId: string): Plugin | undefined;
  getAllPlugins(): Plugin[];
  getEnabledPlugins(): Plugin[];
  query(context: PluginContext): Promise<PluginResult[]>;
}
```

#### Instance singleton

```typescript
import { pluginRegistry } from '@/features/plugins/core';

// Enregistrer un plugin
pluginRegistry.register(new MyPlugin());

// Interroger tous les plugins
const results = await pluginRegistry.query({ query: 'test' });
```

#### Methods

##### `register(plugin: Plugin): void`

Enregistre un nouveau plugin dans le registry.

```typescript
const myPlugin = new MyPlugin();
pluginRegistry.register(myPlugin);
// ✓ Plugin registered: My Plugin (my-plugin)
```

##### `unregister(pluginId: string): void`

Désenregistre un plugin.

```typescript
pluginRegistry.unregister('my-plugin');
// ✓ Plugin unregistered: my-plugin
```

##### `getPlugin(pluginId: string): Plugin | undefined`

Récupère un plugin par son ID.

```typescript
const plugin = pluginRegistry.getPlugin('calculator');
if (plugin) {
  console.log('Plugin found:', plugin.name);
}
```

##### `getAllPlugins(): Plugin[]`

Récupère tous les plugins (activés et désactivés).

```typescript
const allPlugins = pluginRegistry.getAllPlugins();
console.log(`Total plugins: ${allPlugins.length}`);
```

##### `getEnabledPlugins(): Plugin[]`

Récupère uniquement les plugins activés.

```typescript
const enabledPlugins = pluginRegistry.getEnabledPlugins();
console.log(`Active plugins: ${enabledPlugins.length}`);
```

##### `query(context: PluginContext): Promise<PluginResult[]>`

Interroge tous les plugins activés et agrège les résultats.

**Comportement:**

1. Filtre les plugins qui peuvent gérer la requête (`canHandle`)
2. Exécute `match()` en parallèle sur tous les plugins validés
3. Applique un timeout de 500ms par plugin
4. Gère les erreurs gracieusement (un plugin en erreur n'affecte pas les autres)
5. Ajoute `pluginId` sur chaque résultat
6. Trie par score décroissant

```typescript
const results = await pluginRegistry.query({ query: 'hello' });
// Retourne tous les résultats triés par score
```

---

## Backend Plugin API (Rust)

### VoltPluginAPI

API principale fournie aux plugins backend pour interagir avec Volt.

```rust
pub struct VoltPluginAPI {
    state: Arc<RwLock<PluginAPIState>>,
}
```

#### Methods

##### `new(app_data_dir: PathBuf) -> Self`

Crée une nouvelle instance de l'API.

```rust
let api = VoltPluginAPI::new(app_data_dir);
```

##### `get_plugin_cache_dir(&self, plugin_id: &str) -> VoltResult<PathBuf>`

Récupère le répertoire de cache du plugin.

**Validation:** Le `plugin_id` doit contenir uniquement des caractères alphanumériques, tirets et underscores.

```rust
let cache_dir = api.get_plugin_cache_dir("my_plugin")?;
// Retourne: {app_data}/cache/my_plugin
```

##### `get_plugin_config_dir(&self, plugin_id: &str) -> VoltResult<PathBuf>`

Récupère le répertoire de configuration du plugin.

```rust
let config_dir = api.get_plugin_config_dir("my_plugin")?;
// Retourne: {app_data}/config/my_plugin
```

##### `read_cache_file(&self, plugin_id: &str, cache_key: &str) -> VoltResult<Vec<u8>>`

Lit un fichier depuis le cache du plugin.

```rust
let data = api.read_cache_file("my_plugin", "games.json").await?;
let json = String::from_utf8(data)?;
```

##### `write_cache_file(&self, plugin_id: &str, cache_key: &str, data: &[u8]) -> VoltResult<()>`

Écrit dans un fichier de cache du plugin.

```rust
let json_data = serde_json::to_vec(&my_data)?;
api.write_cache_file("my_plugin", "games.json", &json_data).await?;
```

##### `delete_cache_file(&self, plugin_id: &str, cache_key: &str) -> VoltResult<()>`

Supprime un fichier du cache.

```rust
api.delete_cache_file("my_plugin", "old_cache.json").await?;
```

---

## Tauri Commands

### Création d'une commande

Les commandes Tauri permettent au frontend d'appeler le code Rust.

```rust
// src-tauri/src/commands/my_plugin.rs

#[tauri::command]
pub async fn my_plugin_scan() -> VoltResult<Vec<MyData>> {
    // Votre logique ici
    Ok(vec![])
}

#[tauri::command]
pub async fn my_plugin_launch(id: String) -> VoltResult<()> {
    // Lancer l'élément par ID
    Ok(())
}
```

### Enregistrement

```rust
// src-tauri/src/lib.rs

.invoke_handler(tauri::generate_handler![
    my_plugin_scan,
    my_plugin_launch,
])
```

### Appel depuis le frontend

```typescript
import { invoke } from '@tauri-apps/api/core';

// Appeler une commande
const data = await invoke<MyData[]>('my_plugin_scan');

// Appeler avec paramètres
await invoke('my_plugin_launch', { id: 'item-123' });
```

---

## Helper Functions

### Frontend Helpers

```typescript
// src/features/plugins/utils/helpers.ts

/** Copier du texte dans le presse-papiers */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/** Ouvrir une URL dans le navigateur par défaut */
export async function openUrl(url: string): Promise<void> {
  await invoke('open_url', { url });
}

/** Ouvrir un fichier/dossier */
export async function openFile(path: string): Promise<void> {
  await invoke('launch_application', { path });
}
```

**Usage:**

```typescript
import { copyToClipboard, openUrl } from '@/features/plugins/utils/helpers';

// Copier dans le presse-papiers
const success = await copyToClipboard('Hello World');
if (success) {
  console.log('✓ Copied!');
}

// Ouvrir une URL
await openUrl('https://example.com');

// Ouvrir un fichier
await openFile('C:\\Users\\John\\document.pdf');
```

---

## Events System

### Événements personnalisés

Communication Plugin → UI via événements DOM.

#### Déclencher un événement

```typescript
// Dans votre plugin
async execute(result: PluginResult): Promise<void> {
  window.dispatchEvent(new CustomEvent('volt:open-settings'));
}

// Avec données
window.dispatchEvent(new CustomEvent('volt:notification', {
  detail: {
    type: 'success',
    message: 'Operation completed!',
  },
}));
```

#### Écouter un événement

```typescript
// Dans App.tsx ou un composant
useEffect(() => {
  const handleOpenSettings = () => {
    // Logique ici
  };

  window.addEventListener('volt:open-settings', handleOpenSettings);

  return () => {
    window.removeEventListener('volt:open-settings', handleOpenSettings);
  };
}, []);

// Avec données
useEffect(() => {
  const handleNotification = (event: CustomEvent) => {
    const { type, message } = event.detail;
    showNotification(type, message);
  };

  window.addEventListener('volt:notification', handleNotification as EventListener);

  return () => {
    window.removeEventListener('volt:notification', handleNotification as EventListener);
  };
}, []);
```

### Événements prédéfinis

| Événement                | Description                 | Données             |
| ------------------------ | --------------------------- | ------------------- |
| `volt:open-settings`     | Ouvrir les paramètres       | -                   |
| `volt:hide-window`       | Masquer la fenêtre          | -                   |
| `volt:show-notification` | Afficher une notification   | `{ type, message }` |
| `volt:plugin-action`     | Action plugin personnalisée | `{ action, data }`  |

---

## Type Definitions

### TypeScript Types

```typescript
// Plugin types
export enum PluginResultType { ... }
export interface PluginResult { ... }
export interface PluginContext { ... }
export interface Plugin { ... }
export interface PluginRegistry { ... }

// Import des types
import {
  Plugin,
  PluginContext,
  PluginResult,
  PluginResultType
} from '@/features/plugins/types';
```

### Rust Types

```rust
// Structures de données communes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyData {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}

// Résultat Tauri command — uses VoltError discriminated union
pub type VoltResult<T> = Result<T, VoltError>;
```

---

## Performance Guidelines

### Frontend

- **canHandle()** : < 1ms (simple check)
- **match()** : < 100ms (idéal), < 500ms (timeout)
- **execute()** : Pas de limite (mais éviter les opérations longues)

### Backend

- **Scan initial** : < 5s (idéal), < 30s (acceptable)
- **Requêtes** : < 100ms
- **Cache** : Utilisez le cache pour les données lourdes

---

## Error Handling

### Frontend

```typescript
match(context: PluginContext): PluginResult[] | null {
  try {
    // Logique qui peut échouer
    const result = this.riskyOperation(context.query);
    return [result];
  } catch (error) {
    console.error('[MyPlugin] Error in match:', error);
    return null; // Ne pas casser l'app
  }
}

async execute(result: PluginResult): Promise<void> {
  try {
    await this.performAction(result);
    console.log('✓ Success');
  } catch (error) {
    console.error('✗ Failed:', error);
    // Optionnel : afficher une notification d'erreur
  }
}
```

### Backend

```rust
#[tauri::command]
pub async fn my_command() -> VoltResult<Vec<Data>> {
    // Errors are handled via VoltError discriminated union
    let data = fetch_data()
        .await
        .map_err(|e| VoltError::Plugin(format!("Failed to fetch data: {}", e)))?;

    Ok(data)
}
```

> **Note**: Volt uses `VoltResult<T>` (an alias for `Result<T, VoltError>`) instead of `Result<T, String>`. The `VoltError` enum provides structured error variants for different failure modes.

---

---

## Web Worker Sandbox

Extensions that declare `keywords` or `prefix` in their manifest run inside a dedicated Web Worker for isolation.

### How it works

- **canHandle is declarative** — the main thread evaluates `keywords`/`prefix` from the manifest; no extension code runs on the main thread
- **match/execute via postMessage** — the registry sends the query to the Worker and awaits a response with a **500ms timeout**
- **Mock VoltAPI** — inside the Worker, a mock `VoltAPI` captures actions (`copyToClipboard`, `openUrl`, `notify`) as action commands returned to the main thread
- **Permission checks** — before executing captured actions, the runtime checks the extension's declared permissions (`clipboard`, `network`, `notifications`); unauthorized actions are silently dropped
- **One Worker per extension** — each extension with keywords/prefix gets its own Worker instance, preventing cross-extension interference

### Lifecycle

```
Main Thread                          Worker
     │                                  │
     ├─ manifest.keywords/prefix ──→ canHandle (declarative, no Worker call)
     │                                  │
     ├─ postMessage({ type: 'match', query }) ──→ extension.match()
     │                                  │
     │  ←── postMessage({ results }) ───┤
     │                                  │
     ├─ postMessage({ type: 'execute', result }) ──→ extension.execute()
     │                                  │
     │  ←── postMessage({ actions }) ───┤  (captured VoltAPI calls)
     │                                  │
     ├─ check permissions & run actions │
```

---

Cette documentation API complète tous les aspects techniques des plugins Volt. Consultez [DEVELOPMENT.md](./DEVELOPMENT.md) pour un guide plus général avec exemples pratiques.
