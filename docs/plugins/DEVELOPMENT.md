# Plugin Development Guide

Bienvenue dans le guide de développement des plugins pour Volt ! Ce guide vous aidera à créer vos propres plugins pour étendre les fonctionnalités de Volt.

## Table des matières

1. [Architecture des plugins](#architecture-des-plugins)
2. [Types de plugins](#types-de-plugins)
3. [Créer un plugin Frontend (TypeScript)](#créer-un-plugin-frontend-typescript)
4. [Créer un plugin Backend (Rust)](#créer-un-plugin-backend-rust)
5. [Exemples de plugins](#exemples-de-plugins)
6. [Meilleures pratiques](#meilleures-pratiques)
7. [API Reference](#api-reference)

---

## Architecture des plugins

Volt possède un système de plugins hybride avec deux couches :

### 🎨 Frontend Plugins (TypeScript/React)

- Gèrent l'interface utilisateur et les interactions
- Parfaits pour : calculatrices, recherches web, raccourcis, etc.
- Exécutés dans le contexte de l'application
- Timeout de 500ms par requête

### ⚙️ Backend Plugins (Rust)

- Gèrent les intégrations système
- Parfaits pour : scanners de jeux, moniteurs système, intégrations cloud
- Accès complet au système de fichiers et aux APIs système

```
┌─────────────────────────────────────────────┐
│          Frontend (React/TypeScript)        │
│  ┌────────────────────────────────────┐    │
│  │      Plugin Registry               │    │
│  │  • Manages all plugins             │    │
│  │  • Routes queries                  │    │
│  │  • Handles timeouts                │    │
│  └────────────────────────────────────┘    │
│              ↓                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │ Plugin  │  │ Plugin  │  │ Plugin  │   │
│  │   A     │  │   B     │  │   C     │   │
│  └─────────┘  └─────────┘  └─────────┘   │
└─────────────────────────────────────────────┘
               ↕ Tauri IPC
┌─────────────────────────────────────────────┐
│           Backend (Rust/Tauri)              │
│  ┌────────────────────────────────────┐    │
│  │      Plugin API (VoltPluginAPI)    │    │
│  │  • File system access             │    │
│  │  • Configuration management       │    │
│  │  • System integrations            │    │
│  └────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

---

## Types de plugins

### Frontend Plugin Types

Les plugins frontend peuvent retourner différents types de résultats :

```typescript
enum PluginResultType {
  Calculator = 'calculator', // Calculs mathématiques
  WebSearch = 'websearch', // Recherche web
  SystemCommand = 'systemcommand', // Commandes système
  Timer = 'timer', // Minuteurs
  SystemMonitor = 'systemmonitor', // Moniteur système
  Steam = 'steam', // Jeux Steam
  Game = 'game', // Jeux (toutes plateformes)
  Clipboard = 'clipboard', // Historique presse-papiers
  Emoji = 'emoji', // Sélecteur d'emoji
  Info = 'info', // Informations générales
}
```

---

## Créer un plugin Frontend (TypeScript)

### Étape 1 : Créer la structure du plugin

```
src/features/plugins/builtin/my-plugin/
├── index.ts              # Plugin principal
├── types.ts             # Types TypeScript
├── components/          # Composants React (optionnel)
│   └── MyPluginView.tsx
└── utils/              # Utilitaires (optionnel)
    └── helpers.ts
```

### Étape 2 : Implémenter l'interface Plugin

Créez votre plugin dans `index.ts` :

```typescript
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

export class MyPlugin implements Plugin {
  // Identifiant unique du plugin (utilisé en interne)
  id = 'my-plugin';

  // Nom affiché dans les paramètres
  name = 'My Awesome Plugin';

  // Description du plugin
  description = 'Does something amazing';

  // Plugin activé par défaut
  enabled = true;

  /**
   * Détermine si le plugin peut traiter la requête
   * @param context - Contexte contenant la requête et les paramètres
   * @returns true si le plugin peut gérer cette requête
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.trim().toLowerCase();

    // Exemple : activer sur un préfixe spécifique
    return query.startsWith('mp ') || query.startsWith('myplugin ');
  }

  /**
   * Génère les résultats pour la requête
   * @param context - Contexte de recherche
   * @returns Tableau de résultats ou null si aucun résultat
   */
  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.trim();

    // Extraction de la requête réelle
    let searchQuery = query;
    if (query.toLowerCase().startsWith('mp ')) {
      searchQuery = query.substring(3).trim();
    } else if (query.toLowerCase().startsWith('myplugin ')) {
      searchQuery = query.substring(9).trim();
    }

    // Si pas de requête, ne rien retourner
    if (!searchQuery) {
      return null;
    }

    // Créer et retourner les résultats
    return [
      {
        id: `my-plugin-${Date.now()}`,
        type: PluginResultType.Info,
        title: `Result for: ${searchQuery}`,
        subtitle: 'Press Enter to execute',
        icon: '🔌', // Emoji ou chemin vers une icône
        score: 85, // Score de pertinence (0-100)
        data: {
          // Données personnalisées pour l'exécution
          query: searchQuery,
          customData: 'some value',
        },
      },
    ];
  }

  /**
   * Exécute l'action quand l'utilisateur sélectionne un résultat
   * @param result - Le résultat sélectionné
   */
  async execute(result: PluginResult): Promise<void> {
    const query = result.data?.query as string;

    // Implémenter votre logique ici
    console.log(`Executing with query: ${query}`);

    // Exemples d'actions possibles :
    // - Copier dans le presse-papiers
    // - Ouvrir une URL
    // - Appeler un backend Tauri
    // - Afficher une notification
  }
}
```

### Étape 3 : Enregistrer le plugin

Dans `src/features/plugins/builtin/index.ts`, ajoutez votre plugin :

```typescript
import { MyPlugin } from './my-plugin';

// Ajoutez-le aux exports
export { MyPlugin } from './my-plugin';
```

Dans `src/app/App.tsx`, enregistrez-le au démarrage :

```typescript
import { MyPlugin } from '../features/plugins/builtin';

// Dans le useEffect d'initialisation
useEffect(() => {
  const initializeApp = async () => {
    // ... autres plugins ...
    pluginRegistry.register(new MyPlugin());
  };

  initializeApp();
}, []);
```

### Étape 4 : Créer un composant de vue (optionnel)

Si votre plugin a besoin d'une interface dédiée :

```typescript
// components/MyPluginView.tsx
import React from 'react';

interface MyPluginViewProps {
  onClose: () => void;
}

export const MyPluginView: React.FC<MyPluginViewProps> = ({ onClose }) => {
  return (
    <div className="my-plugin-view">
      <div className="header">
        <h2>My Plugin</h2>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="content">
        {/* Votre contenu ici */}
      </div>
    </div>
  );
};
```

---

## Créer un plugin Backend (Rust)

### Étape 1 : Créer la structure du plugin

```
src-tauri/src/plugins/builtin/my_plugin/
├── mod.rs        # Module principal
├── plugin.rs     # Implémentation du plugin
└── types.rs      # Types Rust (optionnel)
```

### Étape 2 : Implémenter le plugin

```rust
// src-tauri/src/plugins/builtin/my_plugin/plugin.rs
use std::sync::Arc;
use crate::plugins::api::VoltPluginAPI;

pub struct MyPlugin {
    api: Arc<VoltPluginAPI>,
}

impl MyPlugin {
    pub fn new(api: Arc<VoltPluginAPI>) -> Self {
        Self { api }
    }

    /// Initialiser le plugin (scan initial, etc.)
    pub async fn initialize(&self) -> Result<(), String> {
        println!("✓ My Plugin initialized");
        Ok(())
    }

    /// Votre logique métier ici
    pub async fn do_something(&self) -> Result<Vec<MyData>, String> {
        // Accès au système de fichiers via l'API
        let cache_dir = self.api.get_plugin_cache_dir("my_plugin")
            .map_err(|e| e.to_string())?;

        // Implémenter votre logique
        Ok(vec![])
    }
}
```

### Étape 3 : Créer des commandes Tauri

```rust
// src-tauri/src/commands/my_plugin.rs
use tauri::State;
use crate::plugins::builtin::my_plugin::MyPlugin;

/// Commande Tauri accessible depuis le frontend
#[tauri::command]
pub async fn my_plugin_command(
    plugin: State<'_, MyPlugin>
) -> Result<Vec<MyData>, String> {
    plugin.do_something().await
}
```

### Étape 4 : Enregistrer le plugin et les commandes

Dans `src-tauri/src/plugins/builtin/mod.rs` :

```rust
pub mod my_plugin;
pub use my_plugin::MyPlugin;

use std::sync::Arc;
use crate::plugins::api::VoltPluginAPI;

pub fn get_builtin_plugins(api: Arc<VoltPluginAPI>) -> Vec<Box<dyn std::any::Any>> {
    vec![
        // Autres plugins...
        Box::new(MyPlugin::new(api.clone())),
    ]
}
```

Dans `src-tauri/src/lib.rs` :

```rust
// Dans la fonction setup
app.manage(MyPlugin::new(plugin_api.clone()));

// Dans generate_handler
.invoke_handler(tauri::generate_handler![
    // Autres commandes...
    my_plugin_command,
])
```

### Étape 5 : Appeler depuis le frontend

```typescript
import { invoke } from '@tauri-apps/api/core';

// Appeler votre commande
const results = await invoke('my_plugin_command');
```

---

## Exemples de plugins

### Exemple 1 : Plugin de recherche web simple

```typescript
export class WebSearchPlugin implements Plugin {
  id = 'websearch';
  name = 'Web Search';
  description = 'Search the web';
  enabled = true;

  canHandle(context: PluginContext): boolean {
    return context.query.trim().startsWith('?');
  }

  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.substring(1).trim();
    if (!query) return null;

    return [
      {
        id: `web-${Date.now()}`,
        type: PluginResultType.WebSearch,
        title: `Search "${query}" on Google`,
        subtitle: 'Press Enter to search',
        score: 90,
        data: {
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        },
      },
    ];
  }

  async execute(result: PluginResult): Promise<void> {
    const url = result.data?.url as string;
    window.open(url, '_blank');
  }
}
```

### Exemple 2 : Plugin calculatrice

```typescript
export class CalculatorPlugin implements Plugin {
  id = 'calculator';
  name = 'Calculator';
  description = 'Evaluate math expressions';
  enabled = true;

  canHandle(context: PluginContext): boolean {
    const query = context.query.trim();
    // Détection simple : contient des chiffres et opérateurs
    return /[\d+\-*/().]/.test(query);
  }

  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.trim();

    try {
      // ATTENTION : N'utilisez JAMAIS eval() en production !
      // Utilisez une bibliothèque de parsing sûre comme math.js
      const result = this.evaluateExpression(query);

      return [
        {
          id: `calc-${Date.now()}`,
          type: PluginResultType.Calculator,
          title: result.toString(),
          subtitle: `${query} = ${result}`,
          score: 95,
          data: { result, expression: query },
        },
      ];
    } catch {
      return null;
    }
  }

  async execute(result: PluginResult): Promise<void> {
    const value = result.data?.result?.toString() || '';
    await navigator.clipboard.writeText(value);
    console.log('✓ Copied to clipboard:', value);
  }

  private evaluateExpression(expr: string): number {
    // Implémentez votre propre parser sécurisé ici
    // Ou utilisez une bibliothèque comme math.js
    return 0;
  }
}
```

### Exemple 3 : Plugin Backend pour scanner des jeux

```rust
pub struct GameScannerPlugin {
    api: Arc<VoltPluginAPI>,
    games: Arc<RwLock<Vec<Game>>>,
}

impl GameScannerPlugin {
    pub fn new(api: Arc<VoltPluginAPI>) -> Self {
        Self {
            api,
            games: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Scanner les jeux installés
    pub async fn scan_games(&self) -> Result<Vec<Game>, String> {
        let mut games = Vec::new();

        // Scanner Steam
        if let Ok(steam_games) = self.scan_steam_library().await {
            games.extend(steam_games);
        }

        // Scanner Epic Games
        if let Ok(epic_games) = self.scan_epic_library().await {
            games.extend(epic_games);
        }

        // Mettre à jour le cache
        if let Ok(mut cached_games) = self.games.write() {
            *cached_games = games.clone();
        }

        Ok(games)
    }

    async fn scan_steam_library(&self) -> Result<Vec<Game>, String> {
        // Implémentation du scan Steam
        Ok(vec![])
    }

    async fn scan_epic_library(&self) -> Result<Vec<Game>, String> {
        // Implémentation du scan Epic
        Ok(vec![])
    }
}
```

---

## Meilleures pratiques

### 🎯 Performance

1. **Timeout respecté** : Les plugins frontend ont 500ms max pour répondre
2. **Lazy loading** : Chargez les données lourdes uniquement quand nécessaire
3. **Cache** : Utilisez le cache pour les données qui changent rarement
4. **Async** : Privilégiez les opérations asynchrones

```typescript
// ❌ Mauvais : Opération synchrone lourde
match(context: PluginContext): PluginResult[] {
  const data = this.loadHeavyData(); // Bloque !
  return this.processData(data);
}

// ✅ Bon : Opération asynchrone
async match(context: PluginContext): Promise<PluginResult[]> {
  const data = await this.loadHeavyDataAsync();
  return this.processData(data);
}
```

### 🔒 Sécurité

1. **Validation d'entrée** : Validez toujours les inputs utilisateur
2. **Pas d'eval()** : N'utilisez jamais `eval()` ou équivalent
3. **Sanitisation** : Nettoyez les données avant affichage
4. **Path traversal** : Validez les chemins de fichiers

```typescript
// ❌ Dangereux
execute(result: PluginResult) {
  eval(result.data?.code); // JAMAIS !
}

// ✅ Sûr
execute(result: PluginResult) {
  const safeValue = this.sanitize(result.data?.value);
  this.processValue(safeValue);
}
```

### 🎨 UX

1. **Score pertinent** : Utilisez des scores cohérents (0-100)
   - 95-100 : Correspondance exacte
   - 85-94 : Correspondance partielle forte
   - 70-84 : Correspondance moyenne
   - 50-69 : Correspondance faible

2. **Icônes claires** : Utilisez des icônes/emojis reconnaissables
3. **Sous-titres informatifs** : Expliquez l'action qui sera effectuée
4. **Feedback** : Loggez les actions pour le debugging

```typescript
// ✅ Bon exemple de résultat
{
  id: 'unique-id',
  type: PluginResultType.Info,
  title: 'Action Title',                    // Clair et concis
  subtitle: 'Press Enter to execute',       // Action explicite
  icon: '🔌',                               // Icône reconnaissable
  score: 85,                                // Score approprié
  data: { /* données nécessaires */ },
}
```

### 🧹 Code propre

1. **Types TypeScript** : Utilisez les types pour tout
2. **Error handling** : Gérez les erreurs gracieusement
3. **Logging** : Loggez les erreurs et succès
4. **Documentation** : Commentez les fonctions complexes

```typescript
// ✅ Bon : Types + error handling
async execute(result: PluginResult): Promise<void> {
  try {
    const data = result.data as MyData;
    if (!data) {
      console.warn('No data in result');
      return;
    }

    await this.processData(data);
    console.log('✓ Success:', data);
  } catch (error) {
    console.error('✗ Plugin execution failed:', error);
  }
}
```

### 📦 Structure du projet

```
my-plugin/
├── index.ts              # Export principal
├── types.ts             # Types TypeScript
├── constants.ts         # Constantes
├── components/          # Composants React
│   ├── index.ts
│   └── MyView.tsx
├── utils/              # Utilitaires
│   ├── helpers.ts
│   ├── parsers.ts
│   └── validators.ts
└── __tests__/          # Tests (optionnel)
    └── plugin.test.ts
```

---

## API Reference

### Plugin Interface (Frontend)

```typescript
interface Plugin {
  /** Identifiant unique du plugin */
  id: string;

  /** Nom affiché */
  name: string;

  /** Description du plugin */
  description: string;

  /** État d'activation */
  enabled: boolean;

  /**
   * Détermine si le plugin peut traiter la requête
   * @param context - Contexte avec query et settings
   * @returns true si le plugin peut gérer cette requête
   */
  canHandle(context: PluginContext): boolean;

  /**
   * Génère les résultats pour la requête
   * @param context - Contexte de recherche
   * @returns Tableau de résultats ou null
   */
  match(context: PluginContext): Promise<PluginResult[]> | PluginResult[] | null;

  /**
   * Exécute l'action du résultat sélectionné
   * @param result - Résultat sélectionné par l'utilisateur
   */
  execute(result: PluginResult): Promise<void> | void;
}
```

### PluginContext

```typescript
interface PluginContext {
  /** Requête de recherche de l'utilisateur */
  query: string;

  /** Paramètres optionnels (configuration, etc.) */
  settings?: Record<string, unknown>;
}
```

### PluginResult

```typescript
interface PluginResult {
  /** Identifiant unique du résultat */
  id: string;

  /** Type de résultat (définit l'icône/style) */
  type: PluginResultType;

  /** Titre principal affiché */
  title: string;

  /** Sous-titre optionnel */
  subtitle?: string;

  /** Icône (emoji ou chemin) */
  icon?: string;

  /** Badge affiché à droite */
  badge?: string;

  /** Score de pertinence (0-100) */
  score: number;

  /** Données personnalisées pour execute() */
  data?: Record<string, unknown>;

  /** ID du plugin (ajouté automatiquement) */
  pluginId?: string;
}
```

### Plugin Registry

```typescript
class PluginRegistry {
  /** Enregistrer un nouveau plugin */
  register(plugin: Plugin): void;

  /** Désenregistrer un plugin */
  unregister(pluginId: string): void;

  /** Récupérer un plugin par ID */
  getPlugin(pluginId: string): Plugin | undefined;

  /** Récupérer tous les plugins */
  getAllPlugins(): Plugin[];

  /** Récupérer les plugins activés */
  getEnabledPlugins(): Plugin[];

  /** Interroger tous les plugins activés */
  query(context: PluginContext): Promise<PluginResult[]>;
}
```

### Volt Plugin API (Backend Rust)

```rust
pub struct VoltPluginAPI {
    // État interne
}

impl VoltPluginAPI {
    /// Créer une nouvelle instance de l'API
    pub fn new(app_data_dir: PathBuf) -> Self;

    /// Obtenir le répertoire de cache du plugin
    pub fn get_plugin_cache_dir(&self, plugin_id: &str) -> Result<PathBuf, String>;

    /// Obtenir le répertoire de configuration du plugin
    pub fn get_plugin_config_dir(&self, plugin_id: &str) -> Result<PathBuf, String>;

    /// Lire un fichier de cache
    pub async fn read_cache_file(&self, plugin_id: &str, cache_key: &str) -> Result<Vec<u8>, String>;

    /// Écrire dans un fichier de cache
    pub async fn write_cache_file(&self, plugin_id: &str, cache_key: &str, data: &[u8]) -> Result<(), String>;

    /// Supprimer un fichier de cache
    pub async fn delete_cache_file(&self, plugin_id: &str, cache_key: &str) -> Result<(), String>;
}
```

### Utilitaires Helper

```typescript
// src/features/plugins/utils/helpers.ts

/** Copier du texte dans le presse-papiers */
export async function copyToClipboard(text: string): Promise<boolean>;

/** Ouvrir une URL dans le navigateur par défaut */
export async function openUrl(url: string): Promise<void>;

/** Ouvrir un fichier/dossier avec l'application par défaut */
export async function openFile(path: string): Promise<void>;
```

---

## Communication Plugin → UI

Pour déclencher des actions UI depuis un plugin, utilisez des événements DOM personnalisés :

```typescript
// Dans votre plugin
async execute(result: PluginResult): Promise<void> {
  // Déclencher un événement personnalisé
  window.dispatchEvent(new CustomEvent('volt:open-settings'));
}
```

```typescript
// Dans App.tsx (ou autre composant)
useEffect(() => {
  const handleOpenSettings = () => {
    // Votre logique ici
  };

  window.addEventListener('volt:open-settings', handleOpenSettings);
  return () => window.removeEventListener('volt:open-settings', handleOpenSettings);
}, []);
```

### Événements prédéfinis

- `volt:open-settings` - Ouvrir les paramètres
- `volt:hide-window` - Masquer la fenêtre principale
- `volt:show-notification` - Afficher une notification

---

## Testing

### Test d'un plugin Frontend

```typescript
// __tests__/myPlugin.test.ts
import { MyPlugin } from '../index';

describe('MyPlugin', () => {
  let plugin: MyPlugin;

  beforeEach(() => {
    plugin = new MyPlugin();
  });

  test('should handle queries starting with prefix', () => {
    expect(plugin.canHandle({ query: 'mp test' })).toBe(true);
    expect(plugin.canHandle({ query: 'other' })).toBe(false);
  });

  test('should return results for valid query', () => {
    const results = plugin.match({ query: 'mp test query' });

    expect(results).not.toBeNull();
    expect(results).toHaveLength(1);
    expect(results![0].title).toContain('test query');
  });

  test('should execute without errors', async () => {
    const result = {
      id: 'test',
      type: PluginResultType.Info,
      title: 'Test',
      score: 50,
      data: { query: 'test' },
    };

    await expect(plugin.execute(result)).resolves.not.toThrow();
  });
});
```

---

## Débogage

### Logs

Utilisez les logs pour tracer l'exécution :

```typescript
export class MyPlugin implements Plugin {
  match(context: PluginContext): PluginResult[] | null {
    console.log('[MyPlugin] Query received:', context.query);

    const results = this.processQuery(context.query);

    console.log('[MyPlugin] Results:', results?.length || 0);
    return results;
  }

  async execute(result: PluginResult): Promise<void> {
    console.log('[MyPlugin] Executing:', result.id);

    try {
      await this.performAction(result);
      console.log('✓ [MyPlugin] Success');
    } catch (error) {
      console.error('✗ [MyPlugin] Error:', error);
    }
  }
}
```

### Outils de développement

1. **Chrome DevTools** : Inspectez la console pour voir les logs
2. **React DevTools** : Inspectez les composants React
3. **Performance profiling** : Utilisez le profiler pour détecter les ralentissements

---

## FAQ

### Q : Comment déboguer mon plugin ?

**R :** Utilisez `console.log()` pour tracer l'exécution. Les logs apparaîtront dans la console du DevTools.

### Q : Mon plugin est lent, comment l'optimiser ?

**R :**

- Vérifiez que `canHandle()` est rapide (< 1ms)
- Utilisez le cache pour les opérations lourdes
- Évitez les calculs dans `match()` si possible
- Utilisez `async/await` pour les opérations longues

### Q : Comment accéder aux paramètres utilisateur ?

**R :** Les paramètres sont passés dans `context.settings`. Vous pouvez y stocker la configuration de votre plugin.

### Q : Puis-je utiliser des bibliothèques externes ?

**R :** Oui ! Installez-les via `bun add` et importez-les normalement.

### Q : Comment partager mon plugin ?

**R :** Actuellement, les plugins sont intégrés au code source. Le support des plugins externes est prévu pour une version future.

---

## Ressources

### Documentation officielle

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Plugins d'exemple

- [Calculator Plugin](../src/features/plugins/builtin/calculator/)
- [Web Search Plugin](../src/features/plugins/builtin/websearch/)
- [System Commands Plugin](../src/features/plugins/builtin/systemcommands/)
- [Game Scanner Plugin](../src-tauri/src/plugins/builtin/game_scanner/)

### Contribuer

Si vous créez un plugin utile, n'hésitez pas à soumettre une Pull Request !

1. Fork le projet
2. Créez votre branche (`git checkout -b feature/my-plugin`)
3. Committez vos changements (`git commit -m 'Add my plugin'`)
4. Push vers la branche (`git push origin feature/my-plugin`)
5. Ouvrez une Pull Request

---

## Support

Besoin d'aide ?

- 📖 Consultez la [documentation](../README.md)
- 🐛 Signalez un bug sur [GitHub Issues](https://github.com/VoltLaunchr/Volt/issues)
- 💬 Rejoignez notre communauté (lien à venir)

---

**Bonne création de plugins ! 🚀**
