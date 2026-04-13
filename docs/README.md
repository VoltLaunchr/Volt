# Documentation Volt - Index

Bienvenue dans la documentation de Volt ! Ce dossier contient toutes les ressources pour comprendre et contribuer au projet.

## 📂 Structure

```
docs/
├── architecture/      # Architecture technique & features
├── user-guide/        # Guides utilisateur (raccourcis, etc.)
├── plugins/           # Développement et publication de plugins
├── build-release/     # CI/CD, distribution, roadmap
└── changelog/         # Historique des versions
```

---

## 👤 Guide Utilisateur

### [Features Guide](./architecture/FEATURES.md) ⭐

**Guide complet de toutes les fonctionnalités** — recherche, navigation, plugins intégrés, extensions, paramètres, support multi-plateformes.

### [Keyboard Shortcuts](./user-guide/SHORTCUTS.md) ⭐

**Référence complète des raccourcis clavier** — hotkeys globaux, contrôle des vues, navigation, actions sur les résultats, raccourcis des plugins.

---

## 🏗️ Architecture

### [Architecture & Technical Documentation](./architecture/ARCHITECTURE.md)

Vue d'ensemble de l'architecture technique de Volt :

- Structure frontend/backend
- Organisation des modules Rust
- Système de commandes Tauri
- Gestion des fenêtres et hotkeys

---

## 🔌 Plugins

### [Plugin Development Guide](./plugins/DEVELOPMENT.md) ⭐

**Guide complet pour créer vos propres plugins** (recommandé pour débuter) — architecture, plugins Frontend (TS/React), plugins Backend (Rust), exemples pas-à-pas, meilleures pratiques, FAQ.

### [Plugin API Reference](./plugins/API_REFERENCE.md)

**Documentation technique de l'API des plugins** — interface `Plugin`, types `PluginContext`/`PluginResult`, API Backend Rust, commandes Tauri, système d'événements.

### [Plugin Examples](./plugins/EXAMPLES.md)

**Collection d'exemples avancés** — cache, API externe, interface React dédiée, plugin hybride, paramètres utilisateur, historique, multi-sources.

### [Plugin Template](./plugins/TEMPLATE.md)

**Template prêt à l'emploi** — structure complète, code de base commenté, checklist de création.

### [Quick Reference](./plugins/QUICK_REFERENCE.md)

**Référence rapide** pour le développement de plugins — à garder sous la main.

### [Publishing Guide](./plugins/PUBLISHING_GUIDE.md)

**Guide pour publier la documentation** — conversion Markdown → Web, Docusaurus/VitePress/Next.js, SEO, déploiement.

### [Next.js Secure API](./plugins/NEXTJS_SECURE_API.md)

**API Next.js sécurisée pour repo privé** — architecture et bonnes pratiques.

### [Extension Registry Template](./plugins/EXTENSION_REGISTRY_TEMPLATE.json)

Template JSON pour le registre d'extensions.

### [Plugin Docs Summary](./plugins/SUMMARY.md)

Récapitulatif des documents plugins disponibles.

---

## 🚀 Build & Release

### [Roadmap](./build-release/ROADMAP.md) ⭐

**Roadmap actuelle** — phases ship-ready → quality → platform → features, avec milestones, tâches concrètes et estimations.

### [Distribution Guide](./build-release/DISTRIBUTION.md)

Packaging multi-plateformes, installateurs, signature de code, auto-updates.

### [Signing Setup](./build-release/SIGNING_SETUP.md)

Guide opérationnel pour activer Windows Authenticode + macOS notarization — options de certs, export `.pfx`/`.p12`, secrets GitHub, tests de validation.

### [CI/CD Pipeline](./build-release/CICD.md)

GitHub Actions workflows, tests automatisés, releases automatiques, déploiement.

### [Implementation Plan (historique)](./build-release/IMPLEMENTATION_PLAN.md)

Journal des milestones M0-M5 déjà livrés (stabilité, fichiers, plugins, hotkeys, OS integration).

---

## 📋 Changelog & Release Notes

### [Changelog](./changelog/CHANGELOG.md)

Historique complet des versions de Volt.

### [Updates 2025-01](./changelog/UPDATES_2025-01.md)

Résumé des mises à jour de janvier 2025.

### [Changelog View (feature)](../src/features/changelog/README.md)

Système intégré d'affichage du changelog dans l'app — accessible via les suggestions ("See what's new").

---

## 🚀 Quick Start - Créer un Plugin

### 1. Plugin Frontend Simple

```typescript
// src/features/plugins/builtin/my-plugin/index.ts
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

export class MyPlugin implements Plugin {
  id = 'my-plugin';
  name = 'My Plugin';
  description = 'Description of my plugin';
  enabled = true;

  canHandle(context: PluginContext): boolean {
    return context.query.startsWith('mp ');
  }

  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.substring(3);

    return [
      {
        id: 'result-1',
        type: PluginResultType.Info,
        title: `Result: ${query}`,
        score: 90,
        data: { query },
      },
    ];
  }

  async execute(result: PluginResult): Promise<void> {
    console.log('Executed!', result);
  }
}
```

