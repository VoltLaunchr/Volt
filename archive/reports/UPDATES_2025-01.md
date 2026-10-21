# Volt Updates - January 2025

Résumé des mises à jour et améliorations apportées à Volt.

---

## 🎯 Changements Majeurs

### Hotkey System Overhaul

**Avant** : Système de fallback avec plusieurs combinaisons tentées automatiquement
**Maintenant** : Un seul hotkey par défaut avec configuration claire

- **Nouveau hotkey par défaut** : `Ctrl+Space` (au lieu de `Ctrl+Shift+Space`)
- **Plus de fallbacks automatiques** - meilleure transparence pour l'utilisateur
- **Messages d'erreur améliorés** - direction claire vers les paramètres
- **Détection de conflits** - avertit si le hotkey est déjà utilisé par une autre app
- **Enregistrement best-effort** - l'app démarre même si l'enregistrement échoue

**Impact utilisateur** : Plus prévisible, plus facile à configurer, meilleurs messages d'aide.

### Changelog Integration

Nouveau système d'affichage du changelog intégré :

- Vue dédiée accessible via les suggestions "See what's new"
- Affichage markdown avec styles personnalisés
- Navigation clavier complète
- Design moderne avec glass morphism
- Support des emojis et formatage Markdown

**Fichiers** :
- `/src/features/changelog/` - Nouveau module complet
- `/public/CHANGELOG.md` - Fichier changelog public
- `/CHANGELOG.md` - Changelog racine

---

## ⌨️ Navigation & Keyboard Improvements

### Enhanced Navigation

**Nouvelles touches de navigation** :
- `Home` - Aller au premier résultat
- `End` - Aller au dernier résultat
- `Page Up` - Sauter 5 résultats vers le haut
- `Page Down` - Sauter 5 résultats vers le bas
- `Tab` - Autocomplétion avec le titre du résultat sélectionné

### Auto-Scroll Selection

Les résultats et suggestions sélectionnés scrollent automatiquement dans la vue :
- Comportement smooth scroll
- Utilise `scrollIntoView` avec `block: 'nearest'`
- Implémenté dans `ResultsList` et `SuggestionsView`

### New Keyboard Shortcuts

**Globaux** :
- `F1` - Ouvrir l'aide / documentation (fonctionne partout)

**Actions sur résultats** :
- `Ctrl+O` - Ouvrir le dossier parent
- `Ctrl+I` - Afficher les propriétés
- `Ctrl+C` - Copier le chemin (si aucun texte sélectionné)
- `Ctrl+Delete` - Supprimer de l'historique
- `Shift+Enter` - Exécuter en tant qu'administrateur
- `Ctrl+Enter` - Exécuter en arrière-plan (ne ferme pas la fenêtre)

**Contrôle des vues** :
- `Ctrl+,` - Ouvrir les paramètres
- `Ctrl+R` - Recharger Volt
- `Ctrl+Q` - Quitter Volt
- `Ctrl+K` - Effacer l'entrée

---

## 🧮 Calculator Plugin Enhancements

### Enhanced Math Parser

**Améliorations** :
- Support de la notation scientifique : `1.23e-10`, `5E+3`
- Parser recursif plus robuste
- Meilleure gestion des espaces
- Détection améliorée des fonctions

**Nouvelles capacités** :
- Calculs scientifiques complexes
- Meilleur support des constantes (`pi`, `e`)
- Gestion des nombres très grands/petits

### Calculator View Shortcut

Nouveau raccourci pour ouvrir la vue calculatrice :
- Taper `calc` seul ouvre la vue complète
- Event personnalisé `volt:open-calculator`
- Vue avec historique et toutes les fonctionnalités

---

## 🎮 Game Scanner Improvements

### Launch URI Fixes

**Correction majeure pour EA Games et Riot Games** :

**Avant** : Lancement direct de l'exe → erreurs d'authentification
**Maintenant** : Utilisation des URIs de protocole appropriés

**EA App** :
- Utilise `origin2://game/launch?offerIds=...`
- Fallback sur `link2ea://launchgame/...`
- Lancement via PowerShell pour meilleure gestion des URIs
- Messages d'erreur clairs si pas de launch_uri disponible

**Riot Games** :
- Utilise `riotclient://launch-product?product=...`
- Authentification appropriée via Riot Client
- Pas de lancement direct d'exe (évite les problèmes d'auth)

**Steam** :
- Fix pour les URLs avec caractères spéciaux
- Utilise `start "" "URL"` pour éviter les problèmes de parsing

### Singleton Pattern

**Optimisation mémoire et performance** :
- `GameScannerPlugin` utilise maintenant un singleton avec `OnceLock`
- Une seule instance partagée entre toutes les commandes
- Cache interne préservé entre les appels
- Réduction de la consommation mémoire

