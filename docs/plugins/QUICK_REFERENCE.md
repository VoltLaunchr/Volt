# Plugin Quick Reference Card

Référence rapide pour le développement de plugins Volt (à imprimer ou garder sous la main).

---

## 🚀 Quick Start (30 secondes)

```typescript
// 1. Créer le fichier: src/features/plugins/builtin/my-plugin/index.ts
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

export class MyPlugin implements Plugin {
  id = 'my-plugin';
  name = 'My Plugin';
  description = 'Does something cool';
  enabled = true;

  canHandle(ctx: PluginContext): boolean {
    return ctx.query.startsWith('mp ');
  }

  match(ctx: PluginContext): PluginResult[] | null {
    return [
      {
        id: `my-${Date.now()}`,
        type: PluginResultType.Info,
        title: 'Result',
        score: 90,
        data: {},
      },
    ];
  }

  async execute(result: PluginResult): Promise<void> {
    console.log('Executed!');
  }
}

// 2. Enregistrer dans src/app/App.tsx
import { MyPlugin } from '../features/plugins/builtin/my-plugin';
pluginRegistry.register(new MyPlugin());
```

---

## 📋 Interface Plugin

```typescript
interface Plugin {
  id: string; // Identifiant unique
  name: string; // Nom affiché
  description: string; // Description
  enabled: boolean; // Activé/Désactivé

  canHandle(ctx: PluginContext): boolean;
  match(ctx: PluginContext): PluginResult[] | null;
  execute(result: PluginResult): Promise<void> | void;
}
```

---

## 🎯 Types principaux

### PluginContext

```typescript
interface PluginContext {
  query: string; // Requête utilisateur
  settings?: Record<string, unknown>;
}
```

### PluginResult

```typescript
interface PluginResult {
  id: string; // Unique ID
  type: PluginResultType; // Type de résultat
  title: string; // Titre principal
  subtitle?: string; // Sous-titre
  icon?: string; // Emoji ou URL
  badge?: string; // Badge texte
  score: number; // 0-100
  data?: Record<string, unknown>; // Données custom
}
```

### PluginResultType

```typescript
enum PluginResultType {
  Calculator = 'calculator',
  WebSearch = 'websearch',
  SystemCommand = 'systemcommand',
  Timer = 'timer',
  Clipboard = 'clipboard',
  Info = 'info',
  // ... etc
}
```

---

## ⚡ Performance Guidelines

| Méthode       | Temps max     | Note                          |
| ------------- | ------------- | ----------------------------- |
| `canHandle()` | < 1ms         | Doit être ultra-rapide        |
| `match()`     | < 500ms       | Timeout automatique           |
| `execute()`   | Pas de limite | Éviter les opérations longues |

---

## 📊 Score de pertinence

```typescript
// Échelle recommandée
95 - 100; // Exact match (titre exact, alias exact)
85 - 94; // Correspondance partielle forte (début du titre)
70 - 84; // Correspondance moyenne (contient le terme)
50 - 69; // Correspondance faible (fuzzy match)
0 - 49; // À éviter
```

---

## 🔧 Helper Functions

```typescript
// Copier dans le presse-papiers
import { copyToClipboard } from '@/features/plugins/utils/helpers';
await copyToClipboard('text');

// Ouvrir une URL
import { openUrl } from '@/features/plugins/utils/helpers';
await openUrl('https://example.com');

// Ouvrir un fichier/dossier
import { openFile } from '@/features/plugins/utils/helpers';
await openFile('C:\\path\\to\\file.txt');
```

---

## 📡 Tauri Commands

```typescript
import { invoke } from '@tauri-apps/api/core';

// Appeler une commande backend
const result = await invoke<MyData>('my_command', {
  param: 'value',
});

// Avec gestion d'erreur
try {
  await invoke('my_command');
} catch (error) {
  console.error('Command failed:', error);
}
```

---

## 🎭 Events système

```typescript
// Déclencher un événement
window.dispatchEvent(new CustomEvent('volt:open-settings'));

// Avec données
window.dispatchEvent(
  new CustomEvent('volt:notification', {
    detail: { type: 'success', message: 'Done!' },
  })
);

// Écouter un événement
useEffect(() => {
  const handler = (e: CustomEvent) => {
    console.log(e.detail);
  };
  window.addEventListener('volt:my-event', handler);
  return () => window.removeEventListener('volt:my-event', handler);
}, []);
```

### Événements prédéfinis

- `volt:open-settings` - Ouvrir les paramètres
- `volt:hide-window` - Masquer la fenêtre
- `volt:show-notification` - Notification

---

## 🛡️ Sécurité

