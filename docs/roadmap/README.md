# Volt — Roadmap Produit

> **Volt** est un lanceur d'applications keyboard-first, rapide et extensible, construit avec Tauri v2 + React + TypeScript.

## Version actuelle : v0.0.4

Volt est fonctionnel et utilisable au quotidien. Le core flow (ouvrir → chercher → lancer → fermer) est stable sur Windows, macOS et Linux. 9 plugins builtin frontend, 3 plugins backend Rust, un systeme de settings complet, l'auto-update, et un pipeline CI/CD multi-plateforme sont en place.

L'objectif immediat est d'atteindre la **v1.0** — une version installable par des non-developpeurs sans avertissements systeme (code signing) ni bugs non diagnostiques (logging/tests deja en place).

## Documents

| Document | Description |
|----------|-------------|
| [Roadmap produit](./PRODUCT_ROADMAP.md) | Phases de developpement v1.0 → v2.x avec perspective utilisateur |
| [Analyse concurrentielle](./COMPETITIVE_ANALYSIS.md) | Positionnement vs Alfred, Raycast, PowerToys Run, Ulauncher |
| [Roadmap technique](../build-release/ROADMAP.md) | Milestones detailles avec fichiers modifies, criteres d'acceptation, estimations |
| [Plan historique (M0-M5)](../build-release/IMPLEMENTATION_PLAN.md) | Journal des milestones fondateurs completes |

## Principes de priorisation

1. **Stabilite avant features** — un bug sur le flow principal passe avant tout nouveau milestone.
2. **Pas de feature sans test** — tout nouveau code vient avec au moins un test.
3. **Pas de refactor speculatif** — les refactors servent une feature concrete.
4. **Les docs suivent le code** — chaque milestone termine met a jour la doc et le changelog.
5. **Release early** — une petite release toutes les 2-3 semaines vaut mieux qu'une grosse tous les 3 mois.

## Contribuer

Les contributions sont les bienvenues. Consultez [CONTRIBUTING.md](../../CONTRIBUTING.md) pour les conventions et le workflow PR. La roadmap produit indique les priorites — si vous voulez travailler sur un item, ouvrez une issue pour coordonner.

---

_Derniere mise a jour : 12 avril 2026_