---

## 🔌 Extension System Improvements

### Hot Reload Extensions

**Nouvelle fonctionnalité** :
- Communication entre fenêtre principale et fenêtre paramètres via events Tauri
- Actions : `load`, `unload`, `reload`
- Événement `extension-changed` avec payload

**Fonctionnalités** :
- Installation d'extension → chargement automatique
- Désinstallation → déchargement automatique
- Toggle enable/disable → load/unload en temps réel
- Refresh dev extension → rechargement du code

**Sécurité** :
- Validation des IDs d'extension (pas de path traversal)
- Validation des URLs de téléchargement (HTTPS seulement)
- Blocage des adresses locales/privées
- Caractères alphanumériques + dash/underscore seulement

### Extension Loading

**Prévention double-enregistrement** :
- Protection contre StrictMode React
- Flag `isInitialized()` dans le registry
- Enregistrement silencieux si déjà présent

---

## 🎨 UI/UX Improvements

### Emoji Picker Styling

Refonte complète du style pour matcher le design Volt :

- Glass morphism design cohérent
- Variables CSS globales utilisées partout
- Grid optimisé (7 colonnes au lieu de 8)
- Transitions et animations améliorées
- Meilleure hiérarchie visuelle
- Support thème dark/light amélioré

### View State Management

**Refactoring majeur** :

**Avant** : Multiple flags booléens (`isEmojiPickerActive`, `isCalculatorActive`, etc.)
**Maintenant** : Union discriminée `ActiveView`

```typescript
type ActiveView =
  | { type: 'search' }
  | { type: 'clipboard' }
  | { type: 'emoji'; initialQuery?: string }
  | { type: 'calculator' }
  | { type: 'games' }
  | { type: 'changelog' };
```

**Avantages** :
- Type-safe state management
- Pas de flags contradictoires
- Code plus maintenable
- Meilleure gestion des données spécifiques aux vues

### System Commands

Nouvelles commandes système :

- `about` / `info` / `version` - Ouvre le site Volt
- `account` / `user` / `profile` - Ouvrir les paramètres utilisateur

---

## 🚀 Performance Optimizations

### Plugin Keyword Boosting

**Nouveau système de scoring** :

```typescript
const SEARCH_PRIORITIES = {
  APPLICATION: 200,
  FILE: 80,
  PLUGIN_BASE: 100,
  PLUGIN_KEYWORD_BOOST: 300, // Boost quand la query matche les mots-clés
};
```

**Mots-clés par plugin** :
- Calculator: `calc`, `=`, `math`
- Timer: `timer`, `countdown`, `pomodoro`
- Web Search: `?`, `web`, `search`
- Emoji: `emoji`, `:`
- System Monitor: `system`, `cpu`, `ram`
- Games: `game`, `steam`, `epic`
- Clipboard: `clipboard`

**Résultat** : Les plugins apparaissent en premier quand le mot-clé est détecté.

### Code Splitting

**Optimisation Vite config** :

Nouveaux chunks séparés :
- `vendor-icons` - lucide-react (lourd)
- `vendor-emoji` - emojibase data
- `vendor-date` - date-fns
- `vendor-sucrase` - transpiler pour extensions

**Impact** : Chargement initial plus rapide, meilleur caching.

### Settings Updates

**Réduction de duplication** :

Helper générique `update_settings_section()` pour toutes les mises à jour :
- Moins de code répété
- Pattern fonctionnel
- Plus maintenable

### File Search Optimizations

**Refactoring parsers** :
- Fonctions helper `parse_file_category()` et `parse_category_filter()`
- Réduction de duplication de code
- Meilleur error handling

---

## 🔧 Bug Fixes

### Clippy Warnings

Fixes pour tous les warnings Clippy Rust :

- `let-else` patterns utilisés (ex: `if let ... && ... { }`)
- Suppression de `.unwrap()` inutiles
- Pattern matching amélioré
- Code plus idiomatique

### Search State Management

**Fix race conditions** :

- Protection anti-réponses obsolètes via `latestSearchId`
- Index de sélection borné correctement
- Pas de reset quand on affiche les suggestions

### Update Check

**Update check silencieux** :

- Utilise `console.debug()` au lieu de `console.error()`
- Normal qu'il échoue en dev
- Pas de spam de logs inutiles
- Flag `updateCheckDone` pour éviter double check

---

## 📝 Documentation Updates

### New Documentation Files

