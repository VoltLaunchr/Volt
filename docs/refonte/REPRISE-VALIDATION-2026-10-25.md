# Reprise du lot local — 25 octobre 2026

Le lot est encore local sur `dev`, au-dessus de `1400f8ad`. Le présent bilan
porte sur les sources du working tree ; il ne constitue pas une validation
de CI Linux/macOS ni une validation de publication Store.

## Corrections finalisées

- Le cache de frecency conserve la date la plus récente quand deux réponses
  arrivent dans l’ordre inverse et rejette les dates négatives/non finies.
- Le fallback Wayland utilise un processus asynchrone : le délai couvre
  l’écriture sur stdin et la sortie, l’annulation tue le processus enfant,
  les sorties inutilisées ne peuvent plus remplir un pipe bloquant.
  Les helpers inutilisés auparavant masqués par `allow(dead_code)` sont retirés.
- Les exclusions Windows Search sont publiées après chargement et sauvegarde
  des paramètres, même sans indexation au démarrage. Le test couvre aussi
  `.voltignore` hors des racines indexées.
- Le rapport de diagnostic inclut le churn du watcher, limité à 600 entrées,
  avec des labels génériques et sans chemins de racines.
- Le correctif de dépendances `b48ebfa`, poussé après le merge de #142, est
  repris localement. Zod est également fixé en 4.6.6 après le nouvel avis npm.

## Validation exécutée

| Contrôle | Résultat |
| --- | --- |
| Vitest 4.1.12, suite complète avec deux workers | 56 fichiers, 513 tests réussis |
| TypeScript puis Vite 8.2.4 | Build réussi |
| ESLint, dépôt complet | 0 erreur, 24 avertissements |
| `cargo fmt --check` | Réussi |
| `cargo test --workspace --lib --features tantivy-search` | 485 réussis, 2 ignorés |
| `cargo test --workspace --lib --no-default-features --features sqlcipher,bundled-onnxruntime` | 474 réussis, 2 ignorés |
| Clippy `--all-targets --features tantivy-search -- -D warnings` | Réussi |
| Clippy `--all-targets --no-default-features --features sqlcipher -- -D warnings` | Réussi |
| `pnpm audit --audit-level=high`, via Corepack/pnpm 11.24.0 | Réussi ; 1 avis faible |
| Bindings TS après les tests Rust | Aucun changement supplémentaire |
| Syntaxe des trois scripts PowerShell de build/packaging MSIX | Réussie |

Les deux tests Rust ignorés sont le benchmark manuel de filtrage et le helper
de processus factice appelé explicitement par les tests Wayland. Ces tests
de processus passent sous Windows et ne manipulent pas le presse-papiers.
Les logs sont conservés localement dans `target/reprise-validation-2026-10-25/`
(dossier ignoré par Git).

## Avant publication

Les tests sous un vrai compositeur Wayland et le smoke test des snippets
globaux restent manuels. Pour MSIX, le paquet de test existant conserve le hash
du rapport du 21 octobre ; aucun paquet Volt n’est installé sur la machine.
Installation, lancement sous identité MSIX, autostart, notifications et WACK
restent donc à effectuer. Le paquet existant ne valide pas les sources actuelles.

## Découpage des commits à préparer

1. Dépendances et lockfile audités.
2. Classement unifié et frecency des commandes, avec leurs types/tests.
3. Indexation : exclusions, watcher, diagnostics et paramètres associés.
4. Compatibilité Linux/Wayland et corrections de lifecycle/runtime restantes.
5. Saveur Store et packaging MSIX, avec les limites de validation explicites.
6. Documentation transversale.

Les modifications récentes de présentation des paramètres sont arrivées en
parallèle et doivent garder leur propre périmètre. Les captures Playwright
locales ne font pas partie de ces commits. Les quatre stashes historiques
sont conservés ; les anciens changements de version ne doivent pas être
réappliqués sur la version courante sans comparaison.
