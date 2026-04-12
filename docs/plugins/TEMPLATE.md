# Plugin Template

Template prêt à l'emploi pour créer un nouveau plugin Volt.

## Utilisation

1. Copiez ce dossier dans `src/features/plugins/builtin/`
2. Renommez-le selon votre plugin (ex: `my-awesome-plugin`)
3. Modifiez les fichiers selon vos besoins
4. Enregistrez le plugin dans `src/app/App.tsx`

---

## Structure du template

```
my-plugin/
├── index.ts              # Plugin principal (obligatoire)
├── types.ts             # Types TypeScript (optionnel)
├── constants.ts         # Constantes (optionnel)
├── components/          # Composants React (optionnel)
│   ├── index.ts
│   └── MyPluginView.tsx
└── utils/              # Utilitaires (optionnel)
    └── helpers.ts
```

---

## index.ts (obligatoire)

```typescript
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

/**
 * TODO: Décrivez votre plugin ici
 *
 * Ce plugin fait X, Y, Z...
 */
export class MyPlugin implements Plugin {
  // ============================================
  // Configuration du plugin
  // ============================================

  /** Identifiant unique (kebab-case recommandé) */
  id = 'my-plugin';

  /** Nom affiché dans l'interface */
  name = 'My Plugin';

  /** Description courte */
  description = 'Short description of what this plugin does';

  /** Activé par défaut */
  enabled = true;

  // ============================================
  // Méthodes du plugin
  // ============================================

  /**
   * Détermine si le plugin peut traiter la requête
   *
   * Cette méthode doit être ULTRA-RAPIDE (< 1ms).
   * N'effectuez pas d'opérations lourdes ici.
   *
   * @param context - Contexte contenant la requête
   * @returns true si le plugin peut gérer cette requête
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.trim().toLowerCase();

    // TODO: Implémentez votre logique de détection
    // Exemples:

    // Préfixe simple
    // return query.startsWith('mp ');

    // Plusieurs préfixes
    // const triggers = ['mp ', 'myplugin ', 'my '];
    // return triggers.some(t => query.startsWith(t));

    // Pattern regex
    // return /^pattern/.test(query);

    // Détection intelligente
    // return this.detectMyPattern(query);

    return false; // Changez ceci !
  }

  /**
   * Génère les résultats pour la requête
   *
   * Timeout automatique de 500ms appliqué.
   * Retournez null si aucun résultat.
   *
   * @param context - Contexte de recherche
   * @returns Tableau de résultats ou null
   */
  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.trim();

    // TODO: Extraire la requête réelle (retirer le préfixe si nécessaire)
    // const actualQuery = query.substring(3); // Si préfixe "mp "

    // TODO: Valider la requête
    // if (!actualQuery) return null;

    // TODO: Générer vos résultats
    const results: PluginResult[] = [];

    // Exemple de résultat
    results.push({
      id: `my-plugin-${Date.now()}`, // ID unique
      type: PluginResultType.Info, // Type de résultat
      title: 'Result Title', // Titre principal
      subtitle: 'Press Enter to execute', // Sous-titre (optionnel)
      icon: '🔌', // Icône (emoji ou URL)
      score: 90, // Score de pertinence (0-100)
      data: {
        // Données pour execute()
        // Vos données personnalisées ici
        query: query,
        customField: 'value',
      },
    });

    return results.length > 0 ? results : null;
  }

  /**
   * Version asynchrone de match() (si nécessaire)
   *
   * Utilisez cette version si vous devez faire des appels API,
   * lire des fichiers, ou effectuer des opérations asynchrones.
   */
  /*
  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.trim();

    try {
      // Opération asynchrone (API, fichier, etc.)
      const data = await this.fetchData(query);

      // Convertir en résultats
      return data.map((item, index) => ({
        id: `my-plugin-${item.id}`,
        type: PluginResultType.Info,
        title: item.title,
        subtitle: item.description,
        score: 90 - index,
        data: item,
      }));
    } catch (error) {
      console.error('[MyPlugin] Error:', error);
      return [];
    }
  }
  */

  /**
   * Exécute l'action quand l'utilisateur sélectionne un résultat
   *
   * Appelé quand l'utilisateur appuie sur Entrée.
   *
   * @param result - Le résultat sélectionné
   */
  async execute(result: PluginResult): Promise<void> {
    // TODO: Implémentez votre action

    // Exemples d'actions:

    // 1. Copier dans le presse-papiers
    /*
    const text = result.data?.text as string;
    await navigator.clipboard.writeText(text);
    console.log('✓ Copied to clipboard:', text);
    */

    // 2. Ouvrir une URL
    /*
    const url = result.data?.url as string;
    window.open(url, '_blank');
    */

    // 3. Appeler un backend Tauri
    /*
    const id = result.data?.id as string;
    await invoke('my_command', { id });
    */

    // 4. Déclencher un événement personnalisé
    /*
    window.dispatchEvent(new CustomEvent('volt:my-action', {
      detail: { data: result.data },
    }));
    */

    console.log('[MyPlugin] Executed:', result);
  }

  // ============================================
  // Méthodes privées (helpers)
  // ============================================

  /**
   * Exemple de méthode helper privée
   */
  private processQuery(query: string): string {
    // Votre logique de traitement
    return query.toLowerCase().trim();
  }
}

// Export du plugin
export default MyPlugin;
```

---

## types.ts (optionnel)