1. **[SHORTCUTS.md](../user-guide/SHORTCUTS.md)** - Référence complète des raccourcis
2. **[FEATURES.md](../architecture/FEATURES.md)** - Guide complet des fonctionnalités
3. **[UPDATES_2025-01.md](./UPDATES_2025-01.md)** (ce fichier) - Résumé des updates

### Updated Documentation

1. **[README.md](../../README.md)**
   - Hotkey par défaut mis à jour
   - Nouvelles touches de navigation listées
   - Liens vers nouvelles docs

2. **[ARCHITECTURE.md](../architecture/ARCHITECTURE.md)**
   - Système de hotkey documenté en détail
   - Détection de conflits expliquée
   - Best-effort registration

3. **[docs/README.md](../README.md)**
   - Index mis à jour avec nouvelles docs
   - Section changelog ajoutée
   - Hiérarchie améliorée

### Changelog

**Nouveau CHANGELOG.md professionnel** :

- Format [Keep a Changelog](https://keepachangelog.com/)
- Version 0.0.1 complètement documentée
- Toutes les fonctionnalités listées
- Notes techniques et platform support
- Known issues documentés

---

## 🔄 Migration Guide

Pour les utilisateurs existants :

### Hotkey Change

**Action requise** : Aucune si `Ctrl+Space` est disponible

Si vous aviez configuré un hotkey personnalisé, il sera préservé dans vos settings.

Si `Ctrl+Space` est en conflit avec une autre app :
1. Ouvrir Settings (`Ctrl+,` si ça fonctionne encore)
2. Aller dans Hotkeys
3. Configurer un nouveau hotkey
4. Sauvegarder

### Extensions

Les extensions existantes continuent de fonctionner.

**Nouvelles capacités** :
- Hot reload automatique
- Pas besoin de redémarrer Volt après install/update

### Settings

Tous les settings existants sont préservés.

**Nouveaux settings** :
- Shortcuts supplémentaires configurables (à venir)
- Nouvelles options de navigation

---

## 🎯 Breaking Changes

### Pour Développeurs de Plugins

**PluginRegistry** :

Nouvelles méthodes :
```typescript
isInitialized(): boolean
markInitialized(): void
isRegistered(pluginId: string): boolean
```

**Impact** : Prévient les double-enregistrements en StrictMode

**Action requise** : Aucune si vous utilisez le registry correctement

### Pour Extensions

**Validation d'extension ID** :

Les IDs doivent maintenant :
- Être alphanumériques + `-`, `_`, `.`
- Max 128 caractères
- Pas de path traversal (`..`, `/`, `\`)

**Impact** : Extensions mal nommées seront rejetées

**Action requise** : Renommer si nécessaire

---

## 📊 Statistics

### Code Changes

- **Files changed** : ~30 fichiers
- **Lines added** : ~2000
- **Lines removed** : ~500
- **Net growth** : +1500 lignes

### New Features

- ✅ Changelog view
- ✅ Enhanced keyboard shortcuts (9 nouveaux raccourcis)
- ✅ Auto-scroll selection
- ✅ Plugin keyword boosting
- ✅ Extension hot reload
- ✅ Game launcher fixes
- ✅ Calculator enhancements

### Improvements

- ✅ Hotkey system refactoring
- ✅ View state management
- ✅ Extension security
- ✅ Performance optimizations
- ✅ Documentation complète
- ✅ Code quality (Clippy fixes)

**Note**: Cette version marque la première release publique stable de Volt.

---

## 🚧 Known Issues

Aucun bug critique identifié dans cette version.

**Points à surveiller** :
- Performance avec >10 000 fichiers indexés
- Compatibilité hotkeys sur certaines distributions Linux
- Détection de jeux exotiques (launchers non-standard)

---

## 🔮 What's Next

### Short-term (Q1 2025)

- [ ] Settings export/import
- [ ] Favorites system
- [ ] Custom themes
- [ ] More plugin examples
- [ ] Translation improvements

### Medium-term (Q2 2025)

- [ ] Cloud sync (optional)
- [ ] Plugin marketplace
- [ ] Advanced search filters
- [ ] Window animations customization
- [ ] Performance profiler

### Long-term

- [ ] Mobile companion app
- [ ] Team/Enterprise features
- [ ] API for external integrations
- [ ] Machine learning suggestions

---

## 🙏 Acknowledgments

Merci à tous les testeurs et contributeurs pour leurs retours !

Pour signaler un bug ou suggérer une fonctionnalité :
- GitHub Issues : [github.com/VoltLaunchr/Volt/issues](https://github.com/VoltLaunchr/Volt/issues)
- Discussions : [github.com/VoltLaunchr/Volt/discussions](https://github.com/VoltLaunchr/Volt/discussions)

---

Last updated: January 1, 2026
Version: 0.0.2