```typescript
// ❌ JAMAIS ça
eval(result.data?.code);

// ✅ Faire ça à la place
const safeValue = sanitize(result.data?.value);
processValue(safeValue);
```

---

## 🐛 Error Handling

```typescript
// Dans match()
try {
  const data = this.fetchData(query);
  return this.toResults(data);
} catch (error) {
  console.error('[MyPlugin] Error:', error);
  return null; // Ne pas casser l'app
}

// Dans execute()
try {
  await this.action();
  console.log('✓ Success');
} catch (error) {
  console.error('✗ Failed:', error);
  // Optionnel : notifier l'utilisateur
}
```

---

## 💾 Cache Pattern

```typescript
class MyPlugin implements Plugin {
  private cache = new Map<string, CacheEntry>();
  private cacheTimeout = 3600000; // 1h

  private getFromCache(key: string): Data | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private saveToCache(key: string, data: Data): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });

    // Limiter la taille
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }
}
```

---

## 🎨 Pattern: Vue dédiée

```typescript
// Dans execute()
async execute(result: PluginResult): Promise<void> {
  window.dispatchEvent(new CustomEvent('volt:open-my-view', {
    detail: { data: result.data }
  }));
}

// Dans App.tsx
const [isMyViewActive, setIsMyViewActive] = useState(false);

useEffect(() => {
  const handler = (e: CustomEvent) => {
    setMyViewData(e.detail.data);
    setIsMyViewActive(true);
  };
  window.addEventListener('volt:open-my-view', handler);
  return () => window.removeEventListener('volt:open-my-view', handler);
}, []);

// Dans render
{isMyViewActive && (
  <MyPluginView
    data={myViewData}
    onClose={() => setIsMyViewActive(false)}
  />
)}
```

---

## 🔍 Pattern: Détection intelligente

```typescript
canHandle(ctx: PluginContext): boolean {
  const query = ctx.query.toLowerCase();

  // Préfixe explicite
  if (query.startsWith('calc ')) return true;

  // Détection pattern math
  const mathPattern = /^[\d+\-*/().\s]+$/;
  if (mathPattern.test(query) && /[+\-*/]/.test(query)) {
    return true;
  }

  // Mots-clés
  const keywords = ['calculate', 'compute'];
  if (keywords.some(k => query.includes(k))) {
    return true;
  }

  return false;
}
```

---

## 📦 Pattern: API externe

```typescript
async match(ctx: PluginContext): Promise<PluginResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return this.toResults(data);
  } catch (error) {
    console.error('[Plugin] API error:', error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
```

---

## 🦀 Backend Plugin (Rust)

```rust
// src-tauri/src/plugins/builtin/my_plugin/plugin.rs
use crate::plugins::api::VoltPluginAPI;

pub struct MyPlugin {
    api: Arc<VoltPluginAPI>,
}

impl MyPlugin {
    pub fn new(api: Arc<VoltPluginAPI>) -> Self {
        Self { api }
    }

    pub async fn do_something(&self) -> Result<Vec<Data>, String> {
        // Votre logique
        Ok(vec![])
    }
}

// Commande Tauri
#[tauri::command]
pub async fn my_command(
    plugin: State<'_, MyPlugin>
) -> Result<Vec<Data>, String> {
    plugin.do_something().await
}

// Enregistrer dans lib.rs
app.manage(MyPlugin::new(plugin_api.clone()));

.invoke_handler(tauri::generate_handler![
    my_command,
])
```

---

## 🧪 Testing

```typescript
// __tests__/myPlugin.test.ts
describe('MyPlugin', () => {
  let plugin: MyPlugin;

  beforeEach(() => {
    plugin = new MyPlugin();
  });

  test('should handle queries', () => {
    expect(plugin.canHandle({ query: 'test' })).toBe(true);
  });

  test('should return results', () => {
    const results = plugin.match({ query: 'test' });
    expect(results).toHaveLength(1);
    expect(results![0].title).toContain('test');
  });
});
```

---

## 📚 Documentation

- **Guide complet** : [DEVELOPMENT.md](./DEVELOPMENT.md)
- **API Reference** : [API_REFERENCE.md](./API_REFERENCE.md)
- **Exemples** : [EXAMPLES.md](./EXAMPLES.md)
- **Template** : [TEMPLATE.md](./TEMPLATE.md)

---

## ✅ Checklist de création

- [ ] Implémenter `canHandle()`
- [ ] Implémenter `match()`
- [ ] Implémenter `execute()`
- [ ] Gérer les erreurs
- [ ] Tester avec `bun tauri dev`
- [ ] Vérifier les perfs (< 500ms)
- [ ] Enregistrer dans App.tsx
- [ ] Documenter le plugin

---

**Version :** 1.0 | **Projet :** Volt | **Licence :** MIT
