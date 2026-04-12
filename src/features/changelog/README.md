# Changelog Feature

Système de gestion et d'affichage du changelog de Volt.

## Architecture

La source de vérité pour le changelog dans l'app est le fichier JSON structuré :

| Fichier                  | Usage                                              |
| ------------------------ | -------------------------------------------------- |
| `/public/changelog.json` | Source de vérité pour l'app (chargé dynamiquement) |
| `/CHANGELOG.md`          | Pour GitHub (affiché sur la page du repo)          |
| `/docs/changelog/CHANGELOG.md` | Changelog de la documentation (séparé)       |

## Fichiers

- **`components/ChangelogView.tsx`** - Composant principal qui charge et affiche le changelog
- **`components/ChangelogView.css`** - Styles du composant
- **`index.ts`** - Point d'entrée du module

## Fonctionnalités

### ✨ Affichage du Changelog

- Chargement dynamique du fichier `/public/changelog.json`
- États de chargement et d'erreur avec UI dédiée
- Icônes dynamiques basées sur le type de section

### 🎨 Styles

- Design moderne avec support des thèmes (dark/light)
- Scrollbar personnalisée
- Animations de chargement
- Typographie optimisée pour la lecture

### ⌨️ Navigation

- Touche `Échap` pour fermer
- Bouton de fermeture (X) dans l'en-tête
- Callback `onClose()` pour retour à la vue de recherche

### 📝 Support Markdown

- En-têtes (h1, h2, h3, h4)
- Gras et italique
- Code inline
- Listes (ul, li)
- Liens
- Lignes horizontales
- Emojis

## Utilisation

```tsx
import { ChangelogView } from '../features/changelog';

<ChangelogView onClose={handleClose} />;
```

## Intégration

Le changelog est accessible via :

1. **Suggestions** → "See what's new" (première suggestion)
2. Activation avec `Enter` ou clic

Dans `App.tsx` :

```tsx
switch (activeView.type) {
  case 'changelog':
    return <ChangelogView onClose={resetToSearchView} />;
  // ...
}
```

## Fichier Changelog

Le fichier `CHANGELOG.md` doit être :

- Placé dans `/public/CHANGELOG.md`
- Écrit en Markdown standard
- Organisé par versions et dates

### Format recommandé

```markdown
# Volt Changelog

## [0.0.2] - 2026-01-01

### ✨ Nouveautés

- Feature 1
- Feature 2

### 🔧 Améliorations

- Improvement 1

### 🐛 Corrections

- Fix 1
```

## Extension future

Pour supporter un Markdown plus riche, remplacer `convertMarkdownToHtml()` par une bibliothèque comme :

- `marked` (léger, rapide)
- `remark` (extensible, React-friendly)
- `react-markdown` (composants React)

Exemple avec `marked` :

```tsx
import { marked } from 'marked';

const html = marked(markdown);
```