```typescript
/**
 * Types personnalisés pour votre plugin
 */

export interface MyPluginSettings {
  enabled: boolean;
  maxResults: number;
  // Vos paramètres personnalisés
}

export interface MyData {
  id: string;
  name: string;
  // Vos données personnalisées
}

export interface MyApiResponse {
  results: MyData[];
  total: number;
  // Structure de réponse de votre API
}
```

---

## constants.ts (optionnel)

```typescript
/**
 * Constantes pour votre plugin
 */

export const PLUGIN_ID = 'my-plugin';
export const PLUGIN_NAME = 'My Plugin';

// Préfixes de commande
export const COMMAND_PREFIXES = ['mp ', 'myplugin '];

// Configuration
export const DEFAULT_MAX_RESULTS = 8;
export const API_TIMEOUT_MS = 5000;
export const CACHE_DURATION_MS = 3600000; // 1 heure

// URLs (si applicable)
export const API_BASE_URL = 'https://api.example.com';
export const DOCUMENTATION_URL = 'https://docs.example.com';
```

---

## components/MyPluginView.tsx (optionnel)

Si votre plugin nécessite une interface dédiée :

```typescript
import React, { useState } from 'react';
import './MyPluginView.css';

interface MyPluginViewProps {
  onClose: () => void;
  initialData?: any;
}

/**
 * Vue dédiée pour votre plugin
 *
 * Cette interface s'affiche en plein écran quand activée.
 */
export const MyPluginView: React.FC<MyPluginViewProps> = ({
  onClose,
  initialData
}) => {
  const [data, setData] = useState(initialData);

  const handleAction = async () => {
    // Votre logique d'action
  };

  return (
    <div className="my-plugin-view">
      {/* Header avec bouton de fermeture */}
      <div className="header">
        <h2>My Plugin</h2>
        <button onClick={onClose} className="close-btn">
          ✕
        </button>
      </div>

      {/* Contenu principal */}
      <div className="content">
        {/* Votre contenu ici */}
        <p>Plugin interface goes here</p>
      </div>

      {/* Footer avec actions (optionnel) */}
      <div className="footer">
        <button onClick={handleAction} className="primary-btn">
          Action
        </button>
        <button onClick={onClose} className="secondary-btn">
          Cancel
        </button>
      </div>
    </div>
  );
};
```

```css
/* components/MyPluginView.css */
.my-plugin-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  background: var(--bg-primary);
}

.my-plugin-view .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.my-plugin-view .header h2 {
  margin: 0;
  font-size: 24px;
  color: var(--text-primary);
}

.my-plugin-view .close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: color 0.2s;
}

.my-plugin-view .close-btn:hover {
  color: var(--text-primary);
}

.my-plugin-view .content {
  flex: 1;
  overflow-y: auto;
}

.my-plugin-view .footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}
```

---

## utils/helpers.ts (optionnel)

Fonctions utilitaires pour votre plugin :

```typescript
/**
 * Fonctions helper pour votre plugin
 */

/**
 * Copier du texte dans le presse-papiers
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Formater un nombre avec séparateurs de milliers
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('fr-FR').format(num);
}

/**
 * Tronquer un texte avec ellipse
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Débouncer une fonction
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Calculer le score de similarité entre deux chaînes
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 100;
  if (s2.startsWith(s1)) return 90;
  if (s2.includes(s1)) return 75;

  // Distance de Levenshtein simplifiée
  const distance = levenshteinDistance(s1, s2);
  return Math.max(0, 100 - distance * 5);
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}
```

---

## Enregistrement du plugin

Après avoir créé votre plugin, enregistrez-le dans `src/app/App.tsx` :

```typescript
// src/app/App.tsx

// Import de votre plugin
import { MyPlugin } from '../features/plugins/builtin/my-plugin';

// Dans le useEffect d'initialisation
useEffect(() => {
  const initializeApp = async () => {
    try {
      const loadedSettings = await settingsService.loadSettings();
      setSettings(loadedSettings);
      applyTheme(loadedSettings.appearance.theme);

      // Enregistrer les plugins
      pluginRegistry.register(new ClipboardPlugin());
      pluginRegistry.register(new CalculatorPlugin());
      // ... autres plugins ...

      // 🔌 Enregistrer votre plugin ici
      pluginRegistry.register(new MyPlugin());

      console.log('✓ Plugins initialized');
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  initializeApp();
}, []);
```

---

## Export du plugin

N'oubliez pas d'exporter votre plugin dans `src/features/plugins/builtin/index.ts` :

```typescript
// src/features/plugins/builtin/index.ts

// ... autres exports ...

// 🔌 Exporter votre plugin
export { MyPlugin } from './my-plugin';
export { MyPluginView } from './my-plugin/components/MyPluginView';
```

---

## Checklist de création

- [ ] Copier ce template dans `src/features/plugins/builtin/`
- [ ] Renommer le dossier
- [ ] Implémenter `canHandle()`
- [ ] Implémenter `match()`
- [ ] Implémenter `execute()`
- [ ] Créer les types nécessaires (optionnel)
- [ ] Créer les constantes (optionnel)
- [ ] Créer l'interface dédiée (optionnel)
- [ ] Exporter le plugin dans `builtin/index.ts`
- [ ] Enregistrer le plugin dans `App.tsx`
- [ ] Tester avec `bun tauri dev`
- [ ] Vérifier les performances (< 500ms pour `match()`)
- [ ] Gérer les erreurs gracieusement
- [ ] Documenter le plugin

---

## Ressources

- [Plugin Development Guide](./DEVELOPMENT.md)
- [Plugin API Reference](./API_REFERENCE.md)
- [Plugin Examples](./EXAMPLES.md)

---

Bon développement ! 🚀