### 2. Enregistrer le Plugin

```typescript
// src/app/App.tsx (dans useEffect)
import { MyPlugin } from '../features/plugins/builtin/my-plugin';

pluginRegistry.register(new MyPlugin());
```

### 3. Consulter les exemples

Plugins existants pour inspiration :

- **Calculator** : [src/features/plugins/builtin/calculator/](../src/features/plugins/builtin/calculator/)
- **Web Search** : [src/features/plugins/builtin/websearch/](../src/features/plugins/builtin/websearch/)
- **System Commands** : [src/features/plugins/builtin/systemcommands/](../src/features/plugins/builtin/systemcommands/)

---

## 📖 Ressources par Catégorie

### Pour les développeurs de plugins

| Document                                              | Description                          | Niveau        |
| ----------------------------------------------------- | ------------------------------------ | ------------- |
| [Plugin Development Guide](./plugins/DEVELOPMENT.md)  | Guide complet de création de plugins | Débutant      |
| [Plugin API Reference](./plugins/API_REFERENCE.md)    | Documentation technique de l'API     | Intermédiaire |
| [Plugin Examples](./plugins/EXAMPLES.md)              | Exemples avancés et patterns         | Avancé        |
| [Plugin Template](./plugins/TEMPLATE.md)              | Template prêt à l'emploi             | Tous niveaux  |
| [Quick Reference](./plugins/QUICK_REFERENCE.md)       | Référence rapide                     | Tous niveaux  |

### Pour les contributeurs

| Document                                                   | Description                         |
| ---------------------------------------------------------- | ----------------------------------- |
| [Architecture](./architecture/ARCHITECTURE.md)             | Comprendre l'architecture du projet |
| [Implementation Plan](./build-release/IMPLEMENTATION_PLAN.md) | Roadmap et priorités                |
| [CI/CD](./build-release/CICD.md)                           | Processus de build et release       |

### Pour la distribution

| Document                                           | Description                 |
| -------------------------------------------------- | --------------------------- |
| [Distribution Guide](./build-release/DISTRIBUTION.md) | Packaging et distribution   |
| [CI/CD](./build-release/CICD.md)                   | Automatisation des releases |

---

## 🛠️ Outils de Développement

### Installation

```bash
# Installer les dépendances
bun install

# Lancer en mode dev (Tauri + Vite)
bun tauri dev

# Build production
bun run build
bun tauri build
```

### Structure du Projet

```
Volt/
├── src/                          # Frontend (React 19/TypeScript 5.8)
│   ├── app/                      # Application principale
│   │   ├── App.tsx              # Main component (~197 lines)
│   │   └── hooks/               # Extracted hooks
│   │       ├── useSearchPipeline.ts
│   │       ├── useAppLifecycle.ts
│   │       ├── useGlobalHotkey.ts
│   │       └── useResultActions.ts
│   ├── features/                 # Features organisées par domaine
│   │   ├── plugins/             # Système de plugins
│   │   │   ├── builtin/         # 9 plugins intégrés
│   │   │   ├── core/            # Registry et infrastructure
│   │   │   └── types/           # Types TypeScript
│   │   ├── applications/        # Gestion des applications
│   │   ├── search/              # Barre de recherche
│   │   ├── results/             # Affichage des résultats
│   │   └── settings/            # Paramètres
│   └── shared/                  # Composants partagés
│
├── src-tauri/                   # Backend (Rust)
│   ├── src/
│   │   ├── commands/            # 13 command files (Tauri commands)
│   │   ├── plugins/             # 3 backend plugins
│   │   ├── indexer/             # Indexation de fichiers
│   │   ├── core/                # VoltResult, VoltError, types
│   │   └── hotkey/              # Hotkeys globales
│   └── Cargo.toml
│
└── docs/                        # 📚 Documentation (vous êtes ici)
    ├── architecture/
    ├── user-guide/
    ├── plugins/
    ├── build-release/
    └── changelog/
```

---

## 🤝 Contribuer

### Créer un nouveau plugin

1. Lisez le [Plugin Development Guide](./plugins/DEVELOPMENT.md)
2. Créez votre plugin dans `src/features/plugins/builtin/`
3. Enregistrez-le dans `src/app/App.tsx`
4. Testez localement avec `bun tauri dev`
5. Soumettez une Pull Request (or submit community extensions to [volt-extensions](https://github.com/VoltLaunchr/volt-extensions))

### Contribuer à la doc

Si vous trouvez des erreurs ou souhaitez améliorer la documentation :

1. Éditez le fichier concerné
2. Assurez-vous que les liens fonctionnent
3. Vérifiez l'orthographe et la clarté
4. Soumettez une Pull Request

---

## 📞 Support

- **Issues** : [GitHub Issues](https://github.com/VoltLaunchr/Volt/issues)
- **Discussions** : [GitHub Discussions](https://github.com/VoltLaunchr/Volt/discussions)

---

## 📝 License

Volt est un projet open-source. Consultez le fichier [LICENSE](../LICENSE) pour plus de détails.

---

**Bon développement ! 🚀**
